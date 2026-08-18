import { useMemo, useRef, useState } from 'react'
import { GUIDES } from '../state/useAnalysis'
import type { BeerStyle, GuideId } from '../lib/types'
import { buildFeatureSpace } from '../lib/features'
import { projectPca } from '../lib/projection'
import { GUIDE_COLORS } from '../lib/palette'
import { matchGuides } from '../lib/guideMatch'
import { useCardExpand } from '../components/CardExpand'
import ChartHelp from '../components/ChartHelp'
import { useSvgPanZoom } from '../components/useSvgPanZoom'

function Delta({ a, b, digits = 1, unit = '' }: { a: number | null; b: number | null; digits?: number; unit?: string }) {
  if (a == null || b == null) return <span style={{ color: 'var(--muted)' }}>—</span>
  const d = b - a
  if (Math.abs(d) < 0.05) return <span style={{ color: 'var(--muted)' }}>=</span>
  return (
    <span className={d > 0 ? 'delta-up' : 'delta-down'}>
      {d > 0 ? '▲' : '▼'} {Math.abs(d).toFixed(digits)}
      {unit}
    </span>
  )
}

const midOf = (s: BeerStyle, key: 'abv' | 'ibu' | 'srm'): number | null => {
  const r = s.stats[key]
  return r ? (r[0] + r[1]) / 2 : null
}

function OverlayScatter({ guideA, guideB }: { guideA: GuideId; guideB: GuideId }) {
  const [hover, setHover] = useState<{ x: number; y: number; label: string; guide: string } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const data = useMemo(() => {
    const ga = GUIDES.find((g) => g.guide === guideA)!
    const gb = GUIDES.find((g) => g.guide === guideB)!
    const all = [
      ...ga.styles.filter((s) => s.hasStats).map((s) => ({ s, guide: ga })),
      ...gb.styles.filter((s) => s.hasStats).map((s) => ({ s, guide: gb })),
    ]
    const space = buildFeatureSpace(all.map((x) => x.s), 0.3)
    const proj = projectPca(space.vectors)
    return all.map((x, i) => ({ ...x, p: proj.points[i] }))
  }, [guideA, guideB])

  const W = 1200
  const H = 760
  const pad = 60
  const xs = data.map((d) => d.p[0])
  const ys = data.map((d) => d.p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const x = (v: number) => pad + ((v - minX) / (maxX - minX || 1)) * (W - 2 * pad)
  const y = (v: number) => H - pad - ((v - minY) / (maxY - minY || 1)) * (H - 2 * pad)

  const { vb, k } = useSvgPanZoom(svgRef, W, H, { minK: 1, maxK: 8 })

  return (
    <div className="stage" ref={wrapRef}>
      <div className="stage-title">
        <h2>Two guidelines, one map</h2>
        <div style={{ display: 'flex', gap: 14, margin: '4px 0 2px', flexWrap: 'wrap' }}>
          {[guideA, guideB].map((g) => (
            <span key={g} style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--ink-2)', fontSize: 11.5 }}>
              <span className="srmdot" style={{ background: GUIDE_COLORS[g], border: 'none', width: 9, height: 9 }} />
              {GUIDES.find((x) => x.guide === g)!.label}
            </span>
          ))}
        </div>
        <p className="sub">
          Both guidelines in one PCA space. Where the two systems describe the same beer,
          their points land together. Scroll to zoom (names appear) · drag to pan.
        </p>
      </div>
      <div className="cardtools">
        <ChartHelp title="Reading the cross-guideline map">
          <p>
            Styles from <strong>both selected guidelines</strong> are embedded together in
            one PCA space built from their vitals and tags, then drawn on the first two
            principal components. Color says which guideline a point comes from.
          </p>
          <h3>How to read it</h3>
          <ul>
            <li>
              Where the two systems describe the same beer, a dot of each color lands in
              the same spot — the overlap is the shared ground.
            </li>
            <li>
              A region dense in only one color is territory that guideline covers and the
              other doesn't (e.g. the BA's many historical and regional styles).
            </li>
            <li>Axes are abstract blends of the features; only proximity matters.</li>
          </ul>
          <h3>Interactions</h3>
          <p>
            Hover for names, scroll to zoom (names appear when close), drag to pan,
            double-click to reset.
          </p>
        </ChartHelp>
      </div>
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Cross-guideline PCA overlay"
      >
          {data.map((d, i) => (
            <circle
              key={i}
              cx={x(d.p[0])}
              cy={y(d.p[1])}
              r={5 / k}
              fill={GUIDE_COLORS[d.guide.guide]}
              fillOpacity={0.9}
              stroke="var(--page)"
              strokeWidth={1.5 / k}
              onMouseEnter={(e) => {
                const rect = wrapRef.current!.getBoundingClientRect()
                setHover({
                  x: e.clientX - rect.left,
                  y: e.clientY - rect.top,
                  label: d.s.name,
                  guide: d.guide.label,
                })
              }}
              onMouseLeave={() => setHover(null)}
            />
          ))}
          {k >= 2.2 &&
            data.map((d, i) => (
              <text
                key={`l-${i}`}
                x={x(d.p[0]) + 8 / k}
                y={y(d.p[1]) + 3.5 / k}
                fontSize={11 / k}
                fontWeight={600}
                fill="#d6d4cb"
                stroke="#0d0d0d"
                strokeWidth={2.5 / k}
                paintOrder="stroke"
                style={{ pointerEvents: 'none' }}
              >
                {d.s.name}
              </text>
            ))}
        </svg>
      {hover && (
        <div className="tooltip3d" style={{ left: hover.x, top: hover.y }}>
          <div className="t-name">{hover.label}</div>
          <div className="t-sub">{hover.guide}</div>
        </div>
      )}
    </div>
  )
}

