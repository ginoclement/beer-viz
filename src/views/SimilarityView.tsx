import { useEffect, useMemo, useRef, useState } from 'react'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force'
import { useAnalysis } from '../state/useAnalysis'
import { combinedSimilarityMatrix, jaccard, neighborsOf } from '../lib/similarity'
import { descriptorSimilarity } from '../lib/descriptors'
import { clusterColor } from '../lib/palette'
import StyleDetail from '../components/StyleDetail'

interface Node extends SimulationNodeDatum {
  i: number
}
type Link = SimulationLinkDatum<Node> & { w: number }

function NetworkGraph({
  threshold,
  onPick,
}: {
  threshold: number
  onPick: (id: string) => void
}) {
  const { styles, numericZ, clusterOf, clusterNames, alpha, selectedId } = useAnalysis()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const nodesRef = useRef<Node[]>([])

  const matrix = useMemo(
    () => combinedSimilarityMatrix(numericZ, styles.map((s) => s.tags), alpha),
    [numericZ, styles, alpha],
  )

  const links = useMemo<Link[]>(() => {
    const out: Link[] = []
    for (let i = 0; i < styles.length; i++)
      for (let j = i + 1; j < styles.length; j++)
        if (matrix[i][j] >= threshold) out.push({ source: i, target: j, w: matrix[i][j] })
    return out
  }, [matrix, styles.length, threshold])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const nodes: Node[] = styles.map((_, i) => ({ i, index: i }))
    nodesRef.current = nodes
    const linkCopies: Link[] = links.map((l) => ({ ...l }))

    let width = wrap.clientWidth
    let height = wrap.clientHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const sizeCanvas = () => {
      width = wrap.clientWidth
      height = wrap.clientHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
    sizeCanvas()

    const sim = forceSimulation(nodes)
      .force(
        'link',
        forceLink<Node, Link>(linkCopies)
          .distance((l) => 30 + (1 - l.w) * 160)
          .strength((l) => 0.2 + l.w * 0.6),
      )
      .force('charge', forceManyBody().strength(-42))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide(9))

    const ctx = canvas.getContext('2d')!
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, (width / 2) * dpr, (height / 2) * dpr)
      ctx.clearRect(-width / 2, -height / 2, width, height)
      ctx.lineWidth = 1
      for (const l of linkCopies) {
        const s = l.source as Node
        const t = l.target as Node
        ctx.strokeStyle = `rgba(137,135,129,${(0.12 + l.w * 0.45).toFixed(2)})`
        ctx.beginPath()
        ctx.moveTo(s.x!, s.y!)
        ctx.lineTo(t.x!, t.y!)
        ctx.stroke()
      }
      for (const n of nodes) {
        const isSel = styles[n.i].id === selectedId
        ctx.beginPath()
        ctx.arc(n.x!, n.y!, isSel ? 8 : 5.5, 0, Math.PI * 2)
        ctx.fillStyle = clusterColor(clusterOf[n.i] ?? 0)
        ctx.fill()
        // 2px surface ring so overlapping nodes stay separable
        ctx.strokeStyle = '#0d0d0d'
        ctx.lineWidth = 2
        ctx.stroke()
        if (isSel) {
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
      }
    }

    sim.on('tick', draw)

    const ro = new ResizeObserver(() => {
      sizeCanvas()
      draw()
    })
    ro.observe(wrap)

    return () => {
      sim.stop()
      ro.disconnect()
    }
  }, [styles, links, clusterOf, selectedId])

  const nodeAt = (ev: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = ev.clientX - rect.left - rect.width / 2
    const y = ev.clientY - rect.top - rect.height / 2
    let best = -1
    let bestD = 12 * 12
    for (const n of nodesRef.current) {
      const d = (n.x! - x) ** 2 + (n.y! - y) ** 2
      if (d < bestD) {
        bestD = d
        best = n.i
      }
    }
    return best
  }

  return (
    <div className="netwrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onMouseMove={(e) => {
          const i = nodeAt(e)
          const rect = canvasRef.current!.getBoundingClientRect()
          setHover(i >= 0 ? { i, x: e.clientX - rect.left, y: e.clientY - rect.top } : null)
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const i = nodeAt(e)
          if (i >= 0) onPick(styles[i].id)
        }}
        style={{ cursor: hover ? 'pointer' : 'default' }}
      />
      {hover && (
        <div className="tooltip3d" style={{ left: hover.x, top: hover.y }}>
          <div className="t-name">{styles[hover.i].name}</div>
          <div className="t-sub">
            {styles[hover.i].category} · {clusterNames[clusterOf[hover.i] ?? 0] ?? ''}
          </div>
        </div>
      )}
      <div className="legend">
        <div className="row" style={{ color: 'var(--ink-2)' }}>
          Links join styles above the similarity threshold; node color = k-means cluster.
        </div>
        <div className="note">Click a node to inspect and re-rank neighbors.</div>
      </div>
    </div>
  )
}

