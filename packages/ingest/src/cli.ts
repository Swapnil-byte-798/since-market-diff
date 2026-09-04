/**
 * One-shot ingestion. The ONLY component that talks to an external market feed.
 *
 * Everything on the request path reads Postgres, so a demo can never be broken
 * by a third party's availability or rate limits. Re-running is safe: every
 * write is an idempotent upsert keyed on natural identity.
 *
 *   npm run ingest                      real NSE data via Yahoo
 *   npm run ingest -- --provider synthetic
 *   npm run ingest -- --no-faults       skip injected data-quality faults
 */
import { sql, db, schema } from '@since/db'
import { desc, eq, sql as dsql } from 'drizzle-orm'
import { detectSuspectBar, logReturn, type DailyBar } from '@since/core'
import { UNIVERSE, SECTORS, BENCHMARK, BENCHMARK_ID, symbolId } from './universe.js'
import { YahooProvider } from './providers/yahoo.js'
import { SyntheticProvider } from './providers/synthetic.js'
import { computeSymbolStats, buildFallbackGrid } from './stats.js'
import type { MarketDataProvider } from './provider.js'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1]! : dflt
}

const PROVIDER = opt('provider', 'yahoo')
const YEARS = Number(opt('years', '3'))
const INTRADAY_DAYS = Number(opt('intraday-days', '55'))
const WITH_FAULTS = !flag('no-faults')
const CLEAN = flag('clean')
const CONCURRENCY = Number(opt('concurrency', '3'))

const DEMO_EMAIL = 'demo@since.local'
/** A realistic watchlist: big enough that filtering is visibly doing work. */
const DEMO_WATCHLIST_SIZE = 30

/**
 * Symbols carrying injected data-quality faults.
 *
 * STALE_FEED_SYMBOL gets NO closing-price observation written for it. That is
 * what a stopped feed actually means — and without it the fault silently expires
 * at 15:30 when the session-close observation lands and supersedes it, turning
 * the "stale data" scenario back into a healthy one mid-demo.
 */
const STALE_FEED_SYMBOL = 'RELIANCE.NS'
const CONFLICT_SYMBOL = 'ONGC.NS'

