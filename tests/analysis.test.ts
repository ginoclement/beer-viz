import { describe, expect, it } from 'vitest'
import { fitPca, pcaTransform } from '../src/lib/pca'
import { kmeans, silhouette } from '../src/lib/kmeans'
import { jaccard, jaccardMatrix, neighborsOf, combinedSimilarityMatrix } from '../src/lib/similarity'
import { hclustOrder } from '../src/lib/hclust'
import { srmToHex, ebcToSrm } from '../src/lib/srm'
import { buildFeatureSpace, transformPoint, midVitals, NUMERIC_FEATURE_NAMES } from '../src/lib/features'
import { mulberry32 } from '../src/lib/rng'
import type { BeerStyle } from '../src/lib/types'

function makeStyle(over: Partial<BeerStyle> & { id: string }): BeerStyle {
  return {
    name: over.id,
    category: 'Test',
    categoryId: null,
    type: 'beer',
    stats: {
      og: [1.045, 1.055],
      fg: [1.008, 1.012],
      abv: [4.5, 5.5],
      ibu: [20, 30],
      srm: [4, 8],
    },
    hasStats: true,
    tags: ['pale-color', 'standard-strength'],
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
    ...over,
  }
}

describe('pca', () => {
  it('recovers the dominant direction of correlated 2D data', () => {
    const rand = mulberry32(1)
    const data: number[][] = []
    for (let i = 0; i < 200; i++) {
      const t = (rand() - 0.5) * 10
      data.push([t + (rand() - 0.5) * 0.1, 2 * t + (rand() - 0.5) * 0.1])
    }
    const model = fitPca(data, 2)
    const [a, b] = model.components[0]
    // dominant axis should be along (1, 2) direction
    expect(Math.abs(b / a)).toBeCloseTo(2, 1)
    expect(model.explainedVariance[0]).toBeGreaterThan(0.99)
  })

  it('produces orthogonal components', () => {
    const rand = mulberry32(7)
    const data = Array.from({ length: 100 }, () => [rand(), rand() * 3, rand() * 0.5 + rand()])
    const model = fitPca(data, 3)
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++) {
        const dot = model.components[i].reduce((acc, x, k) => acc + x * model.components[j][k], 0)
        expect(Math.abs(dot)).toBeLessThan(1e-6)
      }
  })

  it('transform maps the mean to the origin', () => {
    const data = [
      [1, 2],
      [3, 4],
      [5, 6],
    ]
    const model = fitPca(data, 2)
    const proj = pcaTransform(model, [3, 4])
    expect(Math.hypot(...proj)).toBeLessThan(1e-9)
  })
})

describe('kmeans', () => {
  it('separates two obvious blobs deterministically', () => {
    const rand = mulberry32(3)
    const data: number[][] = []
    for (let i = 0; i < 40; i++) data.push([rand() * 0.5, rand() * 0.5])
    for (let i = 0; i < 40; i++) data.push([10 + rand() * 0.5, 10 + rand() * 0.5])
    const a = kmeans(data, 2, { seed: 5 })
    const b = kmeans(data, 2, { seed: 5 })
    expect(a.labels).toEqual(b.labels)
    const first = new Set(a.labels.slice(0, 40))
    const second = new Set(a.labels.slice(40))
    expect(first.size).toBe(1)
    expect(second.size).toBe(1)
    expect([...first][0]).not.toBe([...second][0])
    expect(silhouette(data, a.labels)).toBeGreaterThan(0.9)
  })

  it('handles k > distinct points without crashing', () => {
    const data = [
      [0, 0],
      [1, 1],
    ]
    const r = kmeans(data, 5)
    expect(r.labels).toHaveLength(2)
  })
})

describe('jaccard', () => {
  it('computes the standard set overlap', () => {
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3)
    expect(jaccard(['a'], ['a'])).toBe(1)
    expect(jaccard([], [])).toBe(0)
  })

  it('builds a symmetric matrix with unit diagonal', () => {
    const m = jaccardMatrix([['a', 'b'], ['b'], ['c']])
    expect(m[0][0]).toBe(1)
    expect(m[0][1]).toBeCloseTo(0.5)
    expect(m[1][0]).toBeCloseTo(0.5)
    expect(m[0][2]).toBe(0)
  })
})

