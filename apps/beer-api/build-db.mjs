// Build the read-only query database the API serves, from the generated JSON
// (corpus.json + recipeProjection.json). This is the "build offline, mount the
// file, serve read-only" pattern: rebuild produces a fresh beer.duckdb that you
// swap in and restart the container — no runtime writes, so DuckDB's
// single-writer limit never bites.
//
//   GENERATED_DIR   where corpus.json / recipeProjection.json live
//                   (default ../../src/generated)
//   DATA_DIR        where the served DB + aggregates.json are written
//                   (default ../../data — the repo's one canonical data dir)
//   DB_PATH         output database (default $DATA_DIR/beer.duckdb)
//
// Scales to the full corpus: DuckDB reads the JSON with read_json and stores it
// columnar, so range filters over hundreds of thousands of recipes stay fast.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DuckDBInstance } from '@duckdb/node-api'

const here = dirname(fileURLToPath(import.meta.url))
const GENERATED_DIR = resolve(process.env.GENERATED_DIR ?? join(here, '../../src/generated'))
const DATA_DIR = resolve(process.env.DATA_DIR ?? join(here, '../../data'))
const DB_PATH = resolve(process.env.DB_PATH ?? join(DATA_DIR, 'beer.duckdb'))
const corpusPath = join(GENERATED_DIR, 'corpus.json')
const projPath = join(GENERATED_DIR, 'recipeProjection.json')

for (const [label, p] of [
  ['corpus.json', corpusPath],
  ['recipeProjection.json', projPath],
]) {
  if (!existsSync(p)) {
    console.error(`Missing ${label} at ${p}. Run \`npm run build:data\` in the repo root first.`)
    process.exit(1)
  }
}

mkdirSync(dirname(DB_PATH), { recursive: true })
// Fresh build every time — the DB is a disposable projection of the JSON.
for (const f of [DB_PATH, `${DB_PATH}.wal`]) if (existsSync(f)) rmSync(f)

// Flatten the parallel-array projection into NDJSON rows DuckDB can read
// directly: one row per (recipe, method, blend).
const proj = JSON.parse(readFileSync(projPath, 'utf8'))
const projNdjson = join(dirname(DB_PATH), 'projection.ndjson')
{
  const rows = []
  const methods = { pca: proj.pca, ...(proj.umap ? { umap: proj.umap } : {}) }
  for (const [method, byBlend] of Object.entries(methods)) {
    for (const [blend, coords] of Object.entries(byBlend)) {
      for (let i = 0; i < proj.ids.length; i++) {
        const c = coords[i]
        rows.push(JSON.stringify({ recipe_id: proj.ids[i], method, blend: +blend, x: c[0], y: c[1], z: c[2] }))
      }
    }
  }
  writeFileSync(projNdjson, rows.join('\n') + '\n')
  console.log(`flattened projection: ${rows.length} rows`)
}

const instance = await DuckDBInstance.create(DB_PATH)
const db = await instance.connect()
const esc = (p) => p.replace(/'/g, "''")

console.log('loading corpus …')
await db.run(`
  CREATE TABLE _raw AS
  SELECT unnest(recipes) AS r
  FROM read_json('${esc(corpusPath)}', maximum_object_size => 4000000000);
`)

await db.run(`
  CREATE TABLE recipes AS SELECT
    r['id']::BIGINT                        AS id,
    r['name']::VARCHAR                     AS name,
    r['family']::VARCHAR                   AS family,
    r['origin']::VARCHAR                   AS origin,
    r['tagline']::VARCHAR                  AS tagline,
    TRY_CAST(r['year'] AS INTEGER)         AS year,
    r['styleGuess']['code']::VARCHAR       AS style_code,
    r['styleGuess']['name']::VARCHAR       AS style_name,
    r['vitals']['og']::DOUBLE              AS og,
    r['vitals']['fg']::DOUBLE              AS fg,
    r['vitals']['abv']::DOUBLE             AS abv,
    r['vitals']['ibu']::DOUBLE             AS ibu,
    r['vitals']['srm']::DOUBLE             AS srm,
    r['attenuation']::DOUBLE               AS attenuation,
    r['batchL']::DOUBLE                    AS batch_l,
    r['hopGpl']::DOUBLE                    AS hop_gpl,
    r['roast']::DOUBLE                     AS roast,
    r['yeast']::VARCHAR                    AS yeast
  FROM _raw;
`)
await db.run(`
  CREATE TABLE recipe_malts AS
  SELECT r['id']::BIGINT AS recipe_id, m['name']::VARCHAR AS name, m['pct']::DOUBLE AS pct, m['class']::VARCHAR AS class
  FROM _raw, unnest(r['malts']) AS t(m);
`)
await db.run(`
  CREATE TABLE recipe_hops AS
  SELECT r['id']::BIGINT AS recipe_id, h['name']::VARCHAR AS name, h['key']::VARCHAR AS key,
         h['g']::DOUBLE AS g, h['stage']::VARCHAR AS stage
  FROM _raw, unnest(r['hops']) AS t(h);
`)
await db.run(`DROP TABLE _raw;`)

console.log('loading projection …')
await db.run(`CREATE TABLE projection AS SELECT * FROM read_json_auto('${esc(projNdjson)}');`)

// Point lookups (detail, joins) benefit from an index; range filters ride
// DuckDB's automatic min/max zonemaps.
await db.run(`CREATE INDEX idx_recipes_id ON recipes(id);`)
await db.run(`CREATE INDEX idx_malts_rid ON recipe_malts(recipe_id);`)
await db.run(`CREATE INDEX idx_hops_rid ON recipe_hops(recipe_id);`)
await db.run(`CREATE INDEX idx_proj ON projection(method, blend);`)

const counts = (await db.runAndReadAll(`
  SELECT (SELECT count(*) FROM recipes) recipes,
         (SELECT count(*) FROM recipe_malts) malts,
         (SELECT count(*) FROM recipe_hops) hops,
         (SELECT count(*) FROM projection) projection
`)).getRowObjectsJson()[0]

db.closeSync()
rmSync(projNdjson)

// Stage aggregates.json next to the DB so the container mounts one data dir.
const aggSrc = join(GENERATED_DIR, 'aggregates.json')
if (existsSync(aggSrc)) {
  writeFileSync(join(dirname(DB_PATH), 'aggregates.json'), readFileSync(aggSrc, 'utf8'))
  console.log('staged aggregates.json')
}

console.log('built', DB_PATH, counts)
