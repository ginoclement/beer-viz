/**
 * Shared "how many recipes to show" control for every recipe-driven chart.
 * Discrete steps (server requests, not a continuum) plus Show all.
 * `value` is the requested size; 0 means "all".
 */
export const SAMPLE_STEPS = [500, 2000, 8000] as const
export const SAMPLE_ALL = 0

export function sampleLimit(value: number): number {
  return value === SAMPLE_ALL ? 60000 : value
}

export default function SampleSize({
  value,
  onChange,
  total,
}: {
  value: number
  onChange: (v: number) => void
  total: number | null
}) {
  const steps = SAMPLE_STEPS.filter((s) => total == null || s < total)
  return (
    <label className="ctl" title="Charts stay honest: the label always shows how many of the corpus you're seeing">
      Recipes
      <span className="seg">
        {steps.map((s) => (
          <button key={s} className={value === s ? 'active' : ''} onClick={() => onChange(s)}>
            {s >= 1000 ? `${s / 1000}k` : s}
          </button>
        ))}
        <button className={value === SAMPLE_ALL ? 'active' : ''} onClick={() => onChange(SAMPLE_ALL)}>
          All{total != null ? ` ${total.toLocaleString()}` : ''}
        </button>
      </span>
    </label>
  )
}