describe('similarity', () => {
  it('ranks the identical-stats twin first', () => {
    const vectors = [
      [0, 0],
      [0.01, 0],
      [5, 5],
    ]
    const tags = [['a', 'b'], ['a', 'b'], ['z']]
    const n = neighborsOf(0, vectors, tags, 0.5)
    expect(n[0].index).toBe(1)
    expect(n[0].similarity).toBeGreaterThan(0.9)
  })

  it('combined matrix is symmetric and bounded', () => {
    const m = combinedSimilarityMatrix(
      [
        [0, 0],
        [1, 1],
        [2, 0],
      ],
      [['a'], ['a', 'b'], ['b']],
      0.4,
    )
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        expect(m[i][j]).toBeCloseTo(m[j][i])
        expect(m[i][j]).toBeGreaterThanOrEqual(0)
        expect(m[i][j]).toBeLessThanOrEqual(1)
      }
  })
})

describe('hclust', () => {
  it('orders similar items adjacently', () => {
    // items 0,1 near; 2,3 near; groups far apart
    const d = [
      [0, 0.1, 5, 5],
      [0.1, 0, 5, 5],
      [5, 5, 0, 0.1],
      [5, 5, 0.1, 0],
    ]
    const order = hclustOrder(d)
    expect(order).toHaveLength(4)
    const pos = (i: number) => order.indexOf(i)
    expect(Math.abs(pos(0) - pos(1))).toBe(1)
    expect(Math.abs(pos(2) - pos(3))).toBe(1)
  })
})

describe('srm colors', () => {
  it('maps pale to gold and dark to near-black', () => {
    expect(srmToHex(2).toLowerCase()).toBe('#ffd878')
    const [r] = [parseInt(srmToHex(40).slice(1, 3), 16)]
    expect(r).toBeLessThan(0x60)
  })
  it('clamps out-of-range values', () => {
    expect(srmToHex(0.2)).toBe(srmToHex(1))
    expect(srmToHex(80)).toBe(srmToHex(40))
  })
  it('converts EBC', () => {
    expect(ebcToSrm(19.7)).toBeCloseTo(10)
  })
})

describe('feature space', () => {
  const styles = [
    makeStyle({ id: 'a', tags: ['pale-color', 'hoppy'] }),
    makeStyle({ id: 'b', tags: ['pale-color', 'malty'] }),
    makeStyle({
      id: 'c',
      tags: ['dark-color', 'malty'],
      stats: { og: [1.08, 1.09], fg: [1.02, 1.025], abv: [9, 11], ibu: [50, 70], srm: [30, 40] },
    }),
    makeStyle({ id: 'd', hasStats: false, stats: { og: null, fg: null, abv: null, ibu: null, srm: null } }),
  ]

  it('excludes styles without stats and z-scores numerics', () => {
    const space = buildFeatureSpace(styles, 0.35)
    expect(space.styleIds).toEqual(['a', 'b', 'c'])
    expect(space.vectors[0]).toHaveLength(space.numericDim + space.vocab.length)
    // column means of numeric block should be ~0
    for (let j = 0; j < space.numericDim; j++) {
      const mean = space.vectors.reduce((acc, v) => acc + v[j], 0) / space.vectors.length
      expect(Math.abs(mean)).toBeLessThan(1e-9)
    }
  })

  it('transformPoint reproduces an in-sample style vector', () => {
    const space = buildFeatureSpace(styles, 0.35)
    const v = transformPoint(space, midVitals(styles[0])!, styles[0].tags)
    expect(v).toHaveLength(space.vectors[0].length)
    for (let j = 0; j < v.length; j++) expect(v[j]).toBeCloseTo(space.vectors[0][j], 9)
  })

  it('tagWeight 0 zeroes the tag block', () => {
    const space = buildFeatureSpace(styles, 0)
    for (const v of space.vectors)
      for (let j = space.numericDim; j < v.length; j++) expect(v[j]).toBe(0)
  })

  it('exposes the numeric feature names', () => {
    expect(NUMERIC_FEATURE_NAMES).toHaveLength(7)
  })
})
