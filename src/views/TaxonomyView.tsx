import { useEffect, useMemo, useRef, useState } from 'react'
import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy'
import { useAnalysis } from '../state/useAnalysis'
import { srmToHex } from '../lib/srm'
import { SERIES } from '../lib/palette'
import { midVitals } from '../lib/features'
import { attachPanZoom, identityView } from '../lib/panZoom'
import StyleDetail from '../components/StyleDetail'
import ChartHelp from '../components/ChartHelp'
import type { BeerStyle } from '../lib/types'

/**
 * The whole beer world as one radial tree: Beer → fermentation family →
 * guideline category → style → commercial examples. Style nodes wear their
 * true SRM color; example leaves link out to a web search for the beer.
 */

type Kind = 'root' | 'family' | 'category' | 'style' | 'example'

interface TNode {
  name: string
  kind: Kind
  style?: BeerStyle
  children?: TNode[]
}

const FAMILY_COLORS: Record<string, string> = {
  Lager: SERIES[0],
  Ale: SERIES[1],
  'Wild & sour': SERIES[2],
  'Any yeast / specialty': '#898781',
}

/** Fermentation family from tags, with keyword fallback for untagged styles. */
function familyOf(s: BeerStyle): string {
  if (s.tags.includes('wild-fermented')) return 'Wild & sour'
  if (s.tags.includes('bottom-fermented')) return 'Lager'
  if (s.tags.includes('top-fermented')) return 'Ale'
  const text = `${s.name} ${s.category}`.toLowerCase()
  if (/sour|lambic|gueuze|brett|wild/.test(text)) return 'Wild & sour'
  if (/lager|pils|bock|helles|m[äa]rzen|schwarz|dunkel|kellerbier|zwickel/.test(text)) return 'Lager'
  if (/ale|ipa|stout|porter|bitter|saison|weiss|weizen|wit/.test(text)) return 'Ale'
  return 'Any yeast / specialty'
}

/**
 * Commercial examples parsed from the guideline prose. Sub-groupings like
 * "Dark Versions – X, Y; Pale Versions – Z" are flattened; overly long
 * fragments (stray prose) are dropped.
 */
function parseExamples(s: BeerStyle, limit = 6): string[] {
  if (!s.examples) return []
  return s.examples
    .split(/[,;]/)
    .map((e) => e.replace(/^[^–—]*[–—]\s*/, '').trim())
    .filter((e) => e.length > 2 && e.length < 55)
    .slice(0, limit)
}

const FAMILY_ORDER = ['Lager', 'Ale', 'Wild & sour', 'Any yeast / specialty']

function buildTree(styles: BeerStyle[], withExamples: boolean): TNode {
  const families = new Map<string, Map<string, TNode[]>>()
  for (const s of styles) {
    const fam = familyOf(s)
    if (!families.has(fam)) families.set(fam, new Map())
    const cats = families.get(fam)!
    if (!cats.has(s.category)) cats.set(s.category, [])
    const styleNode: TNode = { name: s.name, kind: 'style', style: s }
    if (withExamples) {
      const ex = parseExamples(s)
      if (ex.length) styleNode.children = ex.map((name) => ({ name, kind: 'example' as Kind, style: s }))
    }
    cats.get(s.category)!.push(styleNode)
  }
  return {
    name: 'Beer',
    kind: 'root',
    children: FAMILY_ORDER.filter((f) => families.has(f)).map((fam) => ({
      name: fam,
      kind: 'family',
      children: [...families.get(fam)!.entries()].map(([cat, styleNodes]) => ({
        name: cat,
        kind: 'category',
        children: styleNodes,
      })),
    })),
  }
}

