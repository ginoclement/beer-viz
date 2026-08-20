// Normalizes recipe corpora into src/generated/recipes.json for the
// Ingredients view.
//
// Sources:
//  - data/raw/recipes/diydog.json (always): BrewDog's "DIY Dog" — 415 real
//    commercial recipes with complete grain bills, hop schedules, and yeast,
//    released publicly by BrewDog; JSON transcription vendored from the
//    MIT-licensed alxiw/punkapi archive. Recipe text and data © BrewDog.
//  - data/brewersfriend/recipes.jsonl (optional, not committed): output of
//    scripts/crawl-brewersfriend.mjs, which requires written permission from
//    Brewer's Friend to run. Merged in automatically when the file exists.
//
// Run after build-hops.mjs — hop names are matched against the generated
// hop-chemistry dataset so the app can cross-link varieties.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normGravity,
  ebcToSrm,
  classifyStage,
  classifyFamilyFromTexts,
  makeHopMatcher,
  finishMalts,
} from './lib/normalize.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const beers = JSON.parse(readFileSync(join(root, 'data/raw/recipes/diydog.json'), 'utf8'))
const hopDb = JSON.parse(readFileSync(join(root, 'src/generated/hops.json'), 'utf8'))
const matchHop = makeHopMatcher(hopDb)

// BJCP 2021 styles with published vital ranges, used to tag each recipe with
// its best-fit style code (e.g. 21A American IPA). This is the same
// "which style's box does this beer sit in" test the Style Explorer runs live,
// frozen here as a convenience label; the app recomputes against whichever
// guide is selected. bjcp2021 is the default reference.
const guides = JSON.parse(readFileSync(join(root, 'src/generated/guides.json'), 'utf8'))
const refStyles = (guides.find((g) => g.guide === 'bjcp2021')?.styles ?? []).filter(
  (s) => s.hasStats,
)

const VITAL_KEYS = ['og', 'fg', 'abv', 'ibu', 'srm']

/** Apparent attenuation (%) from gravities, or null if not derivable. */
function attenuationOf(og, fg) {
  if (og == null || fg == null || og <= 1) return null
  return +(((og - fg) / (og - 1)) * 100).toFixed(1)
}

/**
 * Best-fit BJCP style for a set of vitals: the style with the most vitals
 * inside its published range, tie-broken by the smallest mean normalized
 * distance to the range midpoints. Returns { code, name, inRange, considered }.
 */
function matchStyle(vitals) {
  let best = null
  let bestIn = -1
  let bestDist = Infinity
  for (const s of refStyles) {
    let inRange = 0
    let considered = 0
    let dist = 0
    for (const k of VITAL_KEYS) {
      const r = s.stats[k]
      const v = vitals[k]
      if (!r || v == null) continue
      considered++
      const [lo, hi] = r
      const half = Math.max((hi - lo) / 2, 1e-9)
      const mid = (lo + hi) / 2
      if (v >= lo && v <= hi) inRange++
      dist += Math.abs(v - mid) / half
    }
    if (considered === 0) continue
    const nd = dist / considered
    if (inRange > bestIn || (inRange === bestIn && nd < bestDist)) {
      bestIn = inRange
      bestDist = nd
      best = s
    }
  }
  return best ? { code: best.id, name: best.name, inRange: bestIn } : null
}

const cToC = (t) => (t?.unit === 'fahrenheit' ? +(((t.value - 32) * 5) / 9).toFixed(1) : t?.value ?? null)

// Crawled recipes carry occasional parse errors (an OG of 1.773, a negative
// IBU). Drop physically implausible vitals to null so one bad field can't
// distort the projection, scatters, or style matching.
const plausible = (v, lo, hi) => (v != null && v >= lo && v <= hi ? v : null)
function sanitizeVitals(v) {
  return {
    og: plausible(v.og, 1.005, 1.18),
    fg: plausible(v.fg, 0.99, 1.04),
    abv: plausible(v.abv, 0, 20),
    ibu: plausible(v.ibu, 0, 250),
    srm: plausible(v.srm, 0, 200),
  }
}

