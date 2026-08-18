import { UMAP } from 'umap-js'
import { fitPca, pcaTransform, pcaTransformAll, type PcaModel } from './pca'
import { mulberry32 } from './rng'

export type ProjectionMethod = 'pca' | 'umap'

export interface Projection {
  method: ProjectionMethod
  /** 3D coordinates per input vector, rescaled to roughly [-1, 1]^3 */
  points: [number, number, number][]
  /** Project a new vector (same feature space) into these coordinates. */
  transform: (v: number[]) => [number, number, number]
  /** PCA only: fraction of variance captured by each axis. */
  explainedVariance?: number[]
}

interface Rescale {
  center: [number, number, number]
  scale: number
}

function fitRescale(pts: number[][]): Rescale {
  const center: [number, number, number] = [0, 0, 0]
  for (const p of pts) for (let i = 0; i < 3; i++) center[i] += p[i]
  for (let i = 0; i < 3; i++) center[i] /= pts.length || 1
  // robust scale: 97.5th-percentile deviation, so a stray outlier can't
  // compress the whole cloud into the middle of the view
  const devs = pts
    .map((p) => Math.max(...[0, 1, 2].map((i) => Math.abs(p[i] - center[i]))))
    .sort((a, b) => a - b)
  const q = devs[Math.min(devs.length - 1, Math.floor(devs.length * 0.975))] || 1e-9
  return { center, scale: 1 / q }
}

const applyRescale = (r: Rescale, p: number[]): [number, number, number] => [
  (p[0] - r.center[0]) * r.scale,
  (p[1] - r.center[1]) * r.scale,
  ((p[2] ?? 0) - r.center[2]) * r.scale,
]

export function projectPca(vectors: number[][]): Projection {
  const model: PcaModel = fitPca(vectors, 3)
  const raw = pcaTransformAll(model, vectors)
  const r = fitRescale(raw)
  return {
    method: 'pca',
    points: raw.map((p) => applyRescale(r, p)),
    transform: (v) => applyRescale(r, pcaTransform(model, v)),
    explainedVariance: model.explainedVariance,
  }
}

export function projectUmap(vectors: number[][], seed = 42): Projection {
  const rand = mulberry32(seed)
  const umap = new UMAP({
    nComponents: 3,
    nNeighbors: Math.min(15, Math.max(2, vectors.length - 1)),
    minDist: 0.15,
    spread: 1.0,
    random: rand,
  })
  const raw = umap.fit(vectors)
  const r = fitRescale(raw)
  return {
    method: 'umap',
    points: raw.map((p) => applyRescale(r, p)),
    transform: (v) => applyRescale(r, umap.transform([v])[0]),
  }
}

export function project(vectors: number[][], method: ProjectionMethod, seed = 42): Projection {
  return method === 'pca' ? projectPca(vectors) : projectUmap(vectors, seed)
}
