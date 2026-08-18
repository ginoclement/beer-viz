import { useEffect, useState, type ReactNode } from 'react'

/**
 * A "?" icon for a chart corner that opens a modal explaining what the
 * visualization shows and how to read it. Close via ×, backdrop click,
 * or Escape.
 */
export default function ChartHelp({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        className="helpx"
        onClick={() => setOpen(true)}
        title="What am I looking at?"
        aria-label={`Explain: ${title}`}
      >
        ?
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="closex" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
            <h2>{title}</h2>
            {children}
          </div>
        </div>
      )}
    </>
  )
}
