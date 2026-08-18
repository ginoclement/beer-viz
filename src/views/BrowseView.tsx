import { useMemo, useState } from 'react'
import { useAnalysis } from '../state/useAnalysis'
import { srmToHex } from '../lib/srm'
import type { BeerStyle } from '../lib/types'
import StyleDetail from '../components/StyleDetail'
import SidePanel from '../components/SidePanel'

type SortKey = 'id' | 'name' | 'category' | 'abv' | 'ibu' | 'srm' | 'og'

const midOf = (s: BeerStyle, key: 'abv' | 'ibu' | 'srm' | 'og'): number => {
  const r = s.stats[key]
  return r ? (r[0] + r[1]) / 2 : -1
}

function fmtRange(r: [number, number] | null, digits = 0): string {
  if (!r) return '—'
  const f = (x: number) => x.toFixed(digits)
  return r[0] === r[1] ? f(r[0]) : `${f(r[0])}–${f(r[1])}`
}

export default function BrowseView({ goToSpace }: { goToSpace?: () => void }) {
  const { allStyles, selectedId, setSelectedId } = useAnalysis()
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('id')
  const [asc, setAsc] = useState(true)

  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of allStyles) for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24)
  }, [allStyles])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    let out = allStyles.filter((s) => {
      if (tagFilter && !s.tags.includes(tagFilter)) return false
      if (!q) return true
      return (
        s.name.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.tags.some((t) => t.includes(q)) ||
        (s.impression ?? '').toLowerCase().includes(q)
      )
    })
    const dir = asc ? 1 : -1
    out = [...out].sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return dir * a.name.localeCompare(b.name)
        case 'category':
          return dir * (a.category.localeCompare(b.category) || a.id.localeCompare(b.id))
        case 'abv':
        case 'ibu':
        case 'srm':
        case 'og':
          return dir * (midOf(a, sortKey) - midOf(b, sortKey))
        default:
          return dir * a.id.localeCompare(b.id, undefined, { numeric: true })
      }
    })
    return out
  }, [allStyles, query, tagFilter, sortKey, asc])

  const selected = allStyles.find((s) => s.id === selectedId)

  const header = (key: SortKey, label: string) => (
    <th
      style={{ cursor: 'pointer', userSelect: 'none' }}
      onClick={() => {
        if (sortKey === key) setAsc(!asc)
        else {
          setSortKey(key)
          setAsc(true)
        }
      }}
    >
      {label}
      {sortKey === key ? (asc ? ' ▲' : ' ▼') : ''}
    </th>
  )

  return (
    <div className="view">
      <div className="main-panel">
        <div className="controls-bar">
          <input
            type="text"
            placeholder="Search styles, categories, tags, descriptions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 320 }}
            aria-label="Search styles"
          />
          <span style={{ color: 'var(--muted)' }}>
            {rows.length} of {allStyles.length} styles
          </span>
        </div>
        <div className="charts">
          <div className="tagchips" style={{ marginBottom: 12 }}>
            {tags.map(([t, n]) => (
              <button
                key={t}
                className="chip"
                style={{
                  cursor: 'pointer',
                  background: tagFilter === t ? 'var(--accent)' : undefined,
                  color: tagFilter === t ? '#0d0d0d' : undefined,
                  border: '1px solid var(--border)',
                  font: 'inherit',
                  fontSize: 11.5,
                }}
                onClick={() => setTagFilter(tagFilter === t ? null : t)}
              >
                {t} ({n})
              </button>
            ))}
          </div>
          <div className="chart-card">
            <div className="chart-scroll" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
              <table className="cmp-table">
                <thead>
                  <tr>
                    {header('id', 'ID')}
                    {header('name', 'Style')}
                    {header('category', 'Category')}
                    <th>Color</th>
                    {header('abv', 'ABV %')}
                    {header('ibu', 'IBU')}
                    {header('srm', 'SRM')}
                    {header('og', 'OG')}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const srm = s.stats.srm
                    return (
                      <tr
                        key={s.id}
                        onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}
                        style={{
                          cursor: 'pointer',
                          background: s.id === selectedId ? 'var(--surface-2)' : undefined,
                        }}
                      >
                        <td style={{ color: 'var(--muted)' }}>{s.categoryId ? s.id : '·'}</td>
                        <td>{s.name}</td>
                        <td style={{ color: 'var(--ink-2)' }}>{s.category}</td>
                        <td>
                          {srm ? (
                            <span
                              className="srmdot"
                              style={{
                                background: `linear-gradient(90deg, ${srmToHex(srm[0])}, ${srmToHex(srm[1])})`,
                                width: 26,
                                borderRadius: 4,
                              }}
                            />
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>{fmtRange(s.stats.abv, 1)}</td>
                        <td>{fmtRange(s.stats.ibu)}</td>
                        <td>{fmtRange(s.stats.srm)}</td>
                        <td>{fmtRange(s.stats.og, 3)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <SidePanel>
        {selected ? (
          <StyleDetail style={selected} onClose={() => setSelectedId(null)} onViewIn3d={goToSpace} />
        ) : (
          <div className="detail">
            <h2>Browse every style</h2>
            <p>
              The full table view of the current guideline — search anything (names,
              categories, tags, even words from the descriptions), filter by tag, and click
              a column header to sort. Click a row for the complete guideline entry with
              its mined flavor fingerprint.
            </p>
          </div>
        )}
      </SidePanel>
    </div>
  )
}
