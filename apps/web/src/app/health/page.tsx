'use client'
import { useCallback, useEffect, useState } from 'react'
import { api, type DataHealth } from '@/lib/api'
import { ProvenanceBadge } from '@/components/Indicators'
import { Skeleton, ErrorState } from '@/components/States'
import { rupees, ago } from '@/components/format'
import { Integrity } from '@/components/Integrity'

export default function HealthPage() {
  const [data, setData] = useState<DataHealth | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try { await api.session(); setData(await api.dataHealth()) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [])
  useEffect(() => { void load() }, [load])

  if (error) return <ErrorState message={error} onRetry={() => void load()} />
  if (!data) return <Skeleton lines={5} />

  const bad = data.symbols.filter((s) => s.quality !== 'FRESH' && s.quality !== 'DELAYED')

  return (
    <div>
      <header className="pt-10">
        <h1 className="lede">Degrade, don’t lie.</h1>
        <p className="mt-3 max-w-prose text-[0.85rem] leading-relaxed text-ink-muted">
          Every price carries where it came from, when the market produced it, and how much we trust
          it. When that trust fails, Since withholds the alert rather than issuing a confident wrong
          one. This page shows the state behind that decision.
        </p>
        <p className="mt-3 text-[0.75rem] text-ink-faint">
          Provider <span className="text-ink">{data.provider}</span>
          {data.simulated ? ' (simulated)' : ''} · market {data.marketOpen ? 'open' : 'closed'} ·
          checked {ago(data.at)}
        </p>
      </header>

      {bad.length > 0 ? (
        <section className="mt-9">
          <h2 className="eyebrow">Not trusted — alerts withheld</h2>
          <ul className="mt-3 space-y-4">
            {bad.map((s) => (
              <li key={s.symbolId} className="border-l-2 border-signal pl-3">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-[0.9rem] text-ink">{s.symbolId.replace('.NS', '')}</span>
                  <ProvenanceBadge provenance={s.provenance} />
                </div>
                <p className="mt-0.5 text-[0.78rem] text-ink-muted">{s.reason}</p>
                {s.values.length > 1 ? (
                  <table className="mt-2 text-[0.75rem]">
                    <tbody>
                      {s.values.map((v) => (
                        <tr key={v.source}>
                          <td className="pr-4 text-ink-faint">{v.source}</td>
                          <td className="tnum pr-4 text-ink">{rupees(v.price)}</td>
                          <td className="text-ink-faint">{ago(v.observedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Integrity rows={data.quarantined ?? []} />

      <section className="mt-10">
        <h2 className="eyebrow">All symbols</h2>
        <ul className="mt-3">
          {data.symbols.map((s) => (
            <li key={s.symbolId} className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-ink-hairline py-2.5 text-[0.82rem]">
              <span className="text-ink">{s.symbolId.replace('.NS', '')}</span>
              <span className="flex items-baseline gap-4">
                <span className="text-[0.7rem] text-ink-faint">{s.sources.join(', ') || 'no sources'}</span>
                <ProvenanceBadge provenance={s.provenance} reason={s.reason} />
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
