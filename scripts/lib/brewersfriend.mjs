// Brewer's Friend page parsing for scripts/crawl-brewersfriend.mjs.
//
// IMPORTANT: crawling brewersfriend.com requires their written permission —
// their terms prohibit automated scraping. This module only parses HTML/XML
// you already have; the crawler enforces the permission gate.
//
// Parsing is layered for robustness against markup drift:
//   1. each recipe page links its own BeerXML export — the crawler prefers
//      fetching that (parseBeerXml below), since it's a stable format;
//   2. schema.org JSON-LD Recipe blocks, when present, give name/style;
//   3. labeled-value extraction ("Original Gravity", "IBU", …) and table
//      parsing handle the rest of the HTML.
//
// Everything returns the crawler's interchange schema (metric units):
//   { url, id, name, style, method, batchL, vitals:{og,fg,abv,ibu,srm},
//     malts:[{name,kg}], hops:[{name,g,use,stage}], yeast }
import { classifyStage, OZ_TO_G, LB_TO_KG, GAL_TO_L, lovibondToSrm } from './normalize.mjs'

// ------------------------------------------------------------- tiny html kit

const stripTags = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&deg;/g, '°')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** All <table>…</table> blocks, each as an array of rows of cell texts. */
export function htmlTables(html) {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? []
  return tables.map((t) => {
    const rows = t.match(/<tr[\s\S]*?<\/tr>/gi) ?? []
    return rows.map((r) => {
      const cells = r.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? []
      return cells.map((c) => stripTags(c))
    })
  })
}

/** First number following a label anywhere in the page text. */
function labeledNumber(text, labelRe) {
  const m = text.match(new RegExp(`(?:${labelRe.source})` + String.raw`[^0-9\-]{0,40}(-?\d+(?:\.\d+)?)`, 'i'))
  return m ? parseFloat(m[1]) : null
}

// ------------------------------------------------------------------- amounts

/** "5 lb" | "2.5 kg" | "8 oz" | "500 g" -> kilograms. */
export function amountToKg(s) {
  const m = String(s).replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)\s*(kg|kilograms?|g|grams?|lbs?|pounds?|oz|ounces?)\b/i)
  if (!m) return null
  const v = parseFloat(m[1])
  const u = m[2].toLowerCase()
  if (u.startsWith('kg') || u.startsWith('kilo')) return v
  if (u === 'g' || u.startsWith('gram')) return v / 1000
  if (u.startsWith('lb') || u.startsWith('pound')) return v * LB_TO_KG
  return (v * OZ_TO_G) / 1000 // oz
}

/** "1 oz" | "28 g" -> grams. */
export function amountToG(s) {
  const kg = amountToKg(s)
  return kg == null ? null : +(kg * 1000).toFixed(1)
}

/** "5 gal" | "19 l" | "20 liters" -> liters. */
export function volumeToL(s) {
  const m = String(s).replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)\s*(gal(?:lons?)?|l|liters?|litres?)\b/i)
  if (!m) return null
  const v = parseFloat(m[1])
  return /^gal/i.test(m[2]) ? +(v * GAL_TO_L).toFixed(1) : v
}

// ------------------------------------------------------------------- listing

/** Recipe links on a browse/search/listing page. */
export function parseListing(html) {
  const out = new Map()
  const re = /\/homebrew\/recipe\/view\/(\d+)\/([a-z0-9%_-]+)/gi
  let m
  while ((m = re.exec(html))) {
    out.set(m[1], {
      id: m[1],
      slug: m[2],
      url: `https://www.brewersfriend.com/homebrew/recipe/view/${m[1]}/${m[2]}`,
    })
  }
  return [...out.values()]
}

/** The page's own BeerXML export link, if it advertises one. */
export function findBeerXmlLink(html, id) {
  const m = html.match(/href="([^"]*beerxml[^"]*)"/i)
  if (m) {
    const href = m[1]
    return href.startsWith('http') ? href : `https://www.brewersfriend.com${href}`
  }
  // the historical stable pattern
  return id ? `https://www.brewersfriend.com/homebrew/recipe/beerxml1.0/${id}` : null
}

