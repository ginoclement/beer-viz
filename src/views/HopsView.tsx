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
import {
  AROMA_AXES,
  HOPS,
  hopAromaVector,
  hopAromaSimilarity,
  rankHopsForStyle,
  rankStylesForHop,
  type Hop,
  type Range,
} from '../lib/hops'
import { fitPca, pcaTransformAll } from '../lib/pca'
import { attachPanZoom, identityView, fitViewToPoints } from '../lib/panZoom'
import { useCardExpand } from '../components/CardExpand'
import ChartHelp from '../components/ChartHelp'
import HopAromaSpace from '../components/HopAromaSpace'

const PURPOSE_COLORS: Record<string, string> = {
  Aroma: '#3987e5',
  Bittering: '#d95926',
  'Dual Purpose': '#c98500',
}
const purposeColor = (p: string) => PURPOSE_COLORS[p] ?? '#3987e5'

const fmtRange = (r: Range, digits = 1, unit = '') => {
  if (!r) return '—'
  const f = (x: number) => x.toFixed(digits).replace(/\.0$/, '')
  return (r[0] === r[1] ? f(r[0]) : `${f(r[0])}–${f(r[1])}`) + unit
}

const THIOL_LABELS = ['negligible', 'moderate', 'notable', 'high']

function HopRadar({ hop }: { hop: Hop }) {
  if (!hop.aromas) return null
  const size = 310
  const c = size / 2
  const rMax = c - 56
  const pt = (axis: number, value: number): [number, number] => {
    const angle = (Math.PI * 2 * axis) / AROMA_AXES.length - Math.PI / 2
    const r = (value / 5) * rMax
    return [c + Math.cos(angle) * r, c + Math.sin(angle) * r]
  }
  const poly = hop.aromas.map((v, i) => pt(i, v).join(',')).join(' ')
  return (
    <svg width={size} height={size} role="img" aria-label={`Aroma profile radar for ${hop.name}`}>
      {[1, 2, 3, 4, 5].map((ring) => (
        <polygon
          key={ring}
          points={AROMA_AXES.map((_, i) => pt(i, ring).join(',')).join(' ')}
          fill="none"
          stroke="var(--grid)"
        />
      ))}
      {AROMA_AXES.map((axis, i) => {
        const [x, y] = pt(i, 5)
        const [lx, ly] = pt(i, 6.4)
        return (
          <g key={axis}>
            <line x1={c} y1={c} x2={x} y2={y} stroke="var(--grid)" />
            <text
              x={lx}
              y={ly + 3}
              textAnchor="middle"
              fontSize={10.5}
              fill="var(--ink-2)"
            >
              {axis}
            </text>
          </g>
        )
      })}
      <polygon points={poly} fill="rgba(201,133,0,0.25)" stroke="var(--accent-bright)" strokeWidth={1.5} />
      {hop.aromas.map((v, i) => {
        const [x, y] = pt(i, v)
        return <circle key={i} cx={x} cy={y} r={2.5} fill="var(--accent-bright)" />
      })}
    </svg>
  )
}

const OIL_LABELS: [keyof Hop['oilComp'], string, string][] = [
  ['myrcene', 'Myrcene', 'resinous, green, fruity — the volatile workhorse'],
  ['humulene', 'Humulene', 'woody, noble-spicy'],
  ['caryophyllene', 'Caryophyllene', 'peppery, woody'],
  ['farnesene', 'Farnesene', 'fresh, green, floral — the noble signature'],
  ['geraniol', 'Geraniol', 'rose, geranium; biotransforms to citronellol'],
  ['linalool', 'Linalool', 'lavender, orange blossom — key dry-hop aroma'],
]

