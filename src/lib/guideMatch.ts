import type { BeerStyle } from './types'

/**
 * Cross-guideline style matching. Guidelines name the same beer differently:
 * BJCP uses numbered ids with short names ("11B" / "Best Bitter") while the
 * Brewers Association concatenates alternatives ("Special Bitter or Best
 * Bitter", "Imperial or Double India Pale Ale"). Matching therefore runs on
 * normalized names expanded into their alternative readings.
 */

const STOP_WORDS = new Set(['style', 'beer', 'ale', 'lager', 'or', 'and'])

/** German/BA spelling variants mapped onto the BJCP vocabulary. */
const TOKEN_ALIASES: Record<string, string> = {
  pils: 'pilsner',
  pilsener: 'pilsner',
  munchner: 'munich',
  muenchner: 'munich',
  maerzen: 'marzen',
  oktoberfest: 'marzen',
  wiesn: 'marzen',
  hefeweizen: 'weizen',
  weissbier: 'weizen',
  hefeweissbier: 'weizen',
  dunkles: 'dunkel',
  heller: 'helles',
  koelsch: 'kolsch',
  english: 'british',
  blond: 'blonde',
}

export function normName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[äàáâ]/g, 'a')
    .replace(/[öòóô]/g, 'o')
    .replace(/[üùúû]/g, 'u')
    .replace(/[éèêë]/g, 'e')
    .replace(/ß/g, 'ss')
    .replace(/[-/&]/g, ' ')
    .replace(/india pale ale/g, 'ipa')
    .replace(/barley ?wine/g, 'barleywine')
    .replace(/wheat ?wine/g, 'wheatwine')
    .replace(/^\d+[a-z]?\s+/, '') // leading category code, e.g. "11B Best Bitter"
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Alternative readings of a style name. "Special Bitter or Best Bitter"
 * yields itself plus "special bitter" and "best bitter"; a short alternative
 * borrows the trailing words of the last one, so "Golden or Blonde Ale"
 * also yields "golden ale", and "Imperial or Double India Pale Ale" yields
 * "imperial ipa".
 */
export function altNames(name: string): string[] {
  const out = new Set<string>([normName(name)])
  const parts = name
    .split(/,|\bor\b/i)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length > 1) {
    const lastWords = parts[parts.length - 1].split(/\s+/)
    for (const p of parts) {
      const n = normName(p)
      if (n) out.add(n)
      const words = p.split(/\s+/)
      if (words.length < lastWords.length) {
        out.add(normName([...words, ...lastWords.slice(words.length)].join(' ')))
      }
    }
  }
  out.delete('')
  return [...out]
}

export function tokens(name: string): Set<string> {
  return new Set(
    normName(name)
      .split(' ')
      .filter((w) => w && !STOP_WORDS.has(w))
      .map((w) => TOKEN_ALIASES[w] ?? w),
  )
}

export function tokenSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

export interface Match {
  a: BeerStyle
  b: BeerStyle
  fuzzy: boolean
}

/**
 * "ale" and "lager" are stop words for similarity (they'd swamp it), but a
 * name that says one must never fuzzy-match a name that says only the other:
 * "International Pale Lager" is not "International-Style Pale Ale".
 */
function typeConflict(nameA: string, nameB: string): boolean {
  const a = normName(nameA)
  const b = normName(nameB)
  const ale = (n: string) => /\bale\b/.test(n)
  const lager = (n: string) => /\blager\b/.test(n)
  return (
    (ale(a) && !lager(a) && lager(b) && !ale(b)) ||
    (lager(a) && !ale(a) && ale(b) && !lager(b))
  )
}

/**
 * Words too generic to justify a single-token containment match on their
 * own; beer-specific terms like "witbier" or "doppelbock" are not listed,
 * so "Witbier" ⊂ "Belgian-Style Witbier" still pairs.
 */
const GENERIC_TOKENS = new Set([
  'mixed', 'wild', 'specialty', 'strong', 'fruit', 'spice', 'spiced', 'smoked',
  'sour', 'amber', 'dark', 'pale', 'light', 'golden', 'blonde', 'brown', 'red',
  'cream', 'common', 'session', 'imperial', 'double', 'extra', 'special',
  'ordinary', 'robust', 'sweet', 'dry', 'old', 'other', 'wheat', 'rye',
])

export function matchGuides(
  as: BeerStyle[],
  bs: BeerStyle[],
): { matches: Match[]; onlyA: BeerStyle[]; onlyB: BeerStyle[] } {
  const usedB = new Set<string>()
  const matches: Match[] = []
  // index every alternative reading of every b-side name
  const byNorm = new Map<string, BeerStyle>()
  for (const b of bs) {
    for (const alt of altNames(b.name)) {
      if (!byNorm.has(alt)) byNorm.set(alt, b)
    }
  }
  const unmatchedA: BeerStyle[] = []
  for (const a of as) {
    const hit = altNames(a.name)
      .map((alt) => byNorm.get(alt))
      .find((b) => b && !usedB.has(b.id))
    if (hit) {
      matches.push({ a, b: hit, fuzzy: false })
      usedB.add(hit.id)
    } else {
      unmatchedA.push(a)
    }
  }
  // fuzzy pass on word sets, best alternative reading on either side
  const altTokensOf = (s: BeerStyle) => altNames(s.name).map((n) => tokens(n))
  const bAltTokens = new Map(bs.map((b) => [b.id, altTokensOf(b)]))
  const stillUnmatched: BeerStyle[] = []
  for (const a of unmatchedA) {
    const tas = altTokensOf(a)
    let best: BeerStyle | null = null
    let bestS = 0.65
    for (const b of bs) {
      if (usedB.has(b.id) || typeConflict(a.name, b.name)) continue
      let s = 0
      for (const ta of tas)
        for (const tb of bAltTokens.get(b.id)!) s = Math.max(s, tokenSim(ta, tb))
      if (s > bestS) {
        bestS = s
        best = b
      }
    }
    if (best) {
      matches.push({ a, b: best, fuzzy: true })
      usedB.add(best.id)
    } else {
      stillUnmatched.push(a)
    }
  }
  // containment pass: "Witbier" ⊂ "Belgian-Style Witbier", "Saison" ⊂
  // "Classic French & Belgian-Style Saison". Only applies when the shorter
  // name's tokens are distinctive — contained in at most three b-side
  // names, and not a lone generic word — so unrelated styles don't pair.
  const isSubset = (small: Set<string>, big: Set<string>) => {
    if (small.size === 0 || big.size < small.size) return false
    for (const t of small) if (!big.has(t)) return false
    return true
  }
  // the smaller name must be more than one generic word to count
  const contained = (ta: Set<string>, tb: Set<string>) => {
    const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta]
    if (small.size === 1 && GENERIC_TOKENS.has([...small][0])) return false
    return isSubset(small, big)
  }
  const onlyA: BeerStyle[] = []
  for (const a of stillUnmatched) {
    const ta = tokens(a.name)
    if (ta.size === 0) {
      onlyA.push(a)
      continue
    }
    const supersets = bs.filter(
      (b) =>
        !typeConflict(a.name, b.name) &&
        bAltTokens.get(b.id)!.some((tb) => contained(ta, tb)),
    )
    const hit = supersets.find((b) => !usedB.has(b.id))
    if (supersets.length > 0 && supersets.length <= 3 && hit) {
      matches.push({ a, b: hit, fuzzy: true })
      usedB.add(hit.id)
    } else {
      onlyA.push(a)
    }
  }
  const onlyB = bs.filter((b) => !usedB.has(b.id))
  return { matches, onlyA, onlyB }
}
