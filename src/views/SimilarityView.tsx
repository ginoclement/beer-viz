import { useEffect, useMemo, useRef, useState } from 'react'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
  type ForceLink,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force'
import { useAnalysis } from '../state/useAnalysis'
import { combinedSimilarityMatrix, jaccard, neighborsOf } from '../lib/similarity'
import { descriptorSimilarity } from '../lib/descriptors'
import { clusterColor } from '../lib/palette'
import { attachPanZoom, identityView, fitViewToPoints } from '../lib/panZoom'
import StyleDetail from '../components/StyleDetail'
import ChartHelp from '../components/ChartHelp'

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
  const graphRef = useRef<{ sim: Simulation<Node, Link>; links: Link[]; draw: () => void } | null>(
    null,
  )
  // Selection and cluster colors are read through refs so a click or a k
  // change repaints the canvas without rebuilding the force layout.
  const selectedRef = useRef(selectedId)
  const clustersRef = useRef(clusterOf)
  const viewRef = useRef(identityView())
  const interactedRef = useRef(false)
  const draggedRef = useRef<() => boolean>(() => false)

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

  // Build the simulation once per style set. Threshold/blend changes swap
  // links in place and selection changes only repaint, so the layout the
  // user is looking at never regenerates under a click.
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const nodes: Node[] = styles.map((_, i) => ({ i, index: i }))
    nodesRef.current = nodes

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
        forceLink<Node, Link>([])
          .distance((l) => 30 + (1 - l.w) * 160)
          .strength((l) => 0.2 + l.w * 0.6),
      )
      .force('charge', forceManyBody().strength(-42))
      .force('center', forceCenter(0, 0))
      // weak pull toward the middle keeps loose components from flying away
      .force('x', forceX(0).strength(0.045))
      .force('y', forceY(0).strength(0.045))
      .force('collide', forceCollide(9))

    const ctx = canvas.getContext('2d')!
    const draw = () => {
      const view = viewRef.current
      ctx.setTransform(dpr, 0, 0, dpr, (width / 2) * dpr, (height / 2) * dpr)
      ctx.clearRect(-width / 2, -height / 2, width, height)
      ctx.translate(view.tx, view.ty)
      ctx.scale(view.k, view.k)
      ctx.lineWidth = 1 / view.k
      for (const l of graphRef.current?.links ?? []) {
        const s = l.source as Node
        const t = l.target as Node
        ctx.strokeStyle = `rgba(137,135,129,${(0.12 + l.w * 0.45).toFixed(2)})`
        ctx.beginPath()
        ctx.moveTo(s.x!, s.y!)
        ctx.lineTo(t.x!, t.y!)
        ctx.stroke()
      }
      for (const n of nodes) {
        const isSel = styles[n.i].id === selectedRef.current
        ctx.beginPath()
        ctx.arc(n.x!, n.y!, isSel ? 8 : 5.5, 0, Math.PI * 2)
        ctx.fillStyle = clusterColor(clustersRef.current[n.i] ?? 0)
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
      // zoomed in far enough, name every node (constant screen-size text)
      if (view.k >= 1.8) {
        ctx.font = `600 ${11.5 / view.k}px system-ui, sans-serif`
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#e8e6df'
        ctx.shadowColor = '#0d0d0d'
        ctx.shadowBlur = 3 / view.k
        for (const n of nodes) ctx.fillText(styles[n.i].name, n.x! + 9, n.y!)
        ctx.shadowBlur = 0
      }
    }
    graphRef.current = { sim, links: [], draw }

    // keep the whole layout in frame while it settles; stop the moment the
    // user zooms or pans, and let double-click hand control back to auto-fit
    const fit = () => fitViewToPoints(viewRef.current, nodes, width, height)
    sim.on('tick', () => {
      if (!interactedRef.current) fit()
      draw()
    })

    const pz = attachPanZoom(canvas, {
      view: viewRef.current,
      toCenter: (e) => {
        const rect = canvas.getBoundingClientRect()
        return [e.clientX - rect.left - width / 2, e.clientY - rect.top - height / 2]
      },
      onChange: () => {
        interactedRef.current = true
        draw()
      },
      onReset: () => {
        interactedRef.current = false
        fit()
        draw()
      },
    })
    draggedRef.current = pz.dragged

    const ro = new ResizeObserver(() => {
      sizeCanvas()
      draw()
    })
    ro.observe(wrap)

    return () => {
      sim.stop()
      ro.disconnect()
      pz.cleanup()
      graphRef.current = null
    }
  }, [styles])

  // Swap the link set in place and gently reheat: node positions survive
  // threshold/blend changes instead of the graph re-laying-out from scratch.
  useEffect(() => {
    const g = graphRef.current
    if (!g) return
    g.links = links.map((l) => ({ ...l }))
    ;(g.sim.force('link') as ForceLink<Node, Link>).links(g.links)
    g.sim.alpha(0.5).restart()
  }, [links])

  // Selection and cluster recoloring: repaint only.
  useEffect(() => {
    selectedRef.current = selectedId
    clustersRef.current = clusterOf
    graphRef.current?.draw()
  }, [selectedId, clusterOf])

  const nodeAt = (ev: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const { k, tx, ty } = viewRef.current
    const x = (ev.clientX - rect.left - rect.width / 2 - tx) / k
    const y = (ev.clientY - rect.top - rect.height / 2 - ty) / k
    let best = -1
    let bestD = (12 / k) ** 2
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
      <div className="cardtools">
        <ChartHelp title="Reading the similarity network">
          <p>
            Every node is a beer style with published vital statistics; its color is the
            k-means cluster it falls into (the same families as the 3D space). A line joins
            two styles whenever their <strong>blended similarity</strong> is above the
            threshold slider.
          </p>
          <h3>How similarity is computed</h3>
          <ul>
            <li>
              <strong>Tags</strong>: Jaccard overlap of the guideline's tags (hoppy, roasty,
              pale-color…).
            </li>
            <li>
              <strong>Numbers</strong>: closeness of seven z-scored vitals — OG, FG, ABV,
              IBU, log SRM, apparent attenuation, and BU:GU balance.
            </li>
            <li>
              The <strong>Tags ⇄ numbers blend</strong> slider mixes the two (0 = numbers
              only, 1 = tags only).
            </li>
          </ul>
          <h3>How to read the layout</h3>
          <p>
            The force layout pulls linked styles together, so tight clumps are families of
            near-interchangeable styles and isolated nodes have no close relative above the
            threshold. Only <em>connectivity</em> is meaningful — the absolute position and
            rotation of the picture are arbitrary.
          </p>
          <h3>Interactions</h3>
          <p>
            Click a node to inspect it and re-rank its neighbors in the table. Scroll to
            zoom (style names appear), drag to pan, double-click to reset. Lower the
            threshold to reveal weaker relationships; raise it to keep only near-twins.
          </p>
        </ChartHelp>
      </div>
      <canvas
        ref={canvasRef}
        onMouseMove={(e) => {
          const i = nodeAt(e)
          const rect = canvasRef.current!.getBoundingClientRect()
          setHover(i >= 0 ? { i, x: e.clientX - rect.left, y: e.clientY - rect.top } : null)
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          if (draggedRef.current()) return
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
        <div className="note">
          Click a node to inspect and re-rank neighbors. Scroll to zoom (names appear),
          drag to pan, double-click to reset.
        </div>
      </div>
    </div>
  )
}

export default function SimilarityView({ goToSpace }: { goToSpace?: () => void }) {
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
        <StyleDetail style={focus} sharedTags={sharedWith} onViewIn3d={goToSpace} />
      </aside>
    </div>
  )
}
