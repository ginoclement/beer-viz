import type { BeerStyle } from './types'

/**
 * Flavor-descriptor mining. The guideline prose (aroma, flavor, overall
 * impression) is scanned against a curated lexicon of beer sensory
 * descriptors, grouped by where the character comes from. The resulting
 * fingerprint powers a "flavor text" similarity mode that knows nothing
 * about tags or vital statistics — only how the guideline authors describe
 * the beer.
 *
 * Each entry is [canonical name, regex matching its variants].
 */
export type DescriptorFamily = 'malt' | 'hops' | 'fermentation' | 'mouthfeel & other'

const LEXICON: [DescriptorFamily, string, RegExp][] = [
  // malt-derived
  ['malt', 'bready', /\bbread|doughy\b/],
  ['malt', 'biscuity', /\bbiscuit/],
  ['malt', 'toasty', /\btoast/],
  ['malt', 'grainy', /\bgrain(y|-like)|\bcereal\b/],
  ['malt', 'caramel', /\bcaramel/],
  ['malt', 'toffee', /\btoffee/],
  ['malt', 'nutty', /\bnut(ty|-like)/],
  ['malt', 'honey', /\bhoney/],
  ['malt', 'molasses', /\bmolasses|\btreacle/],
  ['malt', 'chocolate', /\bchocolate|\bcocoa/],
  ['malt', 'coffee', /\bcoffee|\bespresso/],
  ['malt', 'roasty', /\broast/],
  ['malt', 'burnt', /\bburnt|\bcharred|\bacrid/],
  ['malt', 'smoky', /\bsmok(e|y|ed)|\brauch/],
  ['malt', 'corn-like', /\bcorn(y|-like)?\b|\bdms\b/],
  // hop-derived
  ['hops', 'citrus', /\bcitrus|\bgrapefruit|\borange\b|\blemon|\blime\b/],
  ['hops', 'piney', /\bpine|\bresin/],
  ['hops', 'floral', /\bfloral|\bflower|\bperfum/],
  ['hops', 'spicy hops', /\bspicy hop|\bpepper(y)? hop|hop.{0,12}spic/],
  ['hops', 'herbal', /\bherbal|\bgrass(y)?\b|\bminty?\b/],
  ['hops', 'earthy', /\bearth(y|iness)/],
  ['hops', 'tropical fruit', /\btropical|\bmango|\bpassion ?fruit|\bpineapple|\bguava/],
  ['hops', 'stone fruit', /\bstone fruit|\bpeach|\bapricot|\bnectarine/],
  ['hops', 'melon', /\bmelon/],
  ['hops', 'dank', /\bdank|\bcatty|\bonion|\bgarlic/],
  ['hops', 'berry', /\bberr(y|ies)|\bcurrant|\bblack ?currant/],
  // fermentation-derived
  ['fermentation', 'fruity esters', /\bester|\bfruity|\bfruit(iness)?\b/],
  ['fermentation', 'banana', /\bbanana/],
  ['fermentation', 'clove', /\bclove/],
  ['fermentation', 'phenolic', /\bphenol/],
  ['fermentation', 'peppery', /\bpepper(y)?\b/],
  ['fermentation', 'apple', /\bapple/],
  ['fermentation', 'pear', /\bpear\b/],
  ['fermentation', 'dark fruit', /\bdark fruit|\bplum|\braisin|\bprune|\bfig\b|\bdate\b/],
  ['fermentation', 'cherry', /\bcherr(y|ies)/],
  ['fermentation', 'vinous', /\bvinous|\bwine|\bwiney|\bgrape\b|\bsherry|\bport\b/],
  ['fermentation', 'alcohol warmth', /\balcohol(ic)? (warm|strength|presence|character|flavor|aroma)|\bwarming|\bboozy|\bspirit/],
  ['fermentation', 'solvent', /\bsolvent|\bfusel|\bhot alcohol/],
  ['fermentation', 'funky', /\bfunk(y)?|\bbarnyard|\bhorse|\bleather(y)?\b|\bbrett(anomyces)?\b|\bmusty\b/],
  ['fermentation', 'sour/tart', /\bsour(ness)?\b|\btart(ness)?\b|\bacidic|\bacidity|\blactic|\bacetic|\bvinegar/],
  ['fermentation', 'buttery', /\bdiacetyl|\bbutter(y|scotch)/],
  ['fermentation', 'sulfur', /\bsulfur|\bsulphur|\bsulfid/],
  // mouthfeel & other
  ['mouthfeel & other', 'sweet', /\bsweet(ness|ish)?\b/],
  ['mouthfeel & other', 'dry finish', /\bdry (finish|palate)|\bfinishes? dry|\bdryness|\bcrisp/],
  ['mouthfeel & other', 'creamy', /\bcream(y|iness)|\bsilky|\bsmooth\b|\bvelvet/],
  ['mouthfeel & other', 'full-bodied', /\bfull[- ]bod|\bchewy|\brich\b|\bluscious/],
  ['mouthfeel & other', 'light-bodied', /\blight[- ]bod|\bwatery|\bthin\b|\bdelicate\b/],
  ['mouthfeel & other', 'vanilla', /\bvanilla/],
  ['mouthfeel & other', 'oak', /\boak|\bwood(y|-aged)?\b|\bbarrel/],
  ['mouthfeel & other', 'licorice', /\blicorice|\bliquorice|\banise/],
  ['mouthfeel & other', 'mineral', /\bmineral|\bflint|\bchalk/],
  ['mouthfeel & other', 'salty', /\bsalt(y|iness)?\b|\bbriny/],
  ['mouthfeel & other', 'spiced', /\bspice[sd]?\b|\bcoriander|\bcinnamon|\bginger\b|\bnutmeg/],
  ['mouthfeel & other', 'bitter finish', /\bbitter(ness)?\b/],
]

export const DESCRIPTOR_FAMILIES: DescriptorFamily[] = [
  'malt',
  'hops',
  'fermentation',
  'mouthfeel & other',
]

export interface Descriptor {
  family: DescriptorFamily
  name: string
  /** number of prose fields it appeared in (1..3) */
  strength: number
}

/** Extract the descriptor fingerprint from a style's prose. */
export function extractDescriptors(style: Pick<BeerStyle, 'aroma' | 'flavor' | 'impression'>): Descriptor[] {
  const fields = [style.aroma, style.flavor, style.impression].filter(
    (t): t is string => Boolean(t),
  )
  if (fields.length === 0) return []
  const lowered = fields.map((f) => f.toLowerCase())
  const out: Descriptor[] = []
  for (const [family, name, re] of LEXICON) {
    let strength = 0
    for (const text of lowered) if (re.test(text)) strength++
    if (strength > 0) out.push({ family, name, strength })
  }
  return out
}

/** Jaccard similarity of two descriptor fingerprints (by descriptor name). */
export function descriptorSimilarity(a: Descriptor[], b: Descriptor[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const sa = new Set(a.map((d) => d.name))
  const sb = new Set(b.map((d) => d.name))
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  return inter / (sa.size + sb.size - inter)
}
