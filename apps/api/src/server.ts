import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { and, asc, eq, ilike, inArray, or, sql as dsql } from 'drizzle-orm'
import { db, schema, marketQueries as q } from '@since/db'
import {
  BUDGET_LABEL, BUDGET_THRESHOLD, frequencyPhrase, displayPercentile, istDate, logReturn,
  type AttentionBudget,
} from '@since/core'
import { investigate, type Stage } from '@since/agent'
import { evaluateBrief, calendar, providerInfo, BENCHMARK_ID } from './services/brief.js'
import { persistChanges, getChange, getInvestigation } from './services/changes.js'
import { badRequest, notFound, unauthorized, send, HttpError } from './errors.js'

const PORT = Number(process.env.PORT ?? 4000)
const DEMO_USER = 'user_demo'
const COOKIE_SECRET = process.env.COOKIE_SECRET ?? 'since-local-dev-secret-change-me'

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] },
})

await app.register(cors, { origin: true, credentials: true })

// A POST with no body is legitimate (e.g. starting a session). Treat an empty
// JSON payload as `{}` instead of rejecting the request.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  const text = typeof body === 'string' ? body.trim() : ''
  if (text.length === 0) return done(null, {})
  try { done(null, JSON.parse(text)) } catch (err) { done(err as Error, undefined) }
})
await app.register(cookie, { secret: COOKIE_SECRET, hook: 'onRequest' })

/** Demo-grade session: a signed cookie naming the user. No passwords by design. */
function userIdOf(req: { cookies: Record<string, string | undefined>; unsignCookie: (v: string) => { valid: boolean; value: string | null } }): string {
  const raw = req.cookies['since_session']
  if (!raw) throw unauthorized('No session. POST /api/session/demo first.')
  const un = req.unsignCookie(raw)
  if (!un.valid || !un.value) throw unauthorized('Invalid session cookie.')
  return un.value
}

const isoDate = z.string().datetime().optional()
const symbolIdSchema = z.string().regex(/^[A-Za-z0-9^&._-]{1,32}$/, 'Invalid symbol id')

app.setErrorHandler((err, _req, reply) => send(reply, err))

/* --------------------------------------------------------------- session */

app.post('/api/session/demo', async (_req, reply) => {
  reply.setCookie('since_session', DEMO_USER, {
    path: '/', httpOnly: true, sameSite: 'lax', signed: true,
    secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 24 * 30,
  })
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, DEMO_USER)).limit(1)
  if (!user) throw notFound('Demo user not seeded. Run `npm run ingest`.')
  return { userId: user.id, email: user.email, displayName: user.displayName }
})

/* --------------------------------------------------------------- symbols */

app.get('/api/symbols/search', async (req) => {
  const { q: term } = z.object({ q: z.string().min(1).max(40) }).parse(req.query)
  const like = `%${term}%`
  const rows = await db.select({
    id: schema.symbols.id, ticker: schema.symbols.ticker,
    name: schema.symbols.name, sectorId: schema.symbols.sectorId,
  }).from(schema.symbols)
    .where(and(
      eq(schema.symbols.isIndex, false),
      eq(schema.symbols.status, 'ACTIVE'),
      or(ilike(schema.symbols.ticker, like), ilike(schema.symbols.name, like)),
    ))
    .orderBy(asc(schema.symbols.ticker)).limit(20)
  return { results: rows }
})

/* ------------------------------------------------------------- watchlist */

