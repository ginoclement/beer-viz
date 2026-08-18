/**
 * Average-linkage agglomerative clustering over a precomputed distance
 * matrix. Used to order the similarity heatmap so blocks of similar styles
 * sit together. O(n^3) worst case — fine for n <= ~200.
 */
export function hclustOrder(dist: number[][]): number[] {
  const n = dist.length
  if (n === 0) return []
  interface Node {
    members: number[]
    leaves: number[]
  }
  const active = new Map<number, Node>()
  for (let i = 0; i < n; i++) active.set(i, { members: [i], leaves: [i] })

  const d = dist.map((row) => row.slice())
  const clusterDist = (a: Node, b: Node) => {
    let s = 0
    for (const i of a.members) for (const j of b.members) s += d[i][j]
    return s / (a.members.length * b.members.length)
  }

  const keys = () => [...active.keys()]
  while (active.size > 1) {
    let bestA = -1
    let bestB = -1
    let bestD = Infinity
    const ks = keys()
    for (let x = 0; x < ks.length; x++) {
      for (let y = x + 1; y < ks.length; y++) {
        const dd = clusterDist(active.get(ks[x])!, active.get(ks[y])!)
        if (dd < bestD) {
          bestD = dd
          bestA = ks[x]
          bestB = ks[y]
        }
      }
    }
    const a = active.get(bestA)!
    const b = active.get(bestB)!
    active.delete(bestB)
    active.set(bestA, {
      members: [...a.members, ...b.members],
      leaves: [...a.leaves, ...b.leaves],
    })
  }
  return [...active.values()][0].leaves
}
