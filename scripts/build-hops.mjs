// Merges four hop-chemistry sources into src/generated/hops.json.
//
// Sources (vendored in data/raw/hops/):
//  - hopdatabase-aggregated.json — kasperg3/HopDatabase (MIT): 220 varieties
//    aggregated from Yakima Chief / Barth-Haas / Hopsteiner / Crosby with
//    acid + oil ranges, brewing purpose, aroma notes, and a 9-axis aroma
//    intensity profile (0-5) for most varieties.
//  - hopsteiner-raw.json — Hopsteiner catalog scrape from the same repo:
//    cohumulone, linalool, xanthohumol, polyphenols, "brews well with"
//    substitute lists, and genetic origin strings.
//  - yakima.json / barthhaas.json — numeric chemistry facts (myrcene,
//    humulene, caryophyllene, farnesene, geraniol, cohumulone) extracted
//    from almet/hops-datasets' producer scrapes.
//  - THIOLS below — hand-curated polyfunctional-thiol potential classes
//    from published brewing-science literature (approximate by nature).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const raw = (f) => JSON.parse(readFileSync(join(root, 'data/raw/hops', f), 'utf8'))

/** Same variety published under different names/spellings across producers. */
const ALIASES = {
  columbus: 'ctz',
  'columbus tomahawk': 'ctz',
  zeus: 'ctz',
  'east kent goldings': 'east kent golding',
  'tettnang tettnanger': 'tettnanger',
  'spalt spalter': 'spalter',
  'whitbread goldings variety': 'whitbread golding',
  'styrian savinjski golding': 'styrian golding',
  'savinjski golding': 'styrian golding',
  'hallertauer mittelfr h': 'hallertauer mittelfruh',
  'hallertau mittelfr h': 'hallertauer mittelfruh',
  'hallertau mittelfrueh': 'hallertauer mittelfruh',
  strisselspalter: 'strisselspalt',
  golding: 'goldings',
}

const norm = (name) => {
  const n = name
    .toLowerCase()
    .replace(/[®™]/g, '')
    .replace(/\b(hbc|yqh)\s*\d+\b/g, (m) => m.replace(/\s+/g, ''))
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return ALIASES[n] ?? n
}

/** "39 - 48%" | "0.6 - 0.8" | "1,0 - 1,7" | "27 - 30" -> [lo, hi] */
function parseRange(s) {
  if (s == null) return null
  if (typeof s === 'number') return [s, s]
  const cleaned = String(s).replace(/,/g, '.').replace(/%/g, '')
  const m = cleaned.match(/(-?\d+(?:\.\d+)?)(?:\s*[-–]\s*(-?\d+(?:\.\d+)?))?/)
  if (!m) return null
  const lo = parseFloat(m[1])
  const hi = m[2] != null ? parseFloat(m[2]) : lo
  return [Math.min(lo, hi), Math.max(lo, hi)]
}

/**
 * Polyfunctional thiol (4MMP / 3MH / 3MHA) potential, 0-3, curated from
 * published sensory and hop-chemistry literature. Approximate: thiol
 * content varies strongly with harvest year and biotransformation.
 */
const THIOLS = {
  'nelson sauvin': [3, '3MH/3MHA — the benchmark "white wine" thiol hop'],
  citra: [3, 'high 3MH and 4MMP; guava/passion fruit'],
  mosaic: [3, 'high 3MH; blueberry/tropical'],
  galaxy: [3, 'high 3MH; passion fruit'],
  riwaka: [3, 'very high 3MH; passion fruit/grapefruit'],
  nectaron: [3, 'high 3MH/3MHA'],
  simcoe: [3, 'high 4MMP; passion fruit/pine'],
  ctz: [3, 'high 4MMP (dank/catty in excess)'],
  apollo: [3, 'high 4MMP'],
  summit: [2, '4MMP plus onion/garlic sulfur notes'],
  eureka: [2, 'high total thiols; blackcurrant'],
  strata: [3, 'high 3MH; strawberry/passion fruit'],
  'idaho 7': [2, 'notable 3MH; tropical'],
  topaz: [2, 'notable 3MH'],
  'vic secret': [2, 'notable thiols; pineapple'],
  ella: [1, 'moderate'],
  motueka: [1, 'moderate 3MH'],
  'hallertau blanc': [3, 'bred for Sauvignon-Blanc-like thiols'],
  'mandarina bavaria': [1, 'moderate'],
  'huell melon': [1, 'moderate'],
  cascade: [1, 'moderate bound 3MH precursors'],
  centennial: [1, 'moderate'],
  chinook: [1, 'moderate'],
  sabro: [1, 'moderate; coconut character is oil-driven'],
  rakau: [1, 'moderate'],
  'wai iti': [1, 'moderate'],
  waimea: [1, 'moderate'],
  saaz: [0, 'noble; negligible thiols'],
  'hallertauer mittelfruh': [0, 'noble; negligible thiols'],
  tettnanger: [0, 'noble; negligible thiols'],
  spalter: [0, 'noble; negligible thiols'],
  'east kent golding': [0, 'traditional English; negligible thiols'],
  fuggle: [0, 'traditional English; negligible thiols'],
  magnum: [0, 'clean bittering; negligible thiols'],
  perle: [0, 'negligible thiols'],
}

