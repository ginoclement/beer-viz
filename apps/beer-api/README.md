# beer-api

Read-only query API over the beer recipe corpus, so the per-recipe views scale
to hundreds of thousands of recipes without shipping the corpus to the browser.
DuckDB-backed, embedded (no DB server), served read-only.

## Why

`aggregates.json` (Ingredients) stays static and bounded forever. But the
per-recipe views — **Style Explorer** and **3D Recipe Space** — need per-recipe
rows, which at 300k can't be downloaded. This API answers filtered/paged queries
instead: the browser asks "recipes with OG in [x,y], limit 100" and gets 100
rows, never the whole set.

## Data model

`build-db.mjs` builds `data/beer.duckdb` from the repo's generated JSON
(`src/generated/corpus.json` + `recipeProjection.json`) and stages
`aggregates.json` beside it. Tables: `recipes`, `recipe_malts`, `recipe_hops`,
`projection` (one row per recipe × method × blend). The DB is a disposable
projection of the JSON — rebuild and swap the file to publish a new crawl; the
API opens it read-only, so DuckDB's single-writer limit never applies.

## Endpoints (under `BASE_PATH`, default `/beer`)

| Route | Purpose |
|---|---|
| `GET /health` | liveness |
| `GET /meta` | counts, families, available projection method/blend pairs |
| `GET /recipes?ogMin&ogMax&…&family&style&q&sort&dir&limit&offset` | filtered, paged recipes (Style Explorer). Returns `{total,limit,offset,recipes}` |
| `GET /recipe/:id` | full detail: vitals + grain bill + hop schedule |
| `GET /projection?method=pca|umap&blend=0|0.5|1&limit=8000` | stable sampled 3D points with color/hover fields |
| `GET /aggregates` | the Ingredients rollups (also fine to keep static on the frontend) |

Range filters accept any of `og/fg/abv/ibu/srm` × `Min/Max`. All queries are
parameterized; responses carry `Cache-Control` so Cloudflare caches them at the
edge (most queries never hit the server twice).

## Build & run

```bash
# from the repo root: make sure the generated data exists
npm run build:data                 # -> src/generated/{corpus,recipeProjection,aggregates}.json

cd apps/beer-api
npm ci
npm run build:db                   # -> data/beer.duckdb + data/aggregates.json
npm start                          # local: http://localhost:8080/beer/health
```

Config via env: `PORT`, `BASE_PATH` (`/beer` behind path routing, `""` for a
subdomain), `DB_PATH`, `AGG_PATH`, `CORS_ORIGIN` (lock to your frontend origin in
prod), `POOL_SIZE`.

## Deploy (Docker + Cloudflare Tunnel)

```bash
docker network create apis                 # shared network, one time
cd apps/beer-api && npm ci && npm run build:db
docker compose up -d --build               # joins "apis"; no host ports
```

Then bring up the tunnel in `infra/cloudflared/` (see its README). cloudflared
routes `apis.ginoclement.com/beer/*` → `http://beer-api:8080`. Verify end to end:

```bash
curl https://apis.ginoclement.com/beer/health
curl "https://apis.ginoclement.com/beer/recipes?abvMin=12&srmMin=40&limit=3"
```

**Publishing a fresh crawl:** rebuild the data (`npm run build:db`), then
`docker compose restart beer-api`. The container reopens the swapped file.

## Next step (frontend)

The Vercel frontend still imports `corpus.json` directly. Rewiring the Style
Explorer and 3D Recipe Space to `fetch()` from this API (behind an env-set base
URL) is the follow-up that makes the whole thing scale; the Ingredients view
keeps reading static `aggregates.json`.
