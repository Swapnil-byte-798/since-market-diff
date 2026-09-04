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
import { desc, eq } from 'drizzle-orm'

const USER = 'user_demo'

const [latest] = await db.select({ date: schema.dailyBars.date })
  .from(schema.dailyBars)
  .where(eq(schema.dailyBars.symbolId, '^NSEI'))
  .orderBy(desc(schema.dailyBars.date))
  .limit(1)

if (!latest) {
  console.error('[demo] no market data. Run `npm run ingest` first.')
  process.exit(1)
}

// 10:14 IST on the most recent session — mid-morning, so the window spans real
// intraday data and the scripted events land inside it.
const lastSeenAt = new Date(`${latest.date}T04:44:00.000Z`)

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

console.log(`[demo] reset ${items.length} cursors to ${lastSeenAt.toISOString()} (10:14 IST, ${latest.date})`)
console.log('[demo] cleared change events and investigations')
await sql.end()
