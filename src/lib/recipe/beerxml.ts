import type { Recipe, RecipeFermentable, RecipeHopAddition } from '../types'
import { abvFromGravities, deriveRecipeTags } from './derive'

/**
 * Minimal, dependency-free BeerXML reader. BeerXML scalar fields are flat
 * <TAG>value</TAG> pairs, so tolerant tag extraction is enough — values
 * like "1.056 SG" or "23.9 IBU" keep their leading number.
 */
function tagValue(xml: string, tag: string): number | null {
  const m = xml.match(new RegExp(`<${tag}>\\s*([^<]*)</${tag}>`, 'i'))
  if (!m) return null
  const v = parseFloat(m[1])
  return isFinite(v) ? v : null
}

function tagText(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>\\s*([^<]*)</${tag}>`, 'i'))
  return m ? m[1].trim() : null
}

function blocks(xml: string, tag: string): string[] {
  return xml.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'gi')) ?? []
}

/** BeerXML AMOUNT is kilograms for fermentables and hops alike. */
function parseFermentables(scope: string): RecipeFermentable[] {
  const out = blocks(scope, 'FERMENTABLE')
    .map((b) => ({
      name: tagText(b, 'NAME') ?? 'Fermentable',
      kg: tagValue(b, 'AMOUNT') ?? 0,
    }))
    .filter((f) => f.kg > 0)
  const total = out.reduce((s, f) => s + f.kg, 0)
  return out.map((f) => ({ ...f, pct: total > 0 ? +((f.kg / total) * 100).toFixed(1) : 0 }))
}

function parseHops(scope: string): RecipeHopAddition[] {
  return blocks(scope, 'HOP').map((b) => {
    const use = (tagText(b, 'USE') ?? '').toLowerCase()
    const time = tagValue(b, 'TIME') ?? 0
    let stage: RecipeHopAddition['stage']
    if (use.includes('dry')) stage = 'dry'
    else if (use.includes('aroma') || use.includes('whirlpool')) stage = 'late'
    else if (use.includes('first wort') || use.includes('mash')) stage = 'bittering'
    else stage = time >= 45 ? 'bittering' : 'late'
    return {
      name: tagText(b, 'NAME') ?? 'Hop',
      g: +(((tagValue(b, 'AMOUNT') ?? 0) * 1000).toFixed(1)),
      stage,
    }
  })
}

export function parseBeerXml(xml: string): Recipe {
  const recipeMatch = xml.match(/<RECIPE>[\s\S]*?<\/RECIPE>/i)
  const scope = recipeMatch ? recipeMatch[0] : xml
  if (!/<RECIPE/i.test(xml)) {
    throw new Error('No <RECIPE> element found — is this a BeerXML file?')
  }

  const og = tagValue(scope, 'EST_OG') ?? tagValue(scope, 'OG')
  const fg = tagValue(scope, 'EST_FG') ?? tagValue(scope, 'FG')
  const ibu = tagValue(scope, 'IBU') ?? tagValue(scope, 'EST_IBU')
  const srm = tagValue(scope, 'EST_COLOR') ?? tagValue(scope, 'COLOR')
  let abv = tagValue(scope, 'EST_ABV') ?? tagValue(scope, 'ABV')

  if (og == null || fg == null || ibu == null || srm == null) {
    throw new Error('BeerXML file is missing OG/FG/IBU/COLOR estimates')
  }
  if (abv == null) abv = abvFromGravities(og, fg)

  const yeastBlock = scope.match(/<YEAST>[\s\S]*?<\/YEAST>/i)?.[0] ?? ''
  const yeastType = tagText(yeastBlock, 'TYPE')
  const name = tagText(scope, 'NAME') ?? 'Imported recipe'
  const fermentables = parseFermentables(scope)
  const hopSchedule = parseHops(scope)

  const vitals = { og, fg, abv, ibu, srm }
  return {
    name,
    vitals,
    tags: deriveRecipeTags(vitals, { name, yeastType }),
    source: 'beerxml',
    ...(fermentables.length > 0 ? { fermentables } : {}),
    ...(hopSchedule.length > 0 ? { hopSchedule } : {}),
    yeastName: tagText(yeastBlock, 'NAME'),
  }
}