app.get('/api/watchlist', async (req) => {
  const userId = userIdOf(req as never)
  const [wl] = await db.select().from(schema.watchlists)
    .where(eq(schema.watchlists.userId, userId)).limit(1)
  if (!wl) return { watchlistId: null, items: [] }

  const items = await db.select({
    symbolId: schema.watchlistItems.symbolId, position: schema.watchlistItems.position,
    ticker: schema.symbols.ticker, name: schema.symbols.name, sectorId: schema.symbols.sectorId,
  }).from(schema.watchlistItems)
    .innerJoin(schema.symbols, eq(schema.symbols.id, schema.watchlistItems.symbolId))
    .where(eq(schema.watchlistItems.watchlistId, wl.id))
    .orderBy(asc(schema.watchlistItems.position))

  const ids = items.map((i) => i.symbolId)
  const now = new Date()
  const [prices, obs, cursors, thresholds] = await Promise.all([
    q.pricesAt(ids, now),
    q.observationsFor(ids, now),
    db.select().from(schema.readCursors)
      .where(and(eq(schema.readCursors.userId, userId), ids.length ? inArray(schema.readCursors.symbolId, ids) : dsql`false`)),
    db.select().from(schema.userThresholds)
      .where(and(eq(schema.userThresholds.userId, userId), ids.length ? inArray(schema.userThresholds.symbolId, ids) : dsql`false`)),
  ])
  const cursorBy = new Map(cursors.map((c) => [c.symbolId, c]))
  const thresholdBy = new Map(thresholds.map((t) => [t.symbolId, t]))

  return {
    watchlistId: wl.id,
    items: items.map((i) => ({
      ...i,
      price: prices.get(i.symbolId)?.price ?? null,
      observedAt: prices.get(i.symbolId)?.observedAt?.toISOString() ?? null,
      sources: (obs.get(i.symbolId) ?? []).map((o) => o.source),
      lastSeenAt: cursorBy.get(i.symbolId)?.lastSeenAt?.toISOString() ?? null,
      threshold: thresholdBy.get(i.symbolId)
        ? { kind: thresholdBy.get(i.symbolId)!.kind, value: thresholdBy.get(i.symbolId)!.value }
        : null,
    })),
  }
})

app.post('/api/watchlist/items', async (req) => {
  const userId = userIdOf(req as never)
  const { symbolId } = z.object({ symbolId: symbolIdSchema }).parse(req.body)
  const [wl] = await db.select().from(schema.watchlists).where(eq(schema.watchlists.userId, userId)).limit(1)
  if (!wl) throw notFound('No watchlist for this user.')
  const [sym] = await db.select().from(schema.symbols).where(eq(schema.symbols.id, symbolId)).limit(1)
  if (!sym) throw notFound(`Unknown symbol ${symbolId}`)
  if (sym.isIndex) throw badRequest('Indices are benchmarks, not watchable instruments.')

  const positions = await db.select({ max: dsql<number>`coalesce(max(${schema.watchlistItems.position}), -1)` })
    .from(schema.watchlistItems).where(eq(schema.watchlistItems.watchlistId, wl.id))
  const max = positions[0]?.max ?? -1

  // Idempotent: adding a symbol twice is a no-op, not an error.
  await db.insert(schema.watchlistItems).values({
    id: `${wl.id}:${symbolId}`, watchlistId: wl.id, symbolId, position: Number(max) + 1,
  }).onConflictDoNothing()
  return { ok: true, symbolId }
})

app.delete('/api/watchlist/items/:symbolId', async (req) => {
  const userId = userIdOf(req as never)
  const { symbolId } = z.object({ symbolId: symbolIdSchema }).parse(req.params)
  const [wl] = await db.select().from(schema.watchlists).where(eq(schema.watchlists.userId, userId)).limit(1)
  if (!wl) throw notFound('No watchlist for this user.')
  await db.delete(schema.watchlistItems)
    .where(and(eq(schema.watchlistItems.watchlistId, wl.id), eq(schema.watchlistItems.symbolId, symbolId)))
  return { ok: true }
})

app.put('/api/watchlist/items/:symbolId/threshold', async (req) => {
  const userId = userIdOf(req as never)
  const { symbolId } = z.object({ symbolId: symbolIdSchema }).parse(req.params)
  const body = z.object({
    kind: z.enum(['ABOVE', 'BELOW']).nullable(),
    value: z.number().finite().positive().nullable(),
  }).parse(req.body)

  if (body.kind === null || body.value === null) {
    await db.delete(schema.userThresholds).where(and(
      eq(schema.userThresholds.userId, userId), eq(schema.userThresholds.symbolId, symbolId)))
    return { ok: true, threshold: null }
  }
  await db.insert(schema.userThresholds).values({
    id: `thr_${userId}_${symbolId}`, userId, symbolId, kind: body.kind, value: body.value,
  }).onConflictDoUpdate({
    target: schema.userThresholds.id,
    set: { kind: body.kind, value: body.value },
  })
  return { ok: true, threshold: { kind: body.kind, value: body.value } }
})

/* ------------------------------------------------------------------ brief */

