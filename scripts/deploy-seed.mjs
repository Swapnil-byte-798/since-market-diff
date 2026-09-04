/**
 * Prepare a freshly deployed database.
 *
 * Idempotent and safe to run on every boot: it applies the schema, then seeds
 * only if the database is actually empty. A deploy must not silently wipe data
 * that is already there, and it must not require anyone to open a shell.
 *
 * Uses the synthetic provider deliberately — it needs no third-party key and no
 * network, so a deploy cannot fail because someone else's API is rate-limiting
 * us. The data is labelled SIMULATED everywhere it appears, exactly as locally.
 *
 *   npm run deploy:seed
 */
import { execSync } from 'node:child_process'

const run = (cmd) => execSync(cmd, { stdio: 'inherit', env: process.env })

if (!process.env.DATABASE_URL) {
  console.error('  DATABASE_URL is not set — nothing to seed.')
  process.exit(1)
}

console.log('  applying schema…')
run('npm run -w @since/db push -- --force')

const { db, schema } = await import('@since/db')
const rows = await db.select({ id: schema.dailyBars.symbolId }).from(schema.dailyBars).limit(1)

if (rows.length > 0) {
  console.log('  database already has market data — leaving it alone.')
  process.exit(0)
}

console.log('  empty database: seeding the demo dataset…')
run('npm run -w @since/ingest start -- --provider synthetic')
run('npm run -w @since/eval start')
console.log('  seed complete.')
process.exit(0)
