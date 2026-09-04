/**
 * Database client. Local Postgres only.
 * Since runs entirely on one machine by design — see DECISIONS.md #1.
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

const DEFAULT_LOCAL_URL = 'postgresql://since:since@localhost:5544/since'
const url = process.env.DATABASE_URL ?? DEFAULT_LOCAL_URL

// Guard rail: this project is deliberately laptop-local. Refuse to connect to
// anything that is not loopback, so a stray env var can never point it elsewhere.
const host = new URL(url).hostname
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(
    `Refusing to connect to non-local database host "${host}". Since runs on this machine only.`,
  )
}

export const sql = postgres(url, { max: 10 })
export const db = drizzle(sql, { schema })
export * from './schema.js'
export { schema }
