// Pulls YOUR OWN recipes from the Brewfather API into JSON files the app's
// My Recipes tab can import (drag & drop the files, or paste their contents).
//
// Brewfather's API is credential-scoped: it serves only the account's own
// recipes — there is no public recipe catalog behind it. Generate credentials
// in the Brewfather app under Settings → API → Generate, and enable the
// "Read Recipes" scope.
//
// Usage:
//   BREWFATHER_USER_ID=xxx BREWFATHER_API_KEY=yyy node scripts/sync-brewfather.mjs
//
// Recipes land in data/brewfather/<name>.json. Rate limit is 150 calls/hour,
// so the full list is fetched in pages of 50 with the `complete` flag to get
// ingredient bills in one call per page.
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const userId = process.env.BREWFATHER_USER_ID
const apiKey = process.env.BREWFATHER_API_KEY
if (!userId || !apiKey) {
  console.error(
    'Set BREWFATHER_USER_ID and BREWFATHER_API_KEY (Brewfather app → Settings → API).',
  )
  process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'data/brewfather')
mkdirSync(outDir, { recursive: true })

const auth = 'Basic ' + Buffer.from(`${userId}:${apiKey}`).toString('base64')
const BASE = 'https://api.brewfather.app/v2'

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: auth } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`)
  return res.json()
}

const safeName = (s) => s.replace(/[^a-z0-9 _-]/gi, '').trim().replace(/\s+/g, '-').toLowerCase()

let saved = 0
let startAfter = null
for (;;) {
  const page = await fetchJson(
    `/recipes?limit=50&complete=true${startAfter ? `&start_after=${startAfter}` : ''}`,
  )
  if (!Array.isArray(page) || page.length === 0) break
  for (const recipe of page) {
    const file = join(outDir, `${safeName(recipe.name ?? recipe._id)}.json`)
    writeFileSync(file, JSON.stringify(recipe, null, 2))
    saved++
  }
  if (page.length < 50) break
  startAfter = page[page.length - 1]._id
}

console.log(`Saved ${saved} recipes to data/brewfather/.`)
console.log('Import them on the My Recipes tab — drag the files onto the drop zone.')
