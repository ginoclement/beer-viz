import { useEffect, useMemo, useState } from 'react'
import { useAnalysis } from '../state/useAnalysis'
import {
  AGGREGATES,
  MALT_CLASS_ORDER,
  STAGES,
  maltClassColor,
  type CorpusRecipe,
  type HopAgg,
} from '../lib/ingredients'
import { apiEnabled, fetchRecipes, fetchRecipeDetail, rowToRecipe, detailToRecipe } from '../lib/api'
import { loadLocalCorpus } from '../lib/localData'
import { srmToHex } from '../lib/srm'
import { GristBar, HopScheduleList } from '../components/IngredientBill'
import ChartHelp from '../components/ChartHelp'
import SidePanel from '../components/SidePanel'
import { useCardExpand } from '../components/CardExpand'

const fmtG = (g: number) => (g >= 1000 ? `${(g / 1000).toFixed(1)} kg` : `${Math.round(g)} g`)

// ------------------------------------------------------------- hop leaderboard

function HopLeaderboard({
  hops,
  recipeCount,
  onPickHop,
}: {
  hops: HopAgg[]
  recipeCount: number
  onPickHop: (key: string) => void
}) {
  const { cardClass, button } = useCardExpand()
  const rows = useMemo(() => hops.slice(0, 30), [hops])
  const maxG = Math.max(...rows.map((r) => r.totalG), 1)

  return (
    <div className={`chart-card${cardClass}`}>
      <div className="cardtools">
        <ChartHelp title="Reading hop usage">
          <p>
            Every hop addition in the {recipeCount} selected recipes, aggregated per
            variety. The bar is the <strong>total weight used across the corpus</strong>,
            split by when it goes in: bittering (early boil), late boil / whirlpool, and
            dry hop.
          </p>
          <h3>How to read it</h3>
          <ul>
            <li>
              A bar dominated by the dry-hop segment is an aroma hop in practice, whatever
              the catalog says; a mostly-bittering bar is a workhorse alpha hop.
            </li>
            <li>
              <strong>n</strong> is the number of recipes using the variety;{' '}
              <strong>median g/L</strong> is its typical total dose in one batch —
              a practical starting point for your own recipes.
            </li>
          </ul>
          <h3>Interactions</h3>
          <p>
            Click a row to open that variety's chemistry in the Hops tab. Filter by style
            family above to see, say, what stouts actually get hopped with.
          </p>
        </ChartHelp>
        {button}
      </div>
      <h2>What these recipes are actually hopped with</h2>
      <p className="sub">
        Total grams used across {recipeCount} recipes, split by addition stage. Click a
        hop for its chemistry.
      </p>
      <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
        {STAGES.map((s) => (
          <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-2)', fontSize: 12.5 }}>
            <span className="srmdot" style={{ background: s.color, border: 'none' }} />
            {s.label}
          </span>
        ))}
      </div>
      {rows.map((u) => (
        <div
          key={u.key ?? u.name}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2.5px 0', cursor: 'pointer' }}
          onClick={() => u.key && onPickHop(u.key)}
          title={`${u.name}: ${fmtG(u.totalG)} across ${u.recipes} recipes — open in Hops tab`}
        >
          <span style={{ width: 150, fontSize: 12.5, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {u.name}
          </span>
          <div style={{ flex: 1, display: 'flex', gap: 2, height: 10 }}>
            {STAGES.map((s) => {
              const g = u.byStage[s.key] ?? 0
              if (g <= 0) return null
              return (
                <div
                  key={s.key}
                  style={{
                    width: `${(g / maxG) * 100}%`,
                    minWidth: 2,
                    background: s.color,
                    borderRadius: 3,
                  }}
                  title={`${s.label}: ${fmtG(g)}`}
                />
              )
            })}
          </div>
          <span style={{ width: 52, textAlign: 'right', fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
            n={u.recipes}
          </span>
          <span style={{ width: 84, textAlign: 'right', fontSize: 12, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
            {u.medianGpl != null ? `${u.medianGpl.toFixed(1)} g/L` : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------- grist by family

function GristByFamily() {
  const [drill, setDrill] = useState<{ fam: string; cls: string } | null>(null)

  // The grist chart always shows every family for comparison, from the
  // precomputed per-family grist rollup — no corpus iteration in the browser.
  const rows = useMemo(() => {
    return AGGREGATES.families
      .filter(({ n }) => n >= 5)
      .map(({ family, n }) => {
        const avg = AGGREGATES.byFamily[family].grist.byClass
        return { fam: family, n, avg, dark: (avg['roasted'] ?? 0) + (avg['crystal & caramel'] ?? 0) }
      })
      .sort((a, b) => a.dark - b.dark)
  }, [])

  const drillRows = drill ? AGGREGATES.byFamily[drill.fam]?.grist.breakdown[drill.cls] ?? [] : []
  const drillCount = drill ? AGGREGATES.byFamily[drill.fam]?.grist.n ?? 0 : 0
  const drillMax = Math.max(...drillRows.map((r) => r.avgPct), 1)

  return (
    <div className="chart-card">
      <div className="cardtools">
        <ChartHelp title="Reading the grist chart">
          <p>
            For each style family, the average <strong>grain-bill composition by
            weight</strong> across its recipes: what fraction of the grist is base malt,
            wheat/oats, crystal, roasted grain, sugar, and so on.
          </p>
          <h3>How to read it</h3>
          <ul>
            <li>
              Families are sorted by dark-malt character, so the gradient from top to
              bottom is literally the recipe-book version of the color ladder.
            </li>
            <li>
              Lagers are nearly all base malt; stouts trade ~20% of the grist for roasted
              and crystal malts; wheat beers show the grain swap directly.
            </li>
            <li>
              Averages are across each family's recipes (n shown); a family needs at least
              5 recipes to appear.
            </li>
          </ul>
          <h3>Drill down</h3>
          <p>
            <strong>Click any segment</strong> to see the actual malts behind it — e.g.
            click a stout's base segment to learn its backbone is Extra Pale plus Munich
            and Brown malt, not just "base".
          </p>
        </ChartHelp>
      </div>
      <h2>What the grist looks like, family by family</h2>
      <p className="sub">
        Average grain-bill share by malt class. Hover a segment for the exact share —{' '}
        <strong>click it</strong> to see which malts it's made of.
      </p>
      <div style={{ display: 'flex', gap: 14, marginBottom: 10, flexWrap: 'wrap' }}>
        {MALT_CLASS_ORDER.map((cls) => (
          <span key={cls} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-2)', fontSize: 12 }}>
            <span className="srmdot" style={{ background: maltClassColor(cls), border: 'none' }} />
            {cls}
          </span>
        ))}
      </div>
      {rows.map((row) => (
        <div key={row.fam} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}>
          <span style={{ width: 160, fontSize: 12.5, color: 'var(--ink-2)' }}>
            {row.fam} <span style={{ color: 'var(--muted)', fontSize: 11 }}>({row.n})</span>
          </span>
          <div style={{ flex: 1, display: 'flex', gap: 2, height: 14, borderRadius: 5, overflow: 'hidden' }}>
            {MALT_CLASS_ORDER.map((cls) => {
              const v = row.avg[cls]
              if (v < 0.5) return null
              const active = drill?.fam === row.fam && drill?.cls === cls
              return (
                <div
                  key={cls}
                  style={{
                    width: `${v}%`,
                    background: maltClassColor(cls),
                    minWidth: 3,
                    cursor: 'pointer',
                    outline: active ? '2px solid #ffffff' : 'none',
                    outlineOffset: -2,
                  }}
                  title={`${cls}: ${v.toFixed(1)}% of grist — click for the malts behind it`}
                  onClick={() => setDrill(active ? null : { fam: row.fam, cls })}
                />
              )
            })}
          </div>
        </div>
      ))}
      {drill && (
        <div
          style={{
            marginTop: 14,
            padding: '12px 14px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span className="srmdot" style={{ background: maltClassColor(drill.cls), border: 'none' }} />
            <strong style={{ fontSize: 13.5 }}>
              {drill.cls} malts in {drill.fam}
            </strong>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>
              across {drillCount} recipes
            </span>
            <button className="closex" style={{ float: 'none', marginLeft: 'auto' }} onClick={() => setDrill(null)} aria-label="Close breakdown">
              ×
            </button>
          </div>
          {drillRows.slice(0, 14).map((m) => (
            <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 0' }}>
              <span style={{ width: 210, fontSize: 12.5, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.name}
              </span>
              <div style={{ flex: 1, height: 9 }}>
                <div
                  style={{
                    width: `${(m.avgPct / drillMax) * 100}%`,
                    minWidth: 2,
                    height: '100%',
                    background: maltClassColor(drill.cls),
                    borderRadius: 4,
                  }}
                />
              </div>
              <span style={{ width: 110, textAlign: 'right', fontSize: 12, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
                {m.avgPct.toFixed(1)}% of grist
              </span>
              <span style={{ width: 90, textAlign: 'right', fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                {m.count} recipes
              </span>
            </div>
          ))}
          {drillRows.length > 14 && (
            <div style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 4 }}>
              + {drillRows.length - 14} more, each under {drillRows[14].avgPct.toFixed(1)}% of the grist
            </div>
          )}
          <p style={{ color: 'var(--muted)', fontSize: 11.5, margin: '6px 0 0' }}>
            Share = average of this malt's grist percentage across all {drillCount}{' '}
            {drill.fam} recipes (zero when absent); "recipes" counts how many actually use it.
          </p>
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------- ingredients → outcome

type ScatterMode = 'hops' | 'roast'

function OutcomeScatter({
  recipes,
  selected,
  onSelect,
}: {
  recipes: CorpusRecipe[]
  selected: number | null
  onSelect: (id: number) => void
}) {
  const [mode, setMode] = useState<ScatterMode>('hops')
  const [hover, setHover] = useState<{ r: CorpusRecipe; x: number; y: number } | null>(null)
  const { cardClass, button } = useCardExpand()

  const W = 860
  const H = 460
  const PAD = { l: 52, r: 18, t: 12, b: 42 }

  const pts = useMemo(() => {
    return recipes
      .map((r) => {
        if (mode === 'hops') {
          const gpl = r.hopGpl
          if (gpl == null || gpl <= 0 || r.vitals.ibu == null) return null
          return { r, x: gpl, y: r.vitals.ibu }
        }
        if (r.vitals.srm == null) return null
        return { r, x: r.roast ?? 0, y: Math.min(r.vitals.srm, 80) }
      })
      .filter((p): p is { r: CorpusRecipe; x: number; y: number } => p !== null)
  }, [recipes, mode])

  const maxYRaw = Math.max(...pts.map((p) => p.y), 1)
  const maxY = mode === 'hops' ? Math.min(maxYRaw, 150) : maxYRaw
  const xs = pts.map((p) => p.x)
  const maxX = mode === 'hops' ? Math.max(...xs, 1) : Math.max(...xs, 1)
  const xScale = (v: number) =>
    mode === 'hops'
      ? PAD.l + (Math.log10(1 + v) / Math.log10(1 + maxX)) * (W - PAD.l - PAD.r)
      : PAD.l + (v / maxX) * (W - PAD.l - PAD.r)
  const yScale = (v: number) => H - PAD.b - (Math.min(v, maxY) / maxY) * (H - PAD.t - PAD.b)

  const xTicks = mode === 'hops' ? [0, 1, 2, 5, 10, 20, 50].filter((t) => t <= maxX) : [0, 5, 10, 15, 20, 25].filter((t) => t <= maxX)
  const yTicks =
    mode === 'hops'
      ? [0, 25, 50, 75, 100, 125, 150].filter((t) => t <= maxY)
      : [0, 20, 40, 60, 80].filter((t) => t <= maxY)

  return (
    <div className={`chart-card${cardClass}`}>
      <div className="cardtools">
        <ChartHelp title="Reading ingredients → outcome">
          <p>
            Each dot is one recipe, painted its actual color (SRM), connecting what went{' '}
            <em>in</em> to what came <em>out</em>:
          </p>
          <ul>
            <li>
              <strong>Hop load vs. bitterness</strong>: total hop grams per liter against
              IBU (log-ish x axis). The spread at any hop load is the modern-brewing
              story — two beers with 10 g/L can sit at 30 or 100 IBU depending on whether
              the hops go in early (bitterness) or as dry hop (aroma, little bitterness).
            </li>
            <li>
              <strong>Roast vs. color</strong>: share of roasted grain in the grist
              against SRM. Color tracks the roast fraction remarkably tightly — a few
              percent of black malt darkens a beer far more than a lot of crystal.
            </li>
          </ul>
          <h3>Interactions</h3>
          <p>Hover for the recipe; click to open its full ingredient bill in the sidebar.</p>
        </ChartHelp>
        {button}
      </div>
      <h2>Ingredients in, beer out</h2>
      <p className="sub">
        {mode === 'hops'
          ? 'Total hop dose (g/L) vs. measured bitterness — dots colored by beer color.'
          : 'Roasted-grain share of the grist vs. beer color (SRM, capped at 80).'}
      </p>
      <span className="seg" style={{ marginBottom: 10, display: 'inline-flex' }}>
        <button className={mode === 'hops' ? 'active' : ''} onClick={() => setMode('hops')}>
          Hop load → IBU
        </button>
        <button className={mode === 'roast' ? 'active' : ''} onClick={() => setMode('roast')}>
          Roast % → color
        </button>
      </span>
      <div className="chart-scroll" style={{ position: 'relative' }}>
        <svg width={W} height={H} role="img" aria-label="Ingredient quantities versus measured outcomes">
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={yScale(t)} y2={yScale(t)} stroke="var(--grid)" />
              <text x={PAD.l - 8} y={yScale(t) + 4} textAnchor="end" fill="var(--muted)" fontSize={11}>
                {t}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <g key={t}>
              <line x1={xScale(t)} x2={xScale(t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--grid)" />
              <text x={xScale(t)} y={H - PAD.b + 18} textAnchor="middle" fill="var(--muted)" fontSize={11}>
                {t}
              </text>
            </g>
          ))}
          <text x={(W + PAD.l - PAD.r) / 2} y={H - 6} textAnchor="middle" fill="var(--ink-2)" fontSize={12}>
            {mode === 'hops' ? 'Total hops (g per liter)' : 'Roasted grain (% of grist)'}
          </text>
          <text
            x={14}
            y={(H + PAD.t - PAD.b) / 2}
            textAnchor="middle"
            fill="var(--ink-2)"
            fontSize={12}
            transform={`rotate(-90 14 ${(H + PAD.t - PAD.b) / 2})`}
          >
            {mode === 'hops' ? 'IBU' : 'SRM'}
          </text>
          {pts.map((p) => {
            const sel = p.r.id === selected
            return (
              <circle
                key={p.r.id}
                cx={xScale(p.x)}
                cy={yScale(p.y)}
                r={sel ? 8 : 5}
                fill={srmToHex(p.r.vitals.srm ?? 5)}
                stroke={sel ? '#ffffff' : 'var(--page)'}
                strokeWidth={sel ? 2 : 1}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHover({ r: p.r, x: xScale(p.x), y: yScale(p.y) })}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect(p.r.id)}
              />
            )
          })}
        </svg>
        {hover && (
          <div className="tooltip3d" style={{ left: hover.x, top: hover.y }}>
            <div className="t-name">{hover.r.name}</div>
            <div className="t-sub">{hover.r.tagline}</div>
            <div className="t-stats">
              {hover.r.vitals.abv ?? '—'}% ABV · {hover.r.vitals.ibu ?? '—'} IBU ·{' '}
              {hover.r.vitals.srm ?? '—'} SRM
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ sidebar

function CorpusRecipeDetail({
  recipe,
  onPickHop,
  onClose,
}: {
  recipe: CorpusRecipe
  onPickHop: (key: string) => void
  onClose: () => void
}) {
  const v = recipe.vitals
  return (
    <div className="detail">
      <button className="closex" onClick={onClose} aria-label="Close recipe">
        ×
      </button>
      <h2>{recipe.name}</h2>
      <div className="cat">
        {recipe.tagline} {recipe.year ? `· ${recipe.year}` : ''}
      </div>
      <p style={{ margin: '4px 0' }}>
        <span className="pill">{recipe.family}</span>{' '}
        {recipe.batchL ? <span className="pill">{recipe.batchL} L batch</span> : null}
      </p>
      <dl className="statgrid">
        <dt>OG / FG</dt>
        <dd>
          {v.og?.toFixed(3) ?? '—'} / {v.fg?.toFixed(3) ?? '—'}
        </dd>
        <dt>ABV</dt>
        <dd>{v.abv != null ? `${v.abv}%` : '—'}</dd>
        <dt>IBU / SRM</dt>
        <dd>
          {v.ibu ?? '—'} / {v.srm ?? '—'}
        </dd>
      </dl>
      <h3>Grist</h3>
      <GristBar rows={recipe.malts.map((m) => ({ name: m.name, pct: m.pct, class: m.class }))} />
      <h3>Hop schedule</h3>
      <HopScheduleList
        rows={recipe.hops}
        onPickHop={(name) => {
          const key = recipe.hops.find((h) => h.name === name)?.key
          if (key) onPickHop(key)
        }}
      />
      {recipe.yeast && (
        <>
          <h3>Yeast</h3>
          <p>{recipe.yeast}</p>
        </>
      )}
      {recipe.description && (
        <>
          <h3>BrewDog's notes</h3>
          <p>{recipe.description}…</p>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ the view

export type IngredientsPage = 'usage' | 'grist' | 'outcome'

export default function IngredientsView({ page = 'usage', goToHops }: { page?: IngredientsPage; goToHops?: () => void }) {
  const { setHopKey } = useAnalysis()
  const [family, setFamily] = useState<string>('all')
  const [selectedRecipe, setSelectedRecipe] = useState<number | null>(null)

  const families = AGGREGATES.families
  const famAgg = AGGREGATES.byFamily[family] ?? AGGREGATES.byFamily.all

  // The scatter is the one per-recipe chart, so it still needs rows. In API
  // mode we fetch a bounded family sample from the beer-api; offline we lazy-
  // load the bundled corpus and filter it (the leaderboard/grist read rollups).
  const [recipes, setRecipes] = useState<CorpusRecipe[]>([])
  const [detail, setDetail] = useState<CorpusRecipe | null>(null)

  useEffect(() => {
    let ok = true
    const ctrl = new AbortController()
    ;(async () => {
      try {
        if (apiEnabled) {
          const res = await fetchRecipes(
            { family: family === 'all' ? undefined : family, limit: 500 },
            ctrl.signal,
          )
          if (ok) setRecipes(res.recipes.map(rowToRecipe))
        } else {
          const corpus = await loadLocalCorpus()
          if (ok) setRecipes(family === 'all' ? corpus.recipes : corpus.recipes.filter((r) => r.family === family))
        }
      } catch {
        /* the scatter simply shows fewer points */
      }
    })()
    return () => {
      ok = false
      ctrl.abort()
    }
  }, [family])

  // Full detail (grain bill + hops) for the clicked dot.
  useEffect(() => {
    if (selectedRecipe == null) {
      setDetail(null)
      return
    }
    const cand = recipes.find((r) => r.id === selectedRecipe) ?? null
    setDetail(cand)
    if (!apiEnabled || !cand) return
    let ok = true
    fetchRecipeDetail(selectedRecipe)
      .then((d) => {
        if (ok) setDetail(detailToRecipe(d))
      })
      .catch(() => {})
    return () => {
      ok = false
    }
  }, [selectedRecipe, recipes])

  const pickHop = (key: string) => {
    setHopKey(key)
    goToHops?.()
  }

  const selected = detail

  return (
    <div className="view">
      <div className="main-panel">
        <div className="controls-bar">
          <label className="ctl">
            Style family
            <select value={family} onChange={(e) => setFamily(e.target.value)} style={{ maxWidth: 240 }}>
              <option value="all">All families ({AGGREGATES.totalRecipes})</option>
              {families.map(({ family: f, n }) => (
                <option key={f} value={f}>
                  {f} ({n})
                </option>
              ))}
            </select>
          </label>
          <span style={{ color: 'var(--muted)' }}>
            {AGGREGATES.totalRecipes} recipes with full ingredient bills
          </span>
        </div>
        <div className="charts">
          {page === 'usage' && (
            <HopLeaderboard hops={famAgg.hops} recipeCount={famAgg.outcome.n} onPickHop={pickHop} />
          )}
          {page === 'outcome' && (
            <OutcomeScatter recipes={recipes} selected={selectedRecipe} onSelect={setSelectedRecipe} />
          )}
          {page === 'grist' && <GristByFamily />}
        </div>
      </div>
      <SidePanel>
        {selected ? (
          <CorpusRecipeDetail
            recipe={selected}
            onPickHop={pickHop}
            onClose={() => setSelectedRecipe(null)}
          />
        ) : (
          <div className="detail">
            <h2>Real recipes, real ingredients</h2>
            <p>
              The style guidelines tell you what a beer should taste like;{' '}
              this tab shows what brewers actually put in the kettle. Every chart is
              computed from {AGGREGATES.totalRecipes} published commercial recipes with complete
              grain bills, hop schedules, and yeast.
            </p>
            <p>
              Filter by style family, click a dot for a full recipe, and click any hop to
              jump to its chemistry on the Hops tab.
            </p>
            <p>
              Want your own brews in here? Import them on the <em>My Recipes</em> tab —
              Brewfather JSON and BeerXML exports (including Brewer's Friend recipe
              exports) now carry their full ingredient bills in with them.
            </p>
            <h3>Source</h3>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>{AGGREGATES.source}. Recipes © BrewDog, published for homebrewers.</p>
          </div>
        )}
      </SidePanel>
    </div>
  )
}