app.get('/api/brief', async (req) => {
  const userId = userIdOf(req as never)
  const parsed = z.object({
    at: isoDate,
    budget: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  }).parse(req.query)

  // `at` is the ONLY difference between live and replay.
  const at = parsed.at ? new Date(parsed.at) : new Date()
  if (Number.isNaN(at.getTime())) throw badRequest('Invalid `at` timestamp')

  const brief = await evaluateBrief({ userId, at, budgetOverride: parsed.budget as AttentionBudget | undefined })
  const changeIds = await persistChanges(userId, brief)

  return {
    ...brief,
    window: {
      ...brief.window,
      windowStart: brief.window.windowStart.toISOString(),
      windowEnd: brief.window.windowEnd.toISOString(),
    },
    cards: brief.cards.map((c) => ({
      ...c,
      changeId: changeIds.get(c.symbolId) ?? null,
      scoreText: displayPercentile(c.score.pctl),
    })),
    budgetLabel: BUDGET_LABEL[brief.budget],
    budgetThreshold: BUDGET_THRESHOLD[brief.budget],
  }
})

/* ---------------------------------------------------------------- cursors */

app.post('/api/cursor/seen', async (req) => {
  const userId = userIdOf(req as never)
  const { symbolIds, at } = z.object({
    symbolIds: z.array(symbolIdSchema).min(1).max(200),
    at: isoDate,
  }).parse(req.body)
  const seenAt = at ? new Date(at) : new Date()
  return markSeen(userId, symbolIds, seenAt)
})

app.post('/api/cursor/seen-all', async (req) => {
  const userId = userIdOf(req as never)
  const { at } = z.object({ at: isoDate }).parse(req.body ?? {})
  const items = await db.select({ symbolId: schema.watchlistItems.symbolId })
    .from(schema.watchlistItems)
    .innerJoin(schema.watchlists, eq(schema.watchlists.id, schema.watchlistItems.watchlistId))
    .where(eq(schema.watchlists.userId, userId))
  if (items.length === 0) return { updated: 0 }
  return markSeen(userId, items.map((i) => i.symbolId), at ? new Date(at) : new Date())
})

/**
 * The cross-device merge.
 *
 * `GREATEST` makes this idempotent, commutative and associative: a laptop and a
 * phone syncing out of order converge to the same cursor, and a replayed or
 * duplicated request can never move a cursor backwards — i.e. can never
 * un-read something the user has already seen.
 */
async function markSeen(userId: string, symbolIds: readonly string[], seenAt: Date) {
  const version = seenAt.getTime()
  await db.insert(schema.readCursors).values(symbolIds.map((symbolId) => ({
    userId, symbolId, lastSeenAt: seenAt, lastSeenVersion: version,
  }))).onConflictDoUpdate({
    target: [schema.readCursors.userId, schema.readCursors.symbolId],
    set: {
      lastSeenVersion: dsql`GREATEST(${schema.readCursors.lastSeenVersion}, excluded.last_seen_version)`,
      lastSeenAt: dsql`GREATEST(${schema.readCursors.lastSeenAt}, excluded.last_seen_at)`,
    },
  })
  return { updated: symbolIds.length, at: seenAt.toISOString() }
}

/* ---------------------------------------------------------------- changes */

app.get('/api/changes/:id', async (req) => {
  const userId = userIdOf(req as never)
  const { id } = z.object({ id: z.string().min(3).max(64) }).parse(req.params)
  const change = await getChange(userId, id)
  if (!change) throw notFound('Change not found')

  const [sym] = await db.select().from(schema.symbols).where(eq(schema.symbols.id, change.symbolId)).limit(1)
  const stats = await q.latestStats(change.symbolId, istDate(change.windowEnd))
  const inv = await getInvestigation(change.id)

  return {
    change: {
      ...change,
      windowStart: change.windowStart.toISOString(),
      windowEnd: change.windowEnd.toISOString(),
      createdAt: change.createdAt.toISOString(),
    },
    symbol: sym ? { id: sym.id, ticker: sym.ticker, name: sym.name, sectorId: sym.sectorId } : null,
    frequency: frequencyPhrase(change.pctl),
    scoreText: displayPercentile(change.pctl),
    stats: stats ? { beta: stats.beta, residMad: stats.residMad, sampleN: stats.sampleN, asOf: stats.asOf } : null,
    investigation: inv
      ? {
          ...inv.investigation,
          startedAt: inv.investigation.startedAt?.toISOString() ?? null,
          completedAt: inv.investigation.completedAt?.toISOString() ?? null,
          evidence: inv.evidence.map((e) => ({ ...e, observedAt: e.observedAt?.toISOString() ?? null })),
        }
      : null,
  }
})

