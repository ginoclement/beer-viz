import { useEffect, useMemo, useRef, useState } from 'react'
import { useAnalysis } from '../state/useAnalysis'
import { combinedSimilarityMatrix } from '../lib/similarity'
import { hclustTree, type DendroNode } from '../lib/hclust'
import { clusterColor } from '../lib/palette'
import StyleDetail from '../components/StyleDetail'
import ChartHelp from '../components/ChartHelp'
import type { BeerStyle } from '../lib/types'

/** Sequential blue ramp (light -> dark reversed for dark surface: low sim recedes). */
function simColor(v: number): string {
  // interpolate from near-surface to bright blue
  const t = Math.min(Math.max(v, 0), 1)
  const from = [26, 26, 25] // #1a1a19
  const to = [57, 135, 229] // #3987e5
  const g = (i: number) => Math.round(from[i] + (to[i] - from[i]) * t ** 1.35)
  return `rgb(${g(0)},${g(1)},${g(2)})`
}

function Dendrogram({
  tree,
  styles,
  clusterOf,
  onPick,
  selectedId,
}: {
  tree: DendroNode
  styles: BeerStyle[]
  clusterOf: number[]
  onPick: (id: string) => void
  selectedId: string | null
}) {
  const rowH = 16
  const plotW = 420
  const labelW = 300
  const leaves = tree.leaves
  const height = leaves.length * rowH + 8
  const maxH = tree.height || 1
  const x = (h: number) => 8 + (1 - h / maxH) * plotW
  const yOfLeaf = new Map(leaves.map((leaf, i) => [leaf, i * rowH + rowH / 2]))

  const paths: string[] = []
  const layout = (node: DendroNode): { x: number; y: number } => {
    if (node.leaf >= 0) return { x: x(0), y: yOfLeaf.get(node.leaf)! }
    const l = layout(node.left!)
    const r = layout(node.right!)
    const px = x(node.height)
    paths.push(`M ${l.x} ${l.y} H ${px} V ${r.y} H ${r.x}`)
    return { x: px, y: (l.y + r.y) / 2 }
  }
  layout(tree)

  return (
    <svg width={plotW + labelW + 20} height={height} role="img" aria-label="Hierarchical clustering dendrogram">
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--baseline)" strokeWidth={1} />
      ))}
      {leaves.map((leaf, i) => {
        const s = styles[leaf]
        const y = i * rowH + rowH / 2
        const active = s.id === selectedId
        return (
          <g key={s.id} style={{ cursor: 'pointer' }} onClick={() => onPick(s.id)}>
            <rect
              x={plotW + 10}
              y={y - rowH / 2 + 1}
              width={labelW}
              height={rowH - 2}
              fill={active ? 'var(--surface-2)' : 'transparent'}
            />
            <circle cx={plotW + 16} cy={y} r={4} fill={clusterColor(clusterOf[leaf] ?? 0)} />
            <text
              x={plotW + 26}
              y={y + 4}
              fontSize={11.5}
              fill={active ? 'var(--ink)' : 'var(--ink-2)'}
            >
              {s.categoryId ? `${s.id} ` : ''}
              {s.name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export type MatrixPage = 'matrix' | 'tree'

export default function MatrixView({ page = 'matrix', goToSpace }: { page?: MatrixPage; goToSpace?: () => void }) {
  const { styles, numericZ, clusterOf, alpha, setAlpha, setSelectedId, allStyles, selectedId } =
    useAnalysis()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<{ i: number; j: number; x: number; y: number } | null>(null)

  const matrix = useMemo(
    () => combinedSimilarityMatrix(numericZ, styles.map((s) => s.tags), alpha),
    [numericZ, styles, alpha],
  )

  const tree = useMemo(() => {
    const dist = matrix.map((row) => row.map((v) => 1 - v))
    return hclustTree(dist)
  }, [matrix])
  const order = useMemo(() => tree?.leaves ?? [], [tree])

  const n = styles.length
  const cell = Math.max(6, Math.floor(760 / Math.max(n, 1)))
  const strip = 8
  const size = n * cell + strip + 2

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)

    for (let a = 0; a < n; a++) {
      const ia = order[a]
      // cluster strips
      ctx.fillStyle = clusterColor(clusterOf[ia] ?? 0)
      ctx.fillRect(0, strip + 2 + a * cell, strip - 2, cell - 0.5)
      ctx.fillRect(strip + 2 + a * cell, 0, cell - 0.5, strip - 2)
      for (let b = 0; b < n; b++) {
        const ib = order[b]
        ctx.fillStyle = simColor(matrix[ia][ib])
        ctx.fillRect(strip + 2 + b * cell, strip + 2 + a * cell, cell - 0.5, cell - 0.5)
      }
    }
  }, [matrix, order, clusterOf, n, cell, size])

  const cellAt = (ev: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = ev.clientX - rect.left - strip - 2
    const y = ev.clientY - rect.top - strip - 2
    const b = Math.floor(x / cell)
    const a = Math.floor(y / cell)
    if (a < 0 || b < 0 || a >= n || b >= n) return null
    return { i: order[a], j: order[b], x: ev.clientX - rect.left, y: ev.clientY - rect.top }
  }

  const selected = allStyles.find((s) => s.id === selectedId)

  return (
    <div className="view">
      <div className="main-panel">
        <div className="controls-bar">
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
          <span style={{ color: 'var(--muted)' }}>
            {n} × {n} pairwise similarities, rows ordered by average-linkage hierarchical
            clustering — bright blocks are families of near-identical styles.
          </span>
        </div>
        <div className="charts" style={{ position: 'relative' }}>
          {page === 'matrix' && (
          <div className="chart-card" style={{ display: 'inline-block' }}>
            <div className="cardtools">
              <ChartHelp title="Reading the similarity matrix">
                <p>
                  A grid of every style against every other style. Cell brightness is
                  their blended similarity: Jaccard overlap of guideline tags mixed with
                  closeness of seven z-scored vitals (OG, FG, ABV, IBU, log SRM,
                  attenuation, BU:GU) — the slider above sets the mix.
                </p>
                <h3>How to read it</h3>
                <ul>
                  <li>The diagonal is every style at 100% with itself.</li>
                  <li>
                    Rows and columns are ordered by hierarchical clustering, so{' '}
                    <strong>bright square blocks along the diagonal are families</strong> —
                    bitters, bocks, IPAs — discovered without being told what a family is.
                  </li>
                  <li>
                    The colored strips on the edges show each style's k-means cluster; a
                    clean block whose strip is one color means the two methods agree.
                  </li>
                </ul>
                <h3>Interactions</h3>
                <p>Hover any cell for the pair's score; click to open the row's style.</p>
              </ChartHelp>
            </div>
            <h2>Style similarity matrix</h2>
            <p className="sub">
              Cell brightness = blended Jaccard + vital-statistics similarity. Edge strips
              show each style's k-means cluster. Hover any cell; click to open the row
              style.
            </p>
            <div style={{ position: 'relative' }}>
              <canvas
                ref={canvasRef}
                onMouseMove={(e) => setHover(cellAt(e))}
                onMouseLeave={() => setHover(null)}
                onClick={(e) => {
                  const c = cellAt(e)
                  if (c) setSelectedId(styles[c.i].id)
                }}
                style={{ cursor: 'crosshair' }}
              />
              {hover && (
                <div className="tooltip3d" style={{ left: hover.x, top: hover.y }}>
                  <div className="t-name">
                    {styles[hover.i].name} × {styles[hover.j].name}
                  </div>
                  <div className="t-stats">
                    similarity {(matrix[hover.i][hover.j] * 100).toFixed(0)}%
                  </div>
                </div>
              )}
            </div>
            <p className="sub" style={{ marginTop: 10 }}>
              <span
                className="srmdot"
                style={{ background: `linear-gradient(90deg, ${simColor(0)}, ${simColor(1)})`, width: 46, borderRadius: 4, border: '1px solid var(--border)' }}
              />{' '}
              0% → 100% similar
            </p>
          </div>
          )}
          {page === 'tree' && tree && (
            <div className="chart-card" style={{ display: 'inline-block', verticalAlign: 'top' }}>
              <div className="cardtools">
                <ChartHelp title="Reading the family tree">
                  <p>
                    The same hierarchical clustering as the matrix, drawn as a dendrogram.
                    Each style starts as its own branch; the algorithm repeatedly merges
                    the two most-similar groups until one tree remains.
                  </p>
                  <h3>How to read it</h3>
                  <ul>
                    <li>
                      <strong>Where branches join matters</strong>: styles that merge far
                      to the right are near-twins; a branch that stays alone until far
                      left has no close relative in the guideline.
                    </li>
                    <li>The dot color is the style's k-means cluster.</li>
                  </ul>
                  <h3>Interactions</h3>
                  <p>
                    Click a style name to open it. Move the tags ⇄ numbers blend to watch
                    the tree reorganize around tradition versus raw numbers.
                  </p>
                </ChartHelp>
              </div>
              <h2>Family tree</h2>
              <p className="sub">
                The same clustering as a dendrogram: styles that merge early (far right) are
                near-twins; long branches are loners. Dot = k-means cluster; click a style
                to open it.
              </p>
              <div className="chart-scroll" style={{ maxHeight: 760, overflowY: 'auto' }}>
                <Dendrogram
                  tree={tree}
                  styles={styles}
                  clusterOf={clusterOf}
                  onPick={setSelectedId}
                  selectedId={selectedId}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      <aside className="sidebar">
        {selected ? (
          <StyleDetail style={selected} onClose={() => setSelectedId(null)} onViewIn3d={goToSpace} />
        ) : (
          <div className="detail">
            <h2>Reading the matrix</h2>
            <p>
              The diagonal is every style at 100% similarity with itself. Bright square
              blocks along the diagonal are families — bitters, bocks, IPAs — that the
              hierarchical ordering has pulled together without being told what a family
              is.
            </p>
            <p>
              Slide the blend toward <em>tags</em> to see the guideline's own taxonomy;
              slide toward <em>numbers</em> to see which styles are numerically
              interchangeable even when their traditions differ.
            </p>
          </div>
        )}
      </aside>
    </div>
  )
}
