export const pct = (v: number | null | undefined, dp = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(dp)}%`

export const rupees = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? '—'
    : `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const sigma = (v: number | null | undefined, dp = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${Math.abs(v).toFixed(dp)}σ`

export function ago(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export const timeIST = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true,
  })

export const dateIST = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric',
  })