/**
 * Oil-composition assembly with plausibility validation.
 *
 * The Yakima-derived scrape has its oil columns ROTATED for a subset of
 * varieties (e.g. Citra's "caryophyllene: 60-70%" is really its myrcene,
 * verified against Barth-Haas and published values), while others
 * (e.g. Admiral) are mapped correctly. Every commercial variety has
 * myrcene as a 15-85% major fraction and geraniol/linalool as <5% trace
 * fractions, so each candidate field-assignment is scored against those
 * envelopes and the best one wins; implausible fields are dropped.
 */
const OIL_ENVELOPES = {
  myrcene: [10, 85],
  humulene: [0, 50],
  caryophyllene: [0, 22],
  farnesene: [0, 25],
  geraniol: [0, 6],
  linalool: [0, 3.5],
}

function envelopeViolations(comp) {
  let bad = 0
  let present = 0
  for (const [field, [lo, hi]] of Object.entries(OIL_ENVELOPES)) {
    const r = comp[field]
    if (!r) continue
    present++
    if (r[1] < lo || r[1] > hi) bad++
  }
  // an assignment with no myrcene at all is suspect for a "full" profile
  if (!comp.myrcene && present >= 3) bad += 1
  return bad
}

function buildOilComp(yk, bh, hs) {
  const candidates = []
  if (yk) {
    candidates.push({
      myrcene: parseRange(yk.myrcene),
      humulene: parseRange(yk.humulene),
      caryophyllene: parseRange(yk.caryophyllene),
      farnesene: parseRange(yk.farnesene),
      geraniol: parseRange(yk.geraniol),
      linalool: null,
    })
    // the observed rotation: labels shifted one slot in the source scrape
    candidates.push({
      myrcene: parseRange(yk.caryophyllene),
      humulene: null,
      caryophyllene: parseRange(yk.humulene),
      farnesene: parseRange(yk.geraniol),
      geraniol: parseRange(yk.farnesene),
      linalool: parseRange(yk.myrcene),
    })
  }
  if (bh) {
    candidates.push({
      myrcene: parseRange(bh.myrcene),
      humulene: parseRange(bh.humulene),
      caryophyllene: parseRange(bh.caryophyllene),
      farnesene: parseRange(bh.farnesene),
      geraniol: null,
      linalool: null,
    })
  }

  let best = null
  let bestScore = Infinity
  for (const c of candidates) {
    const fields = Object.values(c).filter(Boolean).length
    if (fields === 0) continue
    const score = envelopeViolations(c) - fields * 0.01 // prefer fuller profiles on ties
    if (score < bestScore) {
      bestScore = score
      best = c
    }
  }
  const comp = best ?? {
    myrcene: null,
    humulene: null,
    caryophyllene: null,
    farnesene: null,
    geraniol: null,
    linalool: null,
  }

  // drop any individual field that still breaks its envelope
  for (const [field, [lo, hi]] of Object.entries(OIL_ENVELOPES)) {
    const r = comp[field]
    if (r && (r[1] < lo || r[1] > hi)) comp[field] = null
  }

  // fill gaps from Barth-Haas per-field when plausible
  if (bh) {
    for (const field of ['myrcene', 'humulene', 'caryophyllene', 'farnesene']) {
      if (!comp[field]) {
        const r = parseRange(bh[field])
        const [lo, hi] = OIL_ENVELOPES[field]
        if (r && r[1] >= lo && r[1] <= hi) comp[field] = r
      }
    }
  }

  // Hopsteiner reports humulene/farnesene in ml/100g; convert to % of
  // total oil via midpoints when the field is still missing
  if (hs) {
    const oils = parseRange(hs.oils)
    const toPct = (r) => {
      if (!r || !oils) return null
      const mid = (r[0] + r[1]) / 2
      const oilMid = (oils[0] + oils[1]) / 2
      if (!oilMid) return null
      const pct = (mid / oilMid) * 100
      return [Math.round(pct * 0.85 * 10) / 10, Math.round(pct * 1.15 * 10) / 10]
    }
    if (!comp.humulene) {
      const r = toPct(parseRange(hs.humulen))
      if (r && r[1] <= OIL_ENVELOPES.humulene[1]) comp.humulene = r
    }
    if (!comp.farnesene) {
      const r = toPct(parseRange(hs.farnesen))
      if (r && r[1] <= OIL_ENVELOPES.farnesene[1]) comp.farnesene = r
    }
    if (!comp.linalool) {
      const r = parseRange(hs.linalool_oil)
      if (r && r[1] <= OIL_ENVELOPES.linalool[1]) comp.linalool = r
    }
  }

  return comp
}

