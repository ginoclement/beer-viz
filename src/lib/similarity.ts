/** Jaccard similarity between two tag sets: |A ∩ B| / |A ∪ B|. */
export function jaccard(a: string[] | Set<string>, b: string[] | Set<string>): number {
  const sa = a instanceof Set ? a : new Set(a)
  const sb = b instanceof Set ? b : new Set(b)
  if (sa.size === 0 && sb.size === 0) return 0
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  return inter / (sa.size + sb.size - inter)
}

export function jaccardMatrix(tagLists: string[][]): number[][] {
  const sets = tagLists.map((t) => new Set(t))
  const n = sets.length
  const m: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    m[i][i] = 1
    for (let j = i + 1; j < n; j++) {
      const s = jaccard(sets[i], sets[j])
      m[i][j] = s
      m[j][i] = s
    }
  }
  return m
}

export function euclidean(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2
  return Math.sqrt(s)
}

/**
 * Combined similarity in [0, 1]: alpha * Jaccard(tags) +
 * (1 - alpha) * numeric closeness, where numeric closeness rescales
 * euclidean distance on the z-scored vitals by the matrix's 95th-percentile
 * distance so it lives on a comparable [0, 1] scale.
 */
export function combinedSimilarityMatrix(
  numericVectors: number[][],
  tagLists: string[][],
  alpha = 0.5,
): number[][] {
  const n = numericVectors.length
  const jm = jaccardMatrix(tagLists)
  const dists: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  const all: number[] = []
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = euclidean(numericVectors[i], numericVectors[j])
      dists[i][j] = d
      dists[j][i] = d
      all.push(d)
    }
  all.sort((a, b) => a - b)
  const scale = all.length ? all[Math.floor(all.length * 0.95)] || 1 : 1
  const m: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    m[i][i] = 1
    for (let j = i + 1; j < n; j++) {
      const closeness = Math.max(0, 1 - dists[i][j] / scale)
      const s = alpha * jm[i][j] + (1 - alpha) * closeness
      m[i][j] = s
      m[j][i] = s
    }
  }
  return m
}

export interface Neighbor {
  index: number
  similarity: number
  jaccard: number
  numericCloseness: number
}

/** Ranked nearest neighbors of one item given precomputed inputs. */
export function neighborsOf(
  index: number,
  numericVectors: number[][],
  tagLists: string[][],
  alpha = 0.5,
  limit = 15,
): Neighbor[] {
  const n = numericVectors.length
  const sets = tagLists.map((t) => new Set(t))
  const dists: number[] = []
  for (let j = 0; j < n; j++) dists.push(euclidean(numericVectors[index], numericVectors[j]))
  const sorted = [...dists].sort((a, b) => a - b)
  const scale = sorted[Math.floor(sorted.length * 0.95)] || 1
  const out: Neighbor[] = []
  for (let j = 0; j < n; j++) {
    if (j === index) continue
    const jac = jaccard(sets[index], sets[j])
    const closeness = Math.max(0, 1 - dists[j] / scale)
    out.push({
      index: j,
      similarity: alpha * jac + (1 - alpha) * closeness,
      jaccard: jac,
      numericCloseness: closeness,
    })
  }
  out.sort((a, b) => b.similarity - a.similarity)
  return out.slice(0, limit)
}
