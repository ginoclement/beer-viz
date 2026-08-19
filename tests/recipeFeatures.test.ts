import { describe, expect, it } from 'vitest'
import { buildRecipeFeatureSpace } from '../src/lib/recipeFeatures'
import { CORPUS } from '../src/lib/ingredients'
import { NUMERIC_FEATURE_NAMES } from '../src/lib/features'
import { MALT_CLASS_ORDER } from '../src/lib/ingredients'

describe('recipe schema enrichment', () => {
  it('derives apparent attenuation consistent with OG/FG', () => {
    for (const r of CORPUS) {
      if (r.attenuation == null || r.vitals.og == null || r.vitals.fg == null) continue
      const expected = ((r.vitals.og - r.vitals.fg) / (r.vitals.og - 1)) * 100
      expect(r.attenuation).toBeCloseTo(expected, 1)
    }
  })

  it('tags every recipe with a best-fit BJCP style whose code is well-formed', () => {
    const tagged = CORPUS.filter((r) => r.styleGuess)
    expect(tagged.length).toBe(CORPUS.length)
    for (const r of CORPUS) {
      // BJCP codes are numeric with an optional subcategory letter (e.g. 21A),
      // plus letter-prefixed provisional/specialty codes (X1, X3, C1…)
      expect(r.styleGuess!.code).toMatch(/^[A-Z]?[0-9]+[A-Z]?$/)
      expect(r.styleGuess!.inRange).toBeGreaterThanOrEqual(0)
      expect(r.styleGuess!.inRange).toBeLessThanOrEqual(5)
    }
  })

  it('carries fermentation/mash slots (DIY Dog populates mash + ferment temps)', () => {
    const withMash = CORPUS.filter((r) => r.mash?.tempC != null)
    expect(withMash.length).toBeGreaterThan(0)
    for (const r of withMash) expect(r.mash!.tempC).toBeGreaterThan(30) // plausible °C
  })
})

describe('buildRecipeFeatureSpace', () => {
  it('includes only full-vitals recipes and aligns vectors to them', () => {
    const space = buildRecipeFeatureSpace(CORPUS, { blend: 0.5 })
    expect(space.vectors.length).toBe(space.recipes.length)
    expect(space.recipes.every((r) => r.vitals.og != null && r.vitals.srm != null)).toBe(true)
  })

  it('has the expected vitals + grist + hop dimensionality', () => {
    const hopTopN = 40
    const space = buildRecipeFeatureSpace(CORPUS, { blend: 0.5, hopTopN })
    const expectedDim = NUMERIC_FEATURE_NAMES.length + MALT_CLASS_ORDER.length + space.hopKeys.length
    expect(space.hopKeys.length).toBeLessThanOrEqual(hopTopN)
    expect(space.featureNames.length).toBe(expectedDim)
    for (const v of space.vectors) expect(v.length).toBe(expectedDim)
  })

  it('blend shifts weight from vitals to ingredients', () => {
    const nNum = NUMERIC_FEATURE_NAMES.length
    const vitalsOnly = buildRecipeFeatureSpace(CORPUS, { blend: 0 })
    const ingOnly = buildRecipeFeatureSpace(CORPUS, { blend: 1 })
    const magIng = (vec: number[]) => vec.slice(nNum).reduce((s, x) => s + Math.abs(x), 0)
    const magVit = (vec: number[]) => vec.slice(0, nNum).reduce((s, x) => s + Math.abs(x), 0)
    // at blend 0 the ingredient block is zeroed out; at blend 1 the vitals block is
    expect(vitalsOnly.vectors.reduce((s, v) => s + magIng(v), 0)).toBeCloseTo(0, 6)
    expect(ingOnly.vectors.reduce((s, v) => s + magVit(v), 0)).toBeCloseTo(0, 6)
  })
})
