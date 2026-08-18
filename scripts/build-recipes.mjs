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
    hops.push({ name: h.name, key, g: +grams.toFixed(1), stage: classifyStage(h.add) })
  }

  recipes.push({
    id: b.id,
    name: b.name,
    tagline: b.tagline ?? '',
    year: b.first_brewed ? +String(b.first_brewed).slice(-4) : null,
    family: classifyFamilyFromTexts(b.tagline, b.name, b.description),
    origin: 'diydog',
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
      return { name: h.name, key, g: +(+h.g).toFixed(1), stage: h.stage ?? classifyStage(h.use) }
    })
    bfCount++
    recipes.push({
      id: 100000 + bfCount, // corpus ids stay unique across origins
      name: r.name,
      tagline: r.style ?? '',
      year: r.year ?? null,
      family: classifyFamilyFromTexts(r.style, r.name),
      origin: 'brewersfriend',
      vitals: {
        og: normGravity(r.vitals?.og),
        fg: normGravity(r.vitals?.fg),
        abv: r.vitals?.abv ?? null,
        ibu: r.vitals?.ibu ?? null,
        srm: r.vitals?.srm != null ? +(+r.vitals.srm).toFixed(1) : null,
      },
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
console.log('wrote src/generated/recipes.json')
