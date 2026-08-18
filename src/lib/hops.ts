import hopsJson from '../generated/hops.json'
import type { BeerStyle } from './types'
import { extractDescriptors } from './descriptors'
import { midVitals } from './features'

export type Range = [number, number] | null

export interface Hop {
  name: string
  key: string
  country: string | null
  purpose: string
  source: string
  alpha: Range
  beta: Range
  oilTotal: Range
  cohumulone: Range
  oilComp: {
    myrcene: Range
    humulene: Range
    caryophyllene: Range
    farnesene: Range
    geraniol: Range
    linalool: Range
  }
  aromas: number[] | null // aligned with AROMA_AXES, 0-5
  notes: string[]
  xanthohumol: Range
  polyphenols: Range
  released: number | null
  pedigree: string | null
  substitutes: string[]
  thiol: { level: number; note: string } | null
}

const data = hopsJson as unknown as { axes: string[]; hops: Hop[] }
export const AROMA_AXES = data.axes
export const HOPS = data.hops
export const HOPS_BY_KEY = new Map(HOPS.map((h) => [h.key, h]))

export const mid = (r: Range): number | null => (r ? (r[0] + r[1]) / 2 : null)

/** hop-aroma axis index for each style flavor descriptor that maps to hops */
const DESCRIPTOR_TO_AXIS: Record<string, string> = {
  citrus: 'Citrus',
  piney: 'Resin/Pine',
  dank: 'Resin/Pine',
  floral: 'Floral',
  herbal: 'Herbal',
  earthy: 'Herbal',
  'spicy hops': 'Spice',
  'tropical fruit': 'Tropical Fruit',
  melon: 'Tropical Fruit',
  'stone fruit': 'Stone Fruit',
  berry: 'Berry',
}

/** fallback mapping from note keywords to axes, for hops without a radar */
const NOTE_TO_AXIS: [RegExp, string][] = [
  [/citrus|grapefruit|orange|lemon|lime|tangerine|mandarin/, 'Citrus'],
  [/pine|resin|dank/, 'Resin/Pine'],
  [/spice|spicy|pepper|anise/, 'Spice'],
  [/herbal|tea|mint|sage|woody|tobacco|earth/, 'Herbal'],
  [/grass|green|hay/, 'Grassy'],
  [/floral|flower|rose|lavender|elderflower|blossom/, 'Floral'],
  [/berry|currant|blueberry|strawberry|raspberry/, 'Berry'],
  [/stone fruit|peach|apricot|cherry|plum/, 'Stone Fruit'],
  [/tropical|mango|passion|pineapple|melon|guava|papaya|coconut|lychee/, 'Tropical Fruit'],
]

/** aroma vector on the 9 axes, normalized to unit sum; null if unknowable */
export function hopAromaVector(h: Hop): number[] | null {
  let v: number[]
  if (h.aromas) {
    v = h.aromas.slice()
  } else if (h.notes.length) {
    v = new Array(AROMA_AXES.length).fill(0)
    for (const note of h.notes) {
      for (const [re, axis] of NOTE_TO_AXIS) {
        if (re.test(note.toLowerCase())) v[AROMA_AXES.indexOf(axis)] += 1
      }
    }
  } else {
    return null
  }
  const sum = v.reduce((a, b) => a + b, 0)
  return sum > 0 ? v.map((x) => x / sum) : null
}

export interface StyleAromaTarget {
  vector: number[] | null // unit-sum target over AROMA_AXES
  matched: string[] // descriptor names that contributed
}

