/**
 * Copy the local dataset into a deployed database.
 *
 * The deployed instance should show the same real market data a reviewer sees
 * on the laptop. Re-ingesting on the server instead would mean ~100 provider
 * calls at eight per minute during a build — slow enough to trip a build
 * timeout, and dependent on someone else's rate limiter being in a good mood.
 * Copying a snapshot is deterministic and takes a couple of minutes.
 *
 * pg_dump and psql come from the running container, so no local Postgres client
 * is needed.
 *
 *   node scripts/db-snapshot.mjs dump      -> .snapshot.sql
 *   node scripts/db-snapshot.mjs restore   -> loads it into $NEON_DATABASE_URL
 *   node scripts/db-snapshot.mjs restore "postgres://…"
 *
 * Prefer the no-argument form: a connection string carries a password, and an
 * argument ends up in shell history and in the process list where any other
 * process on the machine can read it. Put it in .env instead, which is
 * gitignored.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { statSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Load .env from the repo root.
 *
 * Mirrors packages/db/src/env.ts — this script talks to Postgres through the
 * container rather than through @since/db, so it never imports the module that
 * would otherwise have done this. A real environment variable still wins.
 */
function loadEnvFile() {
  const path = fileURLToPath(new URL('../.env', import.meta.url))
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (process.env[key] === undefined) process.env[key] = value
  }
}
loadEnvFile()

const CONTAINER = process.env.PG_CONTAINER ?? 'since_db'
const FILE = '.snapshot.sql'
const [mode, argTarget] = process.argv.slice(2)
// The environment is the preferred source; an argument is the escape hatch.
const target = argTarget || process.env.NEON_DATABASE_URL || ''

function container(args, opts = {}) {
  return execFileSync('docker', ['exec', ...(opts.stdin ? ['-i'] : []), CONTAINER, ...args], {
    maxBuffer: 1 << 30, ...opts,
  })
}

if (mode === 'dump') {
  // --clean --if-exists so a restore is repeatable rather than colliding with
  // whatever a previous attempt left behind. No --owner: the Neon role differs.
  const sql = container(['pg_dump', '-U', 'since', '-d', 'since',
    '--clean', '--if-exists', '--no-owner', '--no-privileges'])
  const { writeFileSync } = await import('node:fs')
  writeFileSync(FILE, sql)
  const mb = (statSync(FILE).size / 1e6).toFixed(1)
  console.log(`  wrote ${FILE} (${mb} MB)`)
  process.exit(0)
}

if (mode === 'restore') {
  if (!target) {
    console.error('  No target database.')
    console.error('  Set NEON_DATABASE_URL in .env (preferred), or pass it as an argument.')
    process.exit(1)
  }
  if (!/-pooler\./.test(target)) {
    // Not fatal: a paid plan or a direct host is a legitimate choice. But on the
    // free tier the direct endpoint allows too few connections for two
    // processes, and it fails intermittently later rather than loudly now.
    console.warn('  ! host is not a -pooler endpoint — on Neon\'s free tier this')
    console.warn('    will run out of connections once the app is serving.')
  }
  if (!/sslmode=/.test(target)) {
    console.warn('  ! no sslmode in the URL — append ?sslmode=require')
  }
  if (/localhost|127\.0\.0\.1/.test(target)) {
    // Restoring over the source would be a no-op at best and destructive at
    // worst; the flag exists to catch a pasted-wrong URL.
    console.error('  refusing: that is the local database, not a remote one.')
    process.exit(1)
  }
  const { readFileSync } = await import('node:fs')
  const sql = readFileSync(FILE)

  /**
   * Load through the DIRECT endpoint, never the pooler.
   *
   * pg_dump's preamble contains `set_config('search_path', '', false)` — the
   * `false` makes it session-wide rather than transaction-local. Sent through a
   * transaction pooler that reuses server connections between clients, the empty
   * search_path outlives the restore and strands every later connection that
   * inherits it: the tables are all present and correct, and every unqualified
   * query says `relation "daily_bars" does not exist`. A bulk load has no
   * business going through a transaction pooler in any case.
   */
  const loadUrl = target.replace(/-pooler\./, '.')
  if (loadUrl !== target) console.log('  using the direct endpoint for the load (not the pooler)')

  const shown = loadUrl.replace(/:[^:@/]+@/, ':****@')
  console.log(`  restoring ${(sql.length / 1e6).toFixed(1)} MB -> ${shown}`)
  const res = spawnSync('docker', ['exec', '-i', CONTAINER, 'psql', loadUrl, '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: sql, stdio: ['pipe', 'inherit', 'inherit'], maxBuffer: 1 << 30 })
  if (res.status !== 0) process.exit(res.status ?? 1)

  /**
   * Pin search_path on the database itself.
   *
   * Neon's pooler rejects `search_path` as a startup parameter outright, so a
   * client cannot ask for it at connect time. Setting it on the database means
   * every new connection gets it without the application having to know.
   */
  const dbName = (() => {
    try { return new URL(loadUrl).pathname.replace(/^\//, '') || 'neondb' }
    catch { return 'neondb' }
  })()
  const alter = spawnSync('docker',
    ['exec', '-i', CONTAINER, 'psql', loadUrl, '-q', '-c',
     `ALTER DATABASE "${dbName}" SET search_path TO public;`],
    { stdio: ['ignore', 'inherit', 'inherit'] })
  console.log(alter.status === 0
    ? `  pinned search_path=public on ${dbName}`
    : `  ! could not pin search_path on ${dbName} — set it in the Neon console`)

  // Prove it end to end rather than trusting the exit code.
  const check = spawnSync('docker',
    ['exec', '-i', CONTAINER, 'psql', target, '-q', '-A', '-t', '-c',
     "SELECT 'verify: search_path='||current_setting('search_path')" +
     "||' daily_bars='||(SELECT count(*) FROM daily_bars);"],
    { encoding: 'utf8' })
  const out = (check.stdout ?? '').trim()
  if (check.status === 0 && out.includes('daily_bars=')) {
    console.log(`  ${out}  (through the pooled endpoint the app will use)`)
    process.exit(0)
  }
  console.error('  ! restore loaded, but the pooled endpoint cannot resolve the tables yet.')
  console.error('    Existing pooled connections outlive the change; retry in a minute,')
  console.error('    or restart the compute in the Neon console to cycle them.')
  process.exit(1)
}

console.error('  usage: node scripts/db-snapshot.mjs dump | restore "postgres://…"')
process.exit(1)
