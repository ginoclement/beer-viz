import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import guidesJson from '../generated/guides.json'
import type { BeerStyle, Guide, GuideId, Recipe, Vitals } from '../lib/types'
import { buildFeatureSpace, midVitals, transformPoint, type FeatureSpace } from '../lib/features'
import { project, type Projection, type ProjectionMethod } from '../lib/projection'
import { kmeans, silhouette } from '../lib/kmeans'
import { numericFeatures } from '../lib/features'
import { clusterLabels } from '../lib/clusterLabels'
import { extractDescriptors, type Descriptor } from '../lib/descriptors'

export const GUIDES = guidesJson as unknown as Guide[]

export type ColorBy = 'cluster' | 'category' | 'srm'

export interface RecipePoint {
  recipe: Recipe
  position: [number, number, number]
  vector: number[]
}

interface AnalysisState {
  guide: Guide
  guideId: GuideId
  setGuideId: (g: GuideId) => void
  styles: BeerStyle[] // styles with full stats, order matches space.vectors
  allStyles: BeerStyle[]
  space: FeatureSpace
  projection: Projection
  method: ProjectionMethod
  setMethod: (m: ProjectionMethod) => void
  tagWeight: number
  setTagWeight: (w: number) => void
  k: number
  setK: (k: number) => void
  clusterOf: number[] // per styles[] index
  clusterNames: string[] // per cluster, distinctive-tag label
  silhouetteScore: number
  /** flavor-descriptor fingerprints per allStyles[] index */
  descriptorsOf: Descriptor[][]
  colorBy: ColorBy
  setColorBy: (c: ColorBy) => void
  alpha: number
  setAlpha: (a: number) => void
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  /** selected hop variety (Hops tab), cross-linkable from other views */
  hopKey: string
  setHopKey: (k: string) => void
  recipes: Recipe[]
  addRecipe: (r: Recipe) => void
  removeRecipe: (i: number) => void
  recipePoints: RecipePoint[]
  /** z-scored numeric-only vectors (no tag block), aligned with styles[] */
  numericZ: number[][]
  /** transform a recipe's vitals into the same z-scored numeric space */
  numericTransform: (v: Vitals) => number[]
}

const Ctx = createContext<AnalysisState | null>(null)

/** z-score the 7 numeric features only — used for similarity blending. */
function numericZSpace(styles: BeerStyle[]) {
  const rows = styles.map((s) => numericFeatures(midVitals(s)!))
  const d = rows[0]?.length ?? 0
  const mean = new Array(d).fill(0)
  const std = new Array(d).fill(0)
  for (const r of rows) for (let j = 0; j < d; j++) mean[j] += r[j]
  for (let j = 0; j < d; j++) mean[j] /= rows.length || 1
  for (const r of rows) for (let j = 0; j < d; j++) std[j] += (r[j] - mean[j]) ** 2
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j] / (rows.length || 1)) || 1
  const z = (r: number[]) => r.map((x, j) => (x - mean[j]) / std[j])
  return { vectors: rows.map(z), transform: (v: Vitals) => z(numericFeatures(v)) }
}

const RECIPES_KEY = 'beer-viz.recipes'
const GUIDE_KEY = 'beer-viz.guide'

function loadStoredRecipes(): Recipe[] {
  try {
    const raw = localStorage.getItem(RECIPES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (r): r is Recipe =>
        r && typeof r.name === 'string' && r.vitals && typeof r.vitals.og === 'number',
    )
  } catch {
    return []
  }
}

function loadStoredGuide(): GuideId {
  const g = typeof localStorage !== 'undefined' ? localStorage.getItem(GUIDE_KEY) : null
  return GUIDES.some((x) => x.guide === g) ? (g as GuideId) : 'bjcp2021'
}

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const [guideId, setGuideId] = useState<GuideId>(loadStoredGuide)
  const [method, setMethod] = useState<ProjectionMethod>('pca')
  const [tagWeight, setTagWeight] = useState(0.35)
  const [k, setK] = useState(6)
  const [colorBy, setColorBy] = useState<ColorBy>('cluster')
  const [alpha, setAlpha] = useState(0.5)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hopKey, setHopKey] = useState('citra')
  const [recipes, setRecipes] = useState<Recipe[]>(loadStoredRecipes)

  useEffect(() => {
    try {
      localStorage.setItem(RECIPES_KEY, JSON.stringify(recipes))
    } catch {
      // storage full or unavailable — imports still work for the session
    }
  }, [recipes])
  useEffect(() => {
    try {
      localStorage.setItem(GUIDE_KEY, guideId)
    } catch {
      // ignore
    }
  }, [guideId])

  const guide = useMemo(() => GUIDES.find((g) => g.guide === guideId)!, [guideId])
  const allStyles = guide.styles
  const styles = useMemo(() => allStyles.filter((s) => s.hasStats), [allStyles])

  const space = useMemo(() => buildFeatureSpace(styles, tagWeight), [styles, tagWeight])
  const projection = useMemo(
    () => project(space.vectors, method),
    [space, method],
  )

  const { clusterOf, silhouetteScore } = useMemo(() => {
    const res = kmeans(space.vectors, k, { seed: 42 })
    return { clusterOf: res.labels, silhouetteScore: silhouette(space.vectors, res.labels) }
  }, [space, k])

  const clusterNames = useMemo(
    () => clusterLabels(styles, clusterOf, k),
    [styles, clusterOf, k],
  )

  const descriptorsOf = useMemo(
    () => allStyles.map((s) => extractDescriptors(s)),
    [allStyles],
  )

  const { vectors: numericZ, transform: numericTransform } = useMemo(
    () => numericZSpace(styles),
    [styles],
  )

  const recipePoints = useMemo<RecipePoint[]>(
    () =>
      recipes.map((recipe) => {
        const vector = transformPoint(space, recipe.vitals, recipe.tags)
        return { recipe, vector, position: projection.transform(vector) }
      }),
    [recipes, space, projection],
  )

  const value: AnalysisState = {
    guide,
    guideId,
    setGuideId,
    styles,
    allStyles,
    space,
    projection,
    method,
    setMethod,
    tagWeight,
    setTagWeight,
    k,
    setK,
    clusterOf,
    clusterNames,
    silhouetteScore,
    descriptorsOf,
    colorBy,
    setColorBy,
    alpha,
    setAlpha,
    selectedId,
    setSelectedId,
    hopKey,
    setHopKey,
    recipes,
    addRecipe: (r) => setRecipes((prev) => [...prev, r]),
    removeRecipe: (i) => setRecipes((prev) => prev.filter((_, j) => j !== i)),
    recipePoints,
    numericZ,
    numericTransform,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAnalysis(): AnalysisState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAnalysis outside provider')
  return v
}
