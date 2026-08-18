import { describe, expect, it } from 'vitest'
import { parseBrewfather } from '../src/lib/recipe/brewfather'
import { parseBeerXml } from '../src/lib/recipe/beerxml'
import { deriveRecipeTags, abvFromGravities } from '../src/lib/recipe/derive'

describe('brewfather', () => {
  it('parses a recipe export', () => {
    const r = parseBrewfather({
      name: 'House IPA',
      og: 1.062,
      fg: 1.012,
      abv: 6.6,
      ibu: 55,
      color: 7.5,
      yeasts: [{ name: 'US-05', type: 'Ale' }],
    })
    expect(r.name).toBe('House IPA')
    expect(r.vitals).toEqual({ og: 1.062, fg: 1.012, abv: 6.6, ibu: 55, srm: 7.5 })
    expect(r.tags).toContain('ipa-family')
    expect(r.tags).toContain('top-fermented')
    expect(r.tags).toContain('high-strength')
    expect(r.source).toBe('brewfather')
  })

  it('unwraps batch exports and computes missing ABV', () => {
    const r = parseBrewfather({
      recipe: { name: 'Batch Pils', og: 1.048, fg: 1.01, ibu: 35, color: 3.5, yeasts: [{ type: 'Lager' }] },
    })
    expect(r.vitals.abv).toBeCloseTo(abvFromGravities(1.048, 1.01))
    expect(r.tags).toContain('bottom-fermented')
    expect(r.tags).toContain('pilsner-family')
  })

  it('honors an explicit EBC unit override', () => {
    const r = parseBrewfather({ name: 'x', og: 1.05, fg: 1.01, ibu: 20, color: 19.7 }, 'ebc')
    expect(r.vitals.srm).toBeCloseTo(10)
  })

  it('rejects non-recipe JSON', () => {
    expect(() => parseBrewfather({ hello: 'world' })).toThrow(/og\/fg\/ibu\/color/)
  })
})

describe('beerxml', () => {
  const xml = `<?xml version="1.0"?>
<RECIPES><RECIPE>
  <NAME>Dry Stout</NAME>
  <EST_OG>1.044 SG</EST_OG>
  <EST_FG>1.011 SG</EST_FG>
  <IBU>38.5</IBU>
  <EST_COLOR>34.0 SRM</EST_COLOR>
  <EST_ABV>4.3 %</EST_ABV>
  <YEASTS><YEAST><NAME>Irish Ale</NAME><TYPE>Ale</TYPE></YEAST></YEASTS>
</RECIPE></RECIPES>`

  it('parses estimates with unit suffixes', () => {
    const r = parseBeerXml(xml)
    expect(r.name).toBe('Dry Stout')
    expect(r.vitals.og).toBeCloseTo(1.044)
    expect(r.vitals.srm).toBeCloseTo(34)
    expect(r.tags).toContain('stout-family')
    expect(r.tags).toContain('dark-color')
    expect(r.source).toBe('beerxml')
  })

  it('rejects non-BeerXML content', () => {
    expect(() => parseBeerXml('<html></html>')).toThrow(/RECIPE/)
  })
})

describe('deriveRecipeTags', () => {
  it('classifies strength, color, and balance', () => {
    const tags = deriveRecipeTags({ og: 1.09, fg: 1.02, abv: 9.5, ibu: 25, srm: 25 })
    expect(tags).toContain('very-high-strength')
    expect(tags).toContain('dark-color')
    expect(tags).toContain('malty')
  })
})