export default function SimilarityView() {
  const {
    allStyles,
    styles,
    numericZ,
    alpha,
    setAlpha,
    selectedId,
    setSelectedId,
    descriptorsOf,
  } = useAnalysis()
  const [threshold, setThreshold] = useState(0.78)
  const [rankBy, setRankBy] = useState<'blend' | 'flavor'>('blend')

  const focus = allStyles.find((s) => s.id === selectedId) ?? styles[0]
  const focusStatsIndex = styles.findIndex((s) => s.id === focus?.id)
  const focusAllIndex = allStyles.findIndex((s) => s.id === focus?.id)

  const neighbors = useMemo(() => {
    if (!focus) return []
    if (rankBy === 'flavor') {
      // rank purely by the language of the guideline prose
      const fd = descriptorsOf[focusAllIndex] ?? []
      return allStyles
        .map((s, i) => ({ style: s, i }))
        .filter(({ style }) => style.id !== focus.id)
        .map(({ style, i }) => ({
          style,
          index: -1,
          jaccard: descriptorSimilarity(fd, descriptorsOf[i] ?? []),
          numericCloseness: 0,
          similarity: descriptorSimilarity(fd, descriptorsOf[i] ?? []),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 20)
    }
    if (focusStatsIndex >= 0) {
      return neighborsOf(
        focusStatsIndex,
        numericZ,
        styles.map((s) => s.tags),
        alpha,
        20,
      ).map((n) => ({ style: styles[n.index], ...n }))
    }
    // no vital statistics: rank by tag overlap alone
    return allStyles
      .filter((s) => s.id !== focus.id)
      .map((s) => ({
        style: s,
        index: -1,
        jaccard: jaccard(focus.tags, s.tags),
        numericCloseness: 0,
        similarity: jaccard(focus.tags, s.tags),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 20)
  }, [focus, focusStatsIndex, focusAllIndex, numericZ, styles, allStyles, alpha, rankBy, descriptorsOf])

  if (!focus) return null
  const sharedWith = new Set(focus.tags)

  return (
    <div className="view">
      <div className="main-panel">
        <div className="controls-bar">
          <label className="ctl">
            Focus style
            <select
              value={focus.id}
              onChange={(e) => setSelectedId(e.target.value)}
              style={{ maxWidth: 280 }}
            >
              {allStyles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.categoryId ? `${s.id} — ` : ''}
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ctl">
            Rank by
            <span className="seg">
              <button className={rankBy === 'blend' ? 'active' : ''} onClick={() => setRankBy('blend')}>
                Tags + numbers
              </button>
              <button
                className={rankBy === 'flavor' ? 'active' : ''}
                onClick={() => setRankBy('flavor')}
                title="Jaccard similarity of flavor descriptors mined from the guideline prose"
              >
                Flavor text
              </button>
            </span>
          </label>
          {rankBy === 'blend' && (
            <label className="ctl" title="0 = numbers only, 1 = tags only">
              Tags ⇄ numbers blend
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={alpha}
                onChange={(e) => setAlpha(Number(e.target.value))}
              />
              <span className="val">{alpha.toFixed(2)}</span>
            </label>
          )}
          <label className="ctl">
            Network threshold
            <input
              type="range"
              min={0.6}
              max={0.92}
              step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
            <span className="val">{threshold.toFixed(2)}</span>
          </label>
        </div>
        <div className="simgrid">
          <div className="simlist">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Style</th>
                  <th>Match</th>
                  <th style={{ minWidth: 120 }}>
                    {rankBy === 'flavor' ? 'Shared flavor language' : 'Tag / numeric parts'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {neighbors.map((n, i) => (
                  <tr key={n.style.id} className="rowbtn" onClick={() => setSelectedId(n.style.id)}>
                    <td style={{ color: 'var(--muted)' }}>{i + 1}</td>
                    <td>
                      {n.style.categoryId ? `${n.style.id} ` : ''}
                      {n.style.name}
                    </td>
                    <td>{Math.round(n.similarity * 100)}%</td>
                    <td>
                      <div
                        className="simbar jac"
                        style={{ width: `${Math.max(2, n.jaccard * 100)}px` }}
                        title={
                          rankBy === 'flavor'
                            ? `Descriptor overlap ${(n.jaccard * 100).toFixed(0)}%`
                            : `Jaccard tag similarity ${(n.jaccard * 100).toFixed(0)}%`
                        }
                      />
                      {rankBy === 'blend' && (
                        <div
                          className="simbar"
                          style={{ width: `${Math.max(2, n.numericCloseness * 100)}px`, marginTop: 2 }}
                          title={`Vital-statistics closeness ${(n.numericCloseness * 100).toFixed(0)}%`}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rankBy === 'flavor' ? (
              <p style={{ color: 'var(--muted)', fontSize: 12 }}>
                Ranked purely by shared flavor descriptors (caramel, clove, grapefruit, funky…)
                mined from each style's aroma/flavor/impression prose — no tags or numbers
                involved. See the "flavor fingerprint" in the sidebar.
              </p>
            ) : (
              <p style={{ color: 'var(--muted)', fontSize: 12 }}>
                <span className="srmdot" style={{ background: 'var(--accent)', border: 'none' }} />{' '}
                Jaccard similarity of guideline tags ·{' '}
                <span className="srmdot" style={{ background: 'var(--blue)', border: 'none' }} />{' '}
                closeness of z-scored vital statistics. Blend with the slider above.
              </p>
            )}
          </div>
          <NetworkGraph threshold={threshold} onPick={setSelectedId} />
        </div>
      </div>
      <aside className="sidebar">
        <StyleDetail style={focus} sharedTags={sharedWith} />
      </aside>
    </div>
  )
}
