/**
 * SRM -> sRGB hex, from the standard homebrewing SRM color chart
 * (1..40, clamped beyond). Values between integers are interpolated.
 */
const SRM_HEX: string[] = [
  '#FFE699', // 1
  '#FFD878', // 2
  '#FFCA5A', // 3
  '#FFBF42', // 4
  '#FBB123', // 5
  '#F8A600', // 6
  '#F39C00', // 7
  '#EA8F00', // 8
  '#E58500', // 9
  '#DE7C00', // 10
  '#D77200', // 11
  '#CF6900', // 12
  '#CB6200', // 13
  '#C35900', // 14
  '#BB5100', // 15
  '#B54C00', // 16
  '#B04500', // 17
  '#A63E00', // 18
  '#A13700', // 19
  '#9B3200', // 20
  '#952D00', // 21
  '#8E2900', // 22
  '#882300', // 23
  '#821E00', // 24
  '#7B1A00', // 25
  '#771900', // 26
  '#701400', // 27
  '#6A0E00', // 28
  '#660D00', // 29
  '#5E0B00', // 30
  '#5A0A02', // 31
  '#560A05', // 32
  '#520907', // 33
  '#4C0505', // 34
  '#470606', // 35
  '#440607', // 36
  '#3F0708', // 37
  '#3B0607', // 38
  '#3A070B', // 39
  '#36080A', // 40
]

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

export function srmToRgb(srm: number): [number, number, number] {
  const v = Math.min(Math.max(srm, 1), 40)
  const lo = Math.floor(v)
  const hi = Math.min(lo + 1, 40)
  const t = v - lo
  const a = hexToRgb(SRM_HEX[lo - 1])
  const b = hexToRgb(SRM_HEX[hi - 1])
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

export function srmToHex(srm: number): string {
  const [r, g, b] = srmToRgb(srm)
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

export const ebcToSrm = (ebc: number) => ebc / 1.97
export const lovibondToSrm = (l: number) => 1.3546 * l - 0.76
