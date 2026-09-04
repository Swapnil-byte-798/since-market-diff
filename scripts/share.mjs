/**
 * Expose the local app on a public URL, for a live demo.
 *
 * Uses localhost.run over plain SSH — no account, no install. The tunnel points
 * at port 3000 only: the API is proxied through Next (see next.config.mjs), so
 * one tunnel serves the whole app and the backend is never separately exposed.
 *
 * The URL lives only as long as this process. Ctrl-C ends it.
 *
 *   npm run share
 */
import { spawn } from 'node:child_process'

const ANSI = new RegExp(String.fromCharCode(27) + String.raw`\[[0-9;]*m`, 'g')
const strip = (s) => String(s).replace(ANSI, '')

try {
  const res = await fetch('http://localhost:3000/', { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(String(res.status))
} catch {
  console.error('  The app is not running on :3000. Start it first:  npm run dev')
  process.exit(1)
}

console.log('  Opening a public tunnel to http://localhost:3000 ...\n')

const ssh = spawn('ssh', [
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'ServerAliveInterval=30',
  '-R', '80:localhost:3000',
  'nokey@localhost.run',
], { stdio: ['ignore', 'pipe', 'pipe'] })

let announced = false
const scan = (buf) => {
  const m = strip(buf).match(/https:\/\/[a-z0-9-]+\.lhr\.life/)
  if (m && !announced) {
    announced = true
    console.log(`  PUBLIC URL:  ${m[0]}\n`)
    console.log('  Anyone with this link can use the app. There is no login - it is a')
    console.log('  demo session against a local database with no real data and no secrets.')
    console.log('  The link dies when you close this process or your laptop sleeps.')
    console.log('  A new URL is issued each time; for a stable one, add an SSH key at')
    console.log('  https://localhost.run/docs/forever-free/\n')
  }
}
ssh.stdout.on('data', scan)
ssh.stderr.on('data', scan)

ssh.on('exit', (code) => {
  console.log(`\n  Tunnel closed (${code}). The public URL is no longer reachable.`)
  process.exit(code ?? 0)
})
process.on('SIGINT', () => ssh.kill('SIGTERM'))