export type ComparePage = 'map' | 'drift'

export default function CompareView({ page = 'map' }: { page?: ComparePage }) {
  const tableCard = useCardExpand()
  const [guideA, setGuideA] = useState<GuideId>('bjcp2015')
  const [guideB, setGuideB] = useState<GuideId>('bjcp2021')
  const [show, setShow] = useState<'changed' | 'all' | 'added' | 'removed'>('changed')

  const ga = GUIDES.find((g) => g.guide === guideA)!
  const gb = GUIDES.find((g) => g.guide === guideB)!
  const { matches, onlyA, onlyB } = useMemo(
    () => matchGuides(ga.styles, gb.styles),
    [ga, gb],
  )

  const changed = matches.filter((m) => {
    for (const k of ['abv', 'ibu', 'srm'] as const) {
      const a = midOf(m.a, k)
      const b = midOf(m.b, k)
      if (a != null && b != null && Math.abs(a - b) >= 0.05) return true
    }
    return false
  })

  const rows = show === 'all' ? matches : changed

  return (
    <div className="view">
      <div className={`main-panel${page === 'map' ? ' immersive' : ''}`}>
        <div className="controls-bar">
          <label className="ctl">
            Compare
            <select value={guideA} onChange={(e) => setGuideA(e.target.value as GuideId)}>
              {GUIDES.map((g) => (
                <option key={g.guide} value={g.guide}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ctl">
            against
            <select value={guideB} onChange={(e) => setGuideB(e.target.value as GuideId)}>
              {GUIDES.map((g) => (
                <option key={g.guide} value={g.guide}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          {page === 'drift' && (
            <span className="seg">
              {(
                [
                  ['changed', `Changed (${changed.length})`],
                  ['all', `All matched (${matches.length})`],
                  ['added', `Only in ${gb.label} (${onlyB.length})`],
                  ['removed', `Only in ${ga.label} (${onlyA.length})`],
                ] as const
              ).map(([key, lbl]) => (
                <button key={key} className={show === key ? 'active' : ''} onClick={() => setShow(key)}>
                  {lbl}
                </button>
              ))}
            </span>
          )}
        </div>
        {page === 'map' && <OverlayScatter guideA={guideA} guideB={guideB} />}
        {page === 'drift' && (
          <div className="charts">
          <div className={`chart-card${tableCard.cardClass}`}>
            <div className="cardtools">
              <ChartHelp title="Reading the drift table">
                <p>
                  Styles present in <strong>both guidelines</strong>, paired by name. The
                  matcher normalizes names (accents, category codes, "India Pale
                  Ale"→"IPA"), expands alternatives ("Special Bitter or Best Bitter"
                  matches "Best Bitter"), bridges German spellings
                  (Münchner→Munich, Oktoberfest→Märzen), and falls back to word overlap —
                  fuzzy pairings carry an ≈ pill showing the other guideline's name.
                </p>
                <h3>How to read it</h3>
                <ul>
                  <li>
                    ▲▼ deltas compare the <em>midpoints</em> of each vital's published
                    range, left guideline → right guideline; "=" means effectively
                    unchanged.
                  </li>
                  <li>
                    <strong>Changed</strong> filters to styles whose numbers actually
                    moved; <strong>Only in…</strong> lists styles with no counterpart —
                    real additions and removals between editions or systems.
                  </li>
                </ul>
              </ChartHelp>
              {tableCard.button}
            </div>
            {(show === 'changed' || show === 'all') && (
              <>
                <h2>
                  Vital-statistic drift: {ga.label} → {gb.label}
                </h2>
                <p className="sub">
                  Midpoint deltas for styles present in both guidelines. Fuzzy name matches
                  are tagged; deltas of exactly zero show as "=".
                </p>
                <div className="chart-scroll" style={{ maxHeight: tableCard.expanded ? 'none' : 520, overflowY: 'auto' }}>
                  <table className="cmp-table">
                    <thead>
                      <tr>
                        <th>Style</th>
                        <th>{ga.label}</th>
                        <th>{gb.label}</th>
                        <th>ABV</th>
                        <th>IBU</th>
                        <th>SRM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((m) => (
                        <tr key={m.a.id + m.b.id}>
                          <td>
                            {m.b.name}
                            {m.fuzzy && (
                              <span className="pill" style={{ marginLeft: 6 }} title={`Matched to "${m.a.name}"`}>
                                ≈ {m.a.name}
                              </span>
                            )}
                          </td>
                          <td style={{ color: 'var(--muted)' }}>{m.a.categoryId ? m.a.id : '·'}</td>
                          <td style={{ color: 'var(--muted)' }}>{m.b.categoryId ? m.b.id : '·'}</td>
                          <td>
                            <Delta a={midOf(m.a, 'abv')} b={midOf(m.b, 'abv')} unit="%" />
                          </td>
                          <td>
                            <Delta a={midOf(m.a, 'ibu')} b={midOf(m.b, 'ibu')} digits={0} />
                          </td>
                          <td>
                            <Delta a={midOf(m.a, 'srm')} b={midOf(m.b, 'srm')} digits={1} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {show === 'added' && (
              <>
                <h2>Only in {gb.label}</h2>
                <p className="sub">No name match (exact or fuzzy) in {ga.label}.</p>
                <div className="tagchips">
                  {onlyB.map((s) => (
                    <span key={s.id} className="chip">
                      {s.categoryId ? `${s.id} ` : ''}
                      {s.name}
                    </span>
                  ))}
                </div>
              </>
            )}
            {show === 'removed' && (
              <>
                <h2>Only in {ga.label}</h2>
                <p className="sub">No name match (exact or fuzzy) in {gb.label}.</p>
                <div className="tagchips">
                  {onlyA.map((s) => (
                    <span key={s.id} className="chip">
                      {s.categoryId ? `${s.id} ` : ''}
                      {s.name}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
          </div>
          )}
      </div>
    </div>
  )
}