/** what the style's guideline prose asks of its hops */
export function styleAromaTarget(style: BeerStyle): StyleAromaTarget {
  const target = new Array(AROMA_AXES.length).fill(0)
  const matched: string[] = []
  for (const d of extractDescriptors(style)) {
    const axis = DESCRIPTOR_TO_AXIS[d.name]
    if (!axis) continue
    target[AROMA_AXES.indexOf(axis)] += d.strength
    matched.push(d.name)
  }
  const sum = target.reduce((a, b) => a + b, 0)
  return { vector: sum > 0 ? target.map((x) => x / sum) : null, matched }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

const REGION_TAG_TO_COUNTRIES: Record<string, string[]> = {
  'central-europe': ['Germany', 'Czech Republic', 'Slovenia', 'Austria', 'Poland', 'France'],
  'eastern-europe': ['Czech Republic', 'Poland', 'Slovenia'],
  'british-isles': ['United Kingdom', 'UK', 'England'],
  'north-america': ['United States', 'USA', 'Canada'],
  pacific: ['Australia', 'New Zealand'],
  'western-europe': ['Belgium', 'France', 'Germany', 'United Kingdom', 'UK'],
}

const NEW_WORLD = ['United States', 'USA', 'Canada', 'Australia', 'New Zealand']

export interface PairingScore {
  hop: Hop
  total: number
  aroma: number | null
  tradition: number
  role: number
  matched: string[]
}

/**
 * Style -> hop affinity.
 *  - aroma: cosine between the style's prose-derived hop-aroma target and
 *    the hop's aroma profile (skipped when the style names no hop character)
 *  - tradition: does the hop's growing region match the style's homeland
 *    tags (craft styles also accept any New World hop)
 *  - role: does the hop's alpha-acid range suit the style's bitterness
 *    load, with a low-cohumulone bonus for delicate styles
 */
export function scoreHopForStyle(style: BeerStyle, hop: Hop, target?: StyleAromaTarget): PairingScore {
  const t = target ?? styleAromaTarget(style)

  let aroma: number | null = null
  const hv = hopAromaVector(hop)
  if (t.vector && hv) aroma = cosine(t.vector, hv)

  let tradition = 0.5
  const homelands = new Set<string>()
  let craft = false
  for (const tag of style.tags) {
    for (const c of REGION_TAG_TO_COUNTRIES[tag] ?? []) homelands.add(c)
    if (tag === 'craft-style') craft = true
  }
  if (homelands.size > 0 || craft) {
    const c = hop.country ?? ''
    const inHomeland = [...homelands].some((h) => c.toLowerCase().includes(h.toLowerCase()))
    const inNewWorld = NEW_WORLD.some((h) => c.toLowerCase().includes(h.toLowerCase()))
    tradition = inHomeland ? 1 : craft && inNewWorld ? 0.85 : 0.15
  }

  let role = 0.7
  const v = midVitals(style)
  const alphaMid = mid(hop.alpha)
  if (v && alphaMid != null) {
    // rough alpha sweet spot rises with the style's bitterness load
    const ideal = Math.min(Math.max(v.ibu / 5, 4), 14)
    role = Math.max(0, 1 - Math.abs(alphaMid - ideal) / 14)
    const cohu = mid(hop.cohumulone)
    if (v.ibu < 30 && cohu != null) {
      // delicate styles favor smooth, low-cohumulone bittering
      role += cohu <= 25 ? 0.15 : cohu >= 35 ? -0.15 : 0
    }
    role = Math.min(Math.max(role, 0), 1)
  }

  // When the style's prose names no hop character, only tradition and role
  // remain; discount so an explicit aroma match always outranks a default.
  const total =
    aroma != null
      ? 0.55 * aroma + 0.25 * tradition + 0.2 * role
      : 0.82 * (0.55 * tradition + 0.45 * role)

  return { hop, total, aroma, tradition, role, matched: t.matched }
}

export function rankHopsForStyle(style: BeerStyle, limit = 12): PairingScore[] {
  const target = styleAromaTarget(style)
  return HOPS.map((h) => scoreHopForStyle(style, h, target))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}

export function rankStylesForHop(hop: Hop, styles: BeerStyle[], limit = 8): { style: BeerStyle; score: PairingScore }[] {
  return styles
    .map((s) => ({ style: s, score: scoreHopForStyle(s, hop) }))
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, limit)
}

/** pairwise hop similarity from aroma profiles (cosine), for the network */
export function hopAromaSimilarity(a: Hop, b: Hop): number {
  const va = hopAromaVector(a)
  const vb = hopAromaVector(b)
  return va && vb ? cosine(va, vb) : 0
}
