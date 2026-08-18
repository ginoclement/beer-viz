import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Line, Html } from '@react-three/drei'
import * as THREE from 'three'
import { useAnalysis, type ColorBy } from '../state/useAnalysis'
import { clusterColor, MAX_K, RECIPE_COLOR } from '../lib/palette'
import { srmToHex } from '../lib/srm'
import { midVitals } from '../lib/features'
import { euclidean, jaccard } from '../lib/similarity'
import StyleDetail from '../components/StyleDetail'
import ChartHelp from '../components/ChartHelp'
import type { BeerStyle } from '../lib/types'

interface Hover {
  index: number
  x: number
  y: number
  kind: 'style' | 'recipe'
}

function StylePoints({
  onHover,
  onSelect,
}: {
  onHover: (h: Hover | null) => void
  onSelect: (id: string) => void
}) {
  const { styles, projection, clusterOf, colorBy, selectedId } = useAnalysis()
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const n = styles.length

  const colors = useMemo(() => {
    return styles.map((s, i) => {
      if (colorBy === 'srm') {
        const v = midVitals(s)
        return new THREE.Color(v ? srmToHex(v.srm) : '#888888')
      }
      return new THREE.Color(clusterColor(clusterOf[i] ?? 0))
    })
  }, [styles, clusterOf, colorBy])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    for (let i = 0; i < n; i++) {
      const p = projection.points[i]
      m.makeTranslation(p[0], p[1], p[2])
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, colors[i])
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [projection, colors, n])

  const selectedIndex = styles.findIndex((s) => s.id === selectedId)

  return (
    <group>
      <instancedMesh
        key={n}
        ref={meshRef}
        args={[undefined, undefined, n]}
        onPointerMove={(e) => {
          e.stopPropagation()
          if (e.instanceId === undefined) return
          onHover({
            index: e.instanceId,
            x: e.nativeEvent.offsetX,
            y: e.nativeEvent.offsetY,
            kind: 'style',
          })
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e) => {
          e.stopPropagation()
          if (e.instanceId !== undefined) onSelect(styles[e.instanceId].id)
        }}
      >
        <sphereGeometry args={[0.038, 20, 20]} />
        <meshStandardMaterial roughness={0.45} metalness={0.1} />
      </instancedMesh>
      {selectedIndex >= 0 && (
        <group position={projection.points[selectedIndex]}>
          <mesh>
            <sphereGeometry args={[0.045, 24, 24]} />
            <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.75} />
          </mesh>
          <Html
            position={[0, 0.07, 0]}
            center
            style={{
              color: '#fff',
              fontSize: 12,
              fontWeight: 650,
              whiteSpace: 'nowrap',
              textShadow: '0 1px 4px #000',
              pointerEvents: 'none',
            }}
          >
            {styles[selectedIndex].name}
          </Html>
        </group>
      )}
    </group>
  )
}