// -------------------------------------------------------------- recipe html

function jsonLdRecipe(html) {
  const blocks = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) ?? []
  for (const b of blocks) {
    try {
      const json = JSON.parse(b.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, ''))
      const items = Array.isArray(json) ? json : [json]
      const r = items.find((x) => x['@type'] === 'Recipe' || (Array.isArray(x['@type']) && x['@type'].includes('Recipe')))
      if (r) return r
    } catch {
      // malformed block — fall through to text extraction
    }
  }
  return null
}

const isHopUse = (s) => /boil|dry hop|whirlpool|aroma|first wort|hopstand|hop stand|mash/i.test(s)

/**
 * Parse a Brewer's Friend recipe page. Works from structure that has been
 * stable for years (labeled stats, fermentable/hop tables), but expect to
 * re-calibrate against a freshly saved page — see the crawler's
 * --parse-file mode.
 */
export function parseRecipePage(html, url = null) {
  const text = stripTags(html)
  const ld = jsonLdRecipe(html)

  const id = url?.match(/\/view\/(\d+)\//)?.[1] ?? html.match(/\/homebrew\/recipe\/view\/(\d+)\//)?.[1] ?? null

  let name = ld?.name ?? null
  if (!name) {
    const t = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? ''
    name = t.replace(/\s*[-|]\s*Beer Recipe.*$/i, '').replace(/\s*[-|]\s*Brewer.?s Friend.*$/i, '').trim() || null
  }
  if (!name) {
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    if (h1) name = stripTags(h1)
  }

  const style =
    ld?.recipeCategory ??
    text.match(/Style:?\s+([A-Za-zÀ-ž0-9&' /-]+?)(?:\s{2,}|\s(?:Boil|Batch|Method|OG|Original)\b)/)?.[1]?.trim() ??
    null

  const method = text.match(/\b(All Grain|BIAB|Partial Mash|Extract)\b/i)?.[1] ?? null

  const vitals = {
    og: labeledNumber(text, /Original Gravity|(?<![A-Z])OG\b/),
    fg: labeledNumber(text, /Final Gravity|(?<![A-Z])FG\b/),
    abv: labeledNumber(text, /ABV/),
    ibu: labeledNumber(text, /IBU/),
    srm: labeledNumber(text, /SRM/),
  }
  const batchL = (() => {
    const m = text.match(/Batch Size:?\s+([\d.]+\s*(?:gal(?:lons?)?|l|liters?|litres?))/i)
    return m ? volumeToL(m[1]) : null
  })()

  // tables: fermentables have a °L or ppg column; hops have a Use column
  const malts = []
  const hops = []
  for (const table of htmlTables(html)) {
    if (table.length < 2) continue
    const header = table[0].join(' ').toLowerCase()
    const body = table.slice(1)
    if (/fermentable|grain/.test(header) || /°l|ppg/.test(header)) {
      for (const row of body) {
        if (row.length < 2) continue
        const kg = amountToKg(row[0])
        const rowName = row[1]?.replace(/\s*\([^)]*\)\s*$/, '').trim()
        if (kg != null && kg > 0 && rowName && !/^total\b/i.test(rowName))
          malts.push({ name: rowName, kg: +kg.toFixed(3) })
      }
    } else if (/variety|hops/.test(header) && /use|time/.test(header)) {
      const useIdx = table[0].findIndex((c) => /use/i.test(c))
      const timeIdx = table[0].findIndex((c) => /time/i.test(c))
      for (const row of body) {
        if (row.length < 2) continue
        const g = amountToG(row[0])
        const rowName = row[1]?.trim()
        if (g == null || g <= 0 || !rowName || /total/i.test(row[0])) continue
        const use = useIdx >= 0 ? row[useIdx] ?? '' : row.find((c) => isHopUse(c)) ?? ''
        const time = timeIdx >= 0 ? row[timeIdx] ?? '' : ''
        const stage = /min/i.test(time) && /boil/i.test(use) ? classifyStage(parseFloat(time)) : classifyStage(use)
        hops.push({ name: rowName, g, use: [use, time].filter(Boolean).join(' '), stage })
      }
    }
  }

  const yeast =
    text.match(/Yeast:?\s+([A-Za-z0-9À-ž .'&/-]+?)(?:\s{2,}|\s(?:Starter|Attenuation|Flocculation|Optimum|Fermentation)\b)/)?.[1]?.trim() ??
    null

  return {
    url,
    id,
    name,
    style,
    method,
    batchL,
    vitals,
    malts,
    hops,
    yeast,
    beerXmlUrl: findBeerXmlLink(html, id),
  }
}

// ------------------------------------------------------------------ beerxml

const xmlBlocks = (xml, tag) => xml.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'gi')) ?? []
const xmlNum = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}>\\s*([^<]*)</${tag}>`, 'i'))
  if (!m) return null
  const v = parseFloat(m[1])
  return isFinite(v) ? v : null
}
const xmlText = (xml, tag) => xml.match(new RegExp(`<${tag}>\\s*([^<]*)</${tag}>`, 'i'))?.[1]?.trim() ?? null

/**
 * Parse a BeerXML export (Brewer's Friend serves one per recipe) into the
 * crawler's interchange schema. BeerXML amounts are kg; COLOR is SRM for
 * recipes but °L for fermentables; BATCH_SIZE is liters.
 */
export function parseBeerXml(xml, url = null) {
  const scope = xml.match(/<RECIPE>[\s\S]*?<\/RECIPE>/i)?.[0]
  if (!scope) throw new Error('No <RECIPE> element')

  const malts = xmlBlocks(scope, 'FERMENTABLE')
    .map((b) => ({ name: xmlText(b, 'NAME') ?? 'Fermentable', kg: xmlNum(b, 'AMOUNT') ?? 0 }))
    .filter((m) => m.kg > 0)
    .map((m) => ({ ...m, kg: +m.kg.toFixed(3) }))

  const hops = xmlBlocks(scope, 'HOP').map((b) => {
    const use = xmlText(b, 'USE') ?? ''
    const time = xmlNum(b, 'TIME') ?? 0
    const stage = /dry/i.test(use)
      ? 'dry'
      : /aroma|whirlpool/i.test(use)
        ? 'late'
        : /first wort|mash/i.test(use)
          ? 'bittering'
          : classifyStage(time)
    return {
      name: xmlText(b, 'NAME') ?? 'Hop',
      g: +(((xmlNum(b, 'AMOUNT') ?? 0) * 1000).toFixed(1)),
      use: `${use} ${time} min`.trim(),
      stage,
    }
  })

  const styleBlock = xmlBlocks(scope, 'STYLE')[0] ?? ''
  const yeastBlock = xmlBlocks(scope, 'YEAST')[0] ?? ''

  return {
    url,
    id: url?.match(/(\d+)/)?.[1] ?? null,
    name: xmlText(scope, 'NAME'),
    style: xmlText(styleBlock, 'NAME'),
    method: xmlText(scope, 'TYPE'),
    batchL: xmlNum(scope, 'BATCH_SIZE'),
    vitals: {
      og: xmlNum(scope, 'EST_OG') ?? xmlNum(scope, 'OG'),
      fg: xmlNum(scope, 'EST_FG') ?? xmlNum(scope, 'FG'),
      abv: xmlNum(scope, 'EST_ABV') ?? xmlNum(scope, 'ABV'),
      ibu: xmlNum(scope, 'IBU'),
      srm: xmlNum(scope, 'EST_COLOR') ?? xmlNum(scope, 'COLOR'),
    },
    malts,
    hops,
    yeast: xmlText(yeastBlock, 'NAME'),
  }
}

export { lovibondToSrm }
