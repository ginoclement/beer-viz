// Crawler for public Brewer's Friend recipes.
//
// Intended to run under an access arrangement with Brewer's Friend
// (IP-whitelisted). Set --rpm to whatever rate they approve.
//
//   node scripts/crawl-brewersfriend.mjs [--rpm 10] [--max 200] \
//     [--start-page 1] [--query "search terms"]
//
// Offline modes (never touch the network):
//   --parse-file saved-page.html   parse a locally saved recipe page and
//                                  print the result; use this to calibrate
//                                  the parser against real markup
//   --parse-xml saved-recipe.xml   same for a saved BeerXML export
//
// Behavior:
//   - serial requests, paced to --rpm requests per minute (default 10)
//   - automatic 60s backoff on 429/503
//   - caches every fetched page under data/brewersfriend/cache/ and skips
//     recipes already fetched, so reruns resume where they stopped
//   - prefers each recipe's BeerXML export (stable format) and falls back
//     to parsing the HTML page
//   - appends normalized recipes to data/brewersfriend/recipes.jsonl;
//     `npm run build:data` then folds them into the Ingredients corpus
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseListing, parseRecipePage, parseBeerXml } from './lib/brewersfriend.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'data/brewersfriend')
const cacheDir = join(outDir, 'cache')
const outFile = join(outDir, 'recipes.jsonl')

const BASE = 'https://www.brewersfriend.com'
const USER_AGENT = 'beer-viz-crawler/1.0'

// ------------------------------------------------------------------ cli args

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? (args[i + 1]?.startsWith('--') ? true : args[i + 1] ?? true) : null
}

// ---------------------------------------------------------- offline parsing

const parseFile = flag('--parse-file')
const parseXmlFile = flag('--parse-xml')
if (parseFile || parseXmlFile) {
  const file = parseFile || parseXmlFile
  const content = readFileSync(String(file), 'utf8')
  const parsed = parseFile ? parseRecipePage(content) : parseBeerXml(content)
  console.log(JSON.stringify(parsed, null, 2))
  const problems = []
  if (!parsed.name) problems.push('no recipe name found')
  if (!parsed.malts?.length) problems.push('no fermentables parsed')
  if (!parsed.hops?.length) problems.push('no hops parsed')
  if (parsed.vitals?.og == null) problems.push('no OG parsed')
  console.error(
    problems.length
      ? `\nCALIBRATION NEEDED — ${problems.join('; ')}. The live markup likely drifted from the fixtures; adjust scripts/lib/brewersfriend.mjs.`
      : '\nLooks complete. The parser handles this page shape.',
  )
  process.exit(problems.length ? 1 : 0)
}

// ------------------------------------------------------------------ settings

const RPM = Math.max(parseFloat(flag('--rpm')) || 10, 0.1)
const DELAY = Math.round(60_000 / RPM)
const MAX = parseInt(flag('--max')) || 200
const START_PAGE = parseInt(flag('--start-page')) || 1
const QUERY = typeof flag('--query') === 'string' ? flag('--query') : null

mkdirSync(cacheDir, { recursive: true })
console.log(`rate: ${RPM} requests/minute (one request every ${(DELAY / 1000).toFixed(1)}s)`)

// ------------------------------------------------------------------- fetch

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let lastFetch = 0

async function pacedFetch(url) {
  const wait = lastFetch + DELAY - Date.now()
  if (wait > 0) await sleep(wait)
  lastFetch = Date.now()
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (res.status === 429 || res.status === 503) {
    console.log(`  ${res.status} — backing off 60s`)
    await sleep(60_000)
    return pacedFetch(url)
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.text()
}

const cachePath = (kind, id) => join(cacheDir, `${kind}-${id}.txt`)

async function cachedFetch(kind, id, url) {
  const p = cachePath(kind, id)
  if (existsSync(p)) return { text: readFileSync(p, 'utf8'), fromCache: true }
  const text = await pacedFetch(url)
  writeFileSync(p, text)
  return { text, fromCache: false }
}

// -------------------------------------------------------------------- main

const seen = new Set()
if (existsSync(outFile)) {
  for (const line of readFileSync(outFile, 'utf8').split('\n')) {
    try {
      const r = JSON.parse(line)
      if (r?.id) seen.add(String(r.id))
    } catch {
      /* skip partial line */
    }
  }
  console.log(`resuming — ${seen.size} recipes already collected`)
}

const listPath = (n) =>
  QUERY
    ? `/search/?keyword=${encodeURIComponent(QUERY)}&page=${n}`
    : n > 1
      ? `/homebrew-recipes/page/${n}/`
      : '/homebrew-recipes/'

let collected = 0
let page = START_PAGE

outer: while (collected < MAX) {
  console.log(`listing page ${page}…`)
  let listing
  try {
    listing = await pacedFetch(`${BASE}${listPath(page)}`)
  } catch (e) {
    console.log(`  listing failed: ${e.message} — stopping`)
    break
  }
  const links = parseListing(listing)
  if (links.length === 0) {
    console.log('  no recipe links found — end of listings (or markup drift; check --parse-file)')
    break
  }

  for (const link of links) {
    if (collected >= MAX) break outer
    if (seen.has(link.id)) continue

    let recipe = null
    try {
      // prefer the stable BeerXML export; fall back to the HTML page
      try {
        const { text } = await cachedFetch('xml', link.id, `${BASE}/homebrew/recipe/beerxml1.0/${link.id}`)
        recipe = parseBeerXml(text, `${BASE}/homebrew/recipe/beerxml1.0/${link.id}`)
      } catch {
        /* fall through to HTML */
      }
      if (!recipe || !recipe.malts?.length) {
        const { text } = await cachedFetch('html', link.id, link.url)
        recipe = parseRecipePage(text, link.url)
      }
    } catch (e) {
      console.log(`  ${link.id} failed: ${e.message}`)
      continue
    }

    if (!recipe?.name || !recipe.malts?.length) {
      console.log(`  ${link.id} parsed empty (markup drift?) — skipping`)
      continue
    }
    recipe.url = link.url
    recipe.id = link.id
    appendFileSync(outFile, JSON.stringify(recipe) + '\n')
    seen.add(link.id)
    collected++
    console.log(`  ✓ ${recipe.name} (${recipe.style ?? 'no style'}) [${collected}/${MAX}]`)
  }
  page++
}

console.log(`\ndone — ${collected} new recipes appended to ${outFile}`)
console.log('run `npm run build:data` to fold them into the Ingredients corpus.')
