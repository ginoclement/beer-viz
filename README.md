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
into a style family from its name/tagline/description.

**On crawling recipe sites**: Brewer's Friend has no public recipe API and its
terms prohibit automated scraping — individual recipes export as BeerXML, which
My Recipes imports with full ingredients. Brewfather's API serves only your own
recipes (credential-scoped): run
`BREWFATHER_USER_ID=… BREWFATHER_API_KEY=… node scripts/sync-brewfather.mjs`
(credentials from Brewfather → Settings → API with the *Read Recipes* scope) to
pull your recipes into `data/brewfather/` as importable JSON files.

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
