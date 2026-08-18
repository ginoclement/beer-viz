// Normalizes the three vendored style guidelines (data/raw/*) into one compact
// schema consumed by the app, written to src/generated/guides.json.
//
// Raw data: https://github.com/beerjson/bjcp-json (MIT). BJCP guidelines are
// © the Beer Judge Certification Program; BA guidelines © the Brewers Association.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const TAG_ALIASES = {
  'wild-fermentation': 'wild-fermented',
  'specialty-beer': 'specialty-beer',
  fruitbrazilian: 'fruit',
  'fruitbrazilian styles': 'fruit',
}

function cleanTags(raw) {
  if (!raw) return []
  const out = new Set()
  for (let t of String(raw).split(',')) {
    t = t.trim().toLowerCase()
    if (!t) continue
    // "FruitBrazilian Styles" is a data glitch in the 2021 file: "fruit" + a
    // stray section header fused together.
    if (t.startsWith('fruitbrazilian')) t = 'fruit'
    out.add(TAG_ALIASES[t] ?? t)
  }
  return [...out]
}

function range(field) {
  const min = field?.minimum?.value
  const max = field?.maximum?.value
  if (typeof min !== 'number' || typeof max !== 'number') return null
  return [min, max]
}

const mid = (r) => (r ? (r[0] + r[1]) / 2 : null)

// Synthesized tags follow the BJCP tag conventions so Jaccard comparisons
// across guidelines operate on one vocabulary.
function synthesizeTags(style, stats, extra = []) {
  const tags = new Set(extra)
  const abv = mid(stats.abv)
  if (abv != null) {
    if (abv < 4.3) tags.add('session-strength')
    else if (abv < 6.3) tags.add('standard-strength')
    else if (abv < 9.0) tags.add('high-strength')
    else tags.add('very-high-strength')
  }
  const srm = mid(stats.srm)
  if (srm != null) {
    if (srm < 9) tags.add('pale-color')
    else if (srm < 20) tags.add('amber-color')
    else tags.add('dark-color')
  }
  const og = mid(stats.og)
  const ibu = mid(stats.ibu)
  if (og != null && ibu != null && og > 1) {
    const buGu = ibu / ((og - 1) * 1000)
    if (buGu >= 0.85) tags.add('hoppy')
    else if (buGu <= 0.45) tags.add('malty')
    else tags.add('balanced')
  }
  const name = style.name.toLowerCase()
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

const BA_ORIGIN_TAGS = {
  'British Origin Ale Styles': ['british-isles', 'top-fermented'],
  'Irish Origin Ale Styles': ['british-isles', 'top-fermented'],
  'North American Origin Ale Styles': ['north-america', 'top-fermented', 'craft-style'],
  'North American Origin Lager Styles': ['north-america', 'bottom-fermented', 'lagered'],
  'German Origin Ale Styles': ['central-europe', 'top-fermented'],
  'European-Germanic Origin Lager Styles': ['central-europe', 'bottom-fermented', 'lagered'],
  'Belgian and French Origin Ale Styles': ['western-europe', 'top-fermented'],
  'Other Origin Ale Styles': ['top-fermented'],
  'Other Origin Lager Styles': ['bottom-fermented', 'lagered'],
  'All Origin Hybrid/Mixed Lagers or Ales': ['any-fermentation'],
}

function firstText(style, keys) {
  for (const k of keys) {
    const v = style[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function normalize(style, guide, index) {
  const stats = {
    og: range(style.original_gravity),
    fg: range(style.final_gravity),
    abv: range(style.alcohol_by_volume),
    ibu: range(style.international_bitterness_units),
    srm: range(style.color),
  }
  const hasStats = Boolean(stats.og && stats.fg && stats.abv && stats.ibu && stats.srm)

  let tags = cleanTags(style.tags)
  let tagsSynthesized = false
  if (tags.length === 0) {
    tagsSynthesized = true
    const extra =
      guide === 'ba2017'
        ? BA_ORIGIN_TAGS[style.origin] ?? []
        : []
    tags = synthesizeTags(style, stats, extra)
  }

  const id =
    guide === 'ba2017' ? `ba-${slug(style.name)}` : style.style_id ?? `x-${index}`

  return {
    id,
    name: style.name,
    category: style.category ?? style.origin ?? 'Uncategorized',
    categoryId: style.category_id ?? null,
    type: style.type ?? 'beer',
    stats,
    hasStats,
    tags,
    tagsSynthesized,
    impression: firstText(style, [
      'overall_impression',
      'impressao_geral',
      'impresion_general',
      'notes',
    ]),
    aroma: firstText(style, ['aroma']),
    appearance: firstText(style, ['appearance', 'aparencia', 'aspecto']),
    flavor: firstText(style, ['flavor', 'sabor']),
    mouthfeel: firstText(style, ['mouthfeel', 'sensacao_de_boca', 'sensacion_en_boca']),
    comments: firstText(style, ['comments', 'comentarios']),
    history: firstText(style, ['history', 'historia']),
    comparison: firstText(style, ['style_comparison', 'comparison', 'comparacoes_de_estilo']),
    ingredients: firstText(style, ['ingredients', 'ingredientes']),
    examples: firstText(style, ['examples', 'ejemplos_comerciales', 'exemplos_comerciais']),
  }
}

function load(file) {
  return JSON.parse(readFileSync(join(root, 'data/raw', file), 'utf8')).beerjson.styles
}

const guides = [
  {
    guide: 'bjcp2021',
    label: 'BJCP 2021',
    source: 'Beer Judge Certification Program, 2021 Beer Style Guidelines',
    styles: load('bjcp_styleguide-2021.json')
      .filter((s) => (s.type ?? 'beer') === 'beer')
      .map((s, i) => normalize(s, 'bjcp2021', i)),
  },
  {
    guide: 'bjcp2015',
    label: 'BJCP 2015',
    source: 'Beer Judge Certification Program, 2015 Style Guidelines (beer styles only)',
    styles: load('bjcp_styleguide-2015.json')
      .filter((s) => (s.type ?? 'beer') === 'beer')
      .map((s, i) => normalize(s, 'bjcp2015', i)),
  },
  {
    guide: 'ba2017',
    label: 'Brewers Association 2017',
    source: 'Brewers Association 2017 Beer Style Guidelines',
    styles: load('ba_styleguide-2017.json')
      .filter((s) => (s.type ?? 'beer') === 'beer')
      .map((s, i) => normalize(s, 'ba2017', i)),
  },
]

for (const g of guides) {
  const ids = new Set()
  for (const s of g.styles) {
    if (ids.has(s.id)) throw new Error(`duplicate id ${s.id} in ${g.guide}`)
    ids.add(s.id)
  }
  const n = g.styles.filter((s) => s.hasStats).length
  console.log(`${g.label}: ${g.styles.length} styles, ${n} with full vital statistics`)
}

const outDir = join(root, 'src/generated')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'guides.json'), JSON.stringify(guides))
console.log('wrote src/generated/guides.json')
