// Normalizes the vendored DIY Dog recipe corpus (data/raw/recipes/diydog.json)
// into src/generated/recipes.json for the Ingredients view.
//
// Source: BrewDog's "DIY Dog" — 415 real commercial recipes with complete
// grain bills, hop schedules, and yeast, released publicly by BrewDog;
// JSON transcription vendored from the MIT-licensed alxiw/punkapi archive.
// Recipe text and data © BrewDog; used here as a public dataset with
// attribution, same as the style-guideline and hop-chemistry sources.
//
// Run after build-hops.mjs — hop names are matched against the generated
// hop-chemistry dataset so the app can cross-link varieties.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const beers = JSON.parse(readFileSync(join(root, 'data/raw/recipes/diydog.json'), 'utf8'))
const hopDb = JSON.parse(readFileSync(join(root, 'src/generated/hops.json'), 'utf8'))

// ---------------------------------------------------------------- gravity/color

/** "1074" | "1.074" | "1010" -> 1.074-style specific gravity. */
const normGravity = (v) => {
  if (v == null || !isFinite(v)) return null
  if (v > 100) return v / 1000
  if (v > 2) return null // nonsense
  return v
}

const ebcToSrm = (ebc) => ebc / 1.97

// ---------------------------------------------------------------- malt classes

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

const classifyMalt = (name) => {
  for (const [cls, re] of MALT_CLASSES) if (re.test(name)) return cls
  return 'other'
}

// ---------------------------------------------------------------- hop stages

/**
 * The corpus spells hop timing 40+ ways ("start", "90", "Flame Out", "FWH",
 * "Dry Hop, at Day 6", "FV", "whirlpool"…). Fold everything into three
 * stages: bittering (early boil), late (mid/late boil + whirlpool), dry
 * (anything post-boil).
 */
const classifyStage = (add) => {
  const a = String(add ?? '').toLowerCase().trim()
  if (/dry|fv|hd\d|secondary|maturation|wood ageing/.test(a)) return 'dry'
  if (/start|first wort|fwh|mash/.test(a)) return 'bittering'
  if (/end|flame|whirlpool|whp|kettle|middle|additions/.test(a)) return 'late'
  const mins = parseFloat(a)
  if (isFinite(mins)) return mins >= 45 ? 'bittering' : 'late'
  return 'late'
}

// ---------------------------------------------------------------- hop matching

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
  'german cascade': 'cascade',
  saphire: 'saphir',
  tomahawk: 'ctz',
  dana: 'extra styrian dana',
}

const normHopName = (name) => {
  let n = name
    .toLowerCase()
    .replace(/[®™]/g, '')
    .replace(/[äà]/g, 'a')
    .replace(/[üù]/g, 'u')
    .replace(/[öò]/g, 'o')
    .replace(/\b(co2|c02)\b/g, '')
    .replace(/\bextract\b/g, '')
    .replace(/\bpellets?\b/g, '')
    .replace(/[^a-z0-9. ]+/g, ' ')
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return HOP_ALIASES[n] ?? n
}

const hopIndex = new Map()
for (const h of hopDb.hops ?? hopDb) {
  hopIndex.set(normHopName(h.name), h.key)
  hopIndex.set(h.key.replace(/-/g, ' '), h.key)
}
const matchHop = (name) => hopIndex.get(normHopName(name)) ?? null

// ---------------------------------------------------------------- style family

/** Ordered keyword rules over tagline, then name, then description. */
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

const classifyFamily = (b) => {
  for (const text of [b.tagline ?? '', b.name ?? '', b.description ?? '']) {
    for (const [fam, re] of FAMILY_RULES) if (re.test(text)) return fam
  }
  return 'other'
}

// ---------------------------------------------------------------- normalize

const recipes = []
let hopEntries = 0
let hopMatched = 0
const unmatchedHops = new Map()

for (const b of beers) {
  let og = normGravity(b.target_og)
  let fg = normGravity(b.target_fg)
  // a few source entries transcribe the two gravities swapped
  if (og != null && fg != null && og < fg) [og, fg] = [fg, og]
  const srm = b.srm ?? (b.ebc != null ? +ebcToSrm(b.ebc).toFixed(1) : null)
  const batchL = b.volume?.value ?? null

  // one source entry ships without a grain bill — useless for this dataset
  if (!(b.ingredients?.malt ?? []).length) continue

  const maltsRaw = (b.ingredients?.malt ?? []).map((m) => ({
    name: m.name,
    kg: m.amount?.unit === 'grams' ? m.amount.value / 1000 : m.amount?.value ?? 0,
    class: classifyMalt(m.name),
  }))
  const totalKg = maltsRaw.reduce((s, m) => s + m.kg, 0)
  const malts = maltsRaw.map((m) => ({ ...m, kg: +m.kg.toFixed(3), pct: totalKg > 0 ? +((m.kg / totalKg) * 100).toFixed(1) : 0 }))

  const hops = []
  for (const h of b.ingredients?.hops ?? []) {
    const unit = h.amount?.unit
    if (unit === 'total') continue // catalog artifact, not an addition
    let grams = h.amount?.value ?? 0
    if (unit === 'kilogram') grams *= 1000
    // 'ml' additions are liquid extracts; density ~1 makes grams a fair proxy
    const key = matchHop(h.name)
    hopEntries++
    if (key) hopMatched++
    else unmatchedHops.set(h.name, (unmatchedHops.get(h.name) ?? 0) + 1)
    hops.push({
      name: h.name,
      key,
      g: +grams.toFixed(1),
      stage: classifyStage(h.add),
    })
  }

  recipes.push({
    id: b.id,
    name: b.name,
    tagline: b.tagline ?? '',
    year: b.first_brewed ? +String(b.first_brewed).slice(-4) : null,
    family: classifyFamily(b),
    vitals: {
      og,
      fg,
      abv: b.abv ?? null,
      ibu: b.ibu ?? null,
      srm: srm != null ? +(+srm).toFixed(1) : null,
    },
    batchL,
    malts,
    hops,
    yeast: typeof b.ingredients?.yeast === 'string' ? b.ingredients.yeast : null,
    description: (b.description ?? '').slice(0, 260),
  })
}

const out = {
  source: 'BrewDog DIY Dog (415 published recipes, 2019 V8 release) via the MIT-licensed alxiw/punkapi JSON archive',
  recipes,
}

mkdirSync(join(root, 'src/generated'), { recursive: true })
writeFileSync(join(root, 'src/generated/recipes.json'), JSON.stringify(out))

const famCount = {}
for (const r of recipes) famCount[r.family] = (famCount[r.family] ?? 0) + 1
console.log({
  recipes: recipes.length,
  withFullVitals: recipes.filter((r) => r.vitals.og && r.vitals.ibu != null && r.vitals.srm != null).length,
  hopEntries,
  hopMatchedToChemistryDb: hopMatched,
  hopMatchRate: `${((hopMatched / hopEntries) * 100).toFixed(1)}%`,
  families: famCount,
})
const topUnmatched = [...unmatchedHops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
console.log('top unmatched hop names (twists & extracts expected):', topUnmatched)
console.log('wrote src/generated/recipes.json')