const recipes = []
let hopEntries = 0
let hopMatched = 0
const unmatchedHops = new Map()

const countHopMatch = (name, key) => {
  hopEntries++
  if (key) hopMatched++
  else unmatchedHops.set(name, (unmatchedHops.get(name) ?? 0) + 1)
}

// ---------------------------------------------------------------- DIY Dog

for (const b of beers) {
  let og = normGravity(b.target_og)
  let fg = normGravity(b.target_fg)
  // a few source entries transcribe the two gravities swapped
  if (og != null && fg != null && og < fg) [og, fg] = [fg, og]
  const srm = b.srm ?? (b.ebc != null ? +ebcToSrm(b.ebc).toFixed(1) : null)
  const batchL = b.volume?.value ?? null

  // one source entry ships without a grain bill — useless for this dataset
  if (!(b.ingredients?.malt ?? []).length) continue

  const malts = finishMalts(
    (b.ingredients?.malt ?? []).map((m) => ({
      name: m.name,
      kg: m.amount?.unit === 'grams' ? m.amount.value / 1000 : m.amount?.value ?? 0,
    })),
  )

  const hops = []
  for (const h of b.ingredients?.hops ?? []) {
    const unit = h.amount?.unit
    if (unit === 'total') continue // catalog artifact, not an addition
    let grams = h.amount?.value ?? 0
    if (unit === 'kilogram') grams *= 1000
    // 'ml' additions are liquid extracts; density ~1 makes grams a fair proxy
    const key = matchHop(h.name)
    countHopMatch(h.name, key)
    hops.push({
      name: h.name,
      key,
      g: +grams.toFixed(1),
      stage: classifyStage(h.add),
      timeMin: null, // DIY Dog records a phase, not minutes; the crawl carries time
    })
  }

  const vitals = sanitizeVitals({
    og,
    fg,
    abv: b.abv ?? null,
    ibu: b.ibu ?? null,
    srm: srm != null ? +(+srm).toFixed(1) : null,
  })
  const mashStep = (b.method?.mash_temp ?? [])[0]
  const mashC = cToC(mashStep?.temp)
  recipes.push({
    id: b.id,
    name: b.name,
    tagline: b.tagline ?? '',
    year: b.first_brewed ? +String(b.first_brewed).slice(-4) : null,
    family: classifyFamilyFromTexts(b.tagline, b.name, b.description),
    origin: 'diydog',
    vitals,
    attenuation: attenuationOf(og, fg),
    styleGuess: matchStyle(vitals),
    // some source entries carry a 0°C mash step (missing data) — drop those
    mash: mashC && mashC > 0 ? { tempC: mashC, durationMin: mashStep.duration ?? null } : null,
    fermentTempC: cToC(b.method?.fermentation?.temp),
    method: null, // all-grain/extract & efficiency: populated by the crawl
    efficiency: null,
    batchL,
    malts,
    hops,
    yeast: typeof b.ingredients?.yeast === 'string' ? b.ingredients.yeast : null,
    description: (b.description ?? '').slice(0, 260),
  })
}

const diydogCount = recipes.length

// ------------------------------------------------- Brewer's Friend (optional)

