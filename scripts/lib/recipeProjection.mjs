// Build-time 3D projection of the recipe corpus, so the browser renders
// precomputed coordinates instead of running PCA/UMAP over thousands of points
// on the main thread. Mirrors the feature engineering in
// src/lib/recipeFeatures.ts and the PCA in src/lib/pca.ts.
//
// Projections are precomputed for a few discrete "vitals ⇄ ingredients" blends
// and both methods; the view snaps its controls to these.

import { UMAP } from 'umap-js'

export const BLENDS = [0, 0.5, 1]
const NUMERIC_DIM = 7
const HOP_TOP_N = 40

const hopKeyOf = (h) => h.key ?? h.name.trim().toLowerCase()
const hasFullVitals = (r) =>
  r.vitals.og != null && r.vitals.fg != null && r.vitals.abv != null && r.vitals.ibu != null && r.vitals.srm != null

const MALT_CLASSES = [
  'base',
  'wheat, oats & rye',
  'crystal & caramel',
  'roasted',
  'sugars & adjuncts',
  'smoked',
  'other',
]

function numericFeatures(v) {
  const attenuation = v.og > 1 ? (v.og - v.fg) / (v.og - 1) : 0
  const buGu = v.og > 1 ? v.ibu / ((v.og - 1) * 1000) : 0
  return [v.og, v.fg, v.abv, v.ibu, Math.log(Math.max(v.srm, 0.5)), attenuation, buGu]
}

// ------------------------------------------------------------------- PCA (mirror of src/lib/pca.ts)

const matVec = (m, v) => m.map((row) => row.reduce((a, x, i) => a + x * v[i], 0))
const normalize = (v) => {
  const n = Math.hypot(...v) || 1
  return v.map((x) => x / n)
}

function fitPca(data, nComponents = 3, iterations = 200) {
  const n = data.length
  const d = data[0]?.length ?? 0
  const mean = new Array(d).fill(0)
  for (const row of data) for (let j = 0; j < d; j++) mean[j] += row[j]
  for (let j = 0; j < d; j++) mean[j] /= n || 1
  const centered = data.map((row) => row.map((x, j) => x - mean[j]))
  const cov = Array.from({ length: d }, () => new Array(d).fill(0))
  for (const row of centered)
    for (let a = 0; a < d; a++) {
      const ra = row[a]
      if (ra === 0) continue
      for (let b = a; b < d; b++) cov[a][b] += ra * row[b]
    }
  for (let a = 0; a < d; a++)
    for (let b = a; b < d; b++) {
      cov[a][b] /= Math.max(n - 1, 1)
      cov[b][a] = cov[a][b]
    }
  const totalVariance = cov.reduce((acc, row, i) => acc + row[i], 0) || 1
  const components = []
  const eigenvalues = []
  const k = Math.min(nComponents, d)
  for (let c = 0; c < k; c++) {
    let v = normalize(Array.from({ length: d }, (_, i) => Math.sin(i + 1 + c)))
    let lambda = 0
    for (let it = 0; it < iterations; it++) {
      let w = matVec(cov, v)
      for (const comp of components) {
        const dot = comp.reduce((a, x, i) => a + x * w[i], 0)
        w = w.map((x, i) => x - dot * comp[i])
      }
      const next = normalize(w)
      lambda = matVec(cov, next).reduce((a, x, i) => a + x * next[i], 0)
      const diff = next.reduce((a, x, i) => a + Math.abs(x - v[i]), 0)
      v = next
      if (diff < 1e-10 && it > 10) break
    }
    components.push(v)
    eigenvalues.push(Math.max(lambda, 0))
  }
  const transform = (point) => {
    const c = point.map((x, j) => x - mean[j])
    return components.map((comp) => comp.reduce((a, x, i) => a + x * c[i], 0))
  }
  return { transformAll: (rows) => rows.map(transform), explainedVariance: eigenvalues.map((l) => l / totalVariance) }
}

// ------------------------------------------------------------------- rescale (mirror of projection.ts)

