/**
 * Shared pan/zoom plumbing for the canvas force graphs and SVG scatters.
 *
 * The transform maps world coordinates to screen offsets from the view
 * center: screen = world * k + t. Listeners are attached natively (not via
 * React) because wheel needs `passive: false` to stop the page scrolling
 * while zooming a chart.
 */

export interface ViewTransform {
  k: number
  tx: number
  ty: number
}

export const identityView = (): ViewTransform => ({ k: 1, tx: 0, ty: 0 })

/**
 * Set the view so all points (world coords, origin-centered screen) fit the
 * width×height viewport with padding. Used by the force graphs to keep the
 * whole layout visible while it settles, however far the physics spreads it.
 */
export function fitViewToPoints(
  view: ViewTransform,
  pts: { x?: number; y?: number }[],
  width: number,
  height: number,
  pad = 40,
): void {
  if (!pts.length || !width || !height) return
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x == null || p.y == null) continue
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  if (!isFinite(minX)) return
  const bw = maxX - minX + pad * 2
  const bh = maxY - minY + pad * 2
  // never zoom past 1.3 for tiny graphs, never below 0.1 for huge ones
  view.k = Math.min(Math.max(Math.min(width / bw, height / bh), 0.1), 1.3)
  view.tx = (-(minX + maxX) / 2) * view.k
  view.ty = (-(minY + maxY) / 2) * view.k
}

export interface PanZoomOptions {
  /** current transform; mutated in place */
  view: ViewTransform
  /** convert a mouse event to coords relative to the view center */
  toCenter: (e: MouseEvent) => [number, number]
  onChange: () => void
  /** double-click handler; defaults to resetting to the identity view */
  onReset?: () => void
  minK?: number
  maxK?: number
}

/** A press only becomes a pan after this much total movement (px). */
const DRAG_THRESHOLD = 4

/**
 * Attach wheel-zoom (cursor-anchored), drag-pan, and double-click-reset
 * to an element. Returns a cleanup function and a `dragged()` probe that
 * click handlers can use to skip clicks that were actually drags.
 *
 * Small jitter during a click never pans the view: panning only engages
 * once the pointer travels past DRAG_THRESHOLD from the press point, so
 * ordinary clicks select instead of nudging the whole graph.
 */
export function attachPanZoom(
  el: HTMLElement,
  { view, toCenter, onChange, onReset, minK = 0.15, maxK = 10 }: PanZoomOptions,
): { cleanup: () => void; dragged: () => boolean } {
  let panning = false
  let engaged = false // passed the drag threshold
  let moved = false
  let downX = 0
  let downY = 0
  let lastX = 0
  let lastY = 0

  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const [mx, my] = toCenter(e)
    const factor = e.deltaY > 0 ? 1 / 1.18 : 1.18
    const k = Math.min(maxK, Math.max(minK, view.k * factor))
    if (k === view.k) return
    // keep the point under the cursor fixed
    view.tx = mx - ((mx - view.tx) * k) / view.k
    view.ty = my - ((my - view.ty) * k) / view.k
    view.k = k
    onChange()
  }
  const onDown = (e: MouseEvent) => {
    panning = true
    engaged = false
    moved = false
    downX = lastX = e.clientX
    downY = lastY = e.clientY
  }
  const onMove = (e: MouseEvent) => {
    if (!panning) return
    if (!engaged) {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) < DRAG_THRESHOLD) return
      engaged = true
      moved = true
      lastX = e.clientX
      lastY = e.clientY
      return
    }
    view.tx += e.clientX - lastX
    view.ty += e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    onChange()
  }
  const onUp = () => {
    panning = false
    engaged = false
  }
  const onDbl = (e: MouseEvent) => {
    e.preventDefault()
    if (onReset) {
      onReset()
      return
    }
    view.k = 1
    view.tx = 0
    view.ty = 0
    onChange()
  }

  el.addEventListener('wheel', onWheel, { passive: false })
  el.addEventListener('mousedown', onDown)
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  el.addEventListener('dblclick', onDbl)

  return {
    cleanup: () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      el.removeEventListener('dblclick', onDbl)
    },
    dragged: () => moved,
  }
}