// Crawled recipes arrive pre-parsed (scripts/lib/brewersfriend.mjs) with
// metric units; here they only need classification and hop matching.
const bfFile = join(root, 'data/brewersfriend/recipes.jsonl')
let bfCount = 0
if (existsSync(bfFile)) {
  const lines = readFileSync(bfFile, 'utf8').split('\n').filter((l) => l.trim())
  for (const line of lines) {
    let r
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    if (!r?.name || !(r.malts ?? []).length) continue
    const hops = (r.hops ?? []).map((h) => {
      const key = matchHop(h.name)
      countHopMatch(h.name, key)
      return {
        name: h.name,
        key,
        g: +(+h.g).toFixed(1),
        stage: h.stage ?? classifyStage(h.use),
        timeMin: h.timeMin ?? h.time ?? null,
      }
    })
    bfCount++
    const bfVitals = sanitizeVitals({
      og: normGravity(r.vitals?.og),
      fg: normGravity(r.vitals?.fg),
      abv: r.vitals?.abv ?? null,
      ibu: r.vitals?.ibu ?? null,
      srm: r.vitals?.srm != null ? +(+r.vitals.srm).toFixed(1) : null,
    })
    recipes.push({
      id: 100000 + bfCount, // corpus ids stay unique across origins
      name: r.name,
      tagline: r.style ?? '',
      year: r.year ?? null,
      family: classifyFamilyFromTexts(r.style, r.name),
      origin: 'brewersfriend',
      vitals: bfVitals,
      attenuation: attenuationOf(bfVitals.og, bfVitals.fg),
      styleGuess: matchStyle(bfVitals),
      mash: r.mash ?? (r.mashTempC != null ? { tempC: r.mashTempC, durationMin: r.mashDurationMin ?? null } : null),
      fermentTempC: r.fermentTempC ?? null,
      method: r.method ?? null,
      efficiency: r.efficiency ?? null,
      batchL: r.batchL ?? null,
      malts: finishMalts((r.malts ?? []).map((m) => ({ name: m.name, kg: +m.kg }))),
      hops,
      yeast: r.yeast ?? null,
      description: (r.url ? `Community recipe — ${r.url}` : '').slice(0, 260),
    })
  }
}

const out = {
  source:
    'BrewDog DIY Dog (415 published recipes, 2019 V8 release) via the MIT-licensed alxiw/punkapi JSON archive' +
    (bfCount > 0 ? ` + ${bfCount} Brewer's Friend community recipes (crawled with permission)` : ''),
  recipes,
}

mkdirSync(join(root, 'src/generated'), { recursive: true })
writeFileSync(join(root, 'src/generated/recipes.json'), JSON.stringify(out))

// ---------------------------------------------------------------- app data
//
// The browser must never load the whole corpus (it grows to GBs). So the build
// precomputes exactly what the views need and ships only that:
//   - aggregates.json: the rollups the Ingredients view renders (hop
//     leaderboard, grist by family + malt breakdown, family outcomes), keyed
//     by style family. O(1) in corpus size for the browser.
//   - corpus.json: a slim per-recipe row for the interactive per-recipe views
//     (Style Explorer, 3D Recipe Space, the outcome scatter, recipe detail) —
//     everything except the heavy prose description, plus precomputed hop-g/L
//     and roast share so the scatter needs no corpus math.
// Both regenerate here in build:data, so they are always fresh on Vercel from
// the committed sources — no separate step, no stale artifacts.

const MALT_CLASSES = [
  'base',
  'wheat, oats & rye',
  'crystal & caramel',
  'roasted',
  'sugars & adjuncts',
  'smoked',
  'other',
]
const keyName = new Map(hopDb.hops.map((h) => [h.key, h.name]))
const round = (v, d) => (v == null || Number.isNaN(v) ? null : +v.toFixed(d))

const canonicalMaltKey = (name) =>
  name
    .toLowerCase()
    .replace(/weyernmann|weyermann|simpsons|thomas fawcett|crisp\b/g, '')
    .replace(/\bmalt\b/g, '')
    .replace(/\btype\s*(\d)/g, '$1')
    .replace(/\boats?\b/g, 'oat')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const gristShare = (r, cls) => r.malts.filter((m) => cls.includes(m.class)).reduce((s, m) => s + m.pct, 0)
const hopGplOf = (r) => (r.batchL ? r.hops.reduce((s, h) => s + h.g, 0) / r.batchL : null)

