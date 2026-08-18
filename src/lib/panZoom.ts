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

export interface PanZoomOptions {
  /** current transform; mutated in place */
  view: ViewTransform
  /** convert a mouse event to coords relative to the view center */
  toCenter: (e: MouseEvent) => [number, number]
  onChange: () => void
  minK?: number
  maxK?: number
}

/**
 * Attach wheel-zoom (cursor-anchored), drag-pan, and double-click-reset
 * to an element. Returns a cleanup function and a `dragged()` probe that
 * click handlers can use to skip clicks that were actually drags.
 */
export function attachPanZoom(
  el: HTMLElement,
  { view, toCenter, onChange, minK = 1, maxK = 10 }: PanZoomOptions,
): { cleanup: () => void; dragged: () => boolean } {
  let panning = false
  let moved = false
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
    if (view.k === 1) {
      view.tx = 0
      view.ty = 0
    }
    onChange()
  }
  const onDown = (e: MouseEvent) => {
    panning = true
    moved = false
    lastX = e.clientX
    lastY = e.clientY
  }
  const onMove = (e: MouseEvent) => {
    if (!panning) return
    const dx = e.clientX - lastX
    const dy = e.clientY - lastY
    if (dx === 0 && dy === 0) return
    moved = true
    view.tx += dx
    view.ty += dy
    lastX = e.clientX
    lastY = e.clientY
    onChange()
  }
  const onUp = () => {
    panning = false
  }
  const onDbl = (e: MouseEvent) => {
    e.preventDefault()
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