function RecipePoints({ onHover }: { onHover: (h: Hover | null) => void }) {
  const { recipePoints, styles, numericZ, numericTransform, alpha, projection } = useAnalysis()

  // faint tethers from each recipe to its top-3 matched styles
  const tethers = useMemo(() => {
    return recipePoints.map((rp) => {
      const rz = numericTransform(rp.recipe.vitals)
      const dists = numericZ.map((v) => euclidean(rz, v))
      const sorted = [...dists].sort((a, b) => a - b)
      const scale = sorted[Math.floor(sorted.length * 0.95)] || 1
      return styles
        .map((s, i) => ({
          i,
          sim:
            alpha * jaccard(rp.recipe.tags, s.tags) +
            (1 - alpha) * Math.max(0, 1 - dists[i] / scale),
        }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 3)
        .map((m) => ({ to: projection.points[m.i], sim: m.sim }))
    })
  }, [recipePoints, styles, numericZ, numericTransform, alpha, projection])

  return (
    <group>
      {recipePoints.map((rp, i) => (
        <group key={`t-${i}`}>
          {tethers[i]?.map((t, j) => (
            <Line
              key={j}
              points={[rp.position, t.to]}
              color="#ffffff"
              transparent
              opacity={0.22 + t.sim * 0.3}
              lineWidth={1.5}
              dashed
              dashScale={28}
            />
          ))}
        </group>
      ))}
      {recipePoints.map((rp, i) => (
        <group key={i} position={rp.position}>
          <mesh
            onPointerMove={(e) => {
              e.stopPropagation()
              onHover({ index: i, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, kind: 'recipe' })
            }}
            onPointerOut={() => onHover(null)}
          >
            <octahedronGeometry args={[0.05]} />
            <meshStandardMaterial
              color={RECIPE_COLOR}
              emissive={RECIPE_COLOR}
              emissiveIntensity={0.35}
              roughness={0.3}
            />
          </mesh>
          <Html
            position={[0, 0.085, 0]}
            center
            style={{
              color: '#fff',
              fontSize: 12,
              fontWeight: 650,
              whiteSpace: 'nowrap',
              textShadow: '0 1px 4px #000',
              pointerEvents: 'none',
            }}
          >
            ◆ {rp.recipe.name}
          </Html>
        </group>
      ))}
    </group>
  )
}

function Axes() {
  const { projection } = useAnalysis()
  const label = (i: number) =>
    projection.method === 'pca'
      ? `PC${i + 1}${
          projection.explainedVariance
            ? ` (${Math.round(projection.explainedVariance[i] * 100)}%)`
            : ''
        }`
      : `UMAP-${i + 1}`
  const axes: { dir: [number, number, number]; text: string }[] = [
    { dir: [1.25, 0, 0], text: label(0) },
    { dir: [0, 1.25, 0], text: label(1) },
    { dir: [0, 0, 1.25], text: label(2) },
  ]
  return (
    <group>
      {axes.map((a, i) => (
        <group key={i}>
          <Line
            points={[
              [-a.dir[0], -a.dir[1], -a.dir[2]],
              a.dir,
            ]}
            color="#383835"
            lineWidth={1}
          />
          <Html
            position={a.dir}
            center
            zIndexRange={[2, 0]}
            style={{ color: '#898781', fontSize: 11, whiteSpace: 'nowrap', pointerEvents: 'none' }}
          >
            {a.text}
          </Html>
        </group>
      ))}
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

function fmt(x: number, d = 0) {
  return x.toFixed(d)
}

function TooltipContent({ hover }: { hover: Hover }) {
  const { styles, clusterOf, clusterNames, recipePoints } = useAnalysis()
  if (hover.kind === 'recipe') {
    const rp = recipePoints[hover.index]
    if (!rp) return null
    const v = rp.recipe.vitals
    return (
      <>
        <div className="t-name">◆ {rp.recipe.name}</div>
        <div className="t-sub">Imported recipe</div>
        <div className="t-stats">
          {v.abv.toFixed(1)}% ABV · {fmt(v.ibu)} IBU · {fmt(v.srm)} SRM
        </div>
      </>
    )
  }
  const s: BeerStyle | undefined = styles[hover.index]
  if (!s) return null
  const v = midVitals(s)
  return (
    <>
      <div className="t-name">
        {s.categoryId ? `${s.id} ` : ''}
        {s.name}
      </div>
      <div className="t-sub">
        {s.category} · {clusterNames[clusterOf[hover.index] ?? 0] ?? 'cluster'}
      </div>
      {v && (
        <div className="t-stats">
          {v.abv.toFixed(1)}% ABV · {fmt(v.ibu)} IBU · {fmt(v.srm)} SRM
        </div>
      )}
    </>
  )
}

function SpaceLegend() {
  const { colorBy, clusterOf, clusterNames, k, styles, silhouetteScore, method, projection } =
    useAnalysis()
  const counts = useMemo(() => {
    const c = new Array(k).fill(0)
    clusterOf.forEach((l) => {
      if (l < k) c[l]++
    })
    return c
  }, [clusterOf, k])

  return (
    <div className="legend">
      {colorBy === 'cluster' ? (
        <>
          {counts.map((cnt, i) => (
            <div className="row" key={i}>
              <span className="dot" style={{ background: clusterColor(i) }} />
              <span>
                <strong style={{ color: 'var(--ink)' }}>{clusterNames[i] ?? `cluster ${i + 1}`}</strong>{' '}
                · {cnt}
              </span>
            </div>
          ))}
          <div className="note">
            k-means on vitals + tags · silhouette {silhouetteScore.toFixed(2)}
          </div>
        </>
      ) : (
        <>
          <div className="row">
            <span
              className="dot"
              style={{ background: `linear-gradient(90deg, ${srmToHex(3)}, ${srmToHex(35)})`, width: 34, borderRadius: 4 }}
            />
            <span>Point color = actual beer color (SRM)</span>
          </div>
        </>
      )}
      <div className="note">
        {method === 'pca' && projection.explainedVariance
          ? `PCA: axes capture ${Math.round(
              (projection.explainedVariance[0] +
                projection.explainedVariance[1] +
                projection.explainedVariance[2]) *
                100,
            )}% of variance across ${styles.length} styles`
          : `UMAP layout of ${styles.length} styles — proximity is meaningful, axes are not`}
      </div>
    </div>
  )
}

export default function SpaceView() {
  const {
    method,
    setMethod,
    colorBy,
    setColorBy,
    k,
    setK,
    tagWeight,
    setTagWeight,
    selectedId,
    setSelectedId,
    styles,
    allStyles,
  } = useAnalysis()
  const [hover, setHover] = useState<Hover | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const selected = allStyles.find((s) => s.id === selectedId) ?? null
  const onSelect = useCallback(
    (id: string) => setSelectedId(id === selectedId ? null : id),
    [selectedId, setSelectedId],
  )

  const excluded = allStyles.length - styles.length

  return (
    <div className="view">
      <div className="main-panel">
        <div className="controls-bar">
          <label className="ctl">
            Projection
            <span className="seg">
              {(['pca', 'umap'] as const).map((m) => (
                <button
                  key={m}
                  className={method === m ? 'active' : ''}
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
                  ['cluster', 'Cluster'],
                  ['srm', 'Beer color'],
                ] as [ColorBy, string][]
              ).map(([key, lbl]) => (
                <button
                  key={key}
                  className={colorBy === key ? 'active' : ''}
                  onClick={() => setColorBy(key)}
                >
                  {lbl}
                </button>
              ))}
            </span>
          </label>
          <label className="ctl">
            Clusters k
            <input
              type="range"
              min={2}
              max={MAX_K}
              value={k}
              onChange={(e) => setK(Number(e.target.value))}
            />
            <span className="val">{k}</span>
          </label>
          <label className="ctl" title="0 = vital statistics only, 1 = tags only">
            Tag weight
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={tagWeight}
              onChange={(e) => setTagWeight(Number(e.target.value))}
            />
            <span className="val">{tagWeight.toFixed(2)}</span>
          </label>
        </div>
        <div className="canvas-wrap" ref={wrapRef}>
          <div className="cardtools">
            <ChartHelp title="Reading the 3D style space">
              <p>
                Every style with full vital statistics becomes a point in a
                ~60-dimensional feature space: seven numeric features (OG, FG, ABV, IBU,
                log SRM, apparent attenuation, BU:GU balance, all z-scored) plus one
                column per guideline tag. That space is reduced to the three axes you see.
              </p>
              <h3>The two projections</h3>
              <ul>
                <li>
                  <strong>PCA</strong>: axes are the directions of greatest variance; the
                  percentages on the axis labels say how much of the total spread each one
                  captures. Distances are roughly faithful, and the axes mean something.
                </li>
                <li>
                  <strong>UMAP</strong>: a nonlinear layout that keeps neighbors together.
                  Local clumps are meaningful; axis directions and large-scale distances
                  are not.
                </li>
              </ul>
              <h3>Color</h3>
              <p>
                <strong>Cluster</strong> colors come from k-means run in the full feature
                space (not on the 3D picture), so a cluster can look stretched here.
                <strong> Beer color</strong> paints each point its actual SRM.
              </p>
              <h3>Interactions</h3>
              <p>
                Drag to orbit, scroll to zoom, click a point for its guideline entry.
                Moving <em>k</em> or the tag weight re-clusters live. Imported recipes
                appear as ◆ diamonds tethered to their three closest styles.
              </p>
            </ChartHelp>
          </div>
          <Canvas
            dpr={[1, 2]}
            camera={{ fov: 42, near: 0.01, far: 50 }}
            onPointerMissed={() => setSelectedId(null)}
          >
            <color attach="background" args={['#0d0d0d']} />
            <ambientLight intensity={0.85} />
            <directionalLight position={[4, 6, 3]} intensity={1.1} />
            <directionalLight position={[-4, -2, -3]} intensity={0.35} />
            <CameraRig />
            <Axes />
            <StylePoints onHover={setHover} onSelect={onSelect} />
            <RecipePoints onHover={setHover} />
            <OrbitControls enableDamping dampingFactor={0.12} makeDefault />
          </Canvas>
          {hover && (
            <div className="tooltip3d" style={{ left: hover.x, top: hover.y }}>
              <TooltipContent hover={hover} />
            </div>
          )}
          <SpaceLegend />
        </div>
      </div>
      <aside className="sidebar">
        {selected ? (
          <StyleDetail style={selected} onClose={() => setSelectedId(null)} />
        ) : (
          <div className="detail">
            <h2>Explore the style space</h2>
            <p>
              Every beer style with complete vital statistics becomes a point in a
              ~60-dimensional feature space: OG, FG, ABV, IBU, color (log SRM), apparent
              attenuation, BU:GU balance, plus its guideline tags. That space is reduced to
              three dimensions with PCA or UMAP — styles that land near each other really
              are similar beers.
            </p>
            <p>
              <strong>Drag</strong> to orbit, <strong>scroll</strong> to zoom,{' '}
              <strong>hover</strong> for a style's vitals, <strong>click</strong> a point for
              its full guideline entry.
            </p>
            <p>
              Colors are k-means clusters computed live — try moving <em>k</em> or the tag
              weight and watch families reorganize. Switch to <em>Beer color</em> to paint
              each point its actual SRM color.
            </p>
            {excluded > 0 && (
              <p style={{ color: 'var(--muted)' }}>
                {excluded} specialty styles without published vital statistics (e.g. Fruit
                Beer, Experimental Beer) are browsable in the Similarity tab but excluded
                from the quantitative space.
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}