const agg = raw('hopdatabase-aggregated.json')
const hopsteiner = raw('hopsteiner-raw.json').hops
const yakima = raw('yakima.json')
const barthhaas = raw('barthhaas.json')

const yakimaByNorm = new Map(Object.values(yakima).map((h) => [norm(h.name), h]))
const bhByNorm = new Map(Object.values(barthhaas).map((h) => [norm(h.name), h]))
const hsByNorm = new Map(hopsteiner.map((h) => [norm(h.name), h]))

const AROMA_AXES = [
  'Citrus',
  'Resin/Pine',
  'Spice',
  'Herbal',
  'Grassy',
  'Floral',
  'Berry',
  'Stone Fruit',
  'Tropical Fruit',
]

// dedupe alias collisions up front, preferring the record with an aroma
// profile, then the one with more filled fields
const byKey = new Map()
for (const h of agg) {
  const key = norm(h.name)
  const prev = byKey.get(key)
  if (!prev) {
    byKey.set(key, h)
    continue
  }
  const score = (x) =>
    (Object.values(x.aromas ?? {}).some((v) => v > 0) ? 100 : 0) +
    Object.values(x).filter((v) => v != null && v !== '' && v !== 0).length
  if (score(h) > score(prev)) byKey.set(key, h)
}

const hops = []
for (const [key, h] of byKey) {
  const yk = yakimaByNorm.get(key)
  const bh = bhByNorm.get(key)
  const hs = hsByNorm.get(key)

  const aromas = h.aromas ?? {}
  const hasAroma = AROMA_AXES.some((a) => (aromas[a] ?? 0) > 0)

  const oilComp = buildOilComp(yk, bh, hs)

  const cohumulone =
    (h.co_h_from || h.co_h_to ? [h.co_h_from, h.co_h_to] : null) ??
    parseRange(hs?.cohumulone) ??
    parseRange(yk?.cohumulone) ??
    parseRange(bh?.cohumulone)

  const substitutes = new Set()
  for (const field of ['brewhouse', 'dry_hopping']) {
    for (const s of (hs?.[field] ?? '').split(',')) {
      const t = s.trim()
      if (t && norm(t) !== key) substitutes.add(t)
    }
  }

  const thiol = THIOLS[key] ?? null

  hops.push({
    name: h.name.replace(/[®™]/g, '').trim(),
    key,
    country: h.country || yk?.region || null,
    purpose: h.brewing_stats?.brewing_purpose ?? 'Aroma',
    source: h.source,
    alpha: h.alpha_from || h.alpha_to ? [h.alpha_from, h.alpha_to] : null,
    beta: h.beta_from || h.beta_to ? [h.beta_from, h.beta_to] : null,
    oilTotal: h.oil_from || h.oil_to ? [h.oil_from, h.oil_to] : null,
    cohumulone,
    oilComp,
    aromas: hasAroma ? AROMA_AXES.map((a) => aromas[a] ?? 0) : null,
    notes: h.notes ?? [],
    xanthohumol: parseRange(hs?.xantholhumol),
    polyphenols: parseRange(hs?.polyphenoles),
    released: yk?.released ?? null,
    pedigree: hs?.genetic_origin?.trim() || null,
    substitutes: [...substitutes],
    thiol: thiol ? { level: thiol[0], note: thiol[1] } : null,
  })
}

hops.sort((a, b) => a.name.localeCompare(b.name))

const stats = {
  total: hops.length,
  withAroma: hops.filter((h) => h.aromas).length,
  withOilComp: hops.filter((h) => h.oilComp.myrcene).length,
  withCohumulone: hops.filter((h) => h.cohumulone).length,
  withSubstitutes: hops.filter((h) => h.substitutes.length).length,
  withThiol: hops.filter((h) => h.thiol).length,
}
console.log(stats)

mkdirSync(join(root, 'src/generated'), { recursive: true })
writeFileSync(
  join(root, 'src/generated/hops.json'),
  JSON.stringify({ axes: AROMA_AXES, hops }),
)
console.log('wrote src/generated/hops.json')
