import { maltClassColor, stageColor, STAGES, type HopStage } from '../lib/ingredients'

/**
 * Grist bar + hop schedule renderer shared by imported-recipe cards and the
 * corpus recipe detail. Rows carry precomputed class/stage so both data
 * sources (imports and the DIY Dog corpus) plug in directly.
 */

export interface GristRow {
  name: string
  pct: number
  class: string
}

export interface HopRow {
  name: string
  g: number
  stage: HopStage
}

export function GristBar({ rows }: { rows: GristRow[] }) {
  if (rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => b.pct - a.pct)
  return (
    <div>
      <div style={{ display: 'flex', gap: 2, height: 12, borderRadius: 6, overflow: 'hidden', margin: '6px 0 8px' }}>
        {sorted.map((m, i) => (
          <div
            key={`${m.name}-${i}`}
            style={{ width: `${m.pct}%`, background: maltClassColor(m.class), minWidth: 2 }}
            title={`${m.name} — ${m.pct.toFixed(1)}% (${m.class})`}
          />
        ))}
      </div>
      {sorted.map((m, i) => (
        <div
          key={`${m.name}-${i}`}
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '1.5px 0' }}
        >
          <span className="srmdot" style={{ background: maltClassColor(m.class), border: 'none', width: 9, height: 9 }} />
          <span style={{ color: 'var(--ink-2)', flex: 1 }}>{m.name}</span>
          <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>{m.class}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 48, textAlign: 'right' }}>
            {m.pct.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  )
}

export function HopScheduleList({ rows, onPickHop }: { rows: HopRow[]; onPickHop?: (name: string) => void }) {
  if (rows.length === 0) return null
  return (
    <div>
      {STAGES.map(({ key, label }) => {
        const stageRows = rows.filter((h) => h.stage === key)
        if (stageRows.length === 0) return null
        return (
          <div key={key} style={{ margin: '4px 0' }}>
            <span style={{ color: 'var(--muted)', fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="srmdot" style={{ background: stageColor(key), border: 'none', width: 9, height: 9 }} />
              {label}
            </span>
            <div className="tagchips" style={{ margin: '3px 0 0 15px' }}>
              {stageRows.map((h, i) => (
                <span
                  key={`${h.name}-${i}`}
                  className="chip"
                  style={onPickHop ? { cursor: 'pointer' } : undefined}
                  onClick={onPickHop ? () => onPickHop(h.name) : undefined}
                  title={onPickHop ? `${h.g} g — open ${h.name} in the Hops tab` : `${h.g} g`}
                >
                  {h.name} · {h.g} g
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
