import { useMemo, useRef, useState } from 'react'
import { useAnalysis } from '../state/useAnalysis'
import { midVitals } from '../lib/features'
import { srmToHex } from '../lib/srm'
import type { BeerStyle } from '../lib/types'
import ChartHelp from '../components/ChartHelp'

const W = 1200
const H = 760
const PAD = { l: 62, r: 26, t: 22, b: 52 }

/** mouse offset within a stage element, for tooltip placement */
type Tip = { i: number; mx: number; my: number } | null
const tipAt = (e: React.MouseEvent, i: number, wrap: HTMLElement | null): Tip => {
  const rect = wrap?.getBoundingClientRect()
  return rect ? { i, mx: e.clientX - rect.left, my: e.clientY - rect.top } : { i, mx: 0, my: 0 }
}

function Scatter() {
  const { styles, setSelectedId, selectedId } = useAnalysis()
  const [hover, setHover] = useState<Tip>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const pts = useMemo(
    () =>
      styles.map((s) => {
        const v = midVitals(s)!
        return { s, v }
      }),
    [styles],
  )

  const maxAbv = Math.max(...pts.map((p) => p.v.abv)) * 1.06
  const maxIbu = Math.max(...pts.map((p) => p.v.ibu)) * 1.06
  const x = (abv: number) => PAD.l + (abv / maxAbv) * (W - PAD.l - PAD.r)
  const y = (ibu: number) => H - PAD.b - (ibu / maxIbu) * (H - PAD.t - PAD.b)

  const xTicks = [0, 2, 4, 6, 8, 10, 12].filter((t) => t <= maxAbv)
  const yTicks = [0, 20, 40, 60, 80, 100].filter((t) => t <= maxIbu)

  const h = hover != null ? pts[hover.i] : null

  return (
    <div className="stage" ref={wrapRef}>
      <div className="stage-title">
        <h2>Bitterness vs. strength</h2>
        <p className="sub">
          Each style at its midpoint ABV and IBU, painted its actual color (SRM). Hover for
          the style; click to select it — the selected style shows its full published ranges
          as whiskers.
        </p>
      </div>
      <div className="cardtools">
        <ChartHelp title="Reading bitterness vs. strength">
          <p>
            Each dot is one style plotted at the <strong>midpoint of its published
            ranges</strong>: alcohol (ABV) across, bitterness (IBU) up, and painted its
            actual beer color (SRM).
          </p>
          <h3>How to read it</h3>
          <ul>
            <li>
              The rough diagonal drift is the balance rule: bigger beers carry more
              bitterness to stay in proportion.
            </li>
            <li>
              Styles far <em>above</em> the trend are aggressively bitter for their size
              (IPAs); far <em>below</em> are malt-led (bocks, milds, wheat beers).
            </li>
            <li>
              Dark dots low on the chart are the roasty-but-gentle family; pale dots high
              up are the pale hop bombs.
            </li>
          </ul>
          <h3>Interactions</h3>
          <p>
            Hover for the style; click to select it — whiskers then show its full
            published ABV and IBU ranges rather than just the midpoint.
          </p>
        </ChartHelp>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Scatter plot of ABV versus IBU for all styles">
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
              <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fill="var(--muted)" fontSize={11}>
                {t}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--grid)" />
              <text x={x(t)} y={H - PAD.b + 18} textAnchor="middle" fill="var(--muted)" fontSize={11}>
                {t}
              </text>
            </g>
          ))}
          <text x={(W + PAD.l - PAD.r) / 2} y={H - 6} textAnchor="middle" fill="var(--ink-2)" fontSize={12}>
            ABV (%)
          </text>
          <text
            x={14}
            y={(H + PAD.t - PAD.b) / 2}
            textAnchor="middle"
            fill="var(--ink-2)"
            fontSize={12}
            transform={`rotate(-90 14 ${(H + PAD.t - PAD.b) / 2})`}
          >
            IBU
          </text>

          {pts.map((p) =>
            p.s.id === selectedId ? (
              <g key={p.s.id} stroke="var(--muted)" strokeWidth={1.5}>
                <line
                  x1={x(p.s.stats.abv![0])}
                  x2={x(p.s.stats.abv![1])}
                  y1={y(p.v.ibu)}
                  y2={y(p.v.ibu)}
                />
                <line
                  x1={x(p.v.abv)}
                  x2={x(p.v.abv)}
                  y1={y(p.s.stats.ibu![0])}
                  y2={y(p.s.stats.ibu![1])}
                />
              </g>
            ) : null,
          )}
          {pts.map((p, i) => (
            <circle
              key={p.s.id}
              cx={x(p.v.abv)}
              cy={y(p.v.ibu)}
              r={hover?.i === i || p.s.id === selectedId ? 8 : 5.5}
              fill={srmToHex(p.v.srm)}
              stroke={p.s.id === selectedId ? '#ffffff' : 'var(--page)'}
              strokeWidth={2}
              style={{ cursor: 'pointer' }}
              onMouseEnter={(e) => setHover(tipAt(e, i, wrapRef.current))}
              onMouseMove={(e) => setHover(tipAt(e, i, wrapRef.current))}
              onMouseLeave={() => setHover(null)}
              onClick={() => setSelectedId(p.s.id)}
            />
          ))}
        </svg>
        {h && hover && (
          <div className="tooltip3d" style={{ left: hover.mx, top: hover.my }}>
            <div className="t-name">
              {h.s.categoryId ? `${h.s.id} ` : ''}
              {h.s.name}
            </div>
            <div className="t-stats">
              {h.v.abv.toFixed(1)}% ABV · {Math.round(h.v.ibu)} IBU · {Math.round(h.v.srm)} SRM
            </div>
          </div>
        )}
    </div>
  )
}