async function main(): Promise<void> {
  const t0 = Date.now()
  const today = new Date()
  const toDate = today.toISOString().slice(0, 10)
  const fromDate = new Date(today.getTime() - YEARS * 365 * 86400_000).toISOString().slice(0, 10)
  const intradayFrom = new Date(today.getTime() - INTRADAY_DAYS * 86400_000).toISOString().slice(0, 10)

  let provider: MarketDataProvider =
    PROVIDER === 'synthetic' ? new SyntheticProvider(toDate) : new YahooProvider()

  log(`provider=${provider.source} simulated=${provider.isSimulated} range=${fromDate}..${toDate}`)

  // Mixing providers inside one dataset would silently corrupt every statistic:
  // real bars for 2024 and synthetic bars for 2026 produce a fictitious return
  // at the seam. --clean makes a run reproducible from empty.
  if (CLEAN) {
    await db.execute(dsql`TRUNCATE daily_bars, intraday_bars, corporate_actions,
      market_events, symbol_stats, observations, change_events, data_quarantine
      RESTART IDENTITY CASCADE`)
    log('cleaned market-truth tables (--clean)')
  }

  // ---- reference data ------------------------------------------------------
  await db.insert(schema.sectors).values(SECTORS.map((s) => ({
    id: s.id, name: s.name, indexTicker: s.indexTicker,
  }))).onConflictDoUpdate({
    target: schema.sectors.id,
    set: { name: sqlExcluded('name'), indexTicker: sqlExcluded('index_ticker') },
  })

  await db.insert(schema.symbols).values([
    {
      id: BENCHMARK_ID, ticker: BENCHMARK.ticker, name: BENCHMARK.name,
      exchange: 'NSE', sectorId: null, isIndex: true, status: 'ACTIVE' as const,
    },
    ...UNIVERSE.map((s) => ({
      id: symbolId(s.ticker), ticker: s.ticker, name: s.name,
      exchange: 'NSE', sectorId: s.sectorId, isIndex: false, status: 'ACTIVE' as const,
    })),
  ]).onConflictDoUpdate({
    target: schema.symbols.id,
    set: { name: sqlExcluded('name'), sectorId: sqlExcluded('sector_id') },
  })
  log(`reference data: ${SECTORS.length} sectors, ${UNIVERSE.length + 1} symbols`)

  // ---- benchmark first: it defines the trading calendar --------------------
  //
  // If the real feed cannot serve the benchmark we fall back to the synthetic
  // provider rather than failing the run. The fallback is loud, is recorded on
  // every observation as source "synthetic", and is surfaced in the UI — a demo
  // that quietly shows made-up data as real would be worse than no demo.
  let indexBars = await provider.dailyBars(BENCHMARK_ID, fromDate, toDate)
  if (indexBars.length === 0 && PROVIDER !== 'synthetic') {
    log(`WARNING: ${provider.source} returned no benchmark data (rate limit or outage).`)
    log('WARNING: falling back to the deterministic synthetic provider.')
    provider = new SyntheticProvider(toDate)
    indexBars = await provider.dailyBars(BENCHMARK_ID, fromDate, toDate)
  }
  if (indexBars.length === 0) {
    throw new Error(`No benchmark data for ${BENCHMARK_ID}. Cannot build a trading calendar.`)
  }
  await db.insert(schema.symbols).values({
    id: '__meta__', ticker: '__meta__', name: `provider:${provider.source}`,
    exchange: 'NSE', sectorId: null, isIndex: true, status: 'SUSPENDED' as const,
  }).onConflictDoUpdate({
    target: schema.symbols.id, set: { name: dsql.raw(`excluded."name"`) as never },
  })
  await writeDailyBars(BENCHMARK_ID, indexBars)
  const indexIntraday = await provider.intradayBars(BENCHMARK_ID, intradayFrom, toDate)
  await writeIntradayBars(BENCHMARK_ID, indexIntraday)
  log(`benchmark: ${indexBars.length} sessions, ${indexIntraday.length} intraday bars`)

  // ---- symbols -------------------------------------------------------------
  const failures: string[] = []
  const allQuarantined: { symbolId: string; date: string; reason: string;
    impliedRatio?: number | undefined; apparentMovePct: number }[] = []
  const gridsForFallback: (number[] | null)[] = []
  let ingested = 0

  await pool(UNIVERSE, CONCURRENCY, async (def) => {
    const id = symbolId(def.ticker)
    try {
      const bars = await provider.dailyBars(id, fromDate, toDate)
      if (bars.length < 80) { failures.push(`${id} (only ${bars.length} bars)`); return }
      await writeDailyBars(id, bars)

      const intraday = await provider.intradayBars(id, intradayFrom, toDate)
      if (intraday.length) await writeIntradayBars(id, intraday)

      const actions = await provider.corporateActions(id, fromDate, toDate)
      if (actions.length) {
        await db.insert(schema.corporateActions).values(actions.map((a) => ({
          id: `${a.symbolId}:${a.exDate}:${a.type}`,
          symbolId: a.symbolId, exDate: a.exDate, type: a.type,
          ratio: a.ratio, notes: a.notes,
        }))).onConflictDoNothing()
      }

      const events = await provider.marketEvents(id, fromDate, toDate)
      if (events.length) {
        await db.insert(schema.marketEvents).values(events.map((e) => ({
          id: `${e.symbolId}:${e.publishedAt.toISOString()}:${hash(e.headline)}`,
          symbolId: e.symbolId, publishedAt: e.publishedAt, type: e.type,
          headline: e.headline, url: e.url, source: e.source,
        }))).onConflictDoNothing()
      }

      const result = computeSymbolStats({
        symbolId: id, bars, indexBars,
        corporateActionDates: new Set(actions.map((a) => a.exDate)),
      })
      if (!result) { failures.push(`${id} (insufficient history for statistics)`); return }

      for (const q of result.quarantined) allQuarantined.push({ symbolId: id, ...q })
      gridsForFallback.push(result.stats.pctlGrid)

      await db.insert(schema.symbolStats).values({
        symbolId: id, asOf: result.stats.asOf,
        beta: result.stats.beta, residMad: result.stats.residMad,
        residMedian: result.stats.residMedian,
        volMedian20: result.stats.volMedian20, volMad20: result.stats.volMad20,
        gapSigma: result.stats.gapSigma,
        high52w: result.stats.high52w, low52w: result.stats.low52w,
        pctlGrid: result.stats.pctlGrid, sampleN: result.stats.sampleN,
        quality: 'FRESH',
      }).onConflictDoUpdate({
        target: [schema.symbolStats.symbolId, schema.symbolStats.asOf],
        set: {
          beta: sqlExcluded('beta'), residMad: sqlExcluded('resid_mad'),
          residMedian: sqlExcluded('resid_median'),
          volMedian20: sqlExcluded('vol_median_20'), volMad20: sqlExcluded('vol_mad_20'),
          gapSigma: sqlExcluded('gap_sigma'),
          high52w: sqlExcluded('high_52w'), low52w: sqlExcluded('low_52w'),
          pctlGrid: sqlExcluded('pctl_grid'), sampleN: sqlExcluded('sample_n'),
        },
      })

      // A symbol whose feed is meant to be dead must not receive a fresh one.
      if (id !== STALE_FEED_SYMBOL || !WITH_FAULTS) {
        await writeLatestObservation(id, bars, provider.source)
      }
      ingested++
      if (ingested % 10 === 0) log(`  ...${ingested}/${UNIVERSE.length} symbols`)
    } catch (err) {
      failures.push(`${id} (${(err as Error).message})`)
    }
  })

  log(`symbols ingested: ${ingested}/${UNIVERSE.length}`)
  if (allQuarantined.length) {
    await db.insert(schema.dataQuarantine).values(allQuarantined.map((q) => ({
      id: `${q.symbolId}:${q.date}`,
      symbolId: q.symbolId, date: q.date, reason: q.reason,
      impliedRatio: q.impliedRatio ?? null,
      apparentMovePct: q.apparentMovePct,
    }))).onConflictDoUpdate({
      target: [schema.dataQuarantine.symbolId, schema.dataQuarantine.date],
      set: { reason: dsql.raw('excluded."reason"') as never },
    })
    log(`quarantined bars (corporate actions / bad ticks): ${allQuarantined.length}`)
    for (const q of allQuarantined.slice(0, 8)) log(`    ${q.symbolId} ${q.date} — ${q.reason}`)
  }
  if (failures.length) log(`skipped: ${failures.join(', ')}`)

  await writeLatestObservation(BENCHMARK_ID, indexBars, provider.source)

  // ---- fallback grid for symbols with thin history -------------------------
  const fallback = buildFallbackGrid(gridsForFallback)
  if (fallback) {
    await db.insert(schema.symbolStats).values({
      symbolId: BENCHMARK_ID, asOf: indexBars[indexBars.length - 1]!.date,
      beta: 1, residMad: null, residMedian: null,
      volMedian20: null, volMad20: null, gapSigma: null,
      high52w: null, low52w: null, pctlGrid: fallback, sampleN: gridsForFallback.length,
      quality: 'FRESH',
    }).onConflictDoUpdate({
      target: [schema.symbolStats.symbolId, schema.symbolStats.asOf],
      set: { pctlGrid: sqlExcluded('pctl_grid') },
    })
    log('peer fallback calibration grid stored on the benchmark row')
  }

  await seedDemoUser(indexBars)
  if (WITH_FAULTS) await injectFaults(indexBars)

  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  await sql.end()
}

