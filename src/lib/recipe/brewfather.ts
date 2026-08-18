import type { Recipe } from '../types'
import { ebcToSrm } from '../srm'
import { abvFromGravities, deriveRecipeTags } from './derive'

/**
 * Parse a Brewfather recipe/batch JSON export. Brewfather exports carry
 * og/fg/ibu/abv directly; color may be stored as SRM or EBC depending on
 * the export, so `colorUnit` lets the user override the auto-guess.
 */
export function parseBrewfather(
  json: unknown,
  colorUnit: 'auto' | 'srm' | 'ebc' = 'auto',
): Recipe {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Not a JSON object')
  }
  let r = json as Record<string, unknown>
  // batch exports nest the recipe
  if (typeof r.recipe === 'object' && r.recipe !== null) {
    r = r.recipe as Record<string, unknown>
  }

  const num = (...keys: string[]): number | null => {
    for (const k of keys) {
      const v = r[k]
      if (typeof v === 'number' && isFinite(v)) return v
      if (typeof v === 'string' && v.trim() && isFinite(Number(v))) return Number(v)
    }
    return null
  }

  const og = num('og', 'estimatedOg')
  const fg = num('fg', 'estimatedFg')
  let abv = num('abv')
  const ibu = num('ibu', 'estimatedIbu')
  let color = num('srm', 'estimatedSrm', 'color', 'estimatedColor', 'ebc')

  if (og == null || fg == null || ibu == null || color == null) {
    throw new Error(
      'Could not find og/fg/ibu/color in this file — is it a Brewfather recipe or batch JSON export?',
    )
  }
  if (abv == null) abv = abvFromGravities(og, fg)

  const explicitSrm = num('srm', 'estimatedSrm') != null
  const explicitEbc = !explicitSrm && r.srm == null && num('ebc') != null
  let srm: number
  if (colorUnit === 'srm') srm = color
  else if (colorUnit === 'ebc') srm = ebcToSrm(color)
  else if (explicitSrm) srm = color
  else if (explicitEbc) srm = ebcToSrm(color)
  else srm = color // Brewfather's `color` field is SRM in recipe exports

  let yeastType: string | null = null
  const yeasts = r.yeasts
  if (Array.isArray(yeasts) && yeasts.length > 0) {
    const y = yeasts[0] as Record<string, unknown>
    if (typeof y.type === 'string') yeastType = y.type
    else if (typeof y.form === 'string') yeastType = y.form
  }

  const name = typeof r.name === 'string' && r.name.trim() ? r.name : 'Imported recipe'
  const vitals = { og, fg, abv, ibu, srm }
  return {
    name,
    vitals,
    tags: deriveRecipeTags(vitals, { name, yeastType }),
    source: 'brewfather',
  }
}