function SrmLadder() {
  const { styles, setSelectedId, selectedId } = useAnalysis()
  const [hover, setHover] = useState<string | null>(null)
  const sorted = useMemo(
    () =>
      [...styles].sort((a, b) => {
        const av = midVitals(a)!.srm
        const bv = midVitals(b)!.srm
        return av - bv
      }),
    [styles],
  )
  const rowH = 17
  const labelW = 260
  const chartW = 560
  const maxSrm = 45
  const x = (srm: number) => labelW + (Math.min(srm, maxSrm) / maxSrm) * chartW
  const height = sorted.length * rowH + 30

  return (
    <div className="chart-card">
      <div className="cardtools">
        <ChartHelp title="Reading the color ladder">
          <p>
            Every style's published SRM color range, sorted palest to darkest, with each
            bar drawn in the true color of that range.
          </p>
          <h3>How to read it</h3>
          <ul>
            <li>The bar's left and right edges are the style's allowed extremes.</li>
            <li>
              A <strong>wide bar</strong> means the guideline tolerates many colors (many
              specialty styles); a narrow bar is a tightly defined look.
            </li>
            <li>
              The scale caps at SRM 45 — beyond that everything reads as black to the eye.
            </li>
          </ul>
          <h3>Interactions</h3>
          <p>Hover to highlight a row; click to open the style.</p>
        </ChartHelp>
      </div>
      <h2>The color ladder</h2>
      <p className="sub">
        Every style's published SRM range, palest to darkest, drawn in true color. The bar
        is the range; wide bars are styles that tolerate many colors.
      </p>
      <div className="chart-scroll">
        <svg width={labelW + chartW + 40} height={height} role="img" aria-label="SRM color range per style">
          {[0, 10, 20, 30, 40].map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={0} y2={height - 24} stroke="var(--grid)" />
              <text x={x(t)} y={height - 8} textAnchor="middle" fill="var(--muted)" fontSize={11}>
                {t}
              </text>
            </g>
          ))}
          <text x={labelW + chartW + 24} y={height - 8} textAnchor="middle" fill="var(--ink-2)" fontSize={12}>
            SRM
          </text>
          {sorted.map((s, i) => {
            const r = s.stats.srm!
            const yy = i * rowH + 4
            const active = hover === s.id || selectedId === s.id
            return (
              <g
                key={s.id}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHover(s.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setSelectedId(s.id)}
              >
                <rect x={0} y={yy - 2} width={labelW + chartW} height={rowH - 1} fill={active ? 'var(--surface-2)' : 'transparent'} />
                <text
                  x={labelW - 10}
                  y={yy + 9}
                  textAnchor="end"
                  fill={active ? 'var(--ink)' : 'var(--ink-2)'}
                  fontSize={11.5}
                >
                  {s.categoryId ? `${s.id} ` : ''}
                  {s.name}
                </text>
                <defs>
                  <linearGradient id={`g-${s.id}`} x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0%" stopColor={srmToHex(r[0])} />
                    <stop offset="100%" stopColor={srmToHex(r[1])} />
                  </linearGradient>
                </defs>
                <rect
                  x={x(r[0])}
                  y={yy}
                  width={Math.max(x(r[1]) - x(r[0]), 3)}
                  height={9}
                  rx={4}
                  fill={`url(#g-${s.id})`}
                  stroke={active ? '#ffffff' : 'rgba(255,255,255,0.18)'}
                  strokeWidth={active ? 1.5 : 0.5}
                />
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function AttenuationChart() {
  const { styles, setSelectedId, selectedId } = useAnalysis()
  const [hover, setHover] = useState<Tip>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const pts = useMemo(
    () =>
      styles.map((s) => {
        const v = midVitals(s)!
        return { s, og: v.og, atten: v.og > 1 ? ((v.og - v.fg) / (v.og - 1)) * 100 : 0, srm: v.srm }
      }),
    [styles],
  )
  const minOg = 1.025
  const maxOg = Math.max(...pts.map((p) => p.og)) + 0.005
  const minAt = 55
  const maxAt = 95
  const x = (og: number) => PAD.l + ((og - minOg) / (maxOg - minOg)) * (W - PAD.l - PAD.r)
  const y = (at: number) =>
    H - PAD.b - ((Math.min(Math.max(at, minAt), maxAt) - minAt) / (maxAt - minAt)) * (H - PAD.t - PAD.b)
  const h = hover != null ? pts[hover.i] : null
  const xTicks = [1.03, 1.05, 1.07, 1.09, 1.11].filter((t) => t < maxOg)
  const yTicks = [60, 70, 80, 90]

  return (
    <div className="stage" ref={wrapRef}>
      <div className="stage-title">
        <h2>Fermentability: OG vs. apparent attenuation</h2>
        <p className="sub">
          How big the beer starts vs. how dry it finishes. Sweet, full styles sink to the
          bottom; crisp, dry styles float to the top.
        </p>
      </div>
      <div className="cardtools">
        <ChartHelp title="Reading the fermentability chart">
          <p>
            Across: <strong>original gravity</strong> — how much sugar the beer starts
            with, i.e. how big it is. Up: <strong>apparent attenuation</strong> — the
            share of that sugar the yeast consumed, computed as (OG − FG) / (OG − 1). Dots
            are painted the style's actual color.
          </p>
          <h3>How to read it</h3>
          <ul>
            <li>
              Top of the chart = dry, crisp finishes (saisons, pilsners); bottom = sweet,
              full beers (milk stouts, doppelbocks).
            </li>
            <li>
              Moving right means more starting sugar; a big beer that is also high up
              (barleywine at 80%+) finishes strong <em>and</em> dry.
            </li>
            <li>
              Vertical neighbors share strength but differ completely in body — a useful
              lens the ABV number alone hides.
            </li>
          </ul>
          <h3>Interactions</h3>
          <p>Hover for the style; click to open it.</p>
        </ChartHelp>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="OG versus apparent attenuation">
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
              <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fill="var(--muted)" fontSize={11}>
                {t}%
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--grid)" />
              <text x={x(t)} y={H - PAD.b + 18} textAnchor="middle" fill="var(--muted)" fontSize={11}>
                {t.toFixed(3)}
              </text>
            </g>
          ))}
          <text x={(W + PAD.l - PAD.r) / 2} y={H - 6} textAnchor="middle" fill="var(--ink-2)" fontSize={12}>
            Original gravity
          </text>
          <text
            x={14}
            y={(H + PAD.t - PAD.b) / 2}
            textAnchor="middle"
            fill="var(--ink-2)"
            fontSize={12}
            transform={`rotate(-90 14 ${(H + PAD.t - PAD.b) / 2})`}
          >
            Apparent attenuation
          </text>
          {pts.map((p, i) => (
            <circle
              key={p.s.id}
              cx={x(p.og)}
              cy={y(p.atten)}
              r={hover?.i === i || p.s.id === selectedId ? 8 : 5.5}
              fill={srmToHex(p.srm)}
              stroke={p.s.id === selectedId ? '#ffffff' : 'var(--page)'}
              strokeWidth={2}
              style={{ cursor: 'pointer' }}
              onMouseEnter={(e) => setHover(tipAt(e, i, wrapRef.current))}
              onMouseMove={(e) => setHover(tipAt(e, i, wrapRef.current))}
              onMouseLeave={() => setHover(null)}
              onClick={() => setSelectedId(p.s.id)}
            />
          ))}
        </svg>
        {h && hover && (
          <div className="tooltip3d" style={{ left: hover.mx, top: hover.my }}>
            <div className="t-name">
              {h.s.categoryId ? `${h.s.id} ` : ''}
              {h.s.name}
            </div>
            <div className="t-stats">
              OG {h.og.toFixed(3)} · {h.atten.toFixed(0)}% apparent attenuation
            </div>
          </div>
        )}
    </div>
  )
}

