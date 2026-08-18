import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain-JS module shared with the crawler scripts
import { parseListing, parseRecipePage, parseBeerXml, amountToKg, amountToG, volumeToL } from '../scripts/lib/brewersfriend.mjs'

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')

describe('unit conversion', () => {
  it('converts amounts to metric', () => {
    expect(amountToKg('10 lb')).toBeCloseTo(4.536, 2)
    expect(amountToKg('2.5 kg')).toBe(2.5)
    expect(amountToG('0.5 oz')).toBeCloseTo(14.2, 1)
    expect(amountToG('28 g')).toBe(28)
    expect(volumeToL('5.5 gallons')).toBeCloseTo(20.8, 1)
    expect(volumeToL('19 L')).toBe(19)
  })
})

describe('listing parser', () => {
  it('extracts unique recipe links', () => {
    const links = parseListing(fixture('bf-listing.html'))
    expect(links).toHaveLength(2)
    expect(links[0]).toEqual({
      id: '999123',
      slug: 'hazy-daze-neipa',
      url: 'https://www.brewersfriend.com/homebrew/recipe/view/999123/hazy-daze-neipa',
    })
  })
})

describe('recipe page parser', () => {
  const r = parseRecipePage(fixture('bf-recipe.html'), 'https://www.brewersfriend.com/homebrew/recipe/view/999123/hazy-daze-neipa')

  it('reads identity and stats', () => {
    expect(r.name).toBe('Hazy Daze NEIPA')
    expect(r.style).toBe('American IPA')
    expect(r.method).toBe('All Grain')
    expect(r.id).toBe('999123')
    expect(r.vitals).toEqual({ og: 1.065, fg: 1.014, abv: 6.7, ibu: 42.3, srm: 4.9 })
    expect(r.batchL).toBeCloseTo(20.8, 1)
  })

  it('reads the fermentable table in kg, skipping the total row', () => {
    expect(r.malts).toHaveLength(3)
    expect(r.malts[0].name).toBe('American - Pale 2-Row')
    expect(r.malts[0].kg).toBeCloseTo(4.536, 2)
    expect(r.malts.map((m: { name: string }) => m.name)).not.toContain('Total')
  })

  it('reads the hop table with stages', () => {
    expect(r.hops).toHaveLength(3)
    expect(r.hops[0]).toMatchObject({ name: 'Magnum', stage: 'bittering' })
    expect(r.hops[0].g).toBeCloseTo(14.2, 1)
    expect(r.hops[1]).toMatchObject({ name: 'Citra', stage: 'late' })
    expect(r.hops[2]).toMatchObject({ name: 'Galaxy', stage: 'dry' })
  })

  it('finds yeast and the BeerXML export link', () => {
    expect(r.yeast).toBe('Imperial Yeast - A38 Juice')
    expect(r.beerXmlUrl).toBe('https://www.brewersfriend.com/homebrew/recipe/beerxml1.0/999123')
  })
})

describe('beerxml parser', () => {
  const r = parseBeerXml(fixture('bf-recipe.xml'), 'https://www.brewersfriend.com/homebrew/recipe/beerxml1.0/999123')

  it('reads vitals, style, and batch size', () => {
    expect(r.name).toBe('Hazy Daze NEIPA')
    expect(r.style).toBe('American IPA')
    expect(r.vitals.og).toBe(1.065)
    expect(r.vitals.ibu).toBe(42.3)
    expect(r.batchL).toBeCloseTo(20.8, 1)
  })

  it('reads ingredients with metric amounts and stages', () => {
    expect(r.malts[0]).toEqual({ name: 'American - Pale 2-Row', kg: 4.536 })
    expect(r.hops.map((h: { stage: string }) => h.stage)).toEqual(['bittering', 'late', 'dry'])
    expect(r.hops[1].g).toBeCloseTo(56.7, 1)
    expect(r.yeast).toBe('Imperial Yeast - A38 Juice')
  })
})