function hopLeaderboard(rs) {
  const byHop = new Map()
  for (const r of rs) {
    const per = new Map()
    for (const h of r.hops) {
      const id = h.key ?? h.name.toLowerCase()
      const e = per.get(id) ?? { g: 0, byStage: {} }
      e.g += h.g
      e.byStage[h.stage] = (e.byStage[h.stage] ?? 0) + h.g
      per.set(id, e)
      if (!byHop.has(id))
        byHop.set(id, { key: h.key, name: keyName.get(h.key) ?? h.name, recipes: 0, totalG: 0, byStage: {}, gpls: [] })
    }
    for (const [id, e] of per) {
      const u = byHop.get(id)
      u.recipes++
      u.totalG += e.g
      for (const [st, g] of Object.entries(e.byStage)) u.byStage[st] = (u.byStage[st] ?? 0) + g
      if (r.batchL) u.gpls.push(e.g / r.batchL)
    }
  }
  return [...byHop.values()]
    .filter((u) => u.key) // real varieties only — twists (coffee, zest) live in the bills
    .map((u) => {
      const s = u.gpls.sort((a, b) => a - b)
      const byStage = {}
      for (const [st, g] of Object.entries(u.byStage)) byStage[st] = round(g, 1)
      return { key: u.key, name: u.name, recipes: u.recipes, totalG: round(u.totalG, 1), byStage, medianGpl: s.length ? round(s[Math.floor(s.length / 2)], 2) : null }
    })
    .sort((a, b) => b.recipes - a.recipes)
    .slice(0, 40)
}

function gristAgg(rs) {
  const byClass = {}
  for (const cls of MALT_CLASSES) byClass[cls] = round(rs.reduce((s, r) => s + gristShare(r, [cls]), 0) / rs.length, 2)
  const breakdown = {}
  for (const cls of MALT_CLASSES) {
    const agg = new Map()
    for (const r of rs) {
      const seen = new Set()
      for (const m of r.malts) {
        if (m.class !== cls) continue
        const key = canonicalMaltKey(m.name)
        const e = agg.get(key) ?? { names: new Map(), totalPct: 0, count: 0 }
        e.totalPct += m.pct
        e.names.set(m.name, (e.names.get(m.name) ?? 0) + 1)
        if (!seen.has(key)) {
          e.count++
          seen.add(key)
        }
        agg.set(key, e)
      }
    }
    const rows = [...agg.values()]
      .map((e) => ({ name: [...e.names.entries()].sort((a, b) => b[1] - a[1])[0][0], avgPct: round(e.totalPct / rs.length, 2), count: e.count }))
      .sort((a, b) => b.avgPct - a.avgPct)
    if (rows.length) breakdown[cls] = rows
  }
  return { n: rs.length, byClass, breakdown }
}

function outcomeAgg(rs) {
  const avg = (f) => {
    const v = rs.map(f).filter((x) => x != null)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }
  return {
    n: rs.length,
    avgAbv: round(avg((r) => r.vitals.abv), 2),
    avgIbu: round(avg((r) => r.vitals.ibu), 1),
    avgSrm: round(avg((r) => r.vitals.srm), 1),
    avgOg: round(avg((r) => r.vitals.og), 4),
    avgFg: round(avg((r) => r.vitals.fg), 4),
  }
}

const familyGroups = new Map()
for (const r of recipes) familyGroups.set(r.family, [...(familyGroups.get(r.family) ?? []), r])
const families = [...familyGroups.entries()].map(([family, rs]) => ({ family, n: rs.length })).sort((a, b) => b.n - a.n)

const byFamily = { all: { hops: hopLeaderboard(recipes), grist: gristAgg(recipes), outcome: outcomeAgg(recipes) } }
for (const { family } of families) {
  const rs = familyGroups.get(family)
  byFamily[family] = { hops: hopLeaderboard(rs), grist: gristAgg(rs), outcome: outcomeAgg(rs) }
}

// ------------------------------------------------------------- insights
// Corpus-wide research rollups for the Recipes → Insights page. Computed
// exactly over the full corpus here (never sampled in the browser), and
// served live from the API host's /aggregates once its data is rebuilt.

const quantile = (sorted, q) => {
  if (!sorted.length) return null
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i)
  return +(sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo)).toFixed(4)
}

