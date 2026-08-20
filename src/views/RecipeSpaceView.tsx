import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { CorpusRecipe } from '../lib/ingredients'
import {
  apiEnabled,
  fetchMeta,
  fetchProjection,
  fetchRecipeDetail,
  projPointToRecipe,
  detailToRecipe,
} from '../lib/api'
import { loadLocalCorpus, loadLocalProjection, type Coords } from '../lib/localData'
import { useApiLive } from '../state/useApiLive'
import { srmToHex } from '../lib/srm'
import { GristBar, HopScheduleList } from '../components/IngredientBill'
import SidePanel from '../components/SidePanel'
import ChartHelp from '../components/ChartHelp'

type ColorMode = 'family' | 'srm' | 'abv'
type ProjMethod = 'pca' | 'umap'

// The projection is precomputed at build time (scripts/build-projection.mjs)
// for both methods and a few discrete "vitals ⇄ ingredients" blends. In API
// mode the beer-api serves a sampled slice; offline we read the bundled file.
const BLENDS = [0, 0.5, 1]
const nearestBlend = (b: number) => BLENDS.reduce((p, c) => (Math.abs(c - b) < Math.abs(p - b) ? c : p), 0.5)

// ABV gradient: pale straw → deep amber, matched to the app's warm palette.
function abvColor(abv: number, lo: number, hi: number): string {
  const t = Math.min(1, Math.max(0, (abv - lo) / Math.max(1e-6, hi - lo)))
  const a = [0xf2, 0xd9, 0x8c]
  const b = [0x8a, 0x2b, 0x06]
  const mix = a.map((c, i) => Math.round(c + (b[i] - c) * t))
  return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

interface Hover {
  index: number
  x: number
  y: number
}

function RecipePoints({
  points,
  colors,
  onHover,
  onSelect,
  selectedIndex,
}: {
  points: [number, number, number][]
  colors: THREE.Color[]
  onHover: (h: Hover | null) => void
  onSelect: (i: number) => void
  selectedIndex: number
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const n = points.length

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    for (let i = 0; i < n; i++) {
      m.makeTranslation(points[i][0], points[i][1], points[i][2])
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, colors[i])
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [points, colors, n])

  // Sphere size shrinks as the cloud grows, so thousands stay legible.
  const radius = n > 1500 ? 0.012 : n > 600 ? 0.017 : 0.024

  return (
    <group>
      <instancedMesh
        key={n}
        ref={meshRef}
        args={[undefined, undefined, n]}
        onPointerMove={(e) => {
          e.stopPropagation()
          if (e.instanceId === undefined) return
          onHover({ index: e.instanceId, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e) => {
          e.stopPropagation()
          if (e.instanceId !== undefined) onSelect(e.instanceId)
        }}
      >
        <sphereGeometry args={[radius, 12, 12]} />
        <meshStandardMaterial roughness={0.5} metalness={0.08} />
      </instancedMesh>
      {selectedIndex >= 0 && points[selectedIndex] && (
        <mesh position={points[selectedIndex]}>
          <sphereGeometry args={[radius * 2.1, 20, 20]} />
          <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.8} />
        </mesh>
      )}
    </group>
  )
}

function CameraRig() {
  const { camera } = useThree()
  useEffect(() => {
    camera.position.set(1.9, 1.4, 1.9)
    camera.lookAt(0, 0, 0)
  }, [camera])
  return null
}

function RecipeDetail({ recipe }: { recipe: CorpusRecipe }) {
  const v = recipe.vitals
  return (
    <div className="detail">
      <h2>{recipe.name}</h2>
      <p style={{ color: 'var(--muted)', marginTop: -4 }}>
        {recipe.styleGuess ? `${recipe.styleGuess.code} ${recipe.styleGuess.name} · ` : ''}
        {recipe.origin === 'diydog' ? 'BrewDog DIY Dog' : recipe.origin ?? 'recipe'}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '10px 0' }}>
        {[
          v.abv != null && `${v.abv.toFixed(1)}% ABV`,
          v.ibu != null && `${Math.round(v.ibu)} IBU`,
          v.srm != null && `${v.srm.toFixed(1)} SRM`,
          v.og != null && `OG ${v.og.toFixed(3)}`,
          v.fg != null && `FG ${v.fg.toFixed(3)}`,
          recipe.attenuation != null && `${recipe.attenuation.toFixed(0)}% att`,
          recipe.mash?.tempC != null && `mash ${recipe.mash.tempC}°C`,
          recipe.fermentTempC != null && `ferment ${recipe.fermentTempC}°C`,
        ]
          .filter(Boolean)
          .map((s, i) => (
            <span
              key={i}
              style={{
                background: 'var(--surface-2, rgba(255,255,255,0.05))',
                border: '1px solid var(--border, #2a2a2a)',
                borderRadius: 6,
                padding: '2px 7px',
                fontSize: 12,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {s}
            </span>
          ))}
      </div>
      {recipe.malts.length > 0 && (
        <>
          <h3>Grist</h3>
          <GristBar rows={recipe.malts.map((m) => ({ name: m.name, pct: m.pct, class: m.class }))} />
        </>
      )}
      {recipe.hops.length > 0 && (
        <>
          <h3>Hops</h3>
          <HopScheduleList rows={recipe.hops.map((h) => ({ name: h.name, g: h.g, stage: h.stage }))} />
        </>
      )}
      {recipe.description && <p style={{ color: 'var(--ink-2)', fontSize: 13 }}>{recipe.description}</p>}
    </div>
  )
}

interface SpaceData {
  recipes: CorpusRecipe[]
  points: Coords
  explained?: number[]
}

export default function RecipeSpaceView() {
  const [method, setMethod] = useState<ProjMethod>('pca')
  const [colorMode, setColorMode] = useState<ColorMode>('family')
  const [blend, setBlend] = useState(0.5)
  const [hover, setHover] = useState<Hover | null>(null)
  const [selected, setSelected] = useState<number>(-1)

  const [families, setFamilies] = useState<string[]>([])
  const [hasUmap, setHasUmap] = useState(false)
  const [projectedTotal, setProjectedTotal] = useState<number | null>(null)
  const [allPoints, setAllPoints] = useState(false)
  const [data, setData] = useState<SpaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<CorpusRecipe | null>(null)

  // Stable family → color map. There are ~15 families — more than the 8-step
  // categorical palette — so we spread evenly around the hue wheel.
  const familyColor = useMemo(() => {
    return (f: string) => {
      const i = Math.max(0, families.indexOf(f))
      return `hsl(${Math.round((i / Math.max(1, families.length)) * 360)}, 60%, 60%)`
    }
  }, [families])

  const apiLive = useApiLive()

  // Discover availability: families (stable colors) and UMAP presence.
  // Re-runs if the API drops mid-session so the local fallback fills in.
  useEffect(() => {
    let ok = true
    ;(async () => {
      try {
        if (apiLive) {
          const meta = await fetchMeta()
          if (!ok) return
          setFamilies([...new Set(meta.families.map((f) => f.family))].sort())
          setHasUmap(meta.projection.some((p) => p.method === 'umap'))
          // counts.projected is count(DISTINCT recipe_id); DuckDB serializes
          // BIGINTs as strings, hence the Number()
          setProjectedTotal(Number(meta.counts.projected) || null)
        } else {
          const [corpus, proj] = await Promise.all([loadLocalCorpus(), loadLocalProjection()])
          if (!ok) return
          setFamilies([...new Set(corpus.recipes.map((r) => r.family))].sort())
          setHasUmap(!!proj.umap)
        }
      } catch (e) {
        if (ok) setError(String(e))
      }
    })()
    return () => {
      ok = false
    }
  }, [apiLive])

  const blendKey = String(nearestBlend(blend))

  // Load the point cloud for the current (method, blend).
  useEffect(() => {
    let ok = true
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        // A healthy API should never serve an empty projection (seen once
        // with a mistyped blend column in the DB) — fall back to the
        // bundled snapshot for this view rather than rendering nothing.
        let apiServed = false
        if (apiLive) {
          const res = await fetchProjection(method, nearestBlend(blend), allPoints ? 60000 : 8000, ctrl.signal)
          if (!ok) return
          if (res.points.length > 0) {
            apiServed = true
            setData({
              recipes: res.points.map(projPointToRecipe),
              points: res.points.map((p) => [p.x, p.y, p.z]) as Coords,
            })
          } else {
            console.warn('beer-api returned an empty projection — using bundled snapshot')
          }
        }
        if (!apiServed) {
          const [corpus, proj] = await Promise.all([loadLocalCorpus(), loadLocalProjection()])
          if (!ok) return
          const byId = new Map(corpus.recipes.map((r) => [r.id, r]))
          const table = method === 'umap' && proj.umap ? proj.umap : proj.pca
          const coords = table[blendKey] ?? proj.pca[blendKey]
          // Keep recipes aligned to coords: index by the projection's id order.
          const recipes: CorpusRecipe[] = []
          const points: Coords = []
          proj.ids.forEach((id, i) => {
            const r = byId.get(id)
            if (r && coords[i]) {
              recipes.push(r)
              points.push(coords[i])
            }
          })
          setData({ recipes, points, explained: method === 'pca' ? proj.explained[blendKey] : undefined })
        }
      } catch (e) {
        if (ok && (e as { name?: string })?.name !== 'AbortError') setError(String(e))
      } finally {
        if (ok) setLoading(false)
      }
    })()
    return () => {
      ok = false
      ctrl.abort()
    }
  }, [method, blendKey, apiLive, allPoints])

  const recipes = data?.recipes ?? []
  const points = data?.points ?? []

  // Resolve the selected recipe's full detail (grain bill + hops). Offline the
  // loaded recipe is already complete; in API mode we fetch /recipe/:id.
  useEffect(() => {
    if (selected < 0 || selected >= recipes.length) {
      setDetail(null)
      return
    }
    const light = recipes[selected]
    setDetail(light)
    if (!apiLive) return
    let ok = true
    fetchRecipeDetail(light.id)
      .then((d) => {
        if (ok) setDetail(detailToRecipe(d))
      })
      .catch(() => {})
    return () => {
      ok = false
    }
  }, [selected, recipes, apiLive])

  const abvRange = useMemo(() => {
    if (!recipes.length) return [0, 12] as [number, number]
    const vals = recipes.map((r) => r.vitals.abv ?? 0)
    return [Math.min(...vals), Math.max(...vals)] as [number, number]
  }, [recipes])

  const colors = useMemo(() => {
    return recipes.map((r) => {
      if (colorMode === 'srm') return new THREE.Color(srmToHex(r.vitals.srm ?? 4))
      if (colorMode === 'abv') return new THREE.Color(abvColor(r.vitals.abv ?? 0, abvRange[0], abvRange[1]))
      return new THREE.Color(familyColor(r.family))
    })
  }, [recipes, colorMode, abvRange, familyColor])

  // clamp selection when the recipe set changes size
  useEffect(() => {
    if (selected >= recipes.length) setSelected(-1)
  }, [recipes.length, selected])

  const hovered = hover && recipes[hover.index] ? recipes[hover.index] : null

  const familyCounts = useMemo(() => {
    const c = new Map<string, number>()
    for (const r of recipes) c.set(r.family, (c.get(r.family) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1])
  }, [recipes])

  return (
    <div className="view">
      <div className="main-panel immersive">
        <div className="controls-bar">
          <label className="ctl">
            Projection
            <span className="seg">
              {(['pca', 'umap'] as const).map((m) => (
                <button
                  key={m}
                  className={method === m ? 'active' : ''}
                  disabled={m === 'umap' && !hasUmap}
                  title={m === 'umap' && !hasUmap ? 'UMAP not precomputed for this build' : undefined}
                  onClick={() => setMethod(m)}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </span>
          </label>
          <label className="ctl">
            Color by
            <span className="seg">
              {(
                [
                  ['family', 'Family'],
                  ['srm', 'Beer color'],
                  ['abv', 'Strength'],
                ] as [ColorMode, string][]
              ).map(([key, lbl]) => (
                <button key={key} className={colorMode === key ? 'active' : ''} onClick={() => setColorMode(key)}>
                  {lbl}
                </button>
              ))}
            </span>
          </label>
          <label className="ctl" title="What drives the layout — precomputed at three levels">
            Vitals ⇄ ingredients
            <input
              type="range"
              min={0}
              max={1}
              step={0.5}
              value={blend}
              onChange={(e) => setBlend(Number(e.target.value))}
            />
            <span className="val">{blend === 0 ? 'vitals' : blend === 1 ? 'ingredients' : 'balanced'}</span>
          </label>
          {apiLive && projectedTotal != null && projectedTotal > 8000 && (
            <label className="ctl">
              Points
              <span className="seg">
                <button className={!allPoints ? 'active' : ''} onClick={() => setAllPoints(false)}>
                  8k sample
                </button>
                <button className={allPoints ? 'active' : ''} onClick={() => setAllPoints(true)}>
                  All {projectedTotal.toLocaleString()}
                </button>
              </span>
            </label>
          )}
          <span className="ctl" style={{ color: 'var(--muted)', fontSize: 12 }}>
            {loading
              ? 'loading…'
              : projectedTotal != null && projectedTotal > recipes.length
                ? `${recipes.length.toLocaleString()} of ${projectedTotal.toLocaleString()} recipes (stable random sample)`
                : `${recipes.length.toLocaleString()} recipes`}
          </span>
        </div>
        <div className="canvas-wrap">
          <div className="cardtools">
            <ChartHelp title="Reading the recipe space">
              <p>
                Every recipe with full vital statistics becomes a point in a feature space
                built from its <strong>vitals</strong> (OG, FG, ABV, IBU, color, attenuation,
                BU:GU) and its <strong>ingredients</strong> (the fraction of the grain bill in
                each malt class, and which of the common hop varieties it uses). That
                high-dimensional space is reduced to the three axes you see.
              </p>
              <h3>The blend slider</h3>
              <p>
                <strong>Vitals ⇄ ingredients</strong> tilts what drives the layout. Toward
                vitals, recipes sort by strength, bitterness, and color; toward ingredients,
                they cluster by grain bill and hop selection — so a Citra-and-oats hazy IPA
                lands near its cousins even if the numbers differ.
              </p>
              <h3>Interactions</h3>
              <p>
                Drag to orbit, scroll to zoom, hover for a recipe's vitals, click a point for
                its full grain bill and hop schedule. Recolor by family, actual beer color
                (SRM), or strength to surface different patterns.
              </p>
            </ChartHelp>
          </div>
          <Canvas dpr={[1, 2]} camera={{ fov: 42, near: 0.01, far: 50 }} onPointerMissed={() => setSelected(-1)}>
            <color attach="background" args={['#0d0d0d']} />
            <ambientLight intensity={0.9} />
            <directionalLight position={[4, 6, 3]} intensity={1.05} />
            <directionalLight position={[-4, -2, -3]} intensity={0.35} />
            <CameraRig />
            <RecipePoints
              points={points}
              colors={colors}
              onHover={setHover}
              onSelect={setSelected}
              selectedIndex={selected}
            />
            <OrbitControls enableDamping dampingFactor={0.12} makeDefault />
          </Canvas>
          {(loading || error || (apiEnabled && !apiLive)) && (
            <div className="overlay-note" style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(0,0,0,0.6)', padding: '6px 10px', borderRadius: 6, fontSize: 13, color: error ? '#ff9b9b' : 'var(--muted)' }}>
              {error
                ? `Couldn't load recipes: ${error}`
                : loading
                  ? 'Loading recipe space…'
                  : 'Live recipe API unreachable — showing the bundled snapshot'}
            </div>
          )}
          {hover && hovered && (
            <div className="tooltip3d" style={{ left: hover.x, top: hover.y }}>
              <div className="t-name">{hovered.name}</div>
              <div className="t-sub">
                {hovered.styleGuess ? `${hovered.styleGuess.code} ${hovered.styleGuess.name}` : hovered.family}
              </div>
              <div className="t-stats">
                {(hovered.vitals.abv ?? 0).toFixed(1)}% ABV · {Math.round(hovered.vitals.ibu ?? 0)} IBU ·{' '}
                {(hovered.vitals.srm ?? 0).toFixed(0)} SRM
              </div>
            </div>
          )}
          <div className="legend">
            {colorMode === 'family' ? (
              <>
                {familyCounts.slice(0, 8).map(([f, cnt]) => (
                  <div className="row" key={f}>
                    <span className="dot" style={{ background: familyColor(f) }} />
                    <span>
                      <strong style={{ color: 'var(--ink)' }}>{f}</strong> · {cnt}
                    </span>
                  </div>
                ))}
              </>
            ) : colorMode === 'srm' ? (
              <div className="row">
                <span
                  className="dot"
                  style={{ background: `linear-gradient(90deg, ${srmToHex(3)}, ${srmToHex(35)})`, width: 34, borderRadius: 4 }}
                />
                <span>Point color = actual beer color (SRM)</span>
              </div>
            ) : (
              <div className="row">
                <span
                  className="dot"
                  style={{
                    background: `linear-gradient(90deg, ${abvColor(abvRange[0], abvRange[0], abvRange[1])}, ${abvColor(abvRange[1], abvRange[0], abvRange[1])})`,
                    width: 34,
                    borderRadius: 4,
                  }}
                />
                <span>
                  Strength {abvRange[0].toFixed(1)}–{abvRange[1].toFixed(1)}% ABV
                </span>
              </div>
            )}
            <div className="note">
              {method === 'pca' && data?.explained
                ? `PCA: axes capture ${Math.round(
                    (data.explained[0] + data.explained[1] + data.explained[2]) * 100,
                  )}% of variance across ${recipes.length} recipes`
                : method === 'pca'
                  ? `PCA layout of ${recipes.length} recipes`
                  : `UMAP layout of ${recipes.length} recipes — proximity is meaningful, axes are not`}
            </div>
          </div>
        </div>
      </div>
      <SidePanel>
        {detail ? (
          <RecipeDetail recipe={detail} />
        ) : (
          <div className="detail">
            <h2>The recipe space</h2>
            <p>
              {recipes.length.toLocaleString()} recipes projected from their vitals and
              ingredients into three dimensions. Points that land near each other are built
              alike — similar strength and color, or similar grain bills and hop selections,
              depending on the blend slider.
            </p>
            <p>
              <strong>Drag</strong> to orbit, <strong>scroll</strong> to zoom,{' '}
              <strong>hover</strong> for a recipe's vitals, <strong>click</strong> a point for
              its full grain bill and hop schedule.
            </p>
            <p style={{ color: 'var(--muted)' }}>
              Recolor by family, actual beer color, or strength to surface different patterns.
            </p>
          </div>
        )}
      </SidePanel>
    </div>
  )
}
