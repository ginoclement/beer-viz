import type { BeerStyle } from '../lib/types'
import { srmToHex } from '../lib/srm'
import { DESCRIPTOR_FAMILIES, extractDescriptors } from '../lib/descriptors'

function fmtRange(r: [number, number] | null, digits = 0): string {
  if (!r) return '—'
  const f = (x: number) => x.toFixed(digits)
  return r[0] === r[1] ? f(r[0]) : `${f(r[0])} – ${f(r[1])}`
}

function DescriptorFingerprint({ style }: { style: BeerStyle }) {
  const descriptors = extractDescriptors(style)
  if (descriptors.length === 0) return null
  return (
    <>
      <h3>Flavor fingerprint (mined from the prose)</h3>
      {DESCRIPTOR_FAMILIES.map((fam) => {
        const ds = descriptors.filter((d) => d.family === fam)
        if (ds.length === 0) return null
        return (
          <div key={fam} style={{ margin: '4px 0' }}>
            <span style={{ color: 'var(--muted)', fontSize: 11.5, marginRight: 6 }}>{fam}</span>
            <span className="tagchips" style={{ display: 'inline-flex', margin: 0 }}>
              {ds.map((d) => (
                <span
                  key={d.name}
                  className="chip"
                  style={d.strength > 1 ? { color: 'var(--ink)', borderColor: 'var(--muted)' } : undefined}
                  title={`mentioned in ${d.strength} of aroma/flavor/impression`}
                >
                  {d.name}
                </span>
              ))}
            </span>
          </div>
        )
      })}
    </>
  )
}

export default function StyleDetail({
  style,
  sharedTags,
  onClose,
  onViewIn3d,
}: {
  style: BeerStyle
  sharedTags?: Set<string>
  onClose?: () => void
  /** jump to the 3D style-space tab with this style selected */
  onViewIn3d?: () => void
}) {
  const srm = style.stats.srm
  return (
    <div className="detail">
      {onClose && (
        <button className="closex" onClick={onClose} aria-label="Close details">
          ×
        </button>
      )}
      <h2>
        {style.categoryId ? `${style.id} ` : ''}
        {style.name}
      </h2>
      <div className="cat">{style.category}</div>
      {onViewIn3d && style.hasStats && (
        <button className="btn view3d" onClick={onViewIn3d}>
          View in 3D style space ↗
        </button>
      )}

      <div className="swatch-row">
        <div
          className="swatch"
          style={
            srm
              ? {
                  background: `linear-gradient(135deg, ${srmToHex(srm[0])}, ${srmToHex(srm[1])})`,
                }
              : { background: 'var(--surface-2)' }
          }
          title={srm ? `SRM ${fmtRange(srm)}` : 'No color data'}
        />
        <dl className="statgrid" style={{ margin: 0 }}>
          <dt>ABV</dt>
          <dd>{fmtRange(style.stats.abv, 1)} %</dd>
          <dt>IBU</dt>
          <dd>{fmtRange(style.stats.ibu)}</dd>
          <dt>SRM</dt>
          <dd>{fmtRange(style.stats.srm)}</dd>
        </dl>
      </div>
      <dl className="statgrid">
        <dt>OG</dt>
        <dd>{fmtRange(style.stats.og, 3)}</dd>
        <dt>FG</dt>
        <dd>{fmtRange(style.stats.fg, 3)}</dd>
      </dl>

      {style.tags.length > 0 && (
        <>
          <h3>Tags{style.tagsSynthesized ? ' (derived from stats)' : ''}</h3>
          <div className="tagchips">
            {style.tags.map((t) => (
              <span key={t} className={`chip${sharedTags?.has(t) ? ' shared' : ''}`}>
                {t}
              </span>
            ))}
          </div>
        </>
      )}

      <DescriptorFingerprint style={style} />

      {style.impression && (
        <>
          <h3>Overall impression</h3>
          <p>{style.impression}</p>
        </>
      )}
      {style.comparison && (
        <>
          <h3>Style comparison</h3>
          <p>{style.comparison}</p>
        </>
      )}
      {style.history && (
        <>
          <h3>History</h3>
          <p>{style.history}</p>
        </>
      )}
      {style.examples && (
        <>
          <h3>Commercial examples</h3>
          <p>{style.examples}</p>
        </>
      )}
    </div>
  )
}