/* ------------------------------------------------------------------ writes */

async function writeDailyBars(id: string, bars: readonly DailyBar[]): Promise<void> {
  for (const chunk of chunks(bars, 500)) {
    await db.insert(schema.dailyBars).values(chunk.map((b) => ({
      symbolId: id, date: b.date, open: b.open, high: b.high, low: b.low,
      close: b.close, adjClose: b.adjClose, volume: b.volume,
    }))).onConflictDoUpdate({
      target: [schema.dailyBars.symbolId, schema.dailyBars.date],
      set: {
        open: sqlExcluded('open'), high: sqlExcluded('high'), low: sqlExcluded('low'),
        close: sqlExcluded('close'), adjClose: sqlExcluded('adj_close'),
        volume: sqlExcluded('volume'),
      },
    })
  }
}

async function writeIntradayBars(
  id: string, bars: readonly { ts: Date; open: number; high: number; low: number; close: number; volume: number }[],
): Promise<void> {
  for (const chunk of chunks(bars, 1000)) {
    await db.insert(schema.intradayBars).values(chunk.map((b) => ({
      symbolId: id, ts: b.ts, interval: '5m', open: b.open, high: b.high,
      low: b.low, close: b.close, volume: b.volume,
    }))).onConflictDoNothing()
  }
}

