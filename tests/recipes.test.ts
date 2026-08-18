import { describe, expect, it } from 'vitest'
import recipesJson from '../src/generated/recipes.json'
import hopsJson from '../src/generated/hops.json'

interface CorpusHop {
  name: string
  key: string | null
  g: number
  stage: string
}
interface CorpusMalt {
  name: string
  kg: number
  pct: number
  class: string
}
interface CorpusRecipe {
  id: number
  name: string
  family: string
  vitals: { og: number | null; fg: number | null; abv: number | null; ibu: number | null; srm: number | null }
  batchL: number | null
  malts: CorpusMalt[]
  hops: CorpusHop[]
  yeast: string | null
}

const recipes = (recipesJson as { recipes: CorpusRecipe[] }).recipes
const hopKeys = new Set((hopsJson as { hops: { key: string }[] }).hops.map((h) => h.key))

const MALT_CLASSES = new Set([
  'base',
  'crystal & caramel',
  'roasted',
  'wheat, oats & rye',
  'sugars & adjuncts',
  'smoked',
  'other',
])
const STAGES = new Set(['bittering', 'late', 'dry'])

describe('generated recipe corpus', () => {
  it('carries the full DIY Dog corpus', () => {
    expect(recipes.length).toBeGreaterThanOrEqual(400)
    expect(recipes.every((r) => r.name && r.malts.length > 0)).toBe(true)
  })

  it('normalizes gravities into specific-gravity form', () => {
    for (const r of recipes) {
      if (r.vitals.og != null) {
        expect(r.vitals.og).toBeGreaterThan(1)
        expect(r.vitals.og).toBeLessThan(1.2)
      }
      if (r.vitals.fg != null) expect(r.vitals.fg).toBeLessThan(1.1)
    }
  })

  it('malt percentages sum to ~100 per recipe', () => {
    for (const r of recipes) {
      const sum = r.malts.reduce((s, m) => s + m.pct, 0)
      if (r.malts.some((m) => m.kg > 0)) {
        expect(sum).toBeGreaterThan(98)
        expect(sum).toBeLessThan(102)
      }
    }
  })

  it('uses only known malt classes and hop stages', () => {
    for (const r of recipes) {
      for (const m of r.malts) expect(MALT_CLASSES.has(m.class), m.class).toBe(true)
      for (const h of r.hops) expect(STAGES.has(h.stage), h.stage).toBe(true)
    }
  })

  it('matches ≥90% of hop additions to the chemistry dataset with valid keys', () => {
    let total = 0
    let matched = 0
    for (const r of recipes)
      for (const h of r.hops) {
        total++
        if (h.key) {
          matched++
          expect(hopKeys.has(h.key), h.key).toBe(true)
        }
      }
    expect(matched / total).toBeGreaterThan(0.9)
  })

  it('classifies well-known beers into sensible families', () => {
    const byName = new Map(recipes.map((r) => [r.name, r.family]))
    expect(byName.get('Punk IPA 2007 - 2010')).toBe('ipa')
    const families = new Set(recipes.map((r) => r.family))
    expect(families.has('stout')).toBe(true)
    expect(families.has('lager & pilsner')).toBe(true)
    // family classification should leave few strays
    const other = recipes.filter((r) => r.family === 'other').length
    expect(other / recipes.length).toBeLessThan(0.12)
  })
})
