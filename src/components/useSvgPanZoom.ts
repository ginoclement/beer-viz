import { useEffect, useRef, useState, type RefObject } from 'react'
import { attachPanZoom, identityView, type ViewTransform } from '../lib/panZoom'

/**
 * Wheel-zoom + drag-pan for a full-bleed SVG that scales its W×H world into
 * the viewport with preserveAspectRatio="meet". Returns the viewBox to
 * render. Pan is clamped so the world can never be dragged fully
 * off-screen, and zoom-out stops at fit — the chart stays locked to the
 * screen instead of floating around inside it.
 */
export function useSvgPanZoom(
  svgRef: RefObject<SVGSVGElement>,
  W: number,
  H: number,
  { minK = 1, maxK = 10, clamp = true }: { minK?: number; maxK?: number; clamp?: boolean } = {},
) {
  const [zoom, setZoom] = useState(identityView())
  const draggedRef = useRef<() => boolean>(() => false)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const view = identityView()
    // world units per screen pixel at k=1 under "meet" scaling
    const upp = () => {
      const rect = svg.getBoundingClientRect()
      return Math.max(W / rect.width, H / rect.height)
    }
    const clampView = (v: ViewTransform) => {
      if (!clamp) return
      const mx = (W * Math.max(v.k - 1, 0)) / 2
      const my = (H * Math.max(v.k - 1, 0)) / 2
      v.tx = Math.min(mx, Math.max(-mx, v.tx))
      v.ty = Math.min(my, Math.max(-my, v.ty))
    }
    const pz = attachPanZoom(svg as unknown as HTMLElement, {
      view,
      toCenter: (e) => {
        const rect = svg.getBoundingClientRect()
        const u = upp()
        return [
          (e.clientX - rect.left - rect.width / 2) * u,
          (e.clientY - rect.top - rect.height / 2) * u,
        ]
      },
      panScale: upp,
      onChange: () => {
        clampView(view)
        setZoom({ ...view })
      },
      onReset: () => {
        view.k = 1
        view.tx = 0
        view.ty = 0
        setZoom({ ...view })
      },
      minK,
      maxK,
    })
    draggedRef.current = pz.dragged
    setZoom(identityView())
    return pz.cleanup
  }, [svgRef, W, H, minK, maxK, clamp])

  const k = zoom.k
  const vb = {
    x: W / 2 - zoom.tx / k - W / (2 * k),
    y: H / 2 - zoom.ty / k - H / (2 * k),
    w: W / k,
    h: H / k,
  }
  return { vb, k, dragged: () => draggedRef.current() }
}
