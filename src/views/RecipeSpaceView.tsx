import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { CORPUS, type CorpusRecipe } from '../lib/ingredients'
import projectionData from '../generated/recipeProjection.json'
import { srmToHex } from '../lib/srm'
import { GristBar, HopScheduleList } from '../components/IngredientBill'
import SidePanel from '../components/SidePanel'
import ChartHelp from '../components/ChartHelp'

type ColorMode = 'family' | 'srm' | 'abv'
type ProjMethod = 'pca' | 'umap'
type Coords = [number, number, number][]

// Coordinates are precomputed at build time (scripts/build-projection.mjs) for
// both methods and a few discrete "vitals ⇄ ingredients" blends, so the browser
// renders thousands of points instantly instead of running PCA/UMAP live.
const PROJ = projectionData as unknown as {
  ids: number[]
  pca: Record<string, Coords>
  umap: Record<string, Coords> | null
  explained: Record<string, number[]>
}
const BLENDS = [0, 0.5, 1]
const nearestBlend = (b: number) => BLENDS.reduce((p, c) => (Math.abs(c - b) < Math.abs(p - b) ? c : p), 0.5)

// Stable family → color map over the corpus, so the legend and points agree.
// There are ~15 families — more than the 8-step categorical palette — so we
// spread evenly around the hue wheel to give every family a distinct color.
const FAMILIES = [...new Set(CORPUS.map((r) => r.family))].sort()
const familyColor = (f: string) => {
  const i = Math.max(0, FAMILIES.indexOf(f))
  return `hsl(${Math.round((i / FAMILIES.length) * 360)}, 60%, 60%)`
}

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

// The recipe set is fixed (the full-vitals recipes the projection was built
// over), in the same order as every coordinate array.
const PROJ_RECIPES: CorpusRecipe[] = (() => {
  const byId = new Map(CORPUS.map((r) => [r.id, r]))
  return PROJ.ids.map((id) => byId.get(id)).filter((r): r is CorpusRecipe => !!r)
})()

export default function RecipeSpaceView() {
  const hasUmap = !!PROJ.umap
  const [method, setMethod] = useState<ProjMethod>('pca')
  const [colorMode, setColorMode] = useState<ColorMode>('family')
  const [blend, setBlend] = useState(0.5)
  const [hover, setHover] = useState<Hover | null>(null)
  const [selected, setSelected] = useState<number>(-1)

  // Coordinates are looked up from the precomputed projection — no PCA/UMAP in
  // the browser. The blend control snaps to the discrete precomputed levels.
  const blendKey = String(nearestBlend(blend))
  const recipes = PROJ_RECIPES
  const projection = useMemo(() => {
    const table = method === 'umap' && PROJ.umap ? PROJ.umap : PROJ.pca
    return {
      points: table[blendKey] ?? PROJ.pca[blendKey],
      explainedVariance: method === 'pca' ? PROJ.explained[blendKey] : undefined,
    }
  }, [method, blendKey])

  const abvRange = useMemo(() => {
    const vals = recipes.map((r) => r.vitals.abv ?? 0)
    return [Math.min(...vals), Math.max(...vals)] as [number, number]
  }, [recipes])

  const colors = useMemo(() => {
    return recipes.map((r) => {
      if (colorMode === 'srm') return new THREE.Color(srmToHex(r.vitals.srm ?? 4))
      if (colorMode === 'abv') return new THREE.Color(abvColor(r.vitals.abv ?? 0, abvRange[0], abvRange[1]))
      return new THREE.Color(familyColor(r.family))
    })
  }, [recipes, colorMode, abvRange])

  // clamp selection when the recipe set changes size
  useEffect(() => {
    if (selected >= recipes.length) setSelected(-1)
  }, [recipes.length, selected])

  const hovered = hover ? recipes[hover.index] : null
  const selectedRecipe = selected >= 0 ? recipes[selected] : null

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
          <span className="ctl" style={{ color: 'var(--muted)', fontSize: 12 }}>
            {recipes.length.toLocaleString()} recipes
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
                (SRM), or strength to surface different patterns. Built to scale to thousands
                of recipes once the crawl lands.
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
              points={projection.points}
              colors={colors}
              onHover={setHover}
              onSelect={setSelected}
              selectedIndex={selected}
            />
            <OrbitControls enableDamping dampingFactor={0.12} makeDefault />
          </Canvas>
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
              {method === 'pca' && projection.explainedVariance
                ? `PCA: axes capture ${Math.round(
                    (projection.explainedVariance[0] + projection.explainedVariance[1] + projection.explainedVariance[2]) * 100,
                  )}% of variance across ${recipes.length} recipes`
                : `UMAP layout of ${recipes.length} recipes — proximity is meaningful, axes are not`}
            </div>
          </div>
        </div>
      </div>
      <SidePanel>
        {selectedRecipe ? (
          <RecipeDetail recipe={selectedRecipe} />
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
              The layout is built to scale to thousands of recipes as the corpus grows.
            </p>
          </div>
        )}
      </SidePanel>
    </div>
  )
}
