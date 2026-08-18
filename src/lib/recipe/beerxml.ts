import type { Recipe } from '../types'
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

  const vitals = { og, fg, abv, ibu, srm }
  return {
    name,
    vitals,
    tags: deriveRecipeTags(vitals, { name, yeastType }),
    source: 'beerxml',
  }
}
