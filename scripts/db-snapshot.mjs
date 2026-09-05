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
 *   node scripts/db-snapshot.mjs dump                    -> .snapshot.sql
 *   node scripts/db-snapshot.mjs restore "postgres://…"  -> loads it remotely
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'

const CONTAINER = process.env.PG_CONTAINER ?? 'since_db'
const FILE = '.snapshot.sql'
const [mode, target] = process.argv.slice(2)

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
    console.error('  usage: node scripts/db-snapshot.mjs restore "postgres://…"')
    process.exit(1)
  }
  if (/localhost|127\.0\.0\.1/.test(target)) {
    // Restoring over the source would be a no-op at best and destructive at
    // worst; the flag exists to catch a pasted-wrong URL.
    console.error('  refusing: that is the local database, not a remote one.')
    process.exit(1)
  }
  const { readFileSync } = await import('node:fs')
  const sql = readFileSync(FILE)
  console.log(`  restoring ${(sql.length / 1e6).toFixed(1)} MB -> ${target.replace(/:[^:@/]+@/, ':****@')}`)
  const res = spawnSync('docker', ['exec', '-i', CONTAINER, 'psql', target, '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: sql, stdio: ['pipe', 'inherit', 'inherit'], maxBuffer: 1 << 30 })
  process.exit(res.status ?? 1)
}

console.error('  usage: node scripts/db-snapshot.mjs dump | restore "postgres://…"')
process.exit(1)
