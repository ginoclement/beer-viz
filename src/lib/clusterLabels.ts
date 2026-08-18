import type { BeerStyle } from './types'

/**
 * Auto-name k-means clusters by their most *distinctive* tags: rank each
 * tag by lift = p(tag | cluster) / p(tag overall), requiring the tag to
 * appear in at least a third of the cluster's styles, and take the top 3.
 */
export function clusterLabels(styles: BeerStyle[], clusterOf: number[], k: number): string[] {
  const total = styles.length || 1
  const overall = new Map<string, number>()
  for (const s of styles) for (const t of s.tags) overall.set(t, (overall.get(t) ?? 0) + 1)

  const labels: string[] = []
  for (let c = 0; c < k; c++) {
    const members = styles.filter((_, i) => clusterOf[i] === c)
    if (members.length === 0) {
      labels.push('empty')
      continue
    }
    const counts = new Map<string, number>()
    for (const s of members) for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    const scored = [...counts.entries()]
      .filter(([, n]) => n >= Math.max(2, members.length / 3))
      .map(([tag, n]) => {
        const pCluster = n / members.length
        const pOverall = (overall.get(tag) ?? 1) / total
        return { tag, lift: pCluster / pOverall, pCluster }
      })
      .sort((a, b) => b.lift - a.lift || b.pCluster - a.pCluster)
    labels.push(
      scored.length
        ? scored.slice(0, 3).map((s) => s.tag).join(' · ')
        : 'mixed',
    )
  }
  return labels
}
