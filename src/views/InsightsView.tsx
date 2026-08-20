import { useMemo, useState } from 'react'
import { useAnalysis } from '../state/useAnalysis'
import { useAggregates } from '../state/useAggregates'
import { useApiLive } from '../state/useApiLive'
import { apiEnabled } from '../lib/api'
import { HOPS_BY_KEY } from '../lib/hops'
import type { CorpusInsights, VitalHistKey, VitalHistogram } from '../lib/ingredients'
import SidePanel from '../components/SidePanel'

const DEV_VITALS = [
  { key: 'abv', label: 'ABV' },
  { key: 'ibu', label: 'IBU' },
  { key: 'srm', label: 'SRM' },
  { key: 'og', label: 'OG' },
] as const

const fmtVal = (key: VitalHistKey, v: number) =>
  key === 'og' ? v.toFixed(3) : key === 'buGu' ? v.toFixed(2) : key === 'abv' ? v.toFixed(1) : String(Math.round(v))

/** percentile (0-100) of value v within a histogram, via cumulative counts */
function percentileOf(h: VitalHistogram, v: number): number {
  if (h.n === 0) return 50
  const bin = (v - h.min) / h.step
  let below = 0
  const whole = Math.floor(bin)
  for (let i = 0; i < Math.min(whole, h.counts.length); i++) below += h.counts[i]
  if (whole >= 0 && whole < h.counts.length) below += h.counts[whole] * Math.min(Math.max(bin - whole, 0), 1)
  if (bin < 0) below = 0
  if (bin >= h.counts.length) below = h.n
  return Math.min(Math.max((below / h.n) * 100, 0), 100)
}

