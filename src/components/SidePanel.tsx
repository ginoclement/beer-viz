import { useState, type ReactNode } from 'react'

/**
 * The detail sidebar as a collapsible overlay: it floats above the graph
 * (which fills the whole viewport underneath) instead of stealing width
 * from it. The chevron tab stays visible when collapsed.
 */
export default function SidePanel({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button
        className={`sidepanel-toggle${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Hide details panel' : 'Show details panel'}
        title={open ? 'Hide details panel' : 'Show details panel'}
      >
        {open ? '⟩' : '⟨'}
      </button>
      <aside className={`sidebar${open ? '' : ' closed'}`}>{children}</aside>
    </>
  )
}
