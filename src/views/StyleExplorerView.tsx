import { useEffect, useMemo, useState } from 'react'
import { useAnalysis } from '../state/useAnalysis'
import { type CorpusRecipe } from '../lib/ingredients'
import {
  apiEnabled,
  fetchRecipes,
  fetchRecipeDetail,
  rowToRecipe,
  detailToRecipe,
  type VitalBounds,
} from '../lib/api'
import { loadLocalCorpus } from '../lib/localData'
import { useApiLive } from '../state/useApiLive'
import { srmToHex } from '../lib/srm'
import { GristBar, HopScheduleList } from '../components/IngredientBill'
import SidePanel from '../components/SidePanel'
import ChartHelp from '../components/ChartHelp'
import type { BeerStyle, StatRange } from '../lib/types'

const W = 1200
const H = 720
const PAD = { t: 70, b: 90, l: 70, r: 70 }

type VitalKey = 'og' | 'fg' | 'abv' | 'ibu' | 'srm'
const AXES: { key: VitalKey; label: string; fmt: (v: number) => string }[] = [
  { key: 'og', label: 'OG', fmt: (v) => v.toFixed(3) },
  { key: 'fg', label: 'FG', fmt: (v) => v.toFixed(3) },
  { key: 'abv', label: 'ABV', fmt: (v) => `${v.toFixed(1)}%` },
  { key: 'ibu', label: 'IBU', fmt: (v) => `${Math.round(v)}` },
  { key: 'srm', label: 'SRM', fmt: (v) => v.toFixed(1) },
]

const hasAllVitals = (r: CorpusRecipe) =>
  AXES.every((a) => r.vitals[a.key] != null)

function styleHasRanges(s: BeerStyle) {
  return AXES.every((a) => s.stats[a.key] != null)
}

