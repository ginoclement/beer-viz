// Read-only query API over the beer recipe corpus (DuckDB).
//
// Serves exactly what the per-recipe views need so the browser never downloads
// the corpus: filtered/paged recipes (Style Explorer), a sampled 3D projection
// (Recipe Space), and per-recipe detail. Aggregates (Ingredients) stay static,
// but are also served here for convenience.
//
// Config (env):
//   PORT         listen port (default 8080)
//   BASE_PATH    URL prefix, e.g. "/beer" behind cloudflared path routing, or
//                "" when it has its own subdomain (default "")
//   DATA_DIR     dir holding the served DB + aggregates.json (default ../../data)
//   DB_PATH      the DuckDB file built by build-db.mjs (default $DATA_DIR/beer.duckdb)
//   AGG_PATH     aggregates.json to serve at /aggregates (default $DATA_DIR/aggregates.json)
//   CORS_ORIGIN  comma-separated allowed origins, or "*" (default "*")
//   POOL_SIZE    read connections (default 6)

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { DuckDBInstance } from '@duckdb/node-api'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 8080)
const BASE_PATH = (process.env.BASE_PATH ?? '').replace(/\/$/, '')
const DATA_DIR = resolve(process.env.DATA_DIR ?? join(here, '../../data'))
const DB_PATH = resolve(process.env.DB_PATH ?? join(DATA_DIR, 'beer.duckdb'))
const AGG_PATH = resolve(process.env.AGG_PATH ?? join(DATA_DIR, 'aggregates.json'))
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*'
const POOL_SIZE = Number(process.env.POOL_SIZE ?? 6)

if (!existsSync(DB_PATH)) {
  console.error(`Missing ${DB_PATH}. Run \`npm run build:db\` first (see README).`)
  process.exit(1)
}

// ------------------------------------------------------- read-only connection pool
// One DuckDB connection runs one query at a time; a small pool lets concurrent
// requests proceed. The DB is opened read-only, so many readers are safe.
const instance = await DuckDBInstance.create(DB_PATH, { access_mode: 'READ_ONLY' })
const idle = []
for (let i = 0; i < POOL_SIZE; i++) idle.push(await instance.connect())
const waiters = []
const acquire = () =>
  idle.length ? Promise.resolve(idle.pop()) : new Promise((res) => waiters.push(res))
const release = (c) => (waiters.length ? waiters.shift()(c) : idle.push(c))

// params: array of ['d'|'i'|'big'|'s', value] — bound positionally ($1, $2, …).
async function query(sql, params = []) {
  const conn = await acquire()
  try {
    if (!params.length) return (await conn.runAndReadAll(sql)).getRowObjectsJson()
    const stmt = await conn.prepare(sql)
    params.forEach(([t, v], k) => {
      const i = k + 1
      if (t === 'd') stmt.bindDouble(i, v)
      else if (t === 'i') stmt.bindInteger(i, v)
      else if (t === 'big') stmt.bindBigInt(i, BigInt(v))
      else stmt.bindVarchar(i, String(v))
    })
    return (await stmt.runAndReadAll()).getRowObjectsJson()
  } finally {
    release(conn)
  }
}

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
const clampInt = (v, def, max) => Math.min(Math.max(parseInt(v) || def, 1), max)

// ----------------------------------------------------------------------- app

const app = Fastify({ logger: true })
await app.register(cors, { origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',') })

// Public read API → let Cloudflare cache it hard.
app.addHook('onSend', (req, reply, payload, done) => {
  if (req.method === 'GET' && !reply.getHeader('cache-control')) {
    reply.header('cache-control', 'public, max-age=300, s-maxage=3600')
  }
  done(null, payload)
})

