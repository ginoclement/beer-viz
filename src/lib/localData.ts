import type { CorpusRecipe } from './ingredients'

/**
 * Offline fallback data loaders, used only when VITE_BEER_API_BASE is unset.
 *
 * These are DYNAMIC imports on purpose: the bundler splits corpus.json and
 * recipeProjection.json into separate chunks that load only when a view calls
 * these functions. So when the API is enabled, the 6.6 MB corpus never ships.
 */

export interface LocalCorpus {
  source: string
  recipes: CorpusRecipe[]
}

let corpusP: Promise<LocalCorpus> | null = null
export function loadLocalCorpus(): Promise<LocalCorpus> {
  if (!corpusP)
    corpusP = import('../generated/corpus.json').then(
      (m) => (m.default ?? m) as unknown as LocalCorpus,
    )
  return corpusP
}

export type Coords = [number, number, number][]
export interface LocalProjection {
  ids: number[]
  pca: Record<string, Coords>
  umap: Record<string, Coords> | null
  explained: Record<string, number[]>
}

let projP: Promise<LocalProjection> | null = null
export function loadLocalProjection(): Promise<LocalProjection> {
  if (!projP)
    projP = import('../generated/recipeProjection.json').then(
      (m) => (m.default ?? m) as unknown as LocalProjection,
    )
  return projP
}
