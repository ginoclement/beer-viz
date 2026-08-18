import { chromium } from 'playwright'

const out = process.argv[2] ?? '.'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.screenshot({ path: `${out}/1-space.png` })

// click a point region? Instead select via similarity tab first
await page.click('nav.tabs button:has-text("Similarity")')
await page.waitForTimeout(2500)
await page.screenshot({ path: `${out}/2-similarity.png` })

await page.click('nav.tabs button:has-text("Vital Statistics")')
await page.waitForTimeout(800)
await page.screenshot({ path: `${out}/3-vitals.png` })

await page.click('nav.tabs button:has-text("Matrix")')
await page.waitForTimeout(1500)
await page.screenshot({ path: `${out}/4-matrix.png` })

await page.click('nav.tabs button:has-text("Guidelines")')
await page.waitForTimeout(2000)
await page.screenshot({ path: `${out}/5-compare.png` })

await page.click('nav.tabs button:has-text("My Recipes")')
await page.waitForTimeout(500)
// paste a brewfather-ish JSON and import
await page.fill('textarea', JSON.stringify({ name: 'House IPA', og: 1.062, fg: 1.012, abv: 6.6, ibu: 55, color: 7.5, yeasts: [{ type: 'Ale' }] }))
await page.click('button:has-text("Import pasted text")')
await page.waitForTimeout(800)
await page.screenshot({ path: `${out}/6-recipes.png` })

// back to space to see the recipe diamond
await page.click('nav.tabs button:has-text("3D Style Space")')
await page.waitForTimeout(2500)
await page.screenshot({ path: `${out}/7-space-with-recipe.png` })

// switch guideline to BA and UMAP
await page.selectOption('select[aria-label="Style guideline"]', 'ba2017')
await page.waitForTimeout(1500)
await page.click('span.seg button:has-text("UMAP")')
await page.waitForTimeout(6000)
await page.screenshot({ path: `${out}/8-ba-umap.png` })

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console/page errors')
await browser.close()
