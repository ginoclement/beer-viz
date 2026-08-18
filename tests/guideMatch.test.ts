import { describe, expect, it } from 'vitest'
import { altNames, matchGuides, normName } from '../src/lib/guideMatch'
import guidesJson from '../src/generated/guides.json'
import type { BeerStyle, Guide } from '../src/lib/types'

const GUIDES = guidesJson as unknown as Guide[]

function style(id: string, name: string): BeerStyle {
  return {
    id,
    name,
    category: 'Test',
    categoryId: '1',
    type: 'beer',
    stats: { og: null, fg: null, abv: null, ibu: null, srm: null },
    tags: [],
    tagsSynthesized: false,
    hasStats: false,
    impression: null,
    comparison: null,
    history: null,
    examples: null,
    aroma: null,
    flavor: null,
  } as unknown as BeerStyle
}

describe('normName', () => {
  it('strips leading category codes', () => {
    expect(normName('11B Best Bitter')).toBe('best bitter')
  })
  it('canonicalizes IPA', () => {
    expect(normName('American-Style India Pale Ale')).toBe('american style ipa')
  })
})

describe('altNames', () => {
  it('splits BA "X or Y" names into alternatives', () => {
    expect(altNames('Special Bitter or Best Bitter')).toContain('best bitter')
    expect(altNames('Special Bitter or Best Bitter')).toContain('special bitter')
  })
  it('borrows the trailing noun for short alternatives', () => {
    expect(altNames('Golden or Blonde Ale')).toContain('golden ale')
    expect(altNames('Golden or Blonde Ale')).toContain('blonde ale')
  })
  it('handles "Imperial or Double India Pale Ale"', () => {
    expect(altNames('Imperial or Double India Pale Ale')).toContain('double ipa')
    expect(altNames('Imperial or Double India Pale Ale')).toContain('imperial ipa')
  })
  it('handles comma lists', () => {
    expect(altNames('Dutch-Style Kuit, Kuyt or Koyt')).toContain('kuyt')
  })
})

describe('matchGuides', () => {
  it('matches BJCP Best Bitter to BA Special Bitter or Best Bitter exactly', () => {
    const { matches } = matchGuides(
      [style('11B', 'Best Bitter')],
      [style('ba-sb', 'Special Bitter or Best Bitter')],
    )
    expect(matches).toHaveLength(1)
    expect(matches[0].fuzzy).toBe(false)
  })

  it('matches Double IPA to Imperial or Double India Pale Ale', () => {
    const { matches } = matchGuides(
      [style('22A', 'Double IPA')],
      [style('ba-dipa', 'Imperial or Double India Pale Ale')],
    )
    expect(matches).toHaveLength(1)
    expect(matches[0].fuzzy).toBe(false)
  })

  it('pairs well-known styles across the real BJCP 2021 and BA 2017 datasets', () => {
    const bjcp = GUIDES.find((g) => g.guide === 'bjcp2021')!
    const ba = GUIDES.find((g) => g.guide === 'ba2017')!
    const { matches } = matchGuides(bjcp.styles, ba.styles)
    const byA = new Map(matches.map((m) => [m.a.name, m.b.name]))
    expect(byA.get('Best Bitter')).toBe('Special Bitter or Best Bitter')
    expect(byA.get('Sweet Stout')).toBe('Sweet Stout or Cream Stout')
    expect(byA.get('Blonde Ale')).toBe('Golden or Blonde Ale')
    expect(byA.get('Witbier')).toBe('Belgian-Style Witbier')
    expect(byA.get('Kölsch')).toBe('German-Style Kölsch')
    // ale/lager conflict guard
    expect(byA.get('International Pale Lager')).not.toBe('International-Style Pale Ale')
    // sanity: a healthy share of BJCP styles find a BA counterpart
    // (the old name-only matcher managed 34)
    expect(matches.length).toBeGreaterThan(55)
  })

  it('never matches one b-side style twice', () => {
    const bjcp = GUIDES.find((g) => g.guide === 'bjcp2021')!
    const ba = GUIDES.find((g) => g.guide === 'ba2017')!
    const { matches } = matchGuides(bjcp.styles, ba.styles)
    const bIds = matches.map((m) => m.b.id)
    expect(new Set(bIds).size).toBe(bIds.length)
  })
})
