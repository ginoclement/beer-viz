import { describe, expect, it } from 'vitest'
import {
  AROMA_AXES,
  HOPS,
  HOPS_BY_KEY,
  hopAromaVector,
  hopAromaSimilarity,
  rankHopsForStyle,
  scoreHopForStyle,
  styleAromaTarget,
} from '../src/lib/hops'
import { GUIDES } from '../src/state/useAnalysis'

const bjcp2021 = GUIDES.find((g) => g.guide === 'bjcp2021')!
const styleById = (id: string) => bjcp2021.styles.find((s) => s.id === id)!

describe('hops dataset', () => {
  it('loads a substantial merged dataset', () => {
    expect(HOPS.length).toBeGreaterThan(180)
    expect(AROMA_AXES).toHaveLength(9)
    const withAroma = HOPS.filter((h) => h.aromas).length
    expect(withAroma).toBeGreaterThan(150)
  })

  it('has plausible oil chemistry for benchmark varieties', () => {
    const citra = HOPS_BY_KEY.get('citra')!
    expect(citra.oilComp.myrcene![0]).toBeGreaterThan(40) // myrcene-dominant
    expect(citra.oilComp.caryophyllene![1]).toBeLessThan(20)
    const saaz = HOPS_BY_KEY.get('saaz')!
    expect(saaz.oilComp.farnesene![1]).toBeGreaterThan(8) // the noble farnesene signature
    expect(citra.thiol!.level).toBe(3)
    expect(saaz.thiol!.level).toBe(0)
  })

  it('normalizes aroma vectors to unit sum', () => {
    const v = hopAromaVector(HOPS_BY_KEY.get('citra')!)!
    expect(v.reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  })
})

describe('style aroma target', () => {
  it('reads hop-facing descriptors out of an IPA', () => {
    const t = styleAromaTarget(styleById('21A')) // American IPA
    expect(t.vector).not.toBeNull()
    expect(t.matched).toContain('citrus')
    // citrus axis should carry weight
    expect(t.vector![AROMA_AXES.indexOf('Citrus')]).toBeGreaterThan(0)
  })
})

describe('pairing engine', () => {
  it('recommends American hops for American IPA over noble hops', () => {
    const ipa = styleById('21A')
    const citra = scoreHopForStyle(ipa, HOPS_BY_KEY.get('citra')!)
    const saaz = scoreHopForStyle(ipa, HOPS_BY_KEY.get('saaz')!)
    expect(citra.total).toBeGreaterThan(saaz.total)
    expect(citra.tradition).toBe(1)
  })

  it('recommends noble hops for Czech Premium Pale Lager over Citra', () => {
    const pils = styleById('3B')
    const saaz = scoreHopForStyle(pils, HOPS_BY_KEY.get('saaz')!)
    const citra = scoreHopForStyle(pils, HOPS_BY_KEY.get('citra')!)
    expect(saaz.total).toBeGreaterThan(citra.total)
  })

  it('ranked list puts a homeland variety in the top ranks for German Pils', () => {
    const top = rankHopsForStyle(styleById('5D'), 10)
    const countries = top.map((p) => p.hop.country ?? '')
    expect(countries.some((c) => /german|czech/i.test(c))).toBe(true)
  })

  it('scores are bounded and complete', () => {
    const top = rankHopsForStyle(styleById('21A'), 200)
    for (const p of top) {
      expect(p.total).toBeGreaterThanOrEqual(0)
      expect(p.total).toBeLessThanOrEqual(1.0001)
    }
  })
})

describe('hop-hop similarity', () => {
  it('rates Citra closer to Mosaic than to Saaz', () => {
    const citra = HOPS_BY_KEY.get('citra')!
    const mosaic = HOPS_BY_KEY.get('mosaic')!
    const saaz = HOPS_BY_KEY.get('saaz')!
    expect(hopAromaSimilarity(citra, mosaic)).toBeGreaterThan(hopAromaSimilarity(citra, saaz))
  })
})
