import type { TradingCalendar } from '../time/market.js'
import { humanDuration } from '../time/market.js'

export interface DiffWindow {
  windowStart: Date
  windowEnd: Date
  /** Trading sessions spanned. Used to scale the residual sigma. */
  sessions: number
  isFirstVisit: boolean
  awayMs: number
  awayLabel: string
}

/**
 * Turn a read cursor into the window we diff against.
 *
 * The window is the user's, not the market's. If they last looked at 10:14 this
 * morning the window is 10:14 -> now; if they last looked on Friday it spans the
 * weekend. Everything downstream — sigma scaling, cumulative signals, replay —
 * is expressed in terms of this window rather than "today".
 */
export function resolveWindow(params: {
  lastSeenAt: Date | null
  at: Date
  calendar: TradingCalendar
  /** How far back to look for someone who has never opened the app. */
  firstVisitSessions?: number
}): DiffWindow {
  const { lastSeenAt, at, calendar } = params
  const firstVisitSessions = params.firstVisitSessions ?? 1

  if (lastSeenAt === null) {
    // A first visit has no "before". We show the most recent completed session
    // so the product has something honest to say, and label it as such.
    const sessions = calendar.allSessions
    const idx = Math.max(0, sessions.length - 1 - firstVisitSessions)
    const startDate = sessions[idx] ?? sessions[0]
    const windowStart = startDate ? new Date(`${startDate}T10:00:00.000Z`) : at
    return {
      windowStart,
      windowEnd: at,
      sessions: Math.max(1, calendar.sessionsBetween(windowStart, at)),
      isFirstVisit: true,
      awayMs: at.getTime() - windowStart.getTime(),
      awayLabel: 'your first look',
    }
  }

  // A cursor from the future (clock skew across devices) must not invert the window.
  const start = lastSeenAt.getTime() > at.getTime() ? at : lastSeenAt
  const awayMs = Math.max(0, at.getTime() - start.getTime())

  return {
    windowStart: start,
    windowEnd: at,
    sessions: calendar.sessionsBetween(start, at),
    isFirstVisit: false,
    awayMs,
    awayLabel: humanDuration(awayMs),
  }
}