export default function StyleExplorerView() {
  const { styles } = useAnalysis()
  const eligibleStyles = useMemo(() => styles.filter(styleHasRanges), [styles])

  const [styleId, setStyleId] = useState<string>(
    () => eligibleStyles.find((s) => /IPA/i.test(s.name))?.id ?? eligibleStyles[0]?.id ?? '',
  )
  const [tol, setTol] = useState(0.15)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [hoverId, setHoverId] = useState<number | null>(null)

  // Candidate recipes to test for membership. In API mode we ask the beer-api
  // for recipes already inside the tolerance-widened window (a bounded page);
  // offline we lazy-load the bundled corpus and filter it here.
  const [candidates, setCandidates] = useState<CorpusRecipe[]>([])
  const [apiTotal, setApiTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<CorpusRecipe | null>(null)

  const style = eligibleStyles.find((s) => s.id === styleId) ?? eligibleStyles[0]
  const apiLive = useApiLive()

  useEffect(() => {
    let ok = true
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        if (apiLive) {
          if (!style) return
          const bounds: VitalBounds = {}
          for (const a of AXES) {
            const [lo, hi] = style.stats[a.key] as [number, number]
            const w = hi - lo || 1e-9
            bounds[`${a.key}Min`] = lo - tol * w
            bounds[`${a.key}Max`] = hi + tol * w
          }
          const res = await fetchRecipes({ ...bounds, sort: 'random', limit: 2000 }, ctrl.signal)
          if (!ok) return
          setCandidates(res.recipes.map(rowToRecipe))
          setApiTotal(res.total)
        } else {
          const corpus = await loadLocalCorpus()
          if (!ok) return
          setCandidates(corpus.recipes)
          setApiTotal(null)
        }
      } catch (e) {
        if (ok && (e as { name?: string })?.name !== 'AbortError') setError(String(e))
      } finally {
        if (ok) setLoading(false)
      }
    })()
    return () => {
      ok = false
      ctrl.abort()
    }
  }, [style, tol, apiLive])

  // Membership: a recipe is "in range" when every vital sits inside the
  // style's published range widened by the tolerance fraction of the range.
  const { matches, domains } = useMemo(() => {
    if (!style) return { matches: [] as { r: CorpusRecipe; fit: number }[], domains: {} as Record<VitalKey, [number, number]> }
    const ranges = Object.fromEntries(AXES.map((a) => [a.key, style.stats[a.key] as [number, number]])) as Record<
      VitalKey,
      [number, number]
    >

    const matches: { r: CorpusRecipe; fit: number }[] = []
    for (const r of candidates) {
      if (!hasAllVitals(r)) continue
      let ok = true
      let fit = 0
      for (const a of AXES) {
        const [lo, hi] = ranges[a.key]
        const w = hi - lo || 1e-9
        const v = r.vitals[a.key]!
        if (v < lo - tol * w || v > hi + tol * w) {
          ok = false
          break
        }
        if (v >= lo && v <= hi) fit++
      }
      if (ok) matches.push({ r, fit })
    }
    matches.sort((a, b) => b.fit - a.fit || a.r.name.localeCompare(b.r.name))

    // Per-axis domain: the widened range unioned with the matching recipes'
    // spread, padded — keeps the plot zoomed to the style's neighborhood.
    const domains = {} as Record<VitalKey, [number, number]>
    for (const a of AXES) {
      const [lo, hi] = ranges[a.key]
      const w = hi - lo || 1e-9
      let dmin = lo - tol * w
      let dmax = hi + tol * w
      for (const { r } of matches) {
        const v = r.vitals[a.key]!
        if (v < dmin) dmin = v
        if (v > dmax) dmax = v
      }
      const pad = (dmax - dmin) * 0.08 || 1e-6
      domains[a.key] = [dmin - pad, dmax + pad]
    }
    return { matches, domains }
  }, [style, tol, candidates])

  // Resolve the selected recipe's full detail (grain bill + hops). Offline the
  // candidate is already complete; in API mode we fetch /recipe/:id on click.
  useEffect(() => {
    if (selectedId == null) {
      setDetail(null)
      return
    }
    const cand = candidates.find((r) => r.id === selectedId) ?? null
    setDetail(cand)
    if (!apiLive || !cand) return
    let ok = true
    fetchRecipeDetail(selectedId)
      .then((d) => {
        if (ok) setDetail(detailToRecipe(d))
      })
      .catch(() => {})
    return () => {
      ok = false
    }
  }, [selectedId, candidates, apiLive])

  if (!style) return null

  const axisX = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / (AXES.length - 1)
  const scaleY = (key: VitalKey, v: number) => {
    const [dmin, dmax] = domains[key]
    const t = (v - dmin) / (dmax - dmin || 1)
    return H - PAD.b - t * (H - PAD.t - PAD.b)
  }

  const range = (key: VitalKey) => style.stats[key] as StatRange as [number, number]
  const linePath = (r: CorpusRecipe) =>
    AXES.map((a, i) => `${i === 0 ? 'M' : 'L'} ${axisX(i).toFixed(1)} ${scaleY(a.key, r.vitals[a.key]!).toFixed(1)}`).join(' ')

  // Shaded envelopes across axes: the published band (solid) and the widened
  // tolerance band (faint), each a polygon from the hi boundary back along lo.
  const envelope = (widen: number) => {
    const top = AXES.map((a, i) => {
      const [lo, hi] = range(a.key)
      const w = hi - lo || 1e-9
      return `${axisX(i).toFixed(1)},${scaleY(a.key, hi + widen * w).toFixed(1)}`
    })
    const bot = [...AXES]
      .reverse()
      .map((a, ri) => {
        const i = AXES.length - 1 - ri
        const [lo, hi] = range(a.key)
        const w = hi - lo || 1e-9
        return `${axisX(i).toFixed(1)},${scaleY(a.key, lo - widen * w).toFixed(1)}`
      })
    return [...top, ...bot].join(' ')
  }

  const selected = detail
  const active = hoverId ?? selectedId

  return (
    <div className="view">
      <div className="main-panel immersive">
        <div className="controls-bar">
          <label className="ctl">
            Target style
            <select value={styleId} onChange={(e) => setStyleId(e.target.value)} style={{ maxWidth: 300 }}>
              {eligibleStyles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.categoryId ? `${s.id} — ` : ''}
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ctl" title="How far outside the published ranges a recipe may sit and still count">
            Tolerance
            <input type="range" min={0} max={0.5} step={0.05} value={tol} onChange={(e) => setTol(Number(e.target.value))} />
            <span className="val">±{Math.round(tol * 100)}%</span>
          </label>
          <span className="ctl" style={{ color: error ? '#ff9b9b' : 'var(--muted)', fontSize: 12 }}>
            {error
              ? `Couldn't load recipes`
              : loading
                ? 'loading…'
                : `${matches.length.toLocaleString()} recipe${matches.length === 1 ? '' : 's'} in range${
                    apiTotal != null && apiTotal > candidates.length
                      ? ` · random ${candidates.length.toLocaleString()}-recipe sample of ${apiTotal.toLocaleString()} in the window`
                      : ''
                  }${apiEnabled && !apiLive ? ' · live API unreachable, using bundled snapshot' : ''}`}
          </span>
        </div>
        <div className="stage">
          <div className="cardtools">
            <ChartHelp title="Reading the style explorer">
              <p>
                Pick a target style and this finds every recipe in the corpus whose vital
                statistics fall inside that style's <strong>published ranges</strong>, then
                lays them out on a parallel-coordinates plot so you can compare them at a
                glance.
              </p>
              <h3>How to read it</h3>
              <ul>
                <li>
                  Each of the five vertical axes is one vital (OG, FG, ABV, IBU, SRM), scaled
                  to the neighborhood of the target style.
                </li>
                <li>
                  The shaded band is the style's published range — solid for the exact range,
                  faint for the tolerance-widened range.
                </li>
                <li>
                  Every line is one in-range recipe, threading through its five values and
                  painted its actual beer color. Lines that hug the middle of the band are
                  textbook examples; lines riding the edges are the outliers.
                </li>
              </ul>
              <h3>Interactions</h3>
              <p>
                Raise <em>Tolerance</em> to admit near-misses. Hover a line, or a recipe in
                the sidebar list, to highlight it; click for its full grain bill and hop
                schedule.
              </p>
            </ChartHelp>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Recipes in the range of ${style.name}`}>
            {/* tolerance-widened band */}
            {tol > 0 && <polygon points={envelope(tol)} fill="var(--accent)" opacity={0.08} />}
            {/* published band */}
            <polygon points={envelope(0)} fill="var(--accent)" opacity={0.16} />

            {/* axes */}
            {AXES.map((a, i) => {
              const [dmin, dmax] = domains[a.key]
              const [lo, hi] = range(a.key)
              return (
                <g key={a.key}>
                  <line x1={axisX(i)} y1={PAD.t} x2={axisX(i)} y2={H - PAD.b} stroke="#3a3a37" strokeWidth={1} />
                  {/* range end ticks */}
                  {[lo, hi].map((v, k) => (
                    <g key={k}>
                      <line x1={axisX(i) - 6} y1={scaleY(a.key, v)} x2={axisX(i) + 6} y2={scaleY(a.key, v)} stroke="var(--accent)" strokeWidth={1.5} />
                      <text x={axisX(i) + 10} y={scaleY(a.key, v) + 3} fontSize={11} fill="var(--ink-2)">
                        {a.fmt(v)}
                      </text>
                    </g>
                  ))}
                  <text x={axisX(i)} y={H - PAD.b + 26} fontSize={14} fontWeight={650} fill="var(--ink)" textAnchor="middle">
                    {a.label}
                  </text>
                  <text x={axisX(i)} y={PAD.t - 12} fontSize={10.5} fill="var(--muted)" textAnchor="middle">
                    {a.fmt(dmax)}
                  </text>
                  <text x={axisX(i)} y={H - PAD.b + 44} fontSize={10.5} fill="var(--muted)" textAnchor="middle">
                    {a.fmt(dmin)}
                  </text>
                </g>
              )
            })}

            {/* recipe polylines (non-active first, active on top) */}
            {matches.map(({ r }) => {
              const isActive = active === r.id
              if (isActive) return null
              return (
                <path
                  key={r.id}
                  d={linePath(r)}
                  fill="none"
                  stroke={srmToHex(r.vitals.srm ?? 4)}
                  strokeWidth={active == null ? 1.6 : 1}
                  opacity={active == null ? 0.6 : 0.18}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHoverId(r.id)}
                  onMouseLeave={() => setHoverId((h) => (h === r.id ? null : h))}
                  onClick={() => setSelectedId(r.id)}
                />
              )
            })}
            {active != null &&
              (() => {
                const r = candidates.find((x) => x.id === active)
                if (!r || !hasAllVitals(r)) return null
                return (
                  <path
                    d={linePath(r)}
                    fill="none"
                    stroke={srmToHex(r.vitals.srm ?? 4)}
                    strokeWidth={3}
                    opacity={1}
                    style={{ filter: 'drop-shadow(0 0 3px #000)' }}
                  />
                )
              })()}
          </svg>
        </div>
      </div>
      <SidePanel>
        <div className="detail" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {selected ? (
            <>
              <button className="ctl" style={{ alignSelf: 'flex-start', cursor: 'pointer' }} onClick={() => setSelectedId(null)}>
                ← all {matches.length} in range
              </button>
              <h2 style={{ marginBottom: 0 }}>{selected.name}</h2>
              <p style={{ color: 'var(--muted)', marginTop: 0 }}>
                {selected.styleGuess ? `${selected.styleGuess.code} ${selected.styleGuess.name}` : selected.family}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[
                  selected.vitals.abv != null && `${selected.vitals.abv.toFixed(1)}% ABV`,
                  selected.vitals.ibu != null && `${Math.round(selected.vitals.ibu)} IBU`,
                  selected.vitals.srm != null && `${selected.vitals.srm.toFixed(1)} SRM`,
                  selected.vitals.og != null && `OG ${selected.vitals.og.toFixed(3)}`,
                  selected.vitals.fg != null && `FG ${selected.vitals.fg.toFixed(3)}`,
                  selected.attenuation != null && `${selected.attenuation.toFixed(0)}% att`,
                ]
                  .filter(Boolean)
                  .map((s, i) => (
                    <span key={i} style={{ border: '1px solid var(--border,#2a2a2a)', borderRadius: 6, padding: '2px 7px', fontSize: 12 }}>
                      {s}
                    </span>
                  ))}
              </div>
              {selected.malts.length > 0 && (
                <>
                  <h3>Grist</h3>
                  <GristBar rows={selected.malts.map((m) => ({ name: m.name, pct: m.pct, class: m.class }))} />
                </>
              )}
              {selected.hops.length > 0 && (
                <>
                  <h3>Hops</h3>
                  <HopScheduleList rows={selected.hops.map((h) => ({ name: h.name, g: h.g, stage: h.stage }))} />
                </>
              )}
            </>
          ) : (
            <>
              <h2 style={{ marginBottom: 2 }}>
                In range of {style.id} {style.name}
              </h2>
              <p style={{ color: 'var(--muted)', marginTop: 0 }}>
                {matches.length} recipe{matches.length === 1 ? '' : 's'} · sorted by how many vitals sit inside the exact range
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto' }}>
                {matches.map(({ r, fit }) => (
                  <div
                    key={r.id}
                    className="rowbtn"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 6px',
                      borderRadius: 6,
                      background: hoverId === r.id ? 'var(--surface-2, rgba(255,255,255,0.06))' : 'transparent',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={() => setHoverId(r.id)}
                    onMouseLeave={() => setHoverId((h) => (h === r.id ? null : h))}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <span className="srmdot" style={{ background: srmToHex(r.vitals.srm ?? 4), border: 'none' }} />
                    <span style={{ flex: 1, fontSize: 13 }}>{r.name}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>
                      {r.vitals.abv?.toFixed(1)}% · {Math.round(r.vitals.ibu ?? 0)} IBU
                    </span>
                    <span title="vitals inside the exact range" style={{ color: fit === 5 ? 'var(--accent)' : 'var(--muted)', fontSize: 11 }}>
                      {fit}/5
                    </span>
                  </div>
                ))}
                {matches.length === 0 && (
                  <p style={{ color: 'var(--muted)' }}>No recipes in range — raise the tolerance or pick another style.</p>
                )}
              </div>
            </>
          )}
        </div>
      </SidePanel>
    </div>
  )
}
