/**
 * Reset the demo to its opening state.
 *
 * Reading the brief advances read cursors — correctly, that is the whole point —
 * which means the demo is not repeatable without this. Rewinds every cursor to
 * mid-session on the last trading day and clears derived state.
 *
 *   npm run demo:reset
 */
import { sql, db, schema } from '@since/db'
import { desc, eq, inArray } from 'drizzle-orm'
import { marketFor, istParts } from '@since/core'

const USER = 'user_demo'

/**
 * The instant, in UTC, whose local time on `date` is `minute` past midnight in
 * `timeZone`. Walked rather than offset-arithmetic, so DST is handled and this
 * works for any exchange.
 */
function instantAt(date: string, minute: number, timeZone: string): Date {
  const base = Date.parse(`${date}T00:00:00.000Z`)
  for (let step = 0; step < 96; step++) {
    const candidate = new Date(base + step * 15 * 60_000)
    const p = istParts(candidate, timeZone)
    if (p.date === date && p.minutes >= minute) return candidate
  }
  return new Date(base)
}

// Which market is seeded decides the benchmark and the session clock.
const [watched] = await db.select({ symbolId: schema.watchlistItems.symbolId })
  .from(schema.watchlistItems).limit(1)
const market = marketFor(watched?.symbolId?.endsWith('.NS') ? 'nifty50' : 'us')

const [latest] = await db.select({ date: schema.dailyBars.date })
  .from(schema.dailyBars)
  .where(eq(schema.dailyBars.symbolId, market.benchmarkId))
  .orderBy(desc(schema.dailyBars.date))
  .limit(1)

if (!latest) {
  console.error('[demo] no market data. Run `npm run ingest` first.')
  process.exit(1)
}

// About an hour after the open on the most recent session. Mid-morning means
// the window spans real intraday bars rather than sitting before the bell or
// after the close, where a replay would have nothing in it.
const lastSeenAt = instantAt(latest.date, market.openMinute + 59, market.timeZone)

const items = await db.select({ symbolId: schema.watchlistItems.symbolId })
  .from(schema.watchlistItems)
  .innerJoin(schema.watchlists, eq(schema.watchlists.id, schema.watchlistItems.watchlistId))
  .where(eq(schema.watchlists.userId, USER))

await db.delete(schema.readCursors).where(eq(schema.readCursors.userId, USER))
if (items.length > 0) {
  await db.insert(schema.readCursors).values(items.map((i) => ({
    userId: USER, symbolId: i.symbolId,
    lastSeenAt, lastSeenVersion: lastSeenAt.getTime(), lastSeenPrice: null,
  })))
}

// Derived state is rebuilt on the next brief; investigations cascade with it.
await db.delete(schema.changeEvents).where(eq(schema.changeEvents.userId, USER))

const local = istParts(lastSeenAt, market.timeZone)
const hh = String(Math.floor(local.minutes / 60)).padStart(2, '0')
const mm = String(local.minutes % 60).padStart(2, '0')
console.log(`[demo] reset ${items.length} cursors to ${hh}:${mm} ${market.label} time on ${latest.date}`)
console.log('[demo] cleared change events and investigations')
await sql.end()
