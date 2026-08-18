import type { BeerStyle, Vitals } from './types'

/**
 * Feature engineering. Each style with full vital statistics becomes a vector:
 *
 *  - 7 numeric features (z-scored over the dataset): OG, FG, ABV, IBU,
 *    log SRM, apparent attenuation, and BU:GU balance ratio
 *  - one column per tag in the vocabulary (tags used by >= 2 styles),
 *    scaled so the tag block's overall weight is adjustable
 *
 * The fitted space remembers its means/stds/vocab so new points (imported
 * recipes) can be transformed into the same space on the fly.
 */

export const NUMERIC_FEATURE_NAMES = [
  'OG',
  'FG',
  'ABV',
  'IBU',
  'log SRM',
  'attenuation',
  'BU:GU',
] as const

export interface FeatureSpace {
  styleIds: string[]
  vectors: number[][]
  numericDim: number
  means: number[]
  stds: number[]
  vocab: string[]
  tagWeight: number
  tagScale: number
}

export function numericFeatures(v: Vitals): number[] {
  const og = v.og
  const fg = v.fg
  const attenuation = og > 1 ? (og - fg) / (og - 1) : 0
  const buGu = og > 1 ? v.ibu / ((og - 1) * 1000) : 0
  return [og, fg, v.abv, v.ibu, Math.log(Math.max(v.srm, 0.5)), attenuation, buGu]
}

export function midVitals(s: BeerStyle): Vitals | null {
  const { og, fg, abv, ibu, srm } = s.stats
  if (!og || !fg || !abv || !ibu || !srm) return null
  return {
    og: (og[0] + og[1]) / 2,
    fg: (fg[0] + fg[1]) / 2,
    abv: (abv[0] + abv[1]) / 2,
    ibu: (ibu[0] + ibu[1]) / 2,
    srm: (srm[0] + srm[1]) / 2,
  }
}

export function buildVocab(styles: BeerStyle[], minCount = 2): string[] {
  const counts = new Map<string, number>()
  for (const s of styles) {
    for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= minCount)
    .map(([t]) => t)
    .sort()
}

/**
 * tagWeight in [0, 1]: 0 = vital statistics only, 1 = tags only.
 * The tag block is scaled so that at 0.5 the two blocks contribute
 * comparable total variance.
 */
export function buildFeatureSpace(styles: BeerStyle[], tagWeight = 0.35): FeatureSpace {
  const usable = styles.filter((s) => s.hasStats)
  const numeric = usable.map((s) => numericFeatures(midVitals(s)!))
  const numericDim = NUMERIC_FEATURE_NAMES.length

  const means = new Array(numericDim).fill(0)
  const stds = new Array(numericDim).fill(0)
  for (const row of numeric) for (let j = 0; j < numericDim; j++) means[j] += row[j]
  for (let j = 0; j < numericDim; j++) means[j] /= numeric.length || 1
  for (const row of numeric)
    for (let j = 0; j < numericDim; j++) stds[j] += (row[j] - means[j]) ** 2
  for (let j = 0; j < numericDim; j++)
    stds[j] = Math.sqrt(stds[j] / (numeric.length || 1)) || 1

  const vocab = buildVocab(usable)
  // Per-column scale that equalizes the two blocks at tagWeight = 0.5:
  // numeric block has numericDim unit-variance columns; a one-hot block of
  // |vocab| columns gets sqrt(numericDim / |vocab|) per column.
  const blockBalance = vocab.length > 0 ? Math.sqrt(numericDim / vocab.length) : 0
  const w = Math.min(Math.max(tagWeight, 0), 1)
  const numericScale = Math.SQRT2 * (1 - w)
  const tagScale = Math.SQRT2 * w * blockBalance

  const vocabIndex = new Map(vocab.map((t, i) => [t, i]))
  const vectors = usable.map((s, i) => {
    const vec = new Array(numericDim + vocab.length).fill(0)
    for (let j = 0; j < numericDim; j++)
      vec[j] = ((numeric[i][j] - means[j]) / stds[j]) * numericScale
    for (const t of s.tags) {
      const j = vocabIndex.get(t)
      if (j !== undefined) vec[numericDim + j] = tagScale
    }
    return vec
  })

  return {
    styleIds: usable.map((s) => s.id),
    vectors,
    numericDim,
    means,
    stds,
    vocab,
    tagWeight: w,
    tagScale,
  }
}

/** Transform a new point (e.g. an imported recipe) into a fitted space. */
export function transformPoint(space: FeatureSpace, vitals: Vitals, tags: string[]): number[] {
  const raw = numericFeatures(vitals)
  const w = space.tagWeight
  const numericScale = Math.SQRT2 * (1 - w)
  const vec = new Array(space.numericDim + space.vocab.length).fill(0)
  for (let j = 0; j < space.numericDim; j++)
    vec[j] = ((raw[j] - space.means[j]) / space.stds[j]) * numericScale
  const tagSet = new Set(tags)
  space.vocab.forEach((t, j) => {
    if (tagSet.has(t)) vec[space.numericDim + j] = space.tagScale
  })
  return vec
}