/* ---------------------------------------------------------- investigation */

const running = new Map<string, Promise<unknown>>()

app.post('/api/changes/:id/investigate', async (req) => {
  const userId = userIdOf(req as never)
  const { id } = z.object({ id: z.string().min(3).max(64) }).parse(req.params)
  const change = await getChange(userId, id)
  if (!change) throw notFound('Change not found')

  // Idempotent: a second request returns the first result rather than paying
  // for a duplicate run that could contradict it.
  const existing = await getInvestigation(change.id)
  if (existing) return { status: existing.investigation.status, investigationId: existing.investigation.id, reused: true }
  if (running.has(change.id)) return { status: 'INVESTIGATING', reused: true }

  const [sym] = await db.select().from(schema.symbols).where(eq(schema.symbols.id, change.symbolId)).limit(1)
  const [sector] = sym?.sectorId
    ? await db.select().from(schema.sectors).where(eq(schema.sectors.id, sym.sectorId)).limit(1)
    : [undefined]

  const invId = `inv_${change.id.slice(3)}`
  await db.insert(schema.investigations).values({
    id: invId, changeEventId: change.id, status: 'INVESTIGATING', startedAt: new Date(),
  }).onConflictDoNothing()

  const stages: Stage[] = []
  const task = investigate({
    symbolId: change.symbolId,
    symbolName: sym?.name ?? change.symbolId,
    windowStart: change.windowStart,
    windowEnd: change.windowEnd,
    benchmarkId: BENCHMARK_ID,
    sectorName: sector?.name ?? null,
    volumeMultiple: volumeMultipleOf(change.contributions),
    hasEvent: (change.contributions ?? []).some((c) => c.key === 'event'),
    score: {
      symbolId: change.symbolId, raw: change.raw, pctl: change.pctl, tier: change.tier,
      contributions: change.contributions ?? [], quality: change.quality, qualityReason: '',
      returnPct: change.returnPct, expectedPct: change.expectedPct,
      residualPct: change.residualPct, residualZ: change.residualZ, degraded: null,
    },
  }, { onStage: (s) => stages.push(s) })
    .then(async (result) => {
      await db.update(schema.investigations).set({
        status: result.status,
        primaryHypothesis: result.conclusion.primary_hypothesis,
        hypotheses: result.findings,
        conclusion: result.conclusion.conclusion,
        confidence: result.conclusion.confidence,
        toolCalls: result.toolCalls.length,
        completedAt: new Date(),
        fallbackUsed: result.fallbackUsed,
      }).where(eq(schema.investigations.id, invId))

      const rows = result.findings.flatMap((f, fi) =>
        f.evidence.map((e, ei) => ({
          id: `${invId}_${fi}_${ei}`, investigationId: invId, hypothesis: f.hypothesis,
          type: e.type, source: e.source, observation: e.observation,
          observedAt: e.observed_at ? new Date(e.observed_at) : null,
          stance: e.stance, reliability: null,
        })))
      if (rows.length) await db.insert(schema.evidence).values(rows).onConflictDoNothing()
      return result
    })
    .catch(async (err) => {
      app.log.error({ err }, 'investigation failed')
      await db.update(schema.investigations)
        .set({ status: 'FAILED', completedAt: new Date(), fallbackUsed: true })
        .where(eq(schema.investigations.id, invId))
    })
    .finally(() => running.delete(change.id))

  running.set(change.id, task)
  return { status: 'INVESTIGATING', investigationId: invId, reused: false }
})

app.get('/api/changes/:id/investigation', async (req) => {
  const userId = userIdOf(req as never)
  const { id } = z.object({ id: z.string().min(3).max(64) }).parse(req.params)
  const change = await getChange(userId, id)
  if (!change) throw notFound('Change not found')
  const inv = await getInvestigation(change.id)
  if (!inv) return { status: 'PENDING', investigation: null, evidence: [] }
  return {
    status: inv.investigation.status,
    investigation: {
      ...inv.investigation,
      startedAt: inv.investigation.startedAt?.toISOString() ?? null,
      completedAt: inv.investigation.completedAt?.toISOString() ?? null,
    },
    evidence: inv.evidence.map((e) => ({ ...e, observedAt: e.observedAt?.toISOString() ?? null })),
  }
})