export type VitalsPage = 'strength' | 'ferment' | 'color'

export default function VitalsView({ page = 'strength', goToSpace }: { page?: VitalsPage; goToSpace?: () => void }) {
  const { selectedId, allStyles, setSelectedId } = useAnalysis()
  const selected: BeerStyle | undefined = allStyles.find((s) => s.id === selectedId)
  // the scatters fill the viewport; the color ladder is a tall scroll list
  const immersive = page !== 'color'

  const banner = selected && (
    <div
      className={immersive ? 'controls-bar' : 'chart-card'}
      style={{ display: 'flex', gap: 12, alignItems: 'center' }}
    >
      <strong>
        {selected.categoryId ? `${selected.id} ` : ''}
        {selected.name}
      </strong>
      <span style={{ color: 'var(--muted)' }}>{selected.category}</span>
      {goToSpace && selected.hasStats && (
        <button className="btn" onClick={goToSpace}>
          View in 3D space ↗
        </button>
      )}
      <button className="btn" onClick={() => setSelectedId(null)}>
        Clear
      </button>
    </div>
  )

  return (
    <div className="view">
      <div className={`main-panel${immersive ? ' immersive' : ''}`}>
        {immersive ? (
          <>
            {banner}
            {page === 'strength' && <Scatter />}
            {page === 'ferment' && <AttenuationChart />}
          </>
        ) : (
          <div className="charts">
            {banner}
            <SrmLadder />
          </div>
        )}
      </div>
    </div>
  )
}