export default function TaxonomyView({ goToSpace }: { goToSpace?: () => void }) {
  const { allStyles, guide, selectedId, setSelectedId } = useAnalysis()
  const [withExamples, setWithExamples] = useState(true)
  const [hover, setHover] = useState<{ text: string; sub: string; x: number; y: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [zoom, setZoom] = useState(identityView())

  const hasExamples = useMemo(() => allStyles.some((s) => s.examples), [allStyles])
  const showExamples = withExamples && hasExamples

  const { root, W, H } = useMemo(() => {
    const data = buildTree(allStyles, showExamples)
    const h = hierarchy<TNode>(data)
    const leaves = h.leaves().length
    // enough circumference that outer labels don't collide
    const R = Math.max(430, (leaves * (showExamples ? 12.5 : 15)) / (2 * Math.PI))
    const layout = tree<TNode>()
      .size([2 * Math.PI, 1])
      .separation((a, b) => ((a.parent === b.parent ? 1 : 1.6) / Math.max(a.depth, 1)))
    const root = layout(h)
    // fixed ring per level (tree() spreads depth evenly; rings read better)
    const rings = showExamples ? [0, 0.22, 0.46, 0.72, 1] : [0, 0.3, 0.62, 1]
    root.each((n) => {
      n.y = (rings[Math.min(n.depth, rings.length - 1)] ?? 1) * R
    })
    const pad = 230 // room for outer labels
    return { root, R, W: 2 * (R + pad), H: 2 * (R + pad) }
  }, [allStyles, showExamples])

  const pt = (n: HierarchyPointNode<TNode>): [number, number] => [
    W / 2 + n.y * Math.cos(n.x - Math.PI / 2),
    H / 2 + n.y * Math.sin(n.x - Math.PI / 2),
  ]

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const view = identityView()
    const upp = () => {
      const rect = svg.getBoundingClientRect()
      return Math.max(W / rect.width, H / rect.height)
    }
    const pz = attachPanZoom(svg as unknown as HTMLElement, {
      view,
      toCenter: (e) => {
        const rect = svg.getBoundingClientRect()
        const u = upp()
        return [(e.clientX - rect.left - rect.width / 2) * u, (e.clientY - rect.top - rect.height / 2) * u]
      },
      panScale: upp,
      onChange: () => setZoom({ ...view }),
      minK: 0.5,
      maxK: 20,
    })
    return pz.cleanup
  }, [W, H])

  const k = zoom.k
  const vb = {
    x: W / 2 - zoom.tx / k - W / (2 * k),
    y: H / 2 - zoom.ty / k - H / (2 * k),
    w: W / k,
    h: H / k,
  }

  const setTip = (e: React.MouseEvent, text: string, sub: string) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    setHover({ text, sub, x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  const selected = allStyles.find((s) => s.id === selectedId)

  const nodeDot = (n: HierarchyPointNode<TNode>) => {
    const [x, y] = pt(n)
    const d = n.data
    switch (d.kind) {
      case 'root':
        return <circle key="root" cx={x} cy={y} r={11} fill="var(--accent-bright)" stroke="#0d0d0d" strokeWidth={2} />
      case 'family':
        return (
          <circle key={d.name} cx={x} cy={y} r={7.5} fill={FAMILY_COLORS[d.name] ?? '#898781'} stroke="#0d0d0d" strokeWidth={2} />
        )
      case 'category':
        return (
          <circle
            key={`c-${d.name}`}
            cx={x}
            cy={y}
            r={4}
            fill="var(--surface-2)"
            stroke="var(--muted)"
            strokeWidth={1.2}
            onMouseEnter={(e) => setTip(e, d.name, `${n.children?.length ?? 0} styles`)}
            onMouseLeave={() => setHover(null)}
          />
        )
      case 'style': {
        const v = d.style ? midVitals(d.style) : null
        const sel = d.style?.id === selectedId
        return (
          <circle
            key={d.style!.id}
            cx={x}
            cy={y}
            r={sel ? 8 : 5.5}
            fill={v ? srmToHex(v.srm) : '#555550'}
            stroke={sel ? '#ffffff' : '#0d0d0d'}
            strokeWidth={sel ? 2 : 1.5}
            style={{ cursor: 'pointer' }}
            onMouseEnter={(e) =>
              setTip(e, d.style!.name, `${d.style!.category}${v ? ` · ${v.abv.toFixed(1)}% ABV · ${Math.round(v.srm)} SRM` : ''}`)
            }
            onMouseLeave={() => setHover(null)}
            onClick={() => setSelectedId(d.style!.id)}
          />
        )
      }
      case 'example':
        return (
          <circle
            key={`${d.style!.id}-${d.name}`}
            cx={x}
            cy={y}
            r={2.6}
            fill="var(--muted)"
            style={{ cursor: 'pointer' }}
            onMouseEnter={(e) => setTip(e, d.name, `${d.style!.name} — click to search the web`)}
            onMouseLeave={() => setHover(null)}
            onClick={() =>
              window.open(`https://www.google.com/search?q=${encodeURIComponent(`${d.name} beer`)}`, '_blank', 'noopener')
            }
          />
        )
    }
  }

  const nodeLabel = (n: HierarchyPointNode<TNode>) => {
    const d = n.data
    if (d.kind === 'root') {
      return (
        <text key="rootl" x={W / 2} y={H / 2 - 18} textAnchor="middle" fontSize={22} fontWeight={700} fill="var(--ink)">
          Beer
        </text>
      )
    }
    const [x, y] = pt(n)
    const deg = (n.x * 180) / Math.PI - 90
    const flip = deg > 90 || deg < -90
    const styleProps: Record<Kind, { size: number; fill: string; weight: number; gap: number }> = {
      root: { size: 22, fill: 'var(--ink)', weight: 700, gap: 0 },
      family: { size: 16, fill: FAMILY_COLORS[d.name] ?? 'var(--ink)', weight: 700, gap: 13 },
      category: { size: 10.5, fill: 'var(--ink-2)', weight: 600, gap: 8 },
      style: { size: 10, fill: 'var(--ink-2)', weight: 500, gap: 10 },
      example: { size: 8.5, fill: 'var(--muted)', weight: 400, gap: 6 },
    }
    // leaf labels point outward; internal labels sit along the spoke
    const isLeaf = !n.children || n.children.length === 0
    const p = styleProps[d.kind]
    const anchor = isLeaf ? (flip ? 'end' : 'start') : 'middle'
    const dx = isLeaf ? (flip ? -p.gap : p.gap) : 0
    const dy = isLeaf ? 0 : -p.gap
    const rotate = isLeaf ? `rotate(${flip ? deg + 180 : deg} ${x} ${y})` : undefined
    const clickable = d.kind === 'style' || d.kind === 'example'
    return (
      <text
        key={`l-${d.kind}-${d.name}-${n.x.toFixed(4)}`}
        x={x + dx}
        y={y + dy + p.size * 0.35}
        textAnchor={anchor}
        fontSize={p.size}
        fontWeight={p.weight}
        fill={d.style?.id === selectedId ? '#ffffff' : p.fill}
        transform={rotate}
        style={clickable ? { cursor: 'pointer' } : { pointerEvents: 'none' }}
        onClick={
          d.kind === 'style'
            ? () => setSelectedId(d.style!.id)
            : d.kind === 'example'
              ? () => window.open(`https://www.google.com/search?q=${encodeURIComponent(`${d.name} beer`)}`, '_blank', 'noopener')
              : undefined
        }
      >
        {d.name}
        {d.kind === 'example' ? ' ↗' : ''}
      </text>
    )
  }

  const links: JSX.Element[] = []
  root.each((n) => {
    if (!n.parent || n.parent.data.kind === 'root') {
      if (n.parent) {
        const [x1, y1] = pt(n.parent)
        const [x2, y2] = pt(n)
        links.push(
          <line key={`lk-${n.data.kind}-${n.x}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--baseline)" strokeWidth={1.6} />,
        )
      }
      return
    }
    const a = n.parent
    const [x2, y2] = pt(n)
    const [x1, y1] = pt(a)
    const rm = (a.y + n.y) / 2
    const c1x = W / 2 + rm * Math.cos(a.x - Math.PI / 2)
    const c1y = H / 2 + rm * Math.sin(a.x - Math.PI / 2)
    const c2x = W / 2 + rm * Math.cos(n.x - Math.PI / 2)
    const c2y = H / 2 + rm * Math.sin(n.x - Math.PI / 2)
    links.push(
      <path
        key={`lk-${n.data.kind}-${n.x.toFixed(5)}-${n.y}`}
        d={`M${x1},${y1}C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`}
        fill="none"
        stroke={n.data.kind === 'example' ? 'rgba(137,135,129,0.28)' : 'var(--baseline)'}
        strokeWidth={n.data.kind === 'example' ? 0.8 : 1.2}
      />,
    )
  })

  const nodes = root.descendants()

  return (
    <div className="view">
      <div className="main-panel">
        <div className="controls-bar">
          <label className="ctl">
            <input
              type="checkbox"
              checked={showExamples}
              disabled={!hasExamples}
              onChange={(e) => setWithExamples(e.target.checked)}
            />
            Commercial examples
          </label>
          {!hasExamples && (
            <span style={{ color: 'var(--muted)' }}>
              {guide.label} publishes no commercial examples — switch to a BJCP guideline to see them.
            </span>
          )}
          <span style={{ color: 'var(--muted)' }}>
            Scroll to zoom · drag to pan · double-click to reset · click a style for its
            entry, an example to search the web
          </span>
        </div>
        <div className="netwrap" ref={wrapRef} style={{ overflow: 'hidden' }}>
          <div className="cardtools">
            <ChartHelp title="Reading the beer family tree">
              <p>
                Every style in the current guideline, arranged by lineage:{' '}
                <strong>Beer → fermentation family → guideline category → style →
                commercial examples</strong>. One glance shows how the beer world divides —
                and how much of it is ale.
              </p>
              <h3>How to read it</h3>
              <ul>
                <li>
                  The first ring splits by yeast: lagers (bottom-fermented), ales
                  (top-fermented), wild &amp; sour, and anything-goes specialty styles.
                </li>
                <li>
                  Style dots wear their <strong>actual beer color</strong> (SRM midpoint) —
                  whole branches darken as you sweep from pilsners around to stouts.
                </li>
                <li>
                  The outer ring is real commercial beers the guideline names as
                  benchmark examples of each style.
                </li>
              </ul>
              <h3>Interactions</h3>
              <p>
                Scroll to zoom in on a branch, drag to pan, double-click to reset. Click a
                style for its full guideline entry; click a commercial example (↗) to
                search the web for it. Categories and structure come from {guide.label}.
              </p>
            </ChartHelp>
          </div>
          <svg
            ref={svgRef}
            viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
            style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
            role="img"
            aria-label="Radial taxonomy of beer styles"
          >
            <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="var(--page)" />
            {links}
            {nodes.map(nodeLabel)}
            {nodes.map(nodeDot)}
          </svg>
          {hover && (
            <div className="tooltip3d" style={{ left: hover.x, top: hover.y }}>
              <div className="t-name">{hover.text}</div>
              <div className="t-sub">{hover.sub}</div>
            </div>
          )}
        </div>
      </div>
      <aside className="sidebar">
        {selected ? (
          <StyleDetail style={selected} onClose={() => setSelectedId(null)} onViewIn3d={goToSpace} />
        ) : (
          <div className="detail">
            <h2>The family tree of beer</h2>
            <p>
              {allStyles.length} styles from {guide.label}, arranged by how they ferment
              and how the guideline groups them. Zoom into a branch to read the styles and
              the commercial beers that define them.
            </p>
            <p>
              Click any style dot for its full guideline entry — vitals, flavor
              fingerprint, and history.
            </p>
          </div>
        )}
      </aside>
    </div>
  )
}
