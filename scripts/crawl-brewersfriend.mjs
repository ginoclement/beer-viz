// Crawler for public Brewer's Friend recipes — PERMISSION-GATED.
//
// Brewer's Friend's terms of service prohibit automated scraping. This tool
// refuses to touch the live site unless you assert, on the command line,
// that you hold their written permission. Get that first.
//
//   node scripts/crawl-brewersfriend.mjs \
//     --i-have-written-permission "Agreement with Brewer's Friend <date/ref>" \
//     --contact you@example.com \
//     [--max 200] [--delay 3000] [--start-page 1] [--query "search terms"]
//
// Offline modes (no permission needed — they never touch the network):
//   --parse-file saved-page.html   parse a locally saved recipe page and
//                                  print the result; use this to calibrate
//                                  the parser against real markup (your own
//                                  recipe pages are ideal test subjects)
//   --parse-xml saved-recipe.xml   same for a saved BeerXML export
//
// Behavior when crawling:
//   - identifies itself: "beer-viz-crawler/1.0 (<contact>; with permission)"
//   - fetches and RESPECTS robots.txt (permission does not disable this;
//     if Brewer's Friend allowlists you, they can say so in robots.txt or
//     you can pass --ignore-robots alongside the permission flag)
//   - one request at a time, --delay ms apart (default 3000 = 20 req/min)
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

// ------------------------------------------------------------------ cli args

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? (args[i + 1]?.startsWith('--') ? true : args[i + 1] ?? true) : null
}
const has = (name) => args.includes(name)

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

// ----------------------------------------------------------- permission gate

const permission = flag('--i-have-written-permission')
const contact = flag('--contact')
if (typeof permission !== 'string' || !permission.trim() || typeof contact !== 'string' || !contact.includes('@')) {
  console.error(`This crawler is disabled by default.

Brewer's Friend's terms of service prohibit automated scraping of their
site. Run it only after they have granted you written permission, then
assert that on the command line:

  node scripts/crawl-brewersfriend.mjs \\
    --i-have-written-permission "<who granted it and when>" \\
    --contact <your@email>

The contact email is sent in the User-Agent so their operators can reach
you. Offline parser calibration needs no permission:

  node scripts/crawl-brewersfriend.mjs --parse-file saved-page.html
`)
  process.exit(1)
}

const MAX = parseInt(flag('--max')) || 200
const DELAY = Math.max(parseInt(flag('--delay')) || 3000, 1000)
const START_PAGE = parseInt(flag('--start-page')) || 1
const QUERY = typeof flag('--query') === 'string' ? flag('--query') : null
const USER_AGENT = `beer-viz-crawler/1.0 (${contact}; crawling with permission: ${permission})`

mkdirSync(cacheDir, { recursive: true })

// ------------------------------------------------------------------- fetch

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let lastFetch = 0

async function politeFetch(url) {
  const wait = lastFetch + DELAY - Date.now()
  if (wait > 0) await sleep(wait)
  lastFetch = Date.now()
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (res.status === 429 || res.status === 503) {
    console.log(`  ${res.status} — backing off 60s`)
    await sleep(60_000)
    return politeFetch(url)
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.text()
}

const cachePath = (kind, id) => join(cacheDir, `${kind}-${id}.txt`)

async function cachedFetch(kind, id, url) {
  const p = cachePath(kind, id)
  if (existsSync(p)) return { text: readFileSync(p, 'utf8'), fromCache: true }
  const text = await politeFetch(url)
  writeFileSync(p, text)
  return { text, fromCache: false }
}

// ------------------------------------------------------------------ robots

/** Minimal robots.txt: Disallow rules for * and for our UA token. */
async function loadRobots() {
  try {
    const txt = await politeFetch(`${BASE}/robots.txt`)
    const rules = []
    let applies = false
    for (const raw of txt.split('\n')) {
      const line = raw.replace(/#.*/, '').trim()
      const ua = line.match(/^user-agent:\s*(.+)$/i)
      if (ua) {
        applies = ua[1].trim() === '*' || 'beer-viz-crawler'.includes(ua[1].trim().toLowerCase())
        continue
      }
      const dis = line.match(/^disallow:\s*(.*)$/i)
      if (dis && applies && dis[1].trim()) rules.push(dis[1].trim())
    }
    return rules
  } catch (e) {
    console.log(`robots.txt unavailable (${e.message}) — proceeding cautiously`)
    return []
  }
}

let robotRules = []
const robotsAllows = (path) => !robotRules.some((r) => path.startsWith(r))

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

if (!has('--ignore-robots')) {
  robotRules = await loadRobots()
  console.log(`robots.txt: ${robotRules.length} disallow rules loaded`)
} else {
  console.log('robots.txt IGNORED by flag — make sure your permission covers this')
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
  const path = listPath(page)
  if (!robotsAllows(path)) {
    console.log(`robots.txt disallows ${path} — stopping listing crawl`)
    break
  }
  console.log(`listing page ${page}…`)
  let listing
  try {
    listing = await politeFetch(`${BASE}${path}`)
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
    const viewPath = new URL(link.url).pathname
    if (!robotsAllows(viewPath)) continue

    let recipe = null
    try {
      // prefer the stable BeerXML export; fall back to the HTML page
      const xmlPath = `/homebrew/recipe/beerxml1.0/${link.id}`
      if (robotsAllows(xmlPath)) {
        try {
          const { text } = await cachedFetch('xml', link.id, `${BASE}${xmlPath}`)
          recipe = parseBeerXml(text, `${BASE}${xmlPath}`)
        } catch {
          /* fall through to HTML */
        }
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