/* ----------------------------------------------------------------- replay */

app.get('/api/changes/:id/replay', async (req) => {
  const userId = userIdOf(req as never)
  const { id } = z.object({ id: z.string().min(3).max(64) }).parse(req.params)
  const change = await getChange(userId, id)
  if (!change) throw notFound('Change not found')

  const [bars, idxBars, events] = await Promise.all([
    q.intradayBetween(change.symbolId, change.windowStart, change.windowEnd),
    q.intradayBetween(BENCHMARK_ID, change.windowStart, change.windowEnd),
    q.eventsBetween(change.symbolId, change.windowStart, change.windowEnd),
  ])
  const stats = await q.latestStats(change.symbolId, istDate(change.windowEnd))
  const beta = stats?.beta ?? 1
  const sigma = stats?.residMad ?? null
  const idxByTs = new Map(idxBars.map((b) => [b.ts.getTime(), b]))

  const first = bars[0]
  const idxFirst = idxBars[0]
  // Residual is recomputed cumulatively from the window start, so the timeline
  // shows the moment the move stopped being explainable by the market.
  const points = bars.map((b) => {
    const r = first ? logReturn(first.open, b.close) : null
    const ib = idxByTs.get(b.ts.getTime())
    const ir = idxFirst && ib ? logReturn(idxFirst.open, ib.close) : null
    const resid = r !== null && ir !== null ? r - beta * ir : r
    return {
      ts: b.ts.toISOString(), close: b.close, volume: b.volume,
      returnPct: r !== null ? (Math.exp(r) - 1) * 100 : null,
      residualPct: resid !== null ? (Math.exp(resid) - 1) * 100 : null,
      residualSigmas: resid !== null && sigma ? resid / sigma : null,
    }
  })

  const crossing = points.find((p) => p.residualSigmas !== null && Math.abs(p.residualSigmas) >= 2)
  return {
    windowStart: change.windowStart.toISOString(),
    windowEnd: change.windowEnd.toISOString(),
    symbolId: change.symbolId,
    points,
    events: events.map((e) => ({
      publishedAt: e.publishedAt.toISOString(), type: e.type, headline: e.headline, source: e.source,
    })),
    attentionCrossedAt: crossing?.ts ?? null,
    note: points.length === 0 ? 'No intraday data stored for this window.' : null,
  }
})

/* ------------------------------------------------------------ data health */

app.get('/api/data-health', async (req) => {
  const userId = userIdOf(req as never)
  const items = await db.select({ symbolId: schema.watchlistItems.symbolId })
    .from(schema.watchlistItems)
    .innerJoin(schema.watchlists, eq(schema.watchlists.id, schema.watchlistItems.watchlistId))
    .where(eq(schema.watchlists.userId, userId))
  const ids = items.map((i) => i.symbolId)
  const now = new Date()
  const cal = await calendar()
  const obs = await q.observationsFor(ids, now)
  const meta = await providerInfo()

  const { assessQuality } = await import('./services/brief.js')
  const rows = []
  for (const id of ids) {
    const list = obs.get(id) ?? []
    const quality = await assessQuality({
      symbolId: id, at: now, observations: list,
      marketOpen: cal.isOpen(now), lastClose: cal.lastSessionCloseAt(now),
      priceEnd: list[0]?.price ?? null, observedAt: list[0]?.observedAt ?? null,
    })
    rows.push({
      symbolId: id, quality: quality.quality, reason: quality.reason,
      ageMs: quality.ageMs, sources: quality.sources,
      values: list.map((o) => ({ source: o.source, price: o.price, observedAt: o.observedAt.toISOString() })),
    })
  }
  return { ...meta, marketOpen: cal.isOpen(now), at: now.toISOString(), symbols: rows }
})

/* --------------------------------------------------------------- settings */

app.get('/api/settings', async (req) => {
  const userId = userIdOf(req as never)
  const [s] = await db.select().from(schema.attentionSettings)
    .where(eq(schema.attentionSettings.userId, userId)).limit(1)
  const budget = s?.budget ?? 'MEDIUM'
  return {
    budget, maxCards: s?.maxCards ?? 3,
    budgetLabel: BUDGET_LABEL[budget], budgetThreshold: BUDGET_THRESHOLD[budget],
    options: (['LOW', 'MEDIUM', 'HIGH'] as const).map((b) => ({
      value: b, label: BUDGET_LABEL[b], threshold: BUDGET_THRESHOLD[b],
    })),
  }
})

