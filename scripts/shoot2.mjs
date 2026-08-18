// Screenshot pass for the second-round features (browse, flavor mode,
// dendrogram, cluster labels, hash links). Usage: node scripts/shoot2.mjs <outdir> [port]
import { chromium } from 'playwright'

const out = process.argv[2] ?? '.'
const port = process.argv[3] ?? '4173'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})

// deep link straight to a selected style in the 3D space
await page.goto(`http://localhost:${port}/#space/bjcp2021/21A`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.screenshot({ path: `${out}/b1-space-deeplink.png` })

// similarity in flavor-text mode
await page.click('nav.tabs button:has-text("Similarity")')
await page.waitForTimeout(1200)
await page.click('button:has-text("Flavor text")')
await page.waitForTimeout(800)
await page.screenshot({ path: `${out}/b2-flavor-mode.png` })

// browse with a search and tag filter
await page.click('nav.tabs button:has-text("Browse")')
await page.waitForTimeout(400)
await page.fill('input[aria-label="Search styles"]', 'stout')
await page.waitForTimeout(400)
await page.screenshot({ path: `${out}/b3-browse.png` })

// matrix + dendrogram
await page.click('nav.tabs button:has-text("Matrix")')
await page.waitForTimeout(1800)
await page.screenshot({ path: `${out}/b4-matrix-dendro.png` })

// recipe tethers in 3D
await page.click('nav.tabs button:has-text("My Recipes")')
await page.waitForTimeout(500)
await page.fill('textarea', JSON.stringify({ name: 'Oatmeal Stout', og: 1.052, fg: 1.014, ibu: 30, color: 32, yeasts: [{ type: 'Ale' }] }))
await page.click('button:has-text("Import pasted text")')
await page.waitForTimeout(600)
await page.click('nav.tabs button:has-text("3D Style Space")')
await page.waitForTimeout(2500)
await page.screenshot({ path: `${out}/b5-space-tethers.png` })

const hash = await page.evaluate(() => window.location.hash)
console.log('hash now:', hash)
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console/page errors')
await browser.close()