/** The latest known value, with full provenance. Never a bare number. */
async function writeLatestObservation(id: string, bars: readonly DailyBar[], source: string): Promise<void> {
  const last = bars[bars.length - 1]
  if (!last) return
  const observedAt = new Date(`${last.date}T10:00:00.000Z`)   // 15:30 IST close
  await db.insert(schema.observations).values({
    id: `${id}:${source}:${observedAt.toISOString()}`,
    symbolId: id, price: last.close, volume: last.volume,
    observedAt, receivedAt: new Date(), source, quality: 'FRESH',
    raw: { date: last.date, kind: 'session-close' },
  }).onConflictDoNothing()
}

async function seedDemoUser(indexBars: readonly DailyBar[]): Promise<void> {
  const userId = 'user_demo'
  await db.insert(schema.users).values({
    id: userId, email: DEMO_EMAIL, displayName: 'Demo',
  }).onConflictDoNothing()

  await db.insert(schema.attentionSettings).values({
    userId, budget: 'MEDIUM', maxCards: 3,
  }).onConflictDoNothing()

  const watchlistId = 'wl_demo'
  await db.insert(schema.watchlists).values({
    id: watchlistId, userId, name: 'My watchlist',
  }).onConflictDoNothing()

  const picks = UNIVERSE.slice(0, DEMO_WATCHLIST_SIZE)
  await db.insert(schema.watchlistItems).values(picks.map((s, i) => ({
    id: `${watchlistId}:${symbolId(s.ticker)}`,
    watchlistId, symbolId: symbolId(s.ticker), position: i,
  }))).onConflictDoNothing()

  // Put the cursor mid-session on the last trading day, so "while you were
  // away" spans a real window with real intraday data behind it.
  const lastDate = indexBars[indexBars.length - 1]!.date
  const lastSeenAt = new Date(`${lastDate}T04:44:00.000Z`)   // 10:14 IST
  await db.insert(schema.readCursors).values(picks.map((s) => ({
    userId, symbolId: symbolId(s.ticker),
    lastSeenAt, lastSeenVersion: lastSeenAt.getTime(), lastSeenPrice: null,
  }))).onConflictDoNothing()

  // One personal threshold, so the highest-weighted signal is demonstrable.
  await db.insert(schema.userThresholds).values({
    id: 'thr_demo_1', userId, symbolId: 'HDFCBANK.NS', kind: 'BELOW', value: 1400,
  }).onConflictDoNothing()

  log(`demo user seeded: ${DEMO_EMAIL}, ${picks.length} symbols, cursor at ${lastSeenAt.toISOString()}`)
}

