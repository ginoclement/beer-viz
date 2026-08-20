import type { CorpusRecipe, HopStage } from './ingredients'

/**
 * Client for the read-only beer-api (DuckDB). Enabled by VITE_BEER_API_BASE;
 * when unset the app runs fully offline against the bundled JSON (see
 * localData.ts). Endpoints and shapes mirror apps/beer-api/server.mjs.
 */

export const API_BASE = (import.meta.env.VITE_BEER_API_BASE ?? '').replace(/\/$/, '')
export const apiEnabled = API_BASE !== ''

async function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(API_BASE + path, { signal })
  if (!res.ok) throw new Error(`beer-api ${path} → ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

// ------------------------------------------------------------------ shapes

export interface ApiRecipeRow {
  id: number
  name: string
  family: string
  style_code: string | null
  style_name: string | null
  og: number | null
  fg: number | null
  abv: number | null
  ibu: number | null
  srm: number | null
  attenuation: number | null
  hop_gpl: number | null
  roast: number | null
  batch_l: number | null
}
export interface RecipesResponse {
  total: number
  limit: number
  offset: number
  recipes: ApiRecipeRow[]
}

export interface ProjPoint {
  id: number
  name: string
  family: string
  style_code: string | null
  abv: number | null
  ibu: number | null
  srm: number | null
  x: number
  y: number
  z: number
}
export interface ProjectionResponse {
  method: string
  blend: number
  count: number
  points: ProjPoint[]
}

export interface MetaResponse {
  counts: { recipes: number | string; projected: number | string }
  families: { family: string; n: number }[]
  projection: { method: string; blend: number }[]
}

export interface RecipeDetailResponse {
  recipe: Record<string, unknown>
  malts: { name: string; pct: number; class: string }[]
  hops: { name: string; key: string | null; g: number; stage: string }[]
}

// ------------------------------------------------------------- range filter

export interface VitalBounds {
  ogMin?: number; ogMax?: number
  fgMin?: number; fgMax?: number
  abvMin?: number; abvMax?: number
  ibuMin?: number; ibuMax?: number
  srmMin?: number; srmMax?: number
}
export interface RecipeQuery extends VitalBounds {
  family?: string
  style?: string
  q?: string
  sort?: string
  dir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

// -------------------------------------------------------------- endpoints

export const fetchMeta = (signal?: AbortSignal) => getJSON<MetaResponse>('/meta', signal)

export function fetchRecipes(query: RecipeQuery, signal?: AbortSignal): Promise<RecipesResponse> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }
  return getJSON<RecipesResponse>(`/recipes?${qs.toString()}`, signal)
}

export const fetchProjection = (method: string, blend: number, limit = 8000, signal?: AbortSignal) =>
  getJSON<ProjectionResponse>(`/projection?method=${method}&blend=${blend}&limit=${limit}`, signal)

export const fetchRecipeDetail = (id: number, signal?: AbortSignal) =>
  getJSON<RecipeDetailResponse>(`/recipe/${id}`, signal)

// ---------------------------------------------------- API → CorpusRecipe

const styleGuess = (code: string | null, name?: string | null) =>
  code ? { code, name: name ?? '', inRange: 0 } : null

/** A filtered/paged recipe row → the shape the views render (no grain bill). */
export function rowToRecipe(r: ApiRecipeRow): CorpusRecipe {
  return {
    id: r.id,
    name: r.name,
    tagline: '',
    year: null,
    family: r.family,
    vitals: { og: r.og, fg: r.fg, abv: r.abv, ibu: r.ibu, srm: r.srm },
    attenuation: r.attenuation,
    styleGuess: styleGuess(r.style_code, r.style_name),
    batchL: r.batch_l,
    malts: [],
    hops: [],
    yeast: null,
    hopGpl: r.hop_gpl,
    roast: r.roast ?? undefined,
  }
}

/** A projection point → a light recipe for rendering/hover (vitals only). */
export function projPointToRecipe(p: ProjPoint): CorpusRecipe {
  return {
    id: p.id,
    name: p.name,
    tagline: '',
    year: null,
    family: p.family,
    vitals: { og: null, fg: null, abv: p.abv, ibu: p.ibu, srm: p.srm },
    styleGuess: styleGuess(p.style_code),
    batchL: null,
    malts: [],
    hops: [],
    yeast: null,
  }
}

/** Full detail (vitals + grain bill + hop schedule) → CorpusRecipe. */
export function detailToRecipe(d: RecipeDetailResponse): CorpusRecipe {
  const r = d.recipe as Record<string, number | string | null>
  const n = (k: string) => (r[k] == null ? null : Number(r[k]))
  const s = (k: string) => (r[k] == null ? null : String(r[k]))
  return {
    id: Number(r.id),
    name: String(r.name ?? ''),
    tagline: s('tagline') ?? '',
    year: n('year'),
    family: String(r.family ?? ''),
    origin: s('origin') ?? undefined,
    vitals: { og: n('og'), fg: n('fg'), abv: n('abv'), ibu: n('ibu'), srm: n('srm') },
    attenuation: n('attenuation'),
    styleGuess: styleGuess(s('style_code'), s('style_name')),
    batchL: n('batch_l'),
    yeast: s('yeast'),
    malts: d.malts.map((m) => ({ name: m.name, kg: 0, pct: m.pct, class: m.class })),
    hops: d.hops.map((h) => ({ name: h.name, key: h.key, g: h.g, stage: (h.stage as HopStage) ?? 'late' })),
    hopGpl: n('hop_gpl'),
    roast: n('roast') ?? undefined,
  }
}
