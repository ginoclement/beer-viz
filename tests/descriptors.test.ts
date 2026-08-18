import { describe, expect, it } from 'vitest'
import { descriptorSimilarity, extractDescriptors } from '../src/lib/descriptors'
import { clusterLabels } from '../src/lib/clusterLabels'
import { hclustTree } from '../src/lib/hclust'
import type { BeerStyle } from '../src/lib/types'

describe('descriptor extraction', () => {
  it('finds descriptors across prose fields and counts strength', () => {
    const d = extractDescriptors({
      aroma: 'Moderate caramel and toffee, with light grapefruit hop aroma.',
      flavor: 'Caramel malt flavor with a dry finish and firm bitterness.',
      impression: 'A smooth amber ale.',
    })
    const byName = Object.fromEntries(d.map((x) => [x.name, x]))
    expect(byName['caramel'].strength).toBe(2)
    expect(byName['caramel'].family).toBe('malt')
    expect(byName['citrus'].strength).toBe(1)
    expect(byName['dry finish']).toBeTruthy()
    expect(byName['creamy']).toBeTruthy() // "smooth"
    expect(byName['banana']).toBeUndefined()
  })

  it('returns empty for missing prose', () => {
    expect(extractDescriptors({ aroma: null, flavor: null, impression: null })).toEqual([])
  })

  it('similarity is 1 for identical fingerprints and 0 for disjoint', () => {
    const a = extractDescriptors({ aroma: 'banana and clove', flavor: null, impression: null })
    const b = extractDescriptors({ aroma: 'banana and clove esters', flavor: null, impression: null })
    const c = extractDescriptors({ aroma: 'intense pine and grapefruit', flavor: null, impression: null })
    expect(descriptorSimilarity(a, a)).toBe(1)
    expect(descriptorSimilarity(a, c)).toBe(0)
    expect(descriptorSimilarity(a, b)).toBeGreaterThan(0.5)
  })
})

describe('cluster labels', () => {
  const mk = (id: string, tags: string[]): BeerStyle =>
    ({
      id,
      name: id,
      category: 'x',
      categoryId: null,
      type: 'beer',
      stats: { og: null, fg: null, abv: null, ibu: null, srm: null },
      hasStats: true,
      tags,
      tagsSynthesized: false,
      impression: null,
      aroma: null,
      appearance: null,
      flavor: null,
      mouthfeel: null,
      comments: null,
      history: null,
      comparison: null,
      ingredients: null,
      examples: null,
    }) as BeerStyle

  it('labels clusters with their distinctive tags', () => {
    const styles = [
      mk('a', ['hoppy', 'pale-color', 'common']),
      mk('b', ['hoppy', 'pale-color', 'common']),
      mk('c', ['malty', 'dark-color', 'common']),
      mk('d', ['malty', 'dark-color', 'common']),
    ]
    const labels = clusterLabels(styles, [0, 0, 1, 1], 2)
    expect(labels[0]).toContain('hoppy')
    expect(labels[0]).not.toContain('malty')
    expect(labels[1]).toContain('malty')
    // 'common' has lift 1 everywhere — must rank below the distinctive tags
    expect(labels[0].startsWith('common')).toBe(false)
  })

  it('handles empty clusters', () => {
    const styles = [mk('a', ['x'])]
    expect(clusterLabels(styles, [0], 2)[1]).toBe('empty')
  })
})

describe('hclust tree', () => {
  it('merges the closest pair first and covers all leaves', () => {
    const d = [
      [0, 0.1, 5, 5],
      [0.1, 0, 5, 5],
      [5, 5, 0, 0.2],
      [5, 5, 0.2, 0],
    ]
    const tree = hclustTree(d)!
    expect([...tree.leaves].sort()).toEqual([0, 1, 2, 3])
    expect(tree.height).toBeCloseTo(5)
    const childLeafSets = [tree.left!.leaves, tree.right!.leaves].map((l) => [...l].sort().join(','))
    expect(childLeafSets).toContain('0,1')
    expect(childLeafSets).toContain('2,3')
  })
})