const HIST_SPECS = {
  abv: { min: 0, max: 15, step: 0.25, label: 'ABV %' },
  ibu: { min: 0, max: 120, step: 5, label: 'IBU' },
  srm: { min: 0, max: 60, step: 2, label: 'SRM' },
  og: { min: 1.02, max: 1.13, step: 0.005, label: 'OG' },
  buGu: { min: 0, max: 1.5, step: 0.05, label: 'BU:GU' },
}

function buildInsights(rs) {
  const valueOf = {
    abv: (r) => r.vitals.abv,
    ibu: (r) => r.vitals.ibu,
    srm: (r) => r.vitals.srm,
    og: (r) => r.vitals.og,
    buGu: (r) =>
      r.vitals.ibu != null && r.vitals.og != null && r.vitals.og > 1.001
        ? r.vitals.ibu / ((r.vitals.og - 1) * 1000)
        : null,
  }

  const histograms = {}
  for (const [key, spec] of Object.entries(HIST_SPECS)) {
    const vals = rs.map(valueOf[key]).filter((v) => v != null && isFinite(v))
    vals.sort((a, b) => a - b)
    const nBins = Math.round((spec.max - spec.min) / spec.step)
    const counts = new Array(nBins).fill(0)
    for (const v of vals) {
      const b = Math.min(Math.max(Math.floor((v - spec.min) / spec.step), 0), nBins - 1)
      counts[b]++
    }
    histograms[key] = {
      ...spec,
      n: vals.length,
      counts,
      quantiles: { p5: quantile(vals, 0.05), p25: quantile(vals, 0.25), p50: quantile(vals, 0.5), p75: quantile(vals, 0.75), p95: quantile(vals, 0.95) },
    }
  }

  // Brewed vs. book: how far real recipes sit from their matched style's
  // published midpoint, in half-range units (+1 = at the top of the range).
  const styleById = new Map(refStyles.map((s) => [s.id, s]))
  const devByFamily = new Map()
  for (const r of rs) {
    const s = r.styleGuess && styleById.get(r.styleGuess.code)
    if (!s) continue
    let acc = devByFamily.get(r.family)
    if (!acc) devByFamily.set(r.family, (acc = { n: 0, sums: { abv: 0, ibu: 0, srm: 0, og: 0 }, ns: { abv: 0, ibu: 0, srm: 0, og: 0 } }))
    acc.n++
    for (const k of ['abv', 'ibu', 'srm', 'og']) {
      const range = s.stats[k]
      const v = r.vitals[k]
      if (!range || v == null) continue
      const half = Math.max((range[1] - range[0]) / 2, 1e-9)
      acc.sums[k] += (v - (range[0] + range[1]) / 2) / half
      acc.ns[k]++
    }
  }
  const deviation = [...devByFamily.entries()]
    .filter(([, a]) => a.n >= 30)
    .map(([family, a]) => ({
      family,
      n: a.n,
      dev: Object.fromEntries(
        ['abv', 'ibu', 'srm', 'og'].map((k) => [k, a.ns[k] ? +(a.sums[k] / a.ns[k]).toFixed(3) : null]),
      ),
    }))
    .sort((a, b) => b.n - a.n)

  // Hop pairings: which matched varieties appear in the same recipe, with
  // lift vs. independent use (>1 = chosen together more than chance).
  const hopCounts = new Map()
  const pairCounts = new Map()
  let recipesWithHops = 0
  for (const r of rs) {
    const keys = [...new Set(r.hops.map((h) => h.key).filter(Boolean))].sort()
    if (!keys.length) continue
    recipesWithHops++
    for (const k of keys) hopCounts.set(k, (hopCounts.get(k) ?? 0) + 1)
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) {
        const id = `${keys[i]}|${keys[j]}`
        pairCounts.set(id, (pairCounts.get(id) ?? 0) + 1)
      }
  }
  const hopPairs = [...pairCounts.entries()]
    .filter(([, n]) => n >= 20)
    .map(([id, n]) => {
      const [a, b] = id.split('|')
      const lift = n * recipesWithHops / ((hopCounts.get(a) ?? 1) * (hopCounts.get(b) ?? 1))
      return { a, b, n, lift: +lift.toFixed(2) }
    })
    .sort((x, y) => y.n - x.n)
    .slice(0, 30)

  // Yeast leaderboard: group by product code when one is present, else by
  // the cleaned name; report the most common raw spelling per group.
  const yeastGroups = new Map()
  for (const r of rs) {
    if (!r.yeast) continue
    const raw = String(r.yeast).trim()
    if (!raw) continue
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9\/ -]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (!/[a-z0-9]/.test(cleaned)) continue // placeholder entries like "- -"
    const code = cleaned.match(/\b(?:wlp ?\d{3,4}|wy ?\d{4}|[a-z]{1,2}-\d{2,3}|34\/70|\d{4})\b/)?.[0]?.replace(/\s+/g, '')
    const key = code ?? cleaned
    let g = yeastGroups.get(key)
    if (!g) yeastGroups.set(key, (g = { n: 0, raws: new Map(), attens: [], families: new Map() }))
    g.n++
    g.raws.set(raw, (g.raws.get(raw) ?? 0) + 1)
    if (r.attenuation != null && r.attenuation > 40 && r.attenuation < 100) g.attens.push(r.attenuation)
    g.families.set(r.family, (g.families.get(r.family) ?? 0) + 1)
  }
  const topOf = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  const yeasts = [...yeastGroups.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 15)
    .map((g) => ({
      name: topOf(g.raws),
      n: g.n,
      share: +(g.n / rs.length).toFixed(4),
      medianAttenuation: quantile(g.attens.sort((a, b) => a - b), 0.5),
      topFamily: topOf(g.families),
    }))

  return { histograms, deviation, hopPairs, recipesWithHops, yeasts }
}