const routes = (fastify, _opts, done) => {
  fastify.get('/health', async () => ({ ok: true }))

  fastify.get('/meta', async () => {
    const [counts] = await query(
      `SELECT (SELECT count(*) FROM recipes) AS recipes,
              (SELECT count(DISTINCT recipe_id) FROM projection) AS projected`,
    )
    const families = await query(
      `SELECT family, count(*)::INTEGER AS n FROM recipes GROUP BY 1 ORDER BY n DESC`,
    )
    const methods = await query(
      `SELECT DISTINCT method, blend FROM projection ORDER BY method, blend`,
    )
    return { counts, families, projection: methods }
  })

  // Style Explorer: recipes whose vitals fall in a (widened) window. Every
  // filter is optional; results are paged. Returns total for the pager.
  fastify.get('/recipes', async (req) => {
    const q = req.query
    const where = []
    const params = []
    const rangeCols = { og: 'og', fg: 'fg', abv: 'abv', ibu: 'ibu', srm: 'srm' }
    for (const [key, col] of Object.entries(rangeCols)) {
      const lo = num(q[`${key}Min`])
      const hi = num(q[`${key}Max`])
      if (lo != null) {
        where.push(`${col} >= $${params.length + 1}`)
        params.push(['d', lo])
      }
      if (hi != null) {
        where.push(`${col} <= $${params.length + 1}`)
        params.push(['d', hi])
      }
    }
    if (q.family) {
      where.push(`family = $${params.length + 1}`)
      params.push(['s', q.family])
    }
    if (q.style) {
      where.push(`style_code = $${params.length + 1}`)
      params.push(['s', q.style])
    }
    if (q.q) {
      where.push(`name ILIKE $${params.length + 1}`)
      params.push(['s', `%${q.q}%`])
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const sortCols = { abv: 'abv', ibu: 'ibu', srm: 'srm', og: 'og', name: 'name' }
    const sortCol = sortCols[q.sort] ?? 'abv'
    const dir = String(q.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'
    const limit = clampInt(q.limit, 100, 500)
    const offset = Math.max(parseInt(q.offset) || 0, 0)

    const [{ total }] = await query(`SELECT count(*)::INTEGER AS total FROM recipes ${clause}`, params)
    const rows = await query(
      `SELECT id, name, family, style_code, style_name, og, fg, abv, ibu, srm,
              attenuation, hop_gpl, roast, batch_l
       FROM recipes ${clause}
       ORDER BY ${sortCol} ${dir} NULLS LAST, id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, ['i', limit], ['i', offset]],
    )
    return { total, limit, offset, recipes: rows.map((r) => ({ ...r, id: Number(r.id) })) }
  })

  // Full detail for one recipe: vitals + grain bill + hop schedule.
  fastify.get('/recipe/:id', async (req, reply) => {
    const id = req.params.id
    const [recipe] = await query(`SELECT * FROM recipes WHERE id = $1`, [['big', id]])
    if (!recipe) return reply.code(404).send({ error: 'not found' })
    const malts = await query(
      `SELECT name, pct, class FROM recipe_malts WHERE recipe_id = $1 ORDER BY pct DESC`,
      [['big', id]],
    )
    const hops = await query(
      `SELECT name, key, g, stage FROM recipe_hops WHERE recipe_id = $1 ORDER BY g DESC`,
      [['big', id]],
    )
    return { recipe: { ...recipe, id: Number(recipe.id) }, malts, hops }
  })

  // Recipe Space: a stable sampled subset of the precomputed projection, with
  // the fields needed to render/hover/color — never the whole corpus.
  fastify.get('/projection', async (req) => {
    const method = req.query.method === 'umap' ? 'umap' : 'pca'
    const blend = [0, 0.5, 1].includes(num(req.query.blend)) ? num(req.query.blend) : 0.5
    const limit = clampInt(req.query.limit, 8000, 60000)
    const points = await query(
      `SELECT r.id, r.name, r.family, r.style_code, r.abv, r.ibu, r.srm, p.x, p.y, p.z
       FROM projection p JOIN recipes r ON r.id = p.recipe_id
       WHERE p.method = $1 AND p.blend = $2
       ORDER BY hash(p.recipe_id)
       LIMIT $3`,
      [['s', method], ['d', blend], ['i', limit]],
    )
    return { method, blend, count: points.length, points: points.map((p) => ({ ...p, id: Number(p.id) })) }
  })

  // Ingredients rollups — small and bounded; served from the file as-is.
  let aggCache = null
  fastify.get('/aggregates', async (reply) => {
    if (!aggCache) {
      if (!existsSync(AGG_PATH)) return { error: 'aggregates.json not mounted' }
      aggCache = readFileSync(AGG_PATH, 'utf8')
    }
    return JSON.parse(aggCache)
  })

  done()
}

await app.register(routes, { prefix: BASE_PATH })
await app.listen({ port: PORT, host: '0.0.0.0' })
console.log(`beer-api listening on :${PORT}  base="${BASE_PATH || '/'}"  db=${DB_PATH}`)
