import { mulberry32 } from './rng'

export interface KMeansResult {
  labels: number[]
  centroids: number[][]
  inertia: number
}

function sqDist(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2
  return s
}

/** Seeded k-means++ with several restarts; deterministic for a given seed. */
export function kmeans(
  data: number[][],
  k: number,
  { seed = 42, restarts = 8, maxIter = 120 } = {},
): KMeansResult {
  const n = data.length
  if (n === 0 || k <= 0) return { labels: [], centroids: [], inertia: 0 }
  k = Math.min(k, n)
  let best: KMeansResult | null = null

  for (let r = 0; r < restarts; r++) {
    const rand = mulberry32(seed + r * 7919)
    // k-means++ init
    const centroids: number[][] = [data[Math.floor(rand() * n)].slice()]
    const minDists = data.map((p) => sqDist(p, centroids[0]))
    while (centroids.length < k) {
      const total = minDists.reduce((a, b) => a + b, 0)
      let pick = rand() * total
      let idx = 0
      for (; idx < n - 1; idx++) {
        pick -= minDists[idx]
        if (pick <= 0) break
      }
      centroids.push(data[idx].slice())
      for (let i = 0; i < n; i++)
        minDists[i] = Math.min(minDists[i], sqDist(data[i], centroids[centroids.length - 1]))
    }

    const labels = new Array(n).fill(0)
    let inertia = 0
    for (let iter = 0; iter < maxIter; iter++) {
      let changed = false
      inertia = 0
      for (let i = 0; i < n; i++) {
        let bestC = 0
        let bestD = Infinity
        for (let c = 0; c < k; c++) {
          const dd = sqDist(data[i], centroids[c])
          if (dd < bestD) {
            bestD = dd
            bestC = c
          }
        }
        if (labels[i] !== bestC) {
          labels[i] = bestC
          changed = true
        }
        inertia += bestD
      }
      if (!changed && iter > 0) break
      const sums = centroids.map((c) => new Array(c.length).fill(0))
      const counts = new Array(k).fill(0)
      for (let i = 0; i < n; i++) {
        counts[labels[i]]++
        const s = sums[labels[i]]
        for (let j = 0; j < data[i].length; j++) s[j] += data[i][j]
      }
      for (let c = 0; c < k; c++) {
        if (counts[c] === 0) {
          // re-seed an empty cluster at the point farthest from its centroid
          let far = 0
          let farD = -1
          for (let i = 0; i < n; i++) {
            const dd = sqDist(data[i], centroids[labels[i]])
            if (dd > farD) {
              farD = dd
              far = i
            }
          }
          centroids[c] = data[far].slice()
        } else {
          centroids[c] = sums[c].map((x) => x / counts[c])
        }
      }
    }
    if (!best || inertia < best.inertia) best = { labels: labels.slice(), centroids, inertia }
  }
  return best!
}

/** Mean silhouette score in [-1, 1]; higher = better-separated clusters. */
export function silhouette(data: number[][], labels: number[]): number {
  const n = data.length
  const k = Math.max(...labels) + 1
  if (n === 0 || k < 2) return 0
  const byCluster: number[][] = Array.from({ length: k }, () => [])
  labels.forEach((l, i) => byCluster[l].push(i))
  let total = 0
  let counted = 0
  for (let i = 0; i < n; i++) {
    const own = byCluster[labels[i]]
    if (own.length <= 1) continue
    let a = 0
    for (const j of own) if (j !== i) a += Math.sqrt(sqDist(data[i], data[j]))
    a /= own.length - 1
    let b = Infinity
    for (let c = 0; c < k; c++) {
      if (c === labels[i] || byCluster[c].length === 0) continue
      let d = 0
      for (const j of byCluster[c]) d += Math.sqrt(sqDist(data[i], data[j]))
      b = Math.min(b, d / byCluster[c].length)
    }
    total += (b - a) / Math.max(a, b)
    counted++
  }
  return counted ? total / counted : 0
}
