/**
 * NSE market time, in Asia/Kolkata.
 *
 * Holidays are NOT hardcoded. A hardcoded list is wrong the moment the exchange
 * publishes a new calendar, and a wrong list silently produces wrong windows.
 * Instead we derive the trading calendar from the data itself: any weekday for
 * which the benchmark has no bar was not a trading day. That is empirical,
 * self-maintaining, and cannot drift from reality. See DECISIONS.md #10.
 */

export const NSE_TZ = 'Asia/Kolkata'
export const SESSION_OPEN_MIN = 9 * 60 + 15   // 09:15 IST
export const SESSION_CLOSE_MIN = 15 * 60 + 30 // 15:30 IST

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: NSE_TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
})

export interface IstParts { date: string; minutes: number; weekday: number }

/** Wall-clock parts of an instant, in IST. */
export function istParts(at: Date): IstParts {
  const parts = fmt.formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  const date = `${get('year')}-${get('month')}-${get('day')}`
  let hour = Number(get('hour'))
  if (hour === 24) hour = 0
  const minutes = hour * 60 + Number(get('minute'))
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return { date, minutes, weekday }
}

/** IST calendar date (YYYY-MM-DD) of an instant. */
export function istDate(at: Date): string {
  return istParts(at).date
}

/** A trading calendar derived from which dates the benchmark actually traded. */
export class TradingCalendar {
  private readonly sessions: string[]
  private readonly set: Set<string>

  constructor(sessionDates: readonly string[]) {
    this.sessions = [...new Set(sessionDates)].sort()
    this.set = new Set(this.sessions)
  }

  isSession(date: string): boolean { return this.set.has(date) }

  /** True while the exchange is open on a real trading day. */
  isOpen(at: Date): boolean {
    const { date, minutes } = istParts(at)
    if (!this.isSession(date)) return false
    return minutes >= SESSION_OPEN_MIN && minutes <= SESSION_CLOSE_MIN
  }

  /** The most recent session date on or before `date`. */
  sessionOnOrBefore(date: string): string | null {
    let lo = 0
    let hi = this.sessions.length - 1
    let best: string | null = null
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const v = this.sessions[mid]!
      if (v <= date) { best = v; lo = mid + 1 } else { hi = mid - 1 }
    }
    return best
  }

  /** Number of trading sessions in (start, end]. Minimum 1 so sigma never divides by zero. */
  sessionsBetween(start: Date, end: Date): number {
    const a = istDate(start)
    const b = istDate(end)
    if (b <= a) return 1
    let n = 0
    for (const s of this.sessions) {
      if (s > a && s <= b) n++
      if (s > b) break
    }
    return Math.max(1, n)
  }

  /** Instant of the most recent session close at or before `at`. */
  lastSessionCloseAt(at: Date): Date | null {
    const { date, minutes } = istParts(at)
    const candidate = minutes >= SESSION_CLOSE_MIN && this.isSession(date)
      ? date
      : this.sessionOnOrBefore(prevDate(date))
    if (candidate === null) return null
    // 15:30 IST == 10:00 UTC.
    return new Date(`${candidate}T10:00:00.000Z`)
  }

  get allSessions(): readonly string[] { return this.sessions }
}

function prevDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** Human phrasing for how long the user was away. */
export function humanDuration(ms: number): string {
  if (ms < 60_000) return 'moments'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  if (hours < 24) return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const hrem = hours % 24
  if (days < 7) return hrem > 0 ? `${days}d ${hrem}h` : `${days}d`
  return `${days}d`
}