const insights = buildInsights(recipes)

writeFileSync(
  join(root, 'src/generated/aggregates.json'),
  JSON.stringify({ source: out.source, totalRecipes: recipes.length, families, byFamily, insights }),
)

// Slim per-recipe rows: drop the prose description and per-malt weight; add
// precomputed hop-g/L and roasted-grain share for the outcome scatter.
const slim = recipes.map((r) => ({
  id: r.id,
  name: r.name,
  tagline: r.tagline,
  year: r.year,
  family: r.family,
  origin: r.origin,
  styleGuess: r.styleGuess,
  vitals: r.vitals,
  attenuation: r.attenuation,
  mash: r.mash,
  fermentTempC: r.fermentTempC,
  batchL: r.batchL,
  malts: r.malts.map((m) => ({ name: m.name, pct: m.pct, class: m.class })),
  hops: r.hops.map((h) => ({ name: h.name, key: h.key, g: h.g, stage: h.stage })),
  yeast: r.yeast,
  hopGpl: round(hopGplOf(r), 2),
  roast: round(gristShare(r, ['roasted']), 2),
}))
writeFileSync(join(root, 'src/generated/corpus.json'), JSON.stringify({ source: out.source, recipes: slim }))

const famCount = {}
for (const r of recipes) famCount[r.family] = (famCount[r.family] ?? 0) + 1
console.log({
  recipes: recipes.length,
  diydog: diydogCount,
  brewersfriend: bfCount,
  withFullVitals: recipes.filter((r) => r.vitals.og && r.vitals.ibu != null && r.vitals.srm != null).length,
  hopEntries,
  hopMatchedToChemistryDb: hopMatched,
  hopMatchRate: `${((hopMatched / hopEntries) * 100).toFixed(1)}%`,
  families: famCount,
})
const topUnmatched = [...unmatchedHops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
console.log('top unmatched hop names (twists & extracts expected):', topUnmatched)
console.log(`wrote recipes.json (fat), corpus.json (slim, ${slim.length} rows), aggregates.json (${families.length} families)`)
