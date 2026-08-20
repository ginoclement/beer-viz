// Shared recipe-normalization vocabulary used by every corpus source
// (DIY Dog, Brewer's Friend crawls, future imports): gravity/color cleanup,
// grist classification, hop-stage folding, hop-name matching against the
// generated chemistry dataset, and style-family keyword rules.
//
// The malt classes and stages mirror src/lib/ingredients.ts — keep in sync.

/** "1074" | "1.074" | "1010" -> 1.074-style specific gravity. */
export const normGravity = (v) => {
  if (v == null || !isFinite(v)) return null
  if (v > 100) return v / 1000
  if (v > 2) return null // nonsense
  return v
}

export const ebcToSrm = (ebc) => ebc / 1.97
export const lovibondToSrm = (l) => 1.3546 * l - 0.76

export const OZ_TO_G = 28.3495
export const LB_TO_KG = 0.453592
export const GAL_TO_L = 3.78541

/**
 * Grist families, checked in order (first match wins). "Chocolate Wheat" and
 * "Carafa" are roasted before the wheat/cara rules can claim them.
 */
const MALT_CLASSES = [
  ['roasted', /black|roast|chocolate|carafa|patent|midnight/i],
  ['crystal & caramel', /crystal|caramalt|caramel|carapils|carahell|caramunich|carared|caraaroma|carabelge|dextrin|special [bw]|t50|double roasted/i],
  ['wheat, oats & rye', /wheat|oat|rye|spelt|torrified|flaked (barley|maize|corn|rice)/i],
  ['sugars & adjuncts', /sugar|dextrose|glucose|honey|lactose|maple|molasses|treacle|candi|syrup|raisins?|fruit/i],
  ['smoked', /smoke|rauch|peat/i],
  ['base', /pale|pilsner|pils|maris|munich|vienna|golden promise|ale malt|lager malt|extra pale|propino|2.row|low colour|amber|brown|mild/i],
]

export const classifyMalt = (name) => {
  for (const [cls, re] of MALT_CLASSES) if (re.test(name)) return cls
  return 'other'
}

/**
 * Fold free-text hop timing ("start", "90", "Flame Out", "FWH", "Dry Hop,
 * at Day 6", "FV", "whirlpool", "hopstand"…) into three stages: bittering
 * (early boil), late (mid/late boil + whirlpool), dry (post-boil).
 */
export const classifyStage = (add) => {
  const a = String(add ?? '').toLowerCase().trim()
  if (/dry|fv|hd\d|secondary|maturation|wood ageing/.test(a)) return 'dry'
  if (/start|first wort|fwh|mash/.test(a)) return 'bittering'
  if (/end|flame|whirlpool|whp|hopstand|hop stand|aroma|kettle|middle|additions/.test(a)) return 'late'
  const mins = parseFloat(a.replace(/^boil\s*/, ''))
  if (isFinite(mins)) return mins >= 45 ? 'bittering' : 'late'
  if (/boil/.test(a)) return 'bittering'
  return 'late'
}

const HOP_ALIASES = {
  columbus: 'ctz',
  'columbus tomahawk': 'ctz',
  zeus: 'ctz',
  'h blanc': 'hallertau blanc',
  'hallertauer blanc': 'hallertau blanc',
  fuggles: 'fuggle',
  'east kent goldings': 'east kent golding',
  'styrian goldings': 'styrian golding',
  equinox: 'ekuanot',
  tettnang: 'tettnanger',
  'h mittelfruh': 'hallertauer mittelfruh',
  'hallertau mittelfruh': 'hallertauer mittelfruh',
  'hallertau tradition': 'hallertauer tradition',
  'german cascade': 'cascade',
  saphire: 'saphir',
  tomahawk: 'ctz',
  dana: 'extra styrian dana',
  'hallertau hersbrucker': 'hersbrucker',
  'hersbrucker hallertau': 'hersbrucker',
  hallertau: 'hallertauer mittelfruh',
  hallertauer: 'hallertauer mittelfruh',
  'kent goldings': 'east kent golding',
  'kent golding': 'east kent golding',
  goldings: 'goldings',
  spalt: 'spalter',
  'spalt select': 'spalter select',
  'brewer s gold': 'brewers gold',
  millenium: 'millennium',
  williamette: 'willamette',
  'lemon drop': 'lemondrop',
  'styrian goldings celeia': 'celeia',
}