app.patch('/api/settings', async (req) => {
  const userId = userIdOf(req as never)
  const body = z.object({
    budget: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
    maxCards: z.number().int().min(1).max(10).optional(),
  }).parse(req.body)
  await db.insert(schema.attentionSettings).values({
    userId, budget: body.budget ?? 'MEDIUM', maxCards: body.maxCards ?? 3,
  }).onConflictDoUpdate({
    target: schema.attentionSettings.userId,
    set: {
      ...(body.budget ? { budget: body.budget } : {}),
      ...(body.maxCards ? { maxCards: body.maxCards } : {}),
    },
  })
  return { ok: true }
})

app.post('/api/changes/:id/feedback', async (req) => {
  const userId = userIdOf(req as never)
  const { id } = z.object({ id: z.string().min(3).max(64) }).parse(req.params)
  const { verdict } = z.object({ verdict: z.enum(['USEFUL', 'NOT_USEFUL']) }).parse(req.body)
  const change = await getChange(userId, id)
  if (!change) throw notFound('Change not found')
  await db.insert(schema.attentionFeedback).values({
    id: `fb_${userId}_${id}`, userId, changeEventId: id, verdict,
  }).onConflictDoUpdate({
    target: [schema.attentionFeedback.userId, schema.attentionFeedback.changeEventId],
    set: { verdict },
  })
  return { ok: true }
})

/* ------------------------------------------------------- eval + debug ---- */

app.get('/api/eval', async () => {
  try {
    const raw = readFileSync(new URL('../../../eval/out/results.json', import.meta.url), 'utf8')
    return JSON.parse(raw)
  } catch {
    throw notFound('No evaluation results yet. Run `npm run eval`.')
  }
})

/**
 * Full scoring breakdown for one symbol at one instant.
 * Exposed deliberately: if the attention score cannot be inspected, it cannot
 * be trusted.
 */
app.get('/debug/why', async (req) => {
  const userId = userIdOf(req as never)
  const { symbol, at } = z.object({ symbol: symbolIdSchema, at: isoDate }).parse(req.query)
  const when = at ? new Date(at) : new Date()
  const brief = await evaluateBrief({ userId, at: when, budgetOverride: 'HIGH', capOverride: 50 })
  const score = brief.cards.find((c) => c.symbolId === symbol)?.score
    ?? (await evaluateBrief({ userId, at: when })).cards.find((c) => c.symbolId === symbol)?.score
  const stats = await q.latestStats(symbol, istDate(when))

  return {
    symbol, at: when.toISOString(),
    window: {
      start: brief.window.windowStart.toISOString(),
      end: brief.at, sessions: brief.window.sessions,
    },
    score: score ?? null,
    scoredButNotShown: !brief.cards.some((c) => c.symbolId === symbol),
    statistics: stats
      ? {
          asOf: stats.asOf, beta: stats.beta, residMad: stats.residMad,
          volMedian20: stats.volMedian20, volMad20LogSpace: stats.volMad20,
          gapSigma: stats.gapSigma, high52w: stats.high52w, low52w: stats.low52w,
          sampleN: stats.sampleN, calibrationGridPoints: stats.pctlGrid?.length ?? 0,
        }
      : null,
    regime: brief.regime,
    note: 'raw = sum of weighted clipped z-scores. pctl = empirical percentile of raw against this symbol\'s own history.',
  }
})

/** Recover the volume multiple the WHY panel showed, for the fallback wording. */
function volumeMultipleOf(contributions: { key: string; detail: string }[] | null): number | null {
  const v = (contributions ?? []).find((c) => c.key === 'volume')
  const m = v?.detail.match(/([\d.]+)×/)
  return m ? Number(m[1]) : null
}

app.get('/health', async () => {
  const meta = await providerInfo()
  const counted = await db.select({ count: dsql<number>`count(*)` }).from(schema.dailyBars)
  return { ok: true, ...meta, dailyBars: Number(counted[0]?.count ?? 0) }
})

try {
  await app.listen({ port: PORT, host: '127.0.0.1' })
  app.log.info(`Since API on http://127.0.0.1:${PORT}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

export { app, HttpError }