function rescaled(pts) {
  const center = [0, 0, 0]
  for (const p of pts) for (let i = 0; i < 3; i++) center[i] += p[i]
  for (let i = 0; i < 3; i++) center[i] /= pts.length || 1
  const devs = pts.map((p) => Math.max(...[0, 1, 2].map((i) => Math.abs(p[i] - center[i])))).sort((a, b) => a - b)
  const q = devs[Math.min(devs.length - 1, Math.floor(devs.length * 0.975))] || 1e-9
  const scale = 1 / q
  return pts.map((p) => [
    +((p[0] - center[0]) * scale).toFixed(3),
    +((p[1] - center[1]) * scale).toFixed(3),
    +(((p[2] ?? 0) - center[2]) * scale).toFixed(3),
  ])
}

// deterministic RNG so UMAP output is stable across builds (mirror of rng.ts mulberry32)
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Build z-scored feature rows (blend-independent) plus the per-column block
 * scaling helper. Returns { rows: recipes, base: z-scored matrix, scaleFor(blend) }.
 */
function buildFeatureBase(corpus) {
  const recipes = corpus.filter(hasFullVitals)
  const hopFreq = new Map()
  for (const r of recipes) {
    const seen = new Set()
    for (const h of r.hops) {
      const k = hopKeyOf(h)
      if (!seen.has(k)) {
        seen.add(k)
        hopFreq.set(k, (hopFreq.get(k) ?? 0) + 1)
      }
    }
  }
  const hopKeys = [...hopFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, HOP_TOP_N).map(([k]) => k)
  const hopIndex = new Map(hopKeys.map((k, i) => [k, i]))
  const maltDim = MALT_CLASSES.length
  const hopDim = hopKeys.length

  const raw = recipes.map((r) => {
    const num = numericFeatures(r.vitals)
    const malt = new Array(maltDim).fill(0)
    for (const m of r.malts) {
      const idx = MALT_CLASSES.indexOf(m.class)
      if (idx >= 0) malt[idx] += (m.pct ?? 0) / 100
    }
    const hop = new Array(hopDim).fill(0)
    for (const h of r.hops) {
      const j = hopIndex.get(hopKeyOf(h))
      if (j !== undefined) hop[j] = 1
    }
    return [...num, ...malt, ...hop]
  })

  const dim = NUMERIC_DIM + maltDim + hopDim
  const n = raw.length || 1
  const means = new Array(dim).fill(0)
  const stds = new Array(dim).fill(0)
  for (const row of raw) for (let j = 0; j < dim; j++) means[j] += row[j]
  for (let j = 0; j < dim; j++) means[j] /= n
  for (const row of raw) for (let j = 0; j < dim; j++) stds[j] += (row[j] - means[j]) ** 2
  for (let j = 0; j < dim; j++) stds[j] = Math.sqrt(stds[j] / n) || 1
  const z = raw.map((row) => row.map((x, j) => (x - means[j]) / stds[j]))

  const ingDim = maltDim + hopDim
  const balance = ingDim > 0 ? Math.sqrt(NUMERIC_DIM / ingDim) : 0
  const scaleFor = (blend) => {
    const w = Math.min(Math.max(blend, 0), 1)
    const vitalsScale = Math.SQRT2 * (1 - w)
    const ingScale = Math.SQRT2 * w * balance
    return z.map((row) => row.map((v, j) => v * (j < NUMERIC_DIM ? vitalsScale : ingScale)))
  }
  return { recipes, scaleFor }
}

/** Precompute { ids, pca:{blend:coords}, umap:{blend:coords}, explained:{blend:[...]} }. */
export function buildRecipeProjections(corpus, { umap = true, log = () => {} } = {}) {
  const { recipes, scaleFor } = buildFeatureBase(corpus)
  const ids = recipes.map((r) => r.id)
  const pca = {}
  const explained = {}
  const umapOut = {}
  for (const blend of BLENDS) {
    const vecs = scaleFor(blend)
    const t0 = Date.now()
    const model = fitPca(vecs, 3)
    pca[String(blend)] = rescaled(model.transformAll(vecs))
    explained[String(blend)] = model.explainedVariance.map((v) => +v.toFixed(4))
    log(`pca blend ${blend}: ${Date.now() - t0}ms`)
    if (umap) {
      const u0 = Date.now()
      const um = new UMAP({
        nComponents: 3,
        nNeighbors: Math.min(15, Math.max(2, vecs.length - 1)),
        minDist: 0.15,
        spread: 1,
        random: mulberry32(42),
      })
      umapOut[String(blend)] = rescaled(um.fit(vecs))
      log(`umap blend ${blend}: ${Date.now() - u0}ms`)
    }
  }
  return { ids, pca, umap: umap ? umapOut : null, explained }
}
