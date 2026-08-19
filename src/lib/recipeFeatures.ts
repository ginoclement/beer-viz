import type { CorpusRecipe } from './ingredients'
import { MALT_CLASS_ORDER } from './ingredients'
import { numericFeatures, NUMERIC_FEATURE_NAMES } from './features'
import type { Vitals } from './types'

/**
 * Feature engineering for the recipe corpus, so thousands of recipes can be
 * projected into 3D and clustered by what they actually are.
 *
 * Each recipe becomes a vector of three blocks:
 *   - vitals: the 7 z-scored numeric features (OG, FG, ABV, IBU, log SRM,
 *     attenuation, BU:GU) — the same ones the style space uses
 *   - grist: the fraction of the grain bill in each malt class (base, crystal,
 *     roasted, …)
 *   - hops: presence (0/1) of each of the most common hop varieties
 *
 * Every column is z-scored to unit variance, then the grist+hops (ingredient)
 * columns are scaled so the two halves contribute comparable variance at
 * blend = 0.5. `blend` in [0,1] tilts the projection: 0 = vitals only,
 * 1 = ingredients only. This is what makes ingredient-driven families (e.g.
 * Citra-forward hazy IPAs) separate out rather than everything collapsing onto
 * strength and color.
 */

export interface RecipeFeatureSpace {
  /** recipes that had full vitals and were included, in vector order */
  recipes: CorpusRecipe[]
  vectors: number[][]
  featureNames: string[]
  hopKeys: string[]
}

const hopKeyOf = (h: { key: string | null; name: string }) =>
  h.key ?? h.name.trim().toLowerCase()

function hasFullVitals(r: CorpusRecipe): boolean {
  const v = r.vitals
  return v.og != null && v.fg != null && v.abv != null && v.ibu != null && v.srm != null
}

export function buildRecipeFeatureSpace(
  corpus: CorpusRecipe[],
  { hopTopN = 40, blend = 0.5 }: { hopTopN?: number; blend?: number } = {},
): RecipeFeatureSpace {
  const recipes = corpus.filter(hasFullVitals)

  // Most common hop varieties across the corpus become the hop columns.
  const hopFreq = new Map<string, number>()
  for (const r of recipes) {
    const seen = new Set<string>()
    for (const h of r.hops) {
      const k = hopKeyOf(h)
      if (!seen.has(k)) {
        seen.add(k)
        hopFreq.set(k, (hopFreq.get(k) ?? 0) + 1)
      }
    }
  }
  const hopKeys = [...hopFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, hopTopN)
    .map(([k]) => k)
  const hopIndex = new Map(hopKeys.map((k, i) => [k, i]))

  const numericDim = NUMERIC_FEATURE_NAMES.length
  const maltDim = MALT_CLASS_ORDER.length
  const hopDim = hopKeys.length

  // Raw (un-scaled) rows.
  const raw = recipes.map((r) => {
    const num = numericFeatures(r.vitals as Vitals)
    const malt = new Array(maltDim).fill(0)
    for (const m of r.malts) {
      const idx = MALT_CLASS_ORDER.indexOf(m.class as (typeof MALT_CLASS_ORDER)[number])
      if (idx >= 0) malt[idx] += (m.pct ?? 0) / 100
    }
    const hop = new Array(hopDim).fill(0)
    for (const h of r.hops) {
      const j = hopIndex.get(hopKeyOf(h))
      if (j !== undefined) hop[j] = 1
    }
    return [...num, ...malt, ...hop]
  })

  const dim = numericDim + maltDim + hopDim
  const n = raw.length || 1

  // z-score every column
  const means = new Array(dim).fill(0)
  const stds = new Array(dim).fill(0)
  for (const row of raw) for (let j = 0; j < dim; j++) means[j] += row[j]
  for (let j = 0; j < dim; j++) means[j] /= n
  for (const row of raw) for (let j = 0; j < dim; j++) stds[j] += (row[j] - means[j]) ** 2
  for (let j = 0; j < dim; j++) stds[j] = Math.sqrt(stds[j] / n) || 1

  // Block scaling: equalize vitals vs ingredient variance at blend 0.5, then
  // tilt by `blend`. Mirrors the style-space feature blending.
  const ingDim = maltDim + hopDim
  const balance = ingDim > 0 ? Math.sqrt(numericDim / ingDim) : 0
  const w = Math.min(Math.max(blend, 0), 1)
  const vitalsScale = Math.SQRT2 * (1 - w)
  const ingScale = Math.SQRT2 * w * balance

  const vectors = raw.map((row) => {
    const vec = new Array(dim)
    for (let j = 0; j < dim; j++) {
      const z = (row[j] - means[j]) / stds[j]
      vec[j] = z * (j < numericDim ? vitalsScale : ingScale)
    }
    return vec
  })

  const featureNames = [
    ...NUMERIC_FEATURE_NAMES,
    ...MALT_CLASS_ORDER.map((c) => `malt:${c}`),
    ...hopKeys.map((k) => `hop:${k}`),
  ]

  return { recipes, vectors, featureNames, hopKeys }
}
