# Engineering decisions

Short records of the choices that shaped Since, why they were made, and what
each one cost. Written as the decisions were taken, not reconstructed afterwards.

---

### 1. Since runs entirely on one machine. There is no cloud path.

**Decision.** Postgres runs in a local Docker container on port 5544 with its own
named volume. The DB client refuses any host that is not loopback. No managed
database, no hosted queue, no deploy target.

**Why.** Every remote dependency is a demo failure mode you cannot debug in the
five minutes you have. Local-only also means the whole system is reproducible by
anyone with Docker and Node — `docker compose up -d db && npm run ingest`.

**Tradeoff.** No public URL for reviewers who won't clone. Mitigated with a
recorded walkthrough and a seeded, deterministic demo dataset.

---

### 2. The schema is split into market truth and user truth.

**Decision.** Prices, bars, rolling statistics and events are one region.
Watchlists, read cursors, thresholds and preferences are another. Change events
are the join of the two.

**Why.** It is the scaling story. Market truth is computed once per symbol;
across an entire broker that is roughly 2,000 distinct symbols. User truth is a
cheap read-time join. 10,000 users x 100 symbols is 1,000,000 pairs but still
only ~2,000 computations.

**Tradeoff.** Change events are materialised per user, so that table does grow
with users. Bounded by retention, and it is the only table that does.

---

### 3. `@since/core` is a pure package: no DB, no network, no LLM, no clock.

**Decision.** All scoring, statistics and diff logic take explicit inputs and
return values. Everything impure lives in `apps/*` or `packages/db`.

**Why.** The offline evaluation harness imports `@since/core` directly, so the
backtest measures the *exact* code that runs in production. If the two could
drift, the Precision@3 number in the README would be meaningless.

**Tradeoff.** More parameter passing; callers must fetch data before scoring.

---

### 4. Robust statistics (MAD), not standard deviation.

**Decision.** Residual scale is `1.4826 x median(|r - median(r)|)` over a
trailing window, not `stdev`.

**Why.** One fat-finger print inflates a 60-day stdev enough to hide every real
signal for the next 60 days. The detector goes quiet and nothing tells you.
The median absolute deviation is unmoved by a single outlier.

**Tradeoff.** Slightly less efficient on genuinely normal data. Worth it.

---

### 5. Store `close` and `adj_close` side by side.

**Decision.** Both the as-traded and the corporate-action-adjusted close.

**Why.** A 1:2 split looks like a -50% move. If the ratios of `close` and
`adj_close` diverge across a session, that is a corporate action, not news.
Detecting it lets us quarantine the bar instead of firing the loudest false
alert the system is capable of producing — and instead of poisoning the rolling
statistics for the next 60 sessions.

**Tradeoff.** Slightly more storage and an extra ingestion check.

---

### 6. The read cursor is per (user, symbol), and merges with `GREATEST`.

**Decision.** No whole-watchlist snapshot. Each `(user, symbol)` pair has its own
`last_seen_at` and monotonic `last_seen_version`, merged in a single upsert:
`SET last_seen_version = GREATEST(existing, incoming)`.

**Why.** Two reasons. Product: a whole-watchlist snapshot means glancing at the
app marks *everything* read, and unseen changes vanish — the inbox that marks
every email read when you open it. Correctness: max-merge is idempotent,
commutative and associative, so a laptop and a phone syncing out of order can
never un-read something. That is a grow-only register, the simplest CRDT there
is, and it needs no library.

**Tradeoff.** More rows than one snapshot per user, and "mark all as seen" is a
bulk update rather than a single write.

---

### 7. npm workspaces, not pnpm or Turborepo.

**Decision.** Plain npm workspaces.

**Why.** pnpm was not installed on the target machine and `corepack` was
unavailable. npm 10 workspaces are sufficient for six packages, and a build tool
nobody can install is worse than a slower one everybody has.

**Tradeoff.** Slower installs, no remote caching. Irrelevant at this size.

---

### 8. Prices are `double precision`, not `numeric`.

**Decision.** Floating point for prices and volumes.

**Why.** Since computes log returns, z-scores and percentiles — it does not
settle trades or hold a ledger. Doubles carry ~15 significant digits, far beyond
what any of these statistics need, and avoid round-tripping every value through
strings in the hot path of the stats pipeline.

**Tradeoff.** Not suitable if this ever touched money movement. A real broker
would use `numeric` at the ledger boundary. Documented rather than pretended
away.

---

### 9. No Redis in the MVP.

**Decision.** Postgres only.

**Why.** At the demo universe size a local Postgres query is faster than the
network hop to Redis, and every additional process is a thing that can be down
when it matters. The place Redis belongs is documented (hot latest-quote cache,
pub/sub fan-out on the symbol -> subscribers index) so the seam is visible.

**Tradeoff.** The fan-out scaling story is argued rather than demonstrated.
