/**
 * Principal component analysis via power iteration with deflation on the
 * covariance matrix. Dimensions here are small (~60 columns), so this is
 * fast and numerically adequate, and it gives us a transform() for
 * projecting new points (imported recipes) into the fitted space.
 */

export interface PcaModel {
  mean: number[]
  components: number[][] // [nComponents][dim]
  explainedVariance: number[] // fraction of total variance per component
}

function matVec(m: number[][], v: number[]): number[] {
  return m.map((row) => row.reduce((acc, x, i) => acc + x * v[i], 0))
}

function normalize(v: number[]): number[] {
  const n = Math.hypot(...v) || 1
  return v.map((x) => x / n)
}

export function fitPca(data: number[][], nComponents = 3, iterations = 200): PcaModel {
  const n = data.length
  const d = data[0]?.length ?? 0
  const mean = new Array(d).fill(0)
  for (const row of data) for (let j = 0; j < d; j++) mean[j] += row[j]
  for (let j = 0; j < d; j++) mean[j] /= n || 1
  const centered = data.map((row) => row.map((x, j) => x - mean[j]))

  // covariance matrix (d x d)
  const cov: number[][] = Array.from({ length: d }, () => new Array(d).fill(0))
  for (const row of centered) {
    for (let a = 0; a < d; a++) {
      const ra = row[a]
      if (ra === 0) continue
      for (let b = a; b < d; b++) cov[a][b] += ra * row[b]
    }
  }
  for (let a = 0; a < d; a++)
    for (let b = a; b < d; b++) {
      cov[a][b] /= Math.max(n - 1, 1)
      cov[b][a] = cov[a][b]
    }

  const totalVariance = cov.reduce((acc, row, i) => acc + row[i], 0) || 1

  const components: number[][] = []
  const eigenvalues: number[] = []
  const k = Math.min(nComponents, d)
  for (let c = 0; c < k; c++) {
    // deterministic start vector, orthogonalized against found components
    let v = normalize(Array.from({ length: d }, (_, i) => Math.sin(i + 1 + c)))
    let lambda = 0
    for (let it = 0; it < iterations; it++) {
      let w = matVec(cov, v)
      for (const comp of components) {
        const dot = comp.reduce((acc, x, i) => acc + x * w[i], 0)
        w = w.map((x, i) => x - dot * comp[i])
      }
      const next = normalize(w)
      lambda = matVec(cov, next).reduce((acc, x, i) => acc + x * next[i], 0)
      const diff = next.reduce((acc, x, i) => acc + Math.abs(x - v[i]), 0)
      v = next
      if (diff < 1e-10 && it > 10) break
    }
    components.push(v)
    eigenvalues.push(Math.max(lambda, 0))
  }

  return {
    mean,
    components,
    explainedVariance: eigenvalues.map((l) => l / totalVariance),
  }
}

export function pcaTransform(model: PcaModel, point: number[]): number[] {
  const centered = point.map((x, j) => x - model.mean[j])
  return model.components.map((comp) =>
    comp.reduce((acc, x, i) => acc + x * centered[i], 0),
  )
}

export function pcaTransformAll(model: PcaModel, data: number[][]): number[][] {
  return data.map((p) => pcaTransform(model, p))
}
