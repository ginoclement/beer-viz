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
| **Matrix** | The full pairwise similarity matrix as a heatmap, rows ordered by average-linkage hierarchical clustering so families form bright blocks. |
| **Guidelines** | Compare BJCP 2021 vs BJCP 2015 vs Brewers Association 2017: vital-statistic drift per matched style (with fuzzy name matching), styles added/removed, and both guidelines embedded into one shared PCA map. |
| **My Recipes** | Import a **Brewfather JSON** export, a **BeerXML** file, or manual vitals. The recipe gets BJCP-vocabulary tags derived from its numbers, is projected into the current style space with the fitted PCA/UMAP transform, ranked against every style, and drawn as a diamond in the 3D view. Everything runs client-side; nothing is uploaded. |

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

`dist/` is fully static with relative asset paths (`base: './'`), so it can be
served from any subdirectory — copy it to wherever `/beer` is served from, or
use the included GitHub Actions workflow (`.github/workflows/deploy.yml`) to
publish to GitHub Pages on pushes to `main`.

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
