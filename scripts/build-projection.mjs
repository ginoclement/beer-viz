// Precompute the 3D recipe-space projection so the browser renders coordinates
// instead of running PCA/UMAP over thousands of points on the main thread.
// Runs as part of build:data (after build-recipes.mjs writes corpus.json), so
// the coordinates are always fresh on Vercel from the committed recipes.jsonl.
//
// PCA is cheap (~100ms/blend). UMAP is the expensive one (~15s/blend) but it
// runs here at build time, not in the user's browser. Set BUILD_UMAP=0 to skip
// UMAP for a fast local iteration (the view disables the UMAP toggle when the
// data is absent).

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRecipeProjections } from './lib/recipeProjection.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const corpusPath = join(root, 'src/generated/corpus.json')
if (!existsSync(corpusPath)) {
  console.error('Missing src/generated/corpus.json — run build-recipes.mjs first.')
  process.exit(1)
}

const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')).recipes
const withUmap = process.env.BUILD_UMAP !== '0'

const t0 = Date.now()
const proj = buildRecipeProjections(corpus, { umap: withUmap, log: (m) => console.log('  ' + m) })
writeFileSync(join(root, 'src/generated/recipeProjection.json'), JSON.stringify(proj))
console.log(
  `wrote recipeProjection.json: ${proj.ids.length} recipes · pca + ${withUmap ? 'umap' : 'no umap'} · ${((Date.now() - t0) / 1000).toFixed(1)}s`,
)
