import { useEffect, useState, type ReactNode } from 'react'

/**
 * Fullscreen toggle for a chart card. Returns the class to append to the
 * card and a small ⛶ button for its header; Escape collapses.
 */
export function useCardExpand(): { expanded: boolean; cardClass: string; button: ReactNode } {
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  const button = (
    <button
      className="expandx"
      onClick={() => setExpanded((v) => !v)}
      title={expanded ? 'Exit fullscreen (Esc)' : 'View fullscreen'}
      aria-label={expanded ? 'Exit fullscreen' : 'View fullscreen'}
    >
      {expanded ? '🗙' : '⛶'}
    </button>
  )

  return { expanded, cardClass: expanded ? ' fullscreen' : '', button }
}
