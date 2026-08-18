/**
 * Categorical series colors (dark-surface steps, validated order).
 * Cluster identity never rides on color alone: the legend, hover tooltip,
 * and detail panel all carry the cluster label as text.
 */
export const SERIES = [
  '#3987e5', // blue
  '#d95926', // orange
  '#199e70', // aqua
  '#c98500', // yellow
  '#d55181', // magenta
  '#008300', // green
  '#9085e9', // violet
  '#e66767', // red
] as const

export const MAX_K = SERIES.length

export const clusterColor = (c: number) => SERIES[((c % SERIES.length) + SERIES.length) % SERIES.length]

/** Guideline identity colors for cross-guide overlays (slots 1-3: all-pairs safe). */
export const GUIDE_COLORS: Record<string, string> = {
  bjcp2021: '#3987e5',
  bjcp2015: '#d95926',
  ba2017: '#199e70',
}

export const RECIPE_COLOR = '#ffffff'

export const INK = {
  surface: '#1a1a19',
  page: '#0d0d0d',
  primary: '#ffffff',
  secondary: '#c3c2b7',
  muted: '#898781',
  grid: '#2c2c2a',
  baseline: '#383835',
  border: 'rgba(255,255,255,0.10)',
} as const