function OilBars({ hop }: { hop: Hop }) {
  const rows = OIL_LABELS.filter(([k]) => hop.oilComp[k])
  if (rows.length === 0) return null
  const max = 70
  return (
    <div style={{ margin: '8px 0' }}>
      {rows.map(([k, label, title]) => {
        const r = hop.oilComp[k]!
        return (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }} title={title}>
            <span style={{ width: 110, color: 'var(--ink-2)', fontSize: 12.5 }}>{label}</span>
            <div style={{ flex: 1, position: 'relative', height: 8 }}>
              <div style={{ position: 'absolute', inset: 0, background: 'var(--surface-2)', borderRadius: 4 }} />
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${(r[0] / max) * 100}%`,
                  width: `${Math.max(((r[1] - r[0]) / max) * 100, 1.5)}%`,
                  background: 'var(--blue)',
                  borderRadius: 4,
                }}
              />
            </div>
            <span style={{ width: 66, textAlign: 'right', fontSize: 12.5, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
              {fmtRange(r, 1, '%')}
            </span>
          </div>
        )
      })}
      <div style={{ color: 'var(--muted)', fontSize: 12 }}>% of total oil ({fmtRange(hop.oilTotal, 1)} mL/100 g)</div>
    </div>
  )
}

function HopDetail({ hop, onPickHop, onPickStyle }: { hop: Hop; onPickHop: (k: string) => void; onPickStyle: (id: string) => void }) {
  const { styles } = useAnalysis()
  const bestStyles = useMemo(() => rankStylesForHop(hop, styles, 8), [hop, styles])
  return (
    <div className="detail">
      <h2>{hop.name}</h2>
      <div className="cat">
        {hop.country ?? 'Unknown origin'} · {hop.purpose}
        {hop.released ? ` · released ${hop.released}` : ''}
      </div>

      <HopRadar hop={hop} />

      <dl className="statgrid">
        <dt>Alpha acids</dt>
        <dd>{fmtRange(hop.alpha, 1, '%')}</dd>
        <dt>Beta acids</dt>
        <dd>{fmtRange(hop.beta, 1, '%')}</dd>
        <dt>Cohumulone</dt>
        <dd>{fmtRange(hop.cohumulone, 0, '% of alpha')}</dd>
        <dt>Total oil</dt>
        <dd>{fmtRange(hop.oilTotal, 1, ' mL/100g')}</dd>
        {hop.xanthohumol && (
          <>
            <dt>Xanthohumol</dt>
            <dd>{fmtRange(hop.xanthohumol, 1, '%')}</dd>
          </>
        )}
      </dl>

      {hop.thiol && (
        <p title={hop.thiol.note} style={{ margin: '6px 0' }}>
          <span
            className="pill"
            style={{
              borderColor: hop.thiol.level >= 2 ? 'var(--accent-bright)' : 'var(--border)',
              color: hop.thiol.level >= 2 ? 'var(--accent-bright)' : 'var(--ink-2)',
            }}
          >
            thiols: {THIOL_LABELS[hop.thiol.level]}
          </span>{' '}
          <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>{hop.thiol.note}</span>
        </p>
      )}

      <h3>Oil composition</h3>
      <OilBars hop={hop} />

      {hop.notes.length > 0 && (
        <>
          <h3>Aroma notes</h3>
          <div className="tagchips">
            {hop.notes.map((n) => (
              <span key={n} className="chip">
                {n}
              </span>
            ))}
          </div>
        </>
      )}

      {hop.pedigree && (
        <>
          <h3>Pedigree</h3>
          <p>{hop.pedigree}</p>
        </>
      )}

      {hop.substitutes.length > 0 && (
        <>
          <h3>Producer-listed companions / substitutes</h3>
          <div className="tagchips">
            {hop.substitutes.map((s) => {
              const target = HOPS.find((h) => h.name.toLowerCase() === s.toLowerCase())
              return (
                <button
                  key={s}
                  className="chip"
                  style={{ cursor: target ? 'pointer' : 'default', font: 'inherit', fontSize: 11.5 }}
                  onClick={() => target && onPickHop(target.key)}
                >
                  {s}
                </button>
              )
            })}
          </div>
        </>
      )}

      <h3>Best-fit styles</h3>
      {bestStyles.map(({ style, score }) => (
        <div key={style.id} className="match-row" onClick={() => onPickStyle(style.id)}>
          <span className="pct">{Math.round(score.total * 100)}%</span>
          <span className="nm">
            {style.name} <span className="id">{style.categoryId ? style.id : ''}</span>
          </span>
        </div>
      ))}
      <p style={{ color: 'var(--muted)', fontSize: 12 }}>
        Chemistry: Yakima Chief, Barth-Haas, Hopsteiner &amp; Crosby published ranges. Thiol
        classes are curated from brewing-science literature and approximate.
      </p>
    </div>
  )
}

function PairingCard({ onPickHop }: { onPickHop: (k: string) => void }) {
  const { styles, selectedId, setSelectedId } = useAnalysis()
  const style = styles.find((s) => s.id === selectedId) ?? styles.find((s) => s.id === '21A') ?? styles[0]
  const ranked = useMemo(() => rankHopsForStyle(style, 12), [style])
  const hasAroma = ranked.some((p) => p.aroma != null)

  return (
    <div className="chart-card">
      <div className="cardtools">
        <ChartHelp title="Reading the hop recommendations">
          <p>
            For the chosen beer style, all 210 hop varieties are scored and ranked. The
            three mini-bars in the last column are the three signals behind each score:
          </p>
          <ul>
            <li>
              <strong>Aroma</strong> (gold): how well the hop's measured aroma profile
              matches the hop character the style's guideline prose actually asks for —
              e.g. "citrus, piney" for an American IPA.
            </li>
            <li>
              <strong>Tradition</strong> (blue): whether the hop grows where the style
              comes from; craft-era styles accept any New World hop.
            </li>
            <li>
              <strong>Role</strong> (gray): whether the hop's alpha-acid range suits the
              style's bitterness load — a 4% noble hop can't cleanly bitter a double IPA.
            </li>
          </ul>
          <h3>How to read it</h3>
          <p>
            A high match with a long gold bar is an aroma-driven pick; a long blue bar
            with a short gold one is the traditional choice. The "thiol" pill marks
            varieties rich in modern tropical thiol precursors. Click a row to open the
            hop's full chemistry.
          </p>
        </ChartHelp>
      </div>
      <h2>Hop recommendations by style</h2>
      <p className="sub">
        Scored from three signals: how the hop's measured aroma profile matches the hop
        character the guideline prose asks for, whether it grows where the style comes from
        (craft styles accept any New World hop), and whether its alpha-acid range suits the
        style's bitterness load.
      </p>
      <label className="ctl" style={{ marginBottom: 10 }}>
        Style
        <select value={style.id} onChange={(e) => setSelectedId(e.target.value)} style={{ maxWidth: 300 }}>
          {styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.categoryId ? `${s.id} — ` : ''}
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {!hasAroma && (
        <p className="sub">
          This style's prose names no specific hop character, so ranking leans on tradition
          and bitterness fit alone.
        </p>
      )}
      <table className="cmp-table roomy">
        <thead>
          <tr>
            <th>#</th>
            <th>Hop</th>
            <th>Origin</th>
            <th>Alpha</th>
            <th>Match</th>
            <th style={{ minWidth: 150 }}>Aroma / tradition / role</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((p, i) => (
            <tr key={p.hop.key} style={{ cursor: 'pointer' }} onClick={() => onPickHop(p.hop.key)}>
              <td style={{ color: 'var(--muted)' }}>{i + 1}</td>
              <td>
                <span className="srmdot" style={{ background: purposeColor(p.hop.purpose), border: 'none' }} />{' '}
                {p.hop.name}
                {p.hop.thiol && p.hop.thiol.level >= 2 ? (
                  <span className="pill" style={{ marginLeft: 6, color: 'var(--accent-bright)', borderColor: 'var(--accent)' }} title={p.hop.thiol.note}>
                    thiol
                  </span>
                ) : null}
              </td>
              <td style={{ color: 'var(--ink-2)' }}>{p.hop.country ?? '—'}</td>
              <td>{fmtRange(p.hop.alpha, 1, '%')}</td>
              <td>{Math.round(p.total * 100)}%</td>
              <td>
                <div className="simbar jac" style={{ width: `${Math.max((p.aroma ?? 0) * 90, 2)}px` }} title={`aroma match ${Math.round((p.aroma ?? 0) * 100)}%`} />
                <div className="simbar" style={{ width: `${Math.max(p.tradition * 90, 2)}px`, marginTop: 2 }} title={`tradition ${Math.round(p.tradition * 100)}%`} />
                <div className="simbar" style={{ width: `${Math.max(p.role * 90, 2)}px`, marginTop: 2, background: 'var(--ink-2)' }} title={`role fit ${Math.round(p.role * 100)}%`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {ranked[0]?.matched.length ? (
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>
          Hop character in this style's prose: {[...new Set(ranked[0].matched)].join(', ')} ·{' '}
          <span className="srmdot" style={{ background: 'var(--accent)', border: 'none' }} /> aroma ·{' '}
          <span className="srmdot" style={{ background: 'var(--blue)', border: 'none' }} /> tradition ·{' '}
          <span className="srmdot" style={{ background: 'var(--ink-2)', border: 'none' }} /> role
        </p>
      ) : null}
    </div>
  )
}

function AromaScatter({ selectedKey, onPickHop }: { selectedKey: string | null; onPickHop: (k: string) => void }) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const { cardClass, button } = useCardExpand()
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const draggedRef = useRef<() => boolean>(() => false)
  // zoom state drives the viewBox; marks/labels are sized in screen pixels
  const [zoom, setZoom] = useState(identityView())

  const pts = useMemo(() => {
    const withVec = HOPS.map((h) => ({ h, v: hopAromaVector(h) })).filter(
      (x): x is { h: Hop; v: number[] } => x.v !== null && x.h.aromas !== null,
    )
    const model = fitPca(withVec.map((x) => x.v), 2)
    const proj = pcaTransformAll(model, withVec.map((x) => x.v))
    return withVec.map((x, i) => ({ ...x, p: proj[i] }))
  }, [])

  const W = 860
  const H = 520
  const pad = 30
  const xs = pts.map((d) => d.p[0])
  const ys = pts.map((d) => d.p[1])
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)]
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)]
  const x = (v: number) => pad + ((v - minX) / (maxX - minX || 1)) * (W - 2 * pad)
  const y = (v: number) => H - pad - ((v - minY) / (maxY - minY || 1)) * (H - 2 * pad)
  const h = hover ? pts[hover.i] : null

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const view = identityView()
    const pz = attachPanZoom(svg as unknown as HTMLElement, {
      view,
      // work in svg user units so CSS scaling of the element doesn't matter
      toCenter: (e) => {
        const rect = svg.getBoundingClientRect()
        return [
          ((e.clientX - rect.left - rect.width / 2) * W) / rect.width,
          ((e.clientY - rect.top - rect.height / 2) * H) / rect.height,
        ]
      },
      onChange: () => setZoom({ ...view }),
      maxK: 8,
    })
    draggedRef.current = pz.dragged
    return pz.cleanup
  }, [])

  const k = zoom.k
  const vb = {
    x: W / 2 - zoom.tx / k - W / (2 * k),
    y: H / 2 - zoom.ty / k - H / (2 * k),
    w: W / k,
    h: H / k,
  }
  const setTip = (i: number, e: React.MouseEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    setHover({ i, x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  return (
    <div className={`chart-card${cardClass}`}>
      <div className="cardtools">
        <ChartHelp title="Reading the hop aroma map">
          <p>
            Every hop with a published sensory profile is a point. Producers rate each
            variety 0–5 on nine aroma axes (citrus, tropical, floral, spice…); PCA
            squeezes those nine numbers onto this 2D map, so{' '}
            <strong>hops that smell alike sit near each other</strong>.
          </p>
          <h3>How to read it</h3>
          <ul>
            <li>Color is the brewing purpose: aroma, bittering, or dual-purpose.</li>
            <li>
              Neighborhoods are substitution candidates — a hop's nearest neighbors on the
              map usually work in the same recipes.
            </li>
            <li>
              Axes have no fixed meaning; direction and distance within a neighborhood are
              what matter.
            </li>
          </ul>
          <h3>Interactions</h3>
          <p>
            Click a dot to open the hop. Scroll to zoom — names appear once you're close —
            drag to pan, double-click to reset.
          </p>
        </ChartHelp>
        {button}
      </div>
      <h2>The hop aroma map</h2>
      <p className="sub">
        PCA of each variety's 9-axis sensory profile (producer spider charts). Neighboring
        hops smell alike; color is brewing purpose. Click to inspect · scroll to zoom
        (names appear) · drag to pan · double-click to reset.
      </p>
      <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
        {Object.entries(PURPOSE_COLORS).map(([p, c]) => (
          <span key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-2)', fontSize: 12.5 }}>
            <span className="srmdot" style={{ background: c, border: 'none' }} />
            {p}
          </span>
        ))}
      </div>
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <svg
          ref={svgRef}
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          width={W}
          height={H}
          style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'none' }}
          role="img"
          aria-label="PCA map of hop aroma profiles"
        >
          <rect x={0} y={0} width={W} height={H} fill="var(--page)" rx={8} />
          {pts.map((d, i) => {
            const sel = d.h.key === selectedKey
            const r = (sel ? 8 : hover?.i === i ? 7 : 5) / k
            return (
              <circle
                key={d.h.key}
                cx={x(d.p[0])}
                cy={y(d.p[1])}
                r={r}
                fill={purposeColor(d.h.purpose)}
                stroke={sel ? '#ffffff' : 'var(--page)'}
                strokeWidth={(sel ? 2 : 1.5) / k}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => setTip(i, e)}
                onMouseMove={(e) => setTip(i, e)}
                onMouseLeave={() => setHover(null)}
                onClick={() => {
                  if (!draggedRef.current()) onPickHop(d.h.key)
                }}
              />
            )
          })}
          {(k >= 2.2 || selectedKey) &&
            pts.map((d) => {
              const sel = d.h.key === selectedKey
              if (k < 2.2 && !sel) return null
              return (
                <text
                  key={`l-${d.h.key}`}
                  x={x(d.p[0]) + 9 / k}
                  y={y(d.p[1]) + 3.5 / k}
                  fontSize={11.5 / k}
                  fontWeight={sel ? 700 : 600}
                  fill={sel ? '#ffffff' : '#d6d4cb'}
                  stroke="#0d0d0d"
                  strokeWidth={2.5 / k}
                  paintOrder="stroke"
                  style={{ pointerEvents: 'none' }}
                >
                  {d.h.name}
                </text>
              )
            })}
        </svg>
        {h && hover && (
          <div className="tooltip3d" style={{ left: hover.x, top: hover.y }}>
            <div className="t-name">{h.h.name}</div>
            <div className="t-sub">
              {h.h.country ?? ''} · {h.h.purpose}
            </div>
            <div className="t-stats">{h.h.notes.slice(0, 4).join(', ')}</div>
          </div>
        )}
      </div>
    </div>
  )
}

interface Node extends SimulationNodeDatum {
  i: number
}
type Link = SimulationLinkDatum<Node> & { w: number; listed: boolean }

function HopNetwork({ selectedKey, onPickHop }: { selectedKey: string | null; onPickHop: (k: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const nodesRef = useRef<Node[]>([])
  const [threshold, setThreshold] = useState(0.93)
  const graphRef = useRef<{ sim: Simulation<Node, Link>; links: Link[]; draw: () => void } | null>(
    null,
  )
  // Selection is read through a ref so clicking a hop repaints the canvas
  // without rebuilding the force layout.
  const selectedRef = useRef(selectedKey)
  const viewRef = useRef(identityView())
  const interactedRef = useRef(false)
  const draggedRef = useRef<() => boolean>(() => false)
  const { expanded, cardClass, button } = useCardExpand()
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  const hops = useMemo(() => HOPS.filter((h) => h.aromas), [])

  const links = useMemo<Link[]>(() => {
    const out: Link[] = []
    const nameToIndex = new Map(hops.map((h, i) => [h.name.toLowerCase(), i]))
    const seen = new Set<string>()
    for (let i = 0; i < hops.length; i++) {
      for (const s of hops[i].substitutes) {
        const j = nameToIndex.get(s.toLowerCase())
        if (j == null || j === i) continue
        const id = [i, j].sort((a, b) => a - b).join('-')
        if (!seen.has(id)) {
          seen.add(id)
          out.push({ source: i, target: j, w: 1, listed: true })
        }
      }
      for (let j = i + 1; j < hops.length; j++) {
        const sim = hopAromaSimilarity(hops[i], hops[j])
        if (sim >= threshold) {
          const id = `${i}-${j}`
          if (!seen.has(id)) {
            seen.add(id)
            out.push({ source: i, target: j, w: (sim - threshold) / (1 - threshold), listed: false })
          }
        }
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hops, threshold])

  // Build the simulation once per hop set. Threshold changes swap links in
  // place and selection changes only repaint, so the layout never
  // regenerates under a click.
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const nodes: Node[] = hops.map((_, i) => ({ i, index: i }))
    nodesRef.current = nodes
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let width = wrap.clientWidth
    let height = 560
    const sizeCanvas = () => {
      width = wrap.clientWidth
      // fullscreen card: let the graph take the viewport height
      height = expandedRef.current ? Math.max(480, window.innerHeight - 250) : 560
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
          .distance((l) => (l.listed ? 46 : 34 + (1 - l.w) * 60))
          .strength((l) => (l.listed ? 0.5 : 0.25 + l.w * 0.4)),
      )
      .force('charge', forceManyBody().strength(-26))
      .force('center', forceCenter(0, 0))
      // weak pull toward the middle keeps loose components from flying away
      .force('x', forceX(0).strength(0.045))
      .force('y', forceY(0).strength(0.045))
      .force('collide', forceCollide(8))

    const ctx = canvas.getContext('2d')!
    const draw = () => {
      const view = viewRef.current
      ctx.setTransform(dpr, 0, 0, dpr, (width / 2) * dpr, (height / 2) * dpr)
      ctx.clearRect(-width / 2, -height / 2, width, height)
      ctx.translate(view.tx, view.ty)
      ctx.scale(view.k, view.k)
      for (const l of graphRef.current?.links ?? []) {
        const s = l.source as Node
        const t = l.target as Node
        ctx.strokeStyle = l.listed
          ? 'rgba(201,133,0,0.5)'
          : `rgba(137,135,129,${(0.1 + l.w * 0.3).toFixed(2)})`
        ctx.lineWidth = l.listed ? 1.4 : 1
        ctx.beginPath()
        ctx.moveTo(s.x!, s.y!)
        ctx.lineTo(t.x!, t.y!)
        ctx.stroke()
      }
      for (const n of nodes) {
        const sel = hops[n.i].key === selectedRef.current
        ctx.beginPath()
        ctx.arc(n.x!, n.y!, sel ? 7.5 : 5, 0, Math.PI * 2)
        ctx.fillStyle = purposeColor(hops[n.i].purpose)
        ctx.fill()
        ctx.strokeStyle = '#0d0d0d'
        ctx.lineWidth = 2
        ctx.stroke()
        if (sel) {
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
      }
      // zoomed in far enough, name every hop (constant screen-size text)
      if (view.k >= 1.6) {
        ctx.font = `600 ${11 / view.k}px system-ui, sans-serif`
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#e8e6df'
        ctx.shadowColor = '#0d0d0d'
        ctx.shadowBlur = 3 / view.k
        for (const n of nodes) ctx.fillText(hops[n.i].name, n.x! + 8, n.y!)
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
  }, [hops])

  // Swap the link set in place and gently reheat: node positions survive
  // threshold changes instead of the graph re-laying-out from scratch.
  useEffect(() => {
    const g = graphRef.current
    if (!g) return
    g.links = links.map((l) => ({ ...l }))
    ;(g.sim.force('link') as ForceLink<Node, Link>).links(g.links)
    g.sim.alpha(0.5).restart()
  }, [links])

  // Selection change: repaint only.
  useEffect(() => {
    selectedRef.current = selectedKey
    graphRef.current?.draw()
  }, [selectedKey])

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
    <div className={`chart-card${cardClass}`}>
      <div className="cardtools">
        <ChartHelp title="Reading the kinship network">
          <p>Each node is a hop variety, colored by brewing purpose. Two kinds of edge:</p>
          <ul>
            <li>
              <strong>Gold edges</strong> are producer-listed relationships — "brews well
              with" and published substitutes.
            </li>
            <li>
              <strong>Gray edges</strong> are computed: they join hops whose measured
              aroma profiles are nearly identical (above the similarity threshold
              slider).
            </li>
          </ul>
          <h3>How to read it</h3>
          <p>
            Clumps are families of interchangeable hops; a gold edge <em>without</em> a
            gray one is a pairing chosen for contrast rather than likeness. Only the
            connections are meaningful — the layout's absolute position is arbitrary.
          </p>
          <h3>Interactions</h3>
          <p>
            Click a node to open the hop. Scroll to zoom (names appear), drag to pan,
            double-click to reset. Lower the threshold to admit looser aroma kinships.
          </p>
        </ChartHelp>
        {button}
      </div>
      <h2>Substitution &amp; kinship network</h2>
      <p className="sub">
        <span style={{ color: 'var(--accent-bright)' }}>Gold edges</span> are
        producer-listed "brews well with / substitute" relationships (Hopsteiner);
        gray edges join hops whose measured aroma profiles are nearly identical.
        Scroll to zoom (names appear), drag to pan, double-click to reset.
      </p>
      <label className="ctl" style={{ marginBottom: 8 }}>
        Aroma-similarity threshold
        <input type="range" min={0.88} max={0.98} step={0.005} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        <span className="val">{threshold.toFixed(3)}</span>
      </label>
      <div ref={wrapRef} style={{ position: 'relative' }}>
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
            if (i >= 0) onPickHop(hops[i].key)
          }}
          style={{ cursor: hover ? 'pointer' : 'default' }}
        />
        {hover && (
          <div className="tooltip3d" style={{ left: hover.x, top: hover.y }}>
            <div className="t-name">{hops[hover.i].name}</div>
            <div className="t-sub">
              {hops[hover.i].country ?? ''} · {hops[hover.i].purpose}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export type HopsPage = 'pairing' | 'aroma' | 'space' | 'network'

export default function HopsView({ page = 'pairing' }: { page?: HopsPage }) {
  const { setSelectedId, hopKey, setHopKey } = useAnalysis()
  const hop = HOPS.find((h) => h.key === hopKey) ?? HOPS[0]

  return (
    <div className="view">
      <div className="main-panel">
        <div className="controls-bar">
          <label className="ctl">
            Hop
            <select value={hop.key} onChange={(e) => setHopKey(e.target.value)} style={{ maxWidth: 240 }}>
              {HOPS.map((h) => (
                <option key={h.key} value={h.key}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <span style={{ color: 'var(--muted)' }}>
            {HOPS.length} varieties · chemistry from Yakima Chief, Barth-Haas, Hopsteiner
            &amp; Crosby published data
          </span>
        </div>
        <div className="charts">
          {page === 'pairing' && <PairingCard onPickHop={setHopKey} />}
          {page === 'aroma' && <AromaScatter selectedKey={hop.key} onPickHop={setHopKey} />}
          {page === 'space' && <HopAromaSpace selectedKey={hop.key} onPickHop={setHopKey} />}
          {page === 'network' && <HopNetwork selectedKey={hop.key} onPickHop={setHopKey} />}
        </div>
      </div>
      <aside className="sidebar">
        <HopDetail hop={hop} onPickHop={setHopKey} onPickStyle={setSelectedId} />
      </aside>
    </div>
  )
}
