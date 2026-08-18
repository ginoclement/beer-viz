import type { Vitals } from '../types'

/**
 * Derive BJCP-vocabulary tags for an imported recipe so Jaccard similarity
 * against guideline styles is meaningful. Mirrors the synthesis used for
 * untagged guideline styles in scripts/build-data.mjs.
 */
export function deriveRecipeTags(
  vitals: Vitals,
  opts: { name?: string; yeastType?: string | null } = {},
): string[] {
  const tags = new Set<string>()
  const { abv, og, ibu, srm } = vitals

  if (abv < 4.3) tags.add('session-strength')
  else if (abv < 6.3) tags.add('standard-strength')
  else if (abv < 9.0) tags.add('high-strength')
  else tags.add('very-high-strength')

  if (srm < 9) tags.add('pale-color')
  else if (srm < 20) tags.add('amber-color')
  else tags.add('dark-color')

  if (og > 1) {
    const buGu = ibu / ((og - 1) * 1000)
    if (buGu >= 0.85) tags.add('hoppy')
    else if (buGu <= 0.45) tags.add('malty')
    else tags.add('balanced')
  }

  const yeast = (opts.yeastType ?? '').toLowerCase()
  if (yeast.includes('lager')) {
    tags.add('bottom-fermented')
    tags.add('lagered')
  } else if (yeast.includes('ale') || yeast.includes('wheat')) {
    tags.add('top-fermented')
  } else if (yeast.includes('brett') || yeast.includes('wild')) {
    tags.add('wild-fermented')
  }

  const name = (opts.name ?? '').toLowerCase()
  if (/sour|gose|lambic|gueuze|berliner|flanders|brett|wild/.test(name)) tags.add('sour')
  if (/smoke|rauch/.test(name)) tags.add('smoke')
  if (/wood|barrel/.test(name)) tags.add('wood')
  if (/wheat|weiss|weizen|wit/.test(name)) tags.add('wheat-beer-family')
  if (/ipa|india pale/.test(name)) tags.add('ipa-family')
  if (/stout/.test(name)) tags.add('stout-family')
  if (/porter/.test(name)) tags.add('porter-family')
  if (/pilsner|pilsener|pils/.test(name)) tags.add('pilsner-family')
  if (/bock/.test(name)) tags.add('bock-family')

  return [...tags]
}

/** ABV estimate when an export carries gravities but no ABV. */
export const abvFromGravities = (og: number, fg: number) => (og - fg) * 131.25