/**
 * Inject data-quality faults.
 *
 * A single real feed cannot produce a genuine cross-provider conflict, so rather
 * than pretend otherwise we inject faults explicitly and label them. Every
 * injected row carries source "fault-injection" and is visible in /api/data-health.
 */
async function injectFaults(indexBars: readonly DailyBar[]): Promise<void> {
  const lastDate = indexBars[indexBars.length - 1]!.date
  const sessionClose = new Date(`${lastDate}T10:00:00.000Z`)   // 15:30 IST

  // 1. A feed that stopped days ago -> STALE -> alerts suppressed.
  //    Anchored to the dataset, so it is stale no matter when you look.
  await db.insert(schema.observations).values({
    id: `${STALE_FEED_SYMBOL}:fault-injection:stale`,
    symbolId: STALE_FEED_SYMBOL, price: null, volume: null,
    observedAt: new Date(sessionClose.getTime() - 3 * 86400_000),
    receivedAt: new Date(), source: 'fault-injection', quality: 'STALE',
    raw: { injected: true, scenario: 'stale-feed' },
  }).onConflictDoNothing()

  // 2. Two sources disagreeing beyond tolerance -> CONFLICTING -> no alert.
  //
  //    A single injected row would decay into "stale" within fifteen minutes of
  //    ingestion, silently turning one demo scenario into a different one. So
  //    the second source is written alongside EVERY recent bar: whenever you
  //    evaluate, both sources are equally fresh and genuinely disagree.
  const recent = await db.select({ ts: schema.intradayBars.ts, close: schema.intradayBars.close })
    .from(schema.intradayBars)
    .where(eq(schema.intradayBars.symbolId, CONFLICT_SYMBOL))
    .orderBy(desc(schema.intradayBars.ts))
    .limit(120)

  if (recent.length > 0) {
    const rows = recent.map((r) => ({
      id: `${CONFLICT_SYMBOL}:fault-injection:${r.ts.toISOString()}`,
      symbolId: CONFLICT_SYMBOL,
      price: Math.round(r.close * 0.972 * 100) / 100,   // 2.8% apart: past tolerance
      volume: null,
      observedAt: r.ts,
      receivedAt: new Date(),
      source: 'fault-injection',
      quality: 'FRESH' as const,
      raw: { injected: true, scenario: 'conflicting-sources' },
    }))
    for (const chunk of chunks(rows, 200)) await db.insert(schema.observations).values(chunk).onConflictDoNothing()

    // The primary source needs a matching observation at each of those instants,
    // or there is nothing for the injected one to conflict WITH.
    const primary = recent.map((r) => ({
      id: `${CONFLICT_SYMBOL}:primary:${r.ts.toISOString()}`,
      symbolId: CONFLICT_SYMBOL, price: r.close, volume: null,
      observedAt: r.ts, receivedAt: new Date(),
      source: 'market-feed', quality: 'FRESH' as const,
      raw: { kind: 'intraday' },
    }))
    for (const chunk of chunks(primary, 200)) await db.insert(schema.observations).values(chunk).onConflictDoNothing()
  }

  log(`injected data-quality faults: ${STALE_FEED_SYMBOL} stale (no live observation), ` +
      `${CONFLICT_SYMBOL} conflicting (${recent.length} instants)`)
}

/* ----------------------------------------------------------------- helpers */

/** Reference the incoming row inside an ON CONFLICT DO UPDATE. */
function sqlExcluded(col: string) {
  return dsql.raw(`excluded."${col}"`) as unknown as never
}

function* chunks<T>(xs: readonly T[], n: number): Generator<T[]> {
  for (let i = 0; i < xs.length; i += n) yield xs.slice(i, i + n) as T[]
}

async function pool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]!
      await fn(item)
    }
  })
  await Promise.all(workers)
}

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return Math.abs(h).toString(36)
}

function log(msg: string): void { console.log(`[ingest] ${msg}`) }

main().catch(async (err) => {
  console.error('[ingest] FAILED:', err)
  await sql.end().catch(() => {})
  process.exit(1)
})