export const normHopName = (name) => {
  const n = String(name)
    .toLowerCase()
    .replace(/[®™]/g, '')
    .replace(/[äà]/g, 'a')
    .replace(/[üù]/g, 'u')
    .replace(/[öò]/g, 'o')
    // vendor packaging qualifiers: "(11 AA)", "(Cryo)", "(U.S.)", "(Germany)"…
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(co2|c02)\b/g, '')
    .replace(/\bextract\b/g, '')
    .replace(/\bpellets?\b/g, '')
    .replace(/\bleaf\b|\bwhole\b|\bcryo\b|\blupomax\b|\blupuln2\b/g, '')
    // alpha-acid annotations outside parens: "Citra 11 AA", "12.5% AA"
    .replace(/\b\d+(\.\d+)?\s*%?\s*aa\b/g, ' ')
    .replace(/[^a-z0-9. ]+/g, ' ')
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const aliased = HOP_ALIASES[n] ?? n
  if (aliased !== n) return aliased
  // origin qualifiers: "Czech Saaz", "Domestic Hallertau", "AU Galaxy"
  const stripped = n.replace(/^(domestic|german|czech|french|us|u s|uk|au|nz|american|slovenian)\s+/, '')
  return stripped !== n ? (HOP_ALIASES[stripped] ?? stripped) : n
}

/** Build a name->key matcher over the generated hop-chemistry dataset. */
export const makeHopMatcher = (hopDb) => {
  const index = new Map()
  for (const h of hopDb.hops ?? hopDb) {
    index.set(normHopName(h.name), h.key)
    index.set(h.key.replace(/-/g, ' '), h.key)
  }
  return (name) => index.get(normHopName(name)) ?? null
}

/** Ordered keyword rules over the given texts (most specific first). */
const FAMILY_RULES = [
  ['barley wine', /barley ?wine/i],
  ['stout', /stout/i],
  ['porter', /porter/i],
  ['sour & wild', /sour|berliner|gose\b|lambic|brett|wild|kettle-?soured/i],
  ['wheat & wit', /wheat|weizen|weisse|witbier|\bwit\b|hefe/i],
  ['saison & farmhouse', /saison|farmhouse|biere de garde/i],
  ['belgian', /belgian|abbey|dubbel|tripel|quad|trappist/i],
  ['ipa', /\bipa\b|india pale ale/i],
  ['red & amber', /\bred ale\b|amber|irish red|\bred\b/i],
  ['brown & dark ale', /brown ale|dark ale|old ale|\bmild\b/i],
  ['scotch & strong ale', /scotch|wee heavy|strong ale|barrel-aged ale/i],
  ['lager & pilsner', /lager|pilsner|pilsener|helles|bock|kolsch|k[öo]lsch|steam beer|zwickel/i],
  ['golden & blonde', /golden ale|blonde?\b/i],
  ['pale ale', /pale ale|\bapa\b|bitter\b/i],
]

export const classifyFamilyFromTexts = (...texts) => {
  for (const text of texts) {
    if (!text) continue
    for (const [fam, re] of FAMILY_RULES) if (re.test(text)) return fam
  }
  return 'other'
}

/** Attach grist percentages to a list of { name, kg } malts. */
export const finishMalts = (maltsRaw) => {
  const totalKg = maltsRaw.reduce((s, m) => s + m.kg, 0)
  return maltsRaw.map((m) => ({
    name: m.name,
    kg: +m.kg.toFixed(3),
    class: classifyMalt(m.name),
    pct: totalKg > 0 ? +((m.kg / totalKg) * 100).toFixed(1) : 0,
  }))
}