function Histogram({
  hist,
  histKey,
  marker,
  width = 320,
  height = 96,
}: {
  hist: VitalHistogram
  histKey: VitalHistKey
  marker?: number | null
  width?: number
  height?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(...hist.counts, 1)
  const pad = { l: 6, r: 6, t: 10, b: 18 }
  const n = hist.counts.length
  const bw = (width - pad.l - pad.r) / n
  const x = (i: number) => pad.l + i * bw
  const y = (c: number) => height - pad.b - (c / max) * (height - pad.t - pad.b)
  const xOfVal = (v: number) => pad.l + ((v - hist.min) / (hist.max - hist.min)) * (width - pad.l - pad.r)
  const q = hist.quantiles

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <svg width={width} height={height} role="img" aria-label={`${hist.label} distribution`}>
        <line x1={pad.l} x2={width - pad.r} y1={height - pad.b} y2={height - pad.b} stroke="var(--baseline)" />
        {hist.counts.map((c, i) => (
          <rect
            key={i}
            x={x(i) + 0.5}
            y={y(c)}
            width={Math.max(bw - 1, 1)}
            height={height - pad.b - y(c)}
            rx={Math.min(2, bw / 3)}
            fill={hover === i ? 'var(--accent-bright)' : 'var(--blue)'}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        <line x1={xOfVal(q.p50)} x2={xOfVal(q.p50)} y1={pad.t} y2={height - pad.b} stroke="var(--muted)" strokeDasharray="3 3" />
        {marker != null && isFinite(marker) && (
          <line
            x1={xOfVal(Math.min(Math.max(marker, hist.min), hist.max))}
            x2={xOfVal(Math.min(Math.max(marker, hist.min), hist.max))}
            y1={pad.t - 4}
            y2={height - pad.b}
            stroke="#ffffff"
            strokeWidth={2}
          />
        )}
        <text x={pad.l} y={height - 5} fontSize={10} fill="var(--muted)">
          {fmtVal(histKey, hist.min)}
        </text>
        <text x={width - pad.r} y={height - 5} fontSize={10} fill="var(--muted)" textAnchor="end">
          {fmtVal(histKey, hist.max)}
        </text>
      </svg>
      {hover != null && (
        <div className="tooltip3d" style={{ left: x(hover), top: 0 }}>
          <div className="t-stats">
            {fmtVal(histKey, hist.min + hover * hist.step)}–{fmtVal(histKey, hist.min + (hover + 1) * hist.step)}:{' '}
            {hist.counts[hover].toLocaleString()} recipes
          </div>
        </div>
      )}
    </div>
  )
}

function StatTiles({ insights, total }: { insights: CorpusInsights; total: number }) {
  const h = insights.histograms
  const topYeast = insights.yeasts[0]
  const tiles: { label: string; value: string; sub?: string }[] = [
    { label: 'Recipes analyzed', value: total.toLocaleString() },
    { label: 'Median ABV', value: `${h.abv.quantiles.p50.toFixed(1)}%`, sub: `middle half ${h.abv.quantiles.p25.toFixed(1)}–${h.abv.quantiles.p75.toFixed(1)}%` },
    { label: 'Median IBU', value: `${Math.round(h.ibu.quantiles.p50)}`, sub: `middle half ${Math.round(h.ibu.quantiles.p25)}–${Math.round(h.ibu.quantiles.p75)}` },
    { label: 'Median balance', value: h.buGu.quantiles.p50.toFixed(2), sub: 'BU:GU — bitterness per gravity point' },
    ...(topYeast
      ? [{ label: 'Most-pitched yeast', value: topYeast.name.replace(/ yeast/i, ''), sub: `${(topYeast.share * 100).toFixed(0)}% of all recipes` }]
      : []),
  ]
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
      {tiles.map((t) => (
        <div key={t.label} className="chart-card" style={{ margin: 0, minWidth: 170, flex: '1 1 170px' }}>
          <div style={{ color: 'var(--muted)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.7 }}>{t.label}</div>
          <div style={{ fontSize: 26, fontWeight: 650, margin: '2px 0' }}>{t.value}</div>
          {t.sub && <div style={{ color: 'var(--ink-2)', fontSize: 12 }}>{t.sub}</div>}
        </div>
      ))}
    </div>
  )
}

function PercentileFinder({ insights }: { insights: CorpusInsights }) {
  const { recipes } = useAnalysis()
  const [pick, setPick] = useState<number>(-1)
  const [vals, setVals] = useState<Record<VitalHistKey, string>>({
    abv: '6.0',
    ibu: '40',
    srm: '8',
    og: '1.058',
    buGu: '',
  })

  const applyRecipe = (i: number) => {
    setPick(i)
    if (i < 0) return
    const v = recipes[i].vitals
    setVals({
      abv: String(v.abv.toFixed(1)),
      ibu: String(Math.round(v.ibu)),
      srm: String(v.srm.toFixed(1)),
      og: String(v.og.toFixed(3)),
      buGu: '',
    })
  }

  const keys: VitalHistKey[] = ['abv', 'ibu', 'srm', 'og']
  return (
    <div className="chart-card">
      <h2>Where does your beer sit?</h2>
      <p className="sub">
        Each panel is the full corpus distribution (dashed line = median). Enter your
        recipe's numbers — or pick one you've imported on My Recipes — and the white marker
        shows exactly where it lands, with its percentile.
      </p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        {recipes.length > 0 && (
          <label className="ctl">
            My recipe
            <select value={pick} onChange={(e) => applyRecipe(Number(e.target.value))}>
              <option value={-1}>— manual —</option>
              {recipes.map((r, i) => (
                <option key={i} value={i}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {keys.map((k) => (
          <label key={k} className="ctl" style={{ gap: 4 }}>
            {insights.histograms[k].label}
            <input
              value={vals[k]}
              onChange={(e) => {
                setPick(-1)
                setVals({ ...vals, [k]: e.target.value })
              }}
              inputMode="decimal"
              style={{ width: 64, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--ink)', borderRadius: 7, padding: '4px 7px', font: 'inherit' }}
            />
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        {keys.map((k) => {
          const h = insights.histograms[k]
          const v = parseFloat(vals[k])
          const has = isFinite(v)
          const pct = has ? percentileOf(h, v) : null
          return (
            <div key={k}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 2 }}>
                <span style={{ color: 'var(--ink-2)' }}>{h.label}</span>
                {pct != null && (
                  <span style={{ color: 'var(--ink)' }}>
                    P{Math.round(pct)}
                    <span style={{ color: 'var(--muted)' }}>
                      {' '}
                      · {pct >= 50 ? `top ${Math.max(100 - Math.round(pct), 1)}%` : `bottom ${Math.max(Math.round(pct), 1)}%`}
                    </span>
                  </span>
                )}
              </div>
              <Histogram hist={h} histKey={k} marker={has ? v : null} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BrewedVsBook({ insights }: { insights: CorpusInsights }) {
  const [vital, setVital] = useState<(typeof DEV_VITALS)[number]['key']>('ibu')
  const rows = useMemo(
    () =>
      insights.deviation
        .filter((d) => d.dev[vital] != null)
        .slice(0, 12)
        .sort((a, b) => (b.dev[vital] ?? 0) - (a.dev[vital] ?? 0)),
    [insights, vital],
  )
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.dev[vital] ?? 0)), 0.5)
  const W = 760
  const labelW = 170
  const half = (W - labelW - 60) / 2
  const mid = labelW + half

  return (
    <div className="chart-card">
      <h2>Brewed vs. the book</h2>
      <p className="sub">
        How far real recipes sit from their matched BJCP style's midpoint, averaged per
        family. Units are half-ranges: +1 means the average recipe sits at the very top of
        the published range; 0 means brewers agree with the guideline.
      </p>
      <div style={{ marginBottom: 12 }}>
        <span className="seg" style={{ display: 'inline-flex' }}>
          {DEV_VITALS.map((v) => (
            <button key={v.key} className={vital === v.key ? 'active' : ''} onClick={() => setVital(v.key)}>
              {v.label}
            </button>
          ))}
        </span>
      </div>
      <svg width={W} height={rows.length * 26 + 30} role="img" aria-label={`Average ${vital} deviation from style midpoint per family`}>
        <line x1={mid} x2={mid} y1={4} y2={rows.length * 26 + 6} stroke="var(--baseline)" />
        {rows.map((r, i) => {
          const d = r.dev[vital] ?? 0
          const w = (Math.abs(d) / maxAbs) * half
          const yy = i * 26 + 8
          return (
            <g key={r.family}>
              <text x={labelW - 8} y={yy + 12} textAnchor="end" fontSize={12} fill="var(--ink-2)">
                {r.family}
              </text>
              <rect
                x={d >= 0 ? mid : mid - w}
                y={yy}
                width={Math.max(w, 1.5)}
                height={15}
                rx={4}
                fill={d >= 0 ? '#6db3f5' : '#e66767'}
              >
                <title>{`${r.family}: ${d >= 0 ? '+' : ''}${d.toFixed(2)} half-ranges (${r.n.toLocaleString()} recipes)`}</title>
              </rect>
              <text
                x={d >= 0 ? mid + w + 6 : mid - w - 6}
                y={yy + 12}
                textAnchor={d >= 0 ? 'start' : 'end'}
                fontSize={11.5}
                fill="var(--ink)"
              >
                {d >= 0 ? '+' : ''}
                {d.toFixed(2)}
              </text>
            </g>
          )
        })}
        <text x={mid + 6} y={rows.length * 26 + 24} fontSize={11} fill="var(--muted)">
          above the style midpoint →
        </text>
        <text x={mid - 6} y={rows.length * 26 + 24} fontSize={11} fill="var(--muted)" textAnchor="end">
          ← below
        </text>
      </svg>
    </div>
  )
}

function HopPairs({ insights, onPickHop }: { insights: CorpusInsights; onPickHop: (k: string) => void }) {
  const maxN = Math.max(...insights.hopPairs.map((p) => p.n), 1)
  const name = (k: string) => HOPS_BY_KEY.get(k)?.name ?? k
  return (
    <div className="chart-card">
      <h2>Hop pairings brewers actually use</h2>
      <p className="sub">
        Varieties appearing in the same recipe, across {insights.recipesWithHops.toLocaleString()} hopped
        recipes. Lift &gt; 1 means the pair is chosen together more often than their
        individual popularity predicts — a real affinity, not just two popular hops.
      </p>
      <table className="cmp-table">
        <thead>
          <tr>
            <th>Pair</th>
            <th style={{ minWidth: 180 }}>Recipes together</th>
            <th>Lift</th>
          </tr>
        </thead>
        <tbody>
          {insights.hopPairs.slice(0, 20).map((p) => (
            <tr key={`${p.a}|${p.b}`}>
              <td>
                <button className="chip" style={{ font: 'inherit', fontSize: 12.5, cursor: 'pointer' }} onClick={() => onPickHop(p.a)}>
                  {name(p.a)}
                </button>{' '}
                +{' '}
                <button className="chip" style={{ font: 'inherit', fontSize: 12.5, cursor: 'pointer' }} onClick={() => onPickHop(p.b)}>
                  {name(p.b)}
                </button>
              </td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="simbar" style={{ width: `${(p.n / maxN) * 150}px` }} />
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{p.n.toLocaleString()}</span>
                </div>
              </td>
              <td style={{ fontVariantNumeric: 'tabular-nums', color: p.lift >= 2 ? 'var(--accent-bright)' : 'var(--ink)' }}>
                {p.lift.toFixed(2)}×
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function YeastBoard({ insights }: { insights: CorpusInsights }) {
  const maxN = Math.max(...insights.yeasts.map((y) => y.n), 1)
  return (
    <div className="chart-card">
      <h2>The yeast leaderboard</h2>
      <p className="sub">
        Grouped by product code where one is present. Median apparent attenuation is
        measured from the recipes themselves — what each strain actually did, not the lab
        sheet.
      </p>
      <table className="cmp-table">
        <thead>
          <tr>
            <th>Yeast</th>
            <th style={{ minWidth: 180 }}>Recipes</th>
            <th>Median atten.</th>
            <th>Most used in</th>
          </tr>
        </thead>
        <tbody>
          {insights.yeasts.map((y) => (
            <tr key={y.name}>
              <td>{y.name}</td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="simbar jac" style={{ width: `${(y.n / maxN) * 150}px` }} />
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{y.n.toLocaleString()}</span>
                </div>
              </td>
              <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                {y.medianAttenuation != null ? `${y.medianAttenuation.toFixed(0)}%` : '—'}
              </td>
              <td style={{ color: 'var(--ink-2)' }}>{y.topFamily}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function InsightsView({ goToHops }: { goToHops?: () => void }) {
  const agg = useAggregates()
  const { setHopKey } = useAnalysis()
  const apiLive = useApiLive()
  const insights = agg.insights

  const pickHop = (k: string) => {
    setHopKey(k)
    goToHops?.()
  }

  if (!insights) {
    return (
      <div className="view">
        <div className="main-panel">
          <div className="charts">
            <div className="chart-card">
              <h2>Insights need a data rebuild</h2>
              <p className="sub">
                This build's aggregates predate the Insights rollups — run{' '}
                <code>npm run build:data</code> and redeploy.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="view">
      <div className="main-panel">
        <div className="controls-bar">
          <span style={{ color: 'var(--muted)' }}>
            Every number on this page is computed over the complete corpus at data-build
            time — no sampling.
            {apiEnabled && !apiLive ? ' Live API unreachable — showing the bundled snapshot.' : ''}
          </span>
        </div>
        <div className="charts">
          <StatTiles insights={insights} total={agg.totalRecipes} />
          <PercentileFinder insights={insights} />
          <BrewedVsBook insights={insights} />
          <HopPairs insights={insights} onPickHop={pickHop} />
          <YeastBoard insights={insights} />
        </div>
      </div>
      <SidePanel>
        <div className="detail">
          <h2>Corpus research</h2>
          <p>
            This page is the "so what" of the recipe corpus: {agg.totalRecipes.toLocaleString()}{' '}
            real recipes summarized into the patterns a brewer can act on.
          </p>
          <p>
            <strong>Where does your beer sit?</strong> turns any set of vitals into corpus
            percentiles — import your Brewfather recipes on My Recipes and they appear in
            the picker.
          </p>
          <p>
            <strong>Brewed vs. the book</strong> is the gap between what the BJCP publishes
            and what people brew: a bar at +1 means the average recipe in that family sits
            at the very top of its style's published range.
          </p>
          <p>
            <strong>Pairings and yeasts</strong> come from the ingredient bills: lift
            filters out "both are just popular", and attenuation is measured from each
            recipe's own gravities.
          </p>
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>
            {agg.source}. Insight rollups refresh whenever the data build runs.
          </p>
        </div>
      </SidePanel>
    </div>
  )
}
