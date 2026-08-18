export type StatRange = [number, number] | null

export interface StyleStats {
  og: StatRange
  fg: StatRange
  abv: StatRange
  ibu: StatRange
  srm: StatRange
}

export interface BeerStyle {
  id: string
  name: string
  category: string
  categoryId: string | null
  type: string
  stats: StyleStats
  hasStats: boolean
  tags: string[]
  tagsSynthesized: boolean
  impression: string | null
  aroma: string | null
  appearance: string | null
  flavor: string | null
  mouthfeel: string | null
  comments: string | null
  history: string | null
  comparison: string | null
  ingredients: string | null
  examples: string | null
}

export type GuideId = 'bjcp2021' | 'bjcp2015' | 'ba2017'

export interface Guide {
  guide: GuideId
  label: string
  source: string
  styles: BeerStyle[]
}

/** The five vital statistics of a recipe or style, as point values. */
export interface Vitals {
  og: number
  fg: number
  abv: number
  ibu: number
  srm: number
}

export interface Recipe {
  name: string
  vitals: Vitals
  tags: string[]
  source: 'brewfather' | 'beerxml' | 'manual'
}
