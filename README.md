# Beer Style Space

An interactive data-analysis playground for beer style guidelines, built to live at
[ginoclement.com/beer](https://ginoclement.com/beer). Every style with published
vital statistics becomes a point in a ~60-dimensional feature space; the app
reduces, clusters, and compares those spaces **live in the browser** — and lets
you drop your own recipes into the same math.

## Views

| Tab | What it shows |
| --- | --- |
| **3D Style Space** | PCA or UMAP projection of all styles into 3D (three.js). Color by live k-means cluster (k slider, silhouette readout) or by the style's actual SRM beer color. Hover for vitals, click for the full guideline entry. |
| **Similarity** | Pick any style → ranked nearest neighbors with the Jaccard (tag) and vital-statistics parts of the score shown separately, plus a force-directed network of all styles linked above a similarity threshold. |
| **Vital Statistics** | ABV × IBU scatter and OG × attenuation scatter (points painted their true SRM color), and a "color ladder" of every style's published SRM range. |
| **Matrix** | The full pairwise similarity matrix as a heatmap, rows ordered by average-linkage hierarchical clustering so families form bright blocks — plus the same clustering drawn as a dendrogram ("family tree"). |
| **Guidelines** | Compare BJCP 2021 vs BJCP 2015 vs Brewers Association 2017: vital-statistic drift per matched style (with fuzzy name matching), styles added/removed, and both guidelines embedded into one shared PCA map. |
| **Hops** | 210 hop varieties with merged producer chemistry: alpha/beta acids, cohumulone, total oil, oil composition (myrcene, humulene, caryophyllene, farnesene, geraniol, linalool), 9-axis sensory radar, curated thiol-potential classes, pedigree, and producer substitute lists. Includes a hop-aroma PCA map, a substitution & kinship network, and a **style↔hop pairing engine**: hops are scored for any style by (1) cosine match between the hop's measured aroma profile and the hop character mined from the style's guideline prose, (2) regional tradition, and (3) alpha-acid fit to the style's bitterness load — with the same engine run in reverse to list each hop's best-fit styles. |
| **Ingredients** | What brewers actually put in the kettle, computed from 414 real published recipes with complete ingredient bills (BrewDog DIY Dog): a hop-usage leaderboard split by addition stage (bittering / late / dry) with median g/L doses, average grist composition per style family, and ingredients→outcome scatters (hop g/L vs IBU, roast % vs SRM). Every recipe opens with its full grain bill and hop schedule; every hop cross-links to its chemistry on the Hops tab. |
| **Recipes → Style Explorer** | Pick a target BJCP style and see every corpus recipe whose OG/FG/ABV/IBU/SRM fall inside that style's published ranges (with a tolerance slider to admit near-misses), laid out on a parallel-coordinates plot — the style's range shown as a shaded band, each recipe a line painted its SRM color — plus a ranked, clickable list to compare and open any recipe's full bill. |
| **Recipes → 3D Recipe Space** | PCA/UMAP projection of the whole recipe corpus into 3D from a feature space of **vitals + ingredients** (z-scored OG/FG/ABV/IBU/color/attenuation/BU:GU, malt-class fractions, and common-hop presence). A *vitals ⇄ ingredients* slider tilts what drives the layout; recolor by family, beer color, or strength. Instanced rendering built to scale to thousands of recipes as the crawl lands. |
| **Browse** | Full-text search over names, categories, tags, and descriptions; tag filters; sortable columns; true-color SRM swatches. |
| **My Recipes** | Import a **Brewfather JSON** export, a **BeerXML** file (Brewer's Friend recipes export as BeerXML), or manual vitals. The recipe gets BJCP-vocabulary tags derived from its numbers, is projected into the current style space with the fitted PCA/UMAP transform, ranked against every style, and drawn as a diamond in the 3D view with dashed tethers to its top-3 matches. Imports that carry ingredient lists show their grist breakdown and hop schedule too. Recipes persist in localStorage; everything runs client-side and nothing is uploaded. |

## The analysis

- **Features** per style: z-scored OG, FG, ABV, IBU, log SRM, apparent
  attenuation, BU:GU ratio, plus one column per guideline tag. A *tag weight*
  slider re-balances the numeric and tag blocks.
- **Dimensionality reduction**: PCA (power iteration with deflation, with a
  `transform()` for new points) or UMAP (`umap-js`), both seeded/deterministic.
- **Clustering**: seeded k-means++ with restarts; mean silhouette shown so you
  can judge a k. Heatmap ordering uses average-linkage hierarchical clustering.
- **Similarity**: `alpha * Jaccard(tags) + (1 - alpha) * closeness(vitals)`,
  with closeness = euclidean distance on z-scored vitals rescaled by the
  95th-percentile pairwise distance.
- **Flavor-text mining**: a curated lexicon of ~50 beer sensory descriptors
  (caramel, clove, grapefruit, funky, …) grouped by malt / hops /
  fermentation / mouthfeel is matched against each style's aroma, flavor,
  and impression prose. The fingerprint appears in every style's detail
  panel, and the Similarity view can rank styles purely by shared flavor
  language.
- **Cluster auto-naming**: k-means clusters are labeled by their most
  distinctive tags (highest lift vs. the overall tag frequency), so the
  legend reads "ipa-family · high-strength" instead of "Cluster D".
- **Shareable URLs**: the active view, guideline, and selected style live in
  the URL hash (e.g. `#space/bjcp2021/21A`).
- Styles without published vital statistics (e.g. Fruit Beer, Experimental
  Beer) are excluded from the quantitative space but remain browsable; the
  Brewers Association file's "varies with style" placeholder ranges are
  detected and treated as absent (see `scripts/build-data.mjs`).

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # vitest suite for the analysis library
npm run build      # rebuilds src/generated/guides.json, typechecks, bundles to dist/
```

The site deploys on Vercel (framework auto-detected as Vite; `npm run build`
regenerates the data files and bundles to `dist/`), redeploying on every push
to the production branch. `dist/` is fully static with relative asset paths
(`base: './'`), so the same build also works from any subdirectory on any
static host — e.g. wherever `/beer` is served from.

`node scripts/shoot.mjs <outdir>` screenshots every view against
`vite preview` via Playwright — handy as a smoke test.

## Data

Vendored in `data/raw/` from the MIT-licensed
[beerjson/bjcp-json](https://github.com/beerjson/bjcp-json) dataset:
BJCP 2021 and 2015 Beer Style Guidelines (© Beer Judge Certification Program)
and the Brewers Association 2017 Beer Style Guidelines (© Brewers Association).
`npm run build:data` normalizes all three into one schema, cleans a handful of
data glitches (gravities stored in points, placeholder ranges), and synthesizes
BJCP-vocabulary tags for styles that ship without tags so Jaccard similarity
works across guidelines (marked `tagsSynthesized`).

Recipe corpus (`data/raw/recipes/`, built by `scripts/build-recipes.mjs`):
BrewDog's **DIY Dog** — 415 published commercial recipes with complete grain
bills, hop schedules, and yeast (recipes © BrewDog, released publicly for
homebrewers), vendored from the MIT-licensed
[alxiw/punkapi](https://github.com/alxiw/punkapi) JSON archive. The build
normalizes gravities (fixing a few swapped OG/FG pairs in the source), folds
40+ hop-timing spellings into three stages, classifies every malt into grist
families, matches ~92% of hop additions to the hop-chemistry dataset (the rest
are non-hop "twists" like coffee and citrus peel), and classifies each recipe
into a style family from its name/tagline/description. Each recipe is also
enriched with its **apparent attenuation** (from OG/FG), **mash** temperature and
duration and **fermentation** temperature (where the source records them), and a
best-fit **BJCP style** — the style whose published OG/FG/ABV/IBU/SRM ranges most
contain the recipe's vitals (the same test the Style Explorer runs live). Method,
efficiency, and per-hop boil times are carried as schema slots that populate from
the Brewer's Friend crawl.

**On crawling recipe sites**: Brewer's Friend has no public recipe API and its
terms prohibit automated scraping — individual recipes export as BeerXML, which
My Recipes imports with full ingredients. Brewfather's API serves only your own
recipes (credential-scoped): run
`BREWFATHER_USER_ID=… BREWFATHER_API_KEY=… node scripts/sync-brewfather.mjs`
(credentials from Brewfather → Settings → API with the *Read Recipes* scope) to
pull your recipes into `data/brewfather/` as importable JSON files.

**Brewer's Friend crawler**: `scripts/crawl-brewersfriend.mjs` crawls the
public recipe listings under an access arrangement with Brewer's Friend
(IP-whitelisted on their side). `--rpm N` paces requests per minute (default
10) — set it to whatever rate they approve. It fetches serially, backs off
60s on 429/503, caches every page under `data/brewersfriend/cache/`, and
prefers each recipe's stable BeerXML export over HTML scraping. Output lands
in `data/brewersfriend/recipes.jsonl`, and `npm run build:data` folds it into
the recipe corpus automatically with `origin: 'brewersfriend'`.

**Deploying crawled recipes.** The site is built on Vercel from *committed*
sources — `build:data` regenerates `src/generated/recipes.json` from the raw
data in the repo, so it only sees recipes that are checked in. The parsed
corpus `data/brewersfriend/recipes.jsonl` is therefore **committed** (the raw
page cache under `cache/` and the crawl `progress.json` stay git-ignored). To
publish new crawled recipes: run the crawl, then
`git add data/brewersfriend/recipes.jsonl && git commit && git push` — Vercel's
build folds them into the deployed corpus. Note this makes the parsed recipe
data (names, vitals, ingredients, source URLs) public in this repo.

*Crash-safe resume*: a checkpoint at `data/brewersfriend/progress.json`
records the last fully-processed listing page and any permanently-skipped
recipe ids, written atomically after every page. If a crawl crashes or is
interrupted, just rerun the same command — it continues from the next listing
page instead of re-walking from the top, and skips recipes already saved
(transient network failures are left for retry; only unparseable pages are
recorded as skipped). Checkpoints are keyed by crawl mode, so the default
listing and each `--query "…"` track independently. `--start-page N` forces a
specific page; `--restart` ignores the checkpoint and re-walks the listings
from page 1 (already-collected recipes are still skipped, so no duplicates). Because the parser was written against
fixture markup, calibrate it on one real saved page first — your own recipe
pages are ideal: save one from the browser and run
`node scripts/crawl-brewersfriend.mjs --parse-file saved-page.html` (fully
offline); it prints what it extracted and flags anything the live markup
breaks. Parsers live in `scripts/lib/brewersfriend.mjs` with tests in
`tests/brewersfriend.test.ts`.

**How the app scales (the browser never loads the whole corpus).** The full
crawl is expected to reach several GB — far too much to ship to the browser.
So `build:data` (`scripts/build-recipes.mjs`, which Vercel runs) emits two slim,
app-facing files alongside the fat `recipes.json`, and the app reads only these:

- `src/generated/aggregates.json` — the rollups the **Ingredients** view renders
  (hop leaderboard, grist by family + malt breakdown, family outcomes), keyed by
  style family. Bounded in size; O(1) in corpus size for the browser.
- `src/generated/corpus.json` — a **slim per-recipe** row (everything the Style
  Explorer, 3D Recipe Space, outcome scatter, and recipe detail need, minus the
  prose description, plus precomputed hop-g/L and roast share) so the per-recipe
  views never touch the fat corpus.

Both regenerate in `build:data`, so they are always fresh on Vercel from the
committed `recipes.jsonl` — no separate step, no stale artifacts. The fat
`recipes.json` stays local-only (git-ignored) as the DuckDB input below.

**Recipe corpus exploration (DuckDB)**: a separate, optional analytics tier for
ad-hoc querying of the full corpus. `scripts/build-corpus.mjs` loads it into
[DuckDB](https://duckdb.org), an embedded columnar engine — no server, no
container — building a durable star-schema database you can query by hand:

```
recipes.json  (GBs, local)  --DuckDB rollups-->  data/corpus-aggregates.json  (local exploration)
```

```
npm install            # @duckdb/node-api is an optionalDependency — plain installs and the Vercel build never touch it
npm run build:data     # normalize the corpus first (also emits the app's aggregates.json + corpus.json)
npm run build:corpus   # -> data/corpus.duckdb  +  data/corpus-aggregates.json (both local, git-ignored)
```

`read_json` streams the corpus, so the same pipeline scales from the 415-recipe
DIY Dog seed to the full crawl unchanged. The star schema and roll-up views live
in `scripts/duckdb/schema.sql` (`recipes`, `recipe_malts`, `recipe_hops`, plus
`malts`/`hops` dimensions and `v_malt_usage`, `v_grist_by_family`, `v_hop_usage`,
`v_hop_pairs`, `v_family_outcomes`, `v_origins`). The `data/corpus.duckdb` file
is a durable local database (git-ignored) you can also query by hand:

```
duckdb data/corpus.duckdb "SELECT * FROM v_hop_pairs LIMIT 20"
```

The build never runs on Vercel and Vercel never sees the corpus: production is
purely static — every chart reads precomputed JSON. If live queries over the
full corpus are ever wanted from the deployed app, the natural next step is
[MotherDuck](https://motherduck.com) (hosted DuckDB with an HTTP API) behind a
serverless function, or shipping a slimmed read-only `.duckdb`/Parquet subset to
query in-browser with `@duckdb/duckdb-wasm` — neither is needed for the
precompute-and-ship model above.

Hop chemistry (`data/raw/hops/`, built by `scripts/build-hops.mjs`) merges the
MIT-licensed [kasperg3/HopDatabase](https://github.com/kasperg3/HopDatabase)
aggregation (Yakima Chief, Barth-Haas, Hopsteiner, Crosby published ranges and
sensory spider charts) with numeric chemistry facts extracted from
[almet/hops-datasets](https://github.com/almet/hops-datasets). The build
validates every oil profile against physical envelopes (myrcene is always the
15–85% major fraction, geraniol/linalool always trace) and auto-corrects a
column rotation present in part of the upstream scrape; substitute lists and
pedigree strings come from the Hopsteiner catalog. Thiol-potential classes
(4MMP/3MH/3MHA) are hand-curated from published brewing-science literature and
are approximate by nature — thiol content varies strongly with harvest year and
biotransformation.
