import recipesJson from '../generated/recipes.json'
import { SERIES } from './palette'

/**
 * The DIY Dog recipe corpus (415 published BrewDog recipes with complete
 * ingredient bills) plus shared ingredient vocabulary: grist classes, hop
 * stages, and their chart colors. Classification mirrors
 * scripts/build-recipes.mjs — keep the regexes in sync.
 */

export interface CorpusMalt {
  name: string
  kg: number
  pct: number
  class: string
}

export interface CorpusHop {
  name: string
  /** key into the hop-chemistry dataset, or null for twists (coffee, zest…) */
  key: string | null
  g: number
  stage: HopStage
}

export interface CorpusRecipe {
  id: number
  name: string
  tagline: string
  year: number | null
  family: string
  vitals: {
    og: number | null
    fg: number | null
    abv: number | null
    ibu: number | null
    srm: number | null
  }
  batchL: number | null
  malts: CorpusMalt[]
  hops: CorpusHop[]
  yeast: string | null
  description: string
}

const data = recipesJson as unknown as { source: string; recipes: CorpusRecipe[] }
export const CORPUS_SOURCE = data.source
export const CORPUS: CorpusRecipe[] = data.recipes

export type HopStage = 'bittering' | 'late' | 'dry'

export const STAGES: { key: HopStage; label: string; color: string }[] = [
  { key: 'bittering', label: 'Bittering (early boil)', color: SERIES[0] },
  { key: 'late', label: 'Late boil / whirlpool', color: SERIES[1] },
  { key: 'dry', label: 'Dry hop', color: SERIES[2] },
]
export const stageColor = (s: HopStage) => STAGES.find((x) => x.key === s)!.color

/** Grist families in display order, colored from the validated series palette. */
export const MALT_CLASS_ORDER = [
  'base',
  'wheat, oats & rye',
  'crystal & caramel',
  'roasted',
  'sugars & adjuncts',
  'smoked',
  'other',
] as const

const MALT_CLASS_COLORS: Record<string, string> = {
  base: SERIES[3], // gold — the pale backbone
  'wheat, oats & rye': SERIES[2],
  'crystal & caramel': SERIES[1],
  roasted: SERIES[6],
  'sugars & adjuncts': SERIES[4],
  smoked: SERIES[7],
  other: '#898781',
}
export const maltClassColor = (c: string) => MALT_CLASS_COLORS[c] ?? '#898781'

/** Mirrors classifyMalt in scripts/build-recipes.mjs (for imported recipes). */
export function classifyMalt(name: string): string {
  if (/black|roast|chocolate|carafa|patent|midnight/i.test(name)) return 'roasted'
  if (/crystal|caramalt|caramel|carapils|carahell|caramunich|carared|caraaroma|carabelge|dextrin|special [bw]|t50|double roasted/i.test(name))
    return 'crystal & caramel'
  if (/wheat|oat|rye|spelt|torrified|flaked (barley|maize|corn|rice)/i.test(name))
    return 'wheat, oats & rye'
  if (/sugar|dextrose|glucose|honey|lactose|maple|molasses|treacle|candi|syrup|raisins?|fruit/i.test(name))
    return 'sugars & adjuncts'
  if (/smoke|rauch|peat/i.test(name)) return 'smoked'
  if (/pale|pilsner|pils|maris|munich|vienna|golden promise|ale malt|lager malt|extra pale|propino|2.row|low colour|amber|brown|mild/i.test(name))
    return 'base'
  return 'other'
}

/** Total hop grams per liter for a recipe, or null without batch volume. */
export function hopGramsPerLiter(r: CorpusRecipe): number | null {
  if (!r.batchL) return null
  const g = r.hops.reduce((s, h) => s + h.g, 0)
  return g / r.batchL
}

/** Share of the grist (by weight %) in the given classes. */
export function gristShare(r: CorpusRecipe, classes: string[]): number {
  return r.malts.filter((m) => classes.includes(m.class)).reduce((s, m) => s + m.pct, 0)
}
