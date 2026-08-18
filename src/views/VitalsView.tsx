import { useMemo, useState } from 'react'
import { useAnalysis } from '../state/useAnalysis'
import { midVitals } from '../lib/features'
import { srmToHex } from '../lib/srm'
import type { BeerStyle } from '../lib/types'

const W = 860
const H = 520
const PAD = { l: 52, r: 18, t: 12, b: 40 }

function Scatter() {
  const { styles, setSelectedId, selectedId } = useAnalysis()
  const [hover, setHover] = useState<number | null>(null)

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

  const h = hover != null ? pts[hover] : null

  return (
    <div className="chart-card">
      <h2>Bitterness vs. strength</h2>
      <p className="sub">
        Each style at its midpoint ABV and IBU, painted its actual color (SRM). Hover for
        the style; click to open it in the 3D space sidebar. The selected style shows its
        full published ranges as whiskers.
      </p>
      <div className="chart-scroll" style={{ position: 'relative' }}>
        <svg width={W} height={H} role="img" aria-label="Scatter plot of ABV versus IBU for all styles">
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
              r={hover === i || p.s.id === selectedId ? 8 : 5.5}
              fill={srmToHex(p.v.srm)}
              stroke={p.s.id === selectedId ? '#ffffff' : 'var(--page)'}
              strokeWidth={2}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setSelectedId(p.s.id)}
            />
          ))}
        </svg>
        {h && (
          <div
            className="tooltip3d"
            style={{ left: x(h.v.abv), top: y(h.v.ibu) }}
          >
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
  const [hover, setHover] = useState<number | null>(null)
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
  const h = hover != null ? pts[hover] : null
  const xTicks = [1.03, 1.05, 1.07, 1.09, 1.11].filter((t) => t < maxOg)
  const yTicks = [60, 70, 80, 90]

  return (
    <div className="chart-card">
      <h2>Fermentability: original gravity vs. apparent attenuation</h2>
      <p className="sub">
        How big the beer starts vs. how dry it finishes. Sweet, full styles sink to the
        bottom; crisp, dry styles float to the top.
      </p>
      <div className="chart-scroll" style={{ position: 'relative' }}>
        <svg width={W} height={H} role="img" aria-label="OG versus apparent attenuation">
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
              r={hover === i || p.s.id === selectedId ? 8 : 5.5}
              fill={srmToHex(p.srm)}
              stroke={p.s.id === selectedId ? '#ffffff' : 'var(--page)'}
              strokeWidth={2}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setSelectedId(p.s.id)}
            />
          ))}
        </svg>
        {h && (
          <div className="tooltip3d" style={{ left: x(h.og), top: y(h.atten) }}>
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
    </div>
  )
}

export default function VitalsView() {
  const { selectedId, allStyles, setSelectedId } = useAnalysis()
  const selected: BeerStyle | undefined = allStyles.find((s) => s.id === selectedId)
  return (
    <div className="view">
      <div className="main-panel">
        <div className="charts">
          {selected && (
            <div className="chart-card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <strong>
                {selected.categoryId ? `${selected.id} ` : ''}
                {selected.name}
              </strong>
              <span style={{ color: 'var(--muted)' }}>{selected.category}</span>
              <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setSelectedId(null)}>
                Clear selection
              </button>
            </div>
          )}
          <Scatter />
          <AttenuationChart />
          <SrmLadder />
        </div>
      </div>
    </div>
  )
}
