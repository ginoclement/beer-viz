// Build-time analytics pipeline for the recipe corpus, powered by DuckDB.
//
// WHY THIS EXISTS
// ---------------
// The normalized corpus (src/generated/recipes.json) is expected to grow to
// several GB once the Brewer's Friend crawl lands. That is far too much to ship
// to the browser, and the visualizations never need the raw rows — they need
// *aggregates* (malt usage, hop pairings, grist by family, per-family outcome
// envelopes). Those are OLAP roll-ups, which is exactly what a columnar engine
// like DuckDB is built for.
//
// DuckDB is an embedded engine: there is no server to run and nothing for the
// deployed site to talk to. This script is the same kind of build step that
// build-recipes.mjs already is — it runs on your machine (or in CI), reads the
// fat corpus, and writes a small aggregates file the app can bundle. Vercel
// never runs this and never sees the corpus; it only builds the committed JSON.
//
//   corpus.json (GBs, local)  --DuckDB rollups-->  aggregates.json (small, shipped)
//
// USAGE
//   npm install            # @duckdb/node-api is an optionalDependency
//   npm run build:corpus   # -> data/corpus.duckdb + src/generated/aggregates.json
//
// The .duckdb file is a durable local star-schema you can also query by hand:
//   duckdb data/corpus.duckdb "SELECT * FROM v_hop_pairs LIMIT 20"

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const corpusJson = join(root, 'src/generated/recipes.json')
const dbPath = join(root, 'data/corpus.duckdb')
const schemaSql = join(root, 'scripts/duckdb/schema.sql')
const outFile = join(root, 'src/generated/aggregates.json')

// DuckDB is optional so a plain `npm install` (and the Vercel build) never
// depends on a native binding. Fail with guidance, not a stack trace.
let DuckDBInstance
try {
  ;({ DuckDBInstance } = await import('@duckdb/node-api'))
} catch {
  console.error(
    'DuckDB is not installed. This is an optional, local-only build step.\n' +
      'Install it with:  npm install --save-optional @duckdb/node-api\n' +
      'then re-run:       npm run build:corpus',
  )
  process.exit(1)
}

if (!existsSync(corpusJson)) {
  console.error(`Missing ${corpusJson}. Run \`npm run build:data\` first.`)
  process.exit(1)
}

mkdirSync(join(root, 'data'), { recursive: true })

const instance = await DuckDBInstance.create(dbPath)
const db = await instance.connect()

const rows = async (sql) => (await db.runAndReadAll(sql)).getRowObjectsJson()
const one = async (sql) => (await rows(sql))[0]

// 1. Ingest the corpus. read_json streams the file, so this scales from the
//    415-recipe DIY Dog seed to the full multi-GB crawl without change. Each
//    recipe stays a nested STRUCT in `recipe_raw`; the schema flattens it.
console.log('Loading corpus …')
await db.run(`
  CREATE OR REPLACE TABLE recipe_raw AS
  SELECT unnest(recipes) AS rec
  FROM read_json('${corpusJson.replace(/'/g, "''")}', maximum_object_size => 2000000000);
`)

// 2. Build the star schema and roll-up views.
console.log('Building star schema + rollup views …')
for (const stmt of readFileSync(schemaSql, 'utf8').split(/;\s*\n/)) {
  if (stmt.trim()) await db.run(stmt)
}

// 3. Report what landed.
const counts = await one(`
  SELECT
    (SELECT count(*) FROM recipes)::INTEGER      AS recipes,
    (SELECT count(*) FROM recipe_malts)::INTEGER AS malt_rows,
    (SELECT count(*) FROM recipe_hops)::INTEGER  AS hop_rows,
    (SELECT count(*) FROM malts)::INTEGER        AS distinct_malts,
    (SELECT count(*) FROM hops)::INTEGER         AS distinct_hops
`)
console.log(counts)

// 4. Export the aggregates the app consumes. Everything here is small and
//    precomputed; the browser reads these, never the corpus.
const aggregates = {
  builtFrom: JSON.parse(readFileSync(corpusJson, 'utf8')).source,
  counts,
  origins: await rows(`SELECT * FROM v_origins`),
  familyOutcomes: await rows(`SELECT * FROM v_family_outcomes`),
  maltUsage: await rows(`SELECT * FROM v_malt_usage LIMIT 60`),
  gristByFamily: await rows(`SELECT * FROM v_grist_by_family`),
  hopUsage: await rows(`SELECT * FROM v_hop_usage LIMIT 60`),
  hopPairs: await rows(`SELECT * FROM v_hop_pairs LIMIT 120`),
}

writeFileSync(outFile, JSON.stringify(aggregates))
db.closeSync()

console.log(`\nWrote ${outFile}`)
console.log(`Wrote star-schema database ${dbPath}`)
console.log(
  `Aggregates: ${aggregates.maltUsage.length} malts, ${aggregates.hopUsage.length} hops, ` +
    `${aggregates.hopPairs.length} hop pairs, ${aggregates.familyOutcomes.length} families.`,
)
