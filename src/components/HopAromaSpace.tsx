import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import { HOPS, hopAromaVector, type Hop } from '../lib/hops'
import { fitPca, pcaTransformAll } from '../lib/pca'
import ChartHelp from './ChartHelp'

/**
 * The hop aroma map in 3D: every variety with a published sensory profile
 * becomes a point at its 3-component PCA position, colored by brewing
 * purpose, with producer-listed substitute relationships drawn as gold
 * edges. Orbit to look around a cluster instead of squinting at a 2D
 * projection of it.
 */

const PURPOSE_COLORS: Record<string, string> = {
  Aroma: '#3987e5',
  Bittering: '#d95926',
  'Dual Purpose': '#c98500',
}
const purposeColor = (p: string) => PURPOSE_COLORS[p] ?? '#3987e5'

interface Pt {
  hop: Hop
  pos: [number, number, number]
}

function useAromaPoints(): { pts: Pt[]; variance: number } {
  return useMemo(() => {
    const withVec = HOPS.map((h) => ({ h, v: hopAromaVector(h) })).filter(
      (x): x is { h: Hop; v: number[] } => x.v !== null && x.h.aromas !== null,
    )
    const model = fitPca(withVec.map((x) => x.v), 3)
    const proj = pcaTransformAll(model, withVec.map((x) => x.v))
    // uniform scale into a ~unit cube so camera distances are predictable
    let maxAbs = 0
    for (const p of proj) for (const c of p) maxAbs = Math.max(maxAbs, Math.abs(c))
    const s = maxAbs > 0 ? 1.15 / maxAbs : 1
    const pts = withVec.map((x, i) => ({
      hop: x.h,
      pos: [proj[i][0] * s, proj[i][1] * s, proj[i][2] * s] as [number, number, number],
    }))
    const variance = model.explainedVariance.slice(0, 3).reduce((a, b) => a + b, 0)
    return { pts, variance }
  }, [])
}

interface Hover {
  index: number
  x: number
  y: number
}

function HopPoints({
  pts,
  selectedKey,
  onHover,
  onPick,
}: {
  pts: Pt[]
  selectedKey: string | null
  onHover: (h: Hover | null) => void
  onPick: (key: string) => void
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const n = pts.length

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    for (let i = 0; i < n; i++) {
      m.makeTranslation(...pts[i].pos)
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, new THREE.Color(purposeColor(pts[i].hop.purpose)))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [pts, n])

  const selected = pts.findIndex((p) => p.hop.key === selectedKey)

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
          if (e.instanceId !== undefined) onPick(pts[e.instanceId].hop.key)
        }}
      >
        <sphereGeometry args={[0.028, 18, 18]} />
        <meshStandardMaterial roughness={0.45} metalness={0.1} />
      </instancedMesh>
      {selected >= 0 && (
        <group position={pts[selected].pos}>
          <mesh>
            <sphereGeometry args={[0.04, 24, 24]} />
            <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.8} />
          </mesh>
          <Html
            position={[0, 0.06, 0]}
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
            {pts[selected].hop.name}
          </Html>
        </group>
      )}
    </group>
  )
}

/** Producer-listed "brews well with / substitute" pairs as gold edges. */
function SubstituteEdges({ pts }: { pts: Pt[] }) {
  const geometry = useMemo(() => {
    const idx = new Map(pts.map((p, i) => [p.hop.name.toLowerCase(), i]))
    const seen = new Set<string>()
    const segs: number[] = []
    pts.forEach((p, i) => {
      for (const s of p.hop.substitutes) {
        const j = idx.get(s.toLowerCase())
        if (j == null || j === i) continue
        const id = [i, j].sort((a, b) => a - b).join('-')
        if (seen.has(id)) continue
        seen.add(id)
        segs.push(...pts[i].pos, ...pts[j].pos)
      }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs), 3))
    return g
  }, [pts])

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#c98500" transparent opacity={0.3} />
    </lineSegments>
  )
}

function CameraRig() {
  const { camera } = useThree()
  useEffect(() => {
    camera.position.set(1.7, 1.2, 1.7)
    camera.lookAt(0, 0, 0)
  }, [camera])
  return null
}

export default function HopAromaSpace({
  selectedKey,
  onPickHop,
}: {
  selectedKey: string | null
  onPickHop: (k: string) => void
}) {
  const { pts, variance } = useAromaPoints()
  const [hover, setHover] = useState<Hover | null>(null)
  const h = hover ? pts[hover.index] : null

  return (
    <div className="stage">
      <Canvas dpr={[1, 2]} camera={{ fov: 42, near: 0.01, far: 60 }} style={{ width: '100%', height: '100%' }}>
        <color attach="background" args={['#0d0d0d']} />
        <ambientLight intensity={0.85} />
        <directionalLight position={[4, 6, 3]} intensity={1.1} />
        <directionalLight position={[-4, -2, -3]} intensity={0.35} />
        <CameraRig />
        <SubstituteEdges pts={pts} />
        <HopPoints pts={pts} selectedKey={selectedKey} onHover={setHover} onPick={onPickHop} />
        <OrbitControls enableDamping dampingFactor={0.12} minDistance={0.2} maxDistance={15} makeDefault />
      </Canvas>
      <div className="stage-title">
        <h2>The hop aroma space, in 3D</h2>
        <div style={{ display: 'flex', gap: 14, margin: '4px 0 2px', flexWrap: 'wrap' }}>
          {Object.entries(PURPOSE_COLORS).map(([p, c]) => (
            <span key={p} style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--ink-2)', fontSize: 11.5 }}>
              <span className="srmdot" style={{ background: c, border: 'none', width: 9, height: 9 }} />
              {p}
            </span>
          ))}
        </div>
        <p className="sub">
          3-component PCA ({Math.round(variance * 100)}% of variance). Gold edges are
          producer-listed substitutes. Drag to orbit · scroll to zoom · click to inspect.
        </p>
      </div>
      <div className="cardtools">
        <ChartHelp title="Reading the 3D aroma space">
          <p>
            The same producer sensory data as the 2D aroma map — nine 0–5 aroma axes per
            variety — reduced to <strong>three</strong> principal components instead of
            two, so clusters that overlap in the flat projection separate in depth. These
            three axes capture {Math.round(variance * 100)}% of the total variance.
          </p>
          <h3>How to read it</h3>
          <ul>
            <li>Proximity = similar smell; color is the brewing purpose.</li>
            <li>
              <strong>Gold lines</strong> are producer-listed "brews well with /
              substitute" relationships. A gold line between distant points is a pairing
              chosen for contrast; substitutes cluster close.
            </li>
            <li>Axes are abstract blends of the nine aroma dimensions.</li>
          </ul>
          <h3>Interactions</h3>
          <p>
            Drag to orbit, scroll to zoom (no limits — pull all the way out), click a
            point to open the hop in the sidebar.
          </p>
        </ChartHelp>
      </div>
      {h && hover && (
        <div className="tooltip3d" style={{ left: hover.x, top: hover.y }}>
          <div className="t-name">{h.hop.name}</div>
          <div className="t-sub">
            {h.hop.country ?? ''} · {h.hop.purpose}
          </div>
          <div className="t-stats">{h.hop.notes.slice(0, 4).join(', ')}</div>
        </div>
      )}
    </div>
  )
}
