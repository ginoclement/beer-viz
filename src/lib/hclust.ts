/**
 * Average-linkage agglomerative clustering over a precomputed distance
 * matrix. Used to order the similarity heatmap so blocks of similar styles
 * sit together, and to draw the dendrogram. O(n^3) worst case — fine for
 * n <= ~200.
 */
export interface DendroNode {
  /** leaf index when >= 0, else an internal merge node */
  leaf: number
  height: number
  left: DendroNode | null
  right: DendroNode | null
  leaves: number[]
}

export function hclustTree(dist: number[][]): DendroNode | null {
  const n = dist.length
  if (n === 0) return null
  interface Cluster {
    members: number[]
    node: DendroNode
  }
  const active = new Map<number, Cluster>()
  for (let i = 0; i < n; i++)
    active.set(i, {
      members: [i],
      node: { leaf: i, height: 0, left: null, right: null, leaves: [i] },
    })

  const d = dist.map((row) => row.slice())
  const clusterDist = (a: Cluster, b: Cluster) => {
    let s = 0
    for (const i of a.members) for (const j of b.members) s += d[i][j]
    return s / (a.members.length * b.members.length)
  }

  while (active.size > 1) {
    let bestA = -1
    let bestB = -1
    let bestD = Infinity
    const ks = [...active.keys()]
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
      node: {
        leaf: -1,
        height: bestD,
        left: a.node,
        right: b.node,
        leaves: [...a.node.leaves, ...b.node.leaves],
      },
    })
  }
  return [...active.values()][0].node
}

export function hclustOrder(dist: number[][]): number[] {
  return hclustTree(dist)?.leaves ?? []
}
