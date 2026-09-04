'use client'
import { useCallback, useEffect, useState } from 'react'
import { api, type EvalReport } from '@/lib/api'
import { Skeleton, ErrorState } from '@/components/States'

/**
 * The evaluation page.
 *
 * Every watchlist claims its ranking is smart. This one is measured against the
 * dumb baselines, on held-out data, with the production scoring code — and the
 * numbers here are read from the harness output, never typed by hand.
 */
export default function EvalPage() {
  const [r, setR] = useState<EvalReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try { await api.session(); setR(await api.evaluation()) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [])
  useEffect(() => { void load() }, [load])

  if (error) return <ErrorState message={error} onRetry={() => void load()} />
  if (!r) return <Skeleton lines={5} />

  const rankerIds = Object.keys(r.precisionAtK)
  const best = (labelId: string) =>
    Math.max(...rankerIds.map((id) => r.precisionAtK[id]!.byLabel[labelId] ?? 0))

  const primary = r.labels[0]
  const since = r.precisionAtK['since']?.byLabel[primary?.id ?? ''] ?? 0
  const baseline = r.precisionAtK['abs-percent']?.byLabel[primary?.id ?? ''] ?? 0
  const lift = baseline > 0 ? ((since - baseline) / baseline) * 100 : 0

  return (
    <div>
      <header className="pt-10">
        <h1 className="lede">We measured our own claim.</h1>
        <p className="mt-4 max-w-prose text-[0.88rem] leading-relaxed text-ink-muted">
          Since claims that market-adjusted surprise finds changes worth your attention better than
          the percentage change every other watchlist ranks by. That is testable, so we tested it.
        </p>
      </header>

      <section className="mt-9 border-t border-ink-hairline pt-7">
        <p className="font-serif text-[1.35rem] leading-snug text-ink">
          On held-out data, ranking by market-adjusted surprise scored{' '}
          <span className="tnum">{since.toFixed(3)}</span> against{' '}
          <span className="tnum">{baseline.toFixed(3)}</span> for absolute % change —
          <span className="text-signal"> {lift > 0 ? '+' : ''}{lift.toFixed(0)}% </span>
          on Precision@{r.topK}.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="eyebrow">Precision@{r.topK}, by label definition</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-[0.85rem]">
            <thead>
              <tr className="border-b border-ink-hairline text-left text-[0.68rem] uppercase tracking-[0.09em] text-ink-faint">
                <th scope="col" className="pb-2 font-medium">Ranker</th>
                {r.labels.map((l) => (
                  <th key={l.id} scope="col" className="pb-2 text-right font-medium">{l.id}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rankerIds.map((id) => {
                const row = r.precisionAtK[id]!
                const isOurs = id === 'since'
                return (
                  <tr key={id} className="border-b border-ink-hairline/60">
                    <td className={`py-2.5 ${isOurs ? 'text-ink' : 'text-ink-muted'}`}>
                      {row.label}
                    </td>
                    {r.labels.map((l) => {
                      const v = row.byLabel[l.id] ?? 0
                      const top = Math.abs(v - best(l.id)) < 1e-9
                      return (
                        <td key={l.id} className={`tnum py-2.5 text-right ${top ? 'text-signal' : 'text-ink-muted'}`}>
                          {v.toFixed(3)}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <dl className="mt-5 space-y-2 text-[0.78rem]">
          {r.labels.map((l) => (
            <div key={l.id} className="flex flex-wrap gap-x-2">
              <dt className="font-mono text-[0.72rem] text-ink">{l.id}</dt>
              <dd className="text-ink-muted">{l.description}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-10 border-t border-ink-hairline pt-7">
        <h2 className="eyebrow">What a budget actually costs you</h2>
        <p className="mt-3 max-w-prose text-[0.85rem] leading-relaxed text-ink-muted">
          Because the score is a calibrated percentile, the attention setting is a false-positive
          rate rather than a slider — so what it costs you is measurable rather than asserted.
          These are the numbers shown beside the setting in the app.
        </p>
        <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-[0.85rem]">
          <thead>
            <tr className="border-b border-ink-hairline text-left text-[0.68rem] uppercase tracking-[0.09em] text-ink-faint">
              <th scope="col" className="pb-2 font-medium">Budget</th>
              <th scope="col" className="pb-2 text-right font-medium">Threshold</th>
              <th scope="col" className="pb-2 text-right font-medium">Alerts / session</th>
              <th scope="col" className="pb-2 text-right font-medium">Worst</th>
              <th scope="col" className="pb-2 text-right font-medium">Precision</th>
              <th scope="col" className="pb-2 text-right font-medium">Recall</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(r.alertVolume).map(([k, v]) => (
              <tr key={k} className="border-b border-ink-hairline/60">
                <td className="py-2.5 text-ink">{k}</td>
                <td className="tnum py-2.5 text-right text-ink-muted">p{v.thresholdPercentile}</td>
                <td className="tnum py-2.5 text-right text-ink">{v.meanAlertsPerSessionPer50Symbols.toFixed(2)}</td>
                <td className="tnum py-2.5 text-right text-ink-muted">{v.maxAlertsPerSession}</td>
                <td className="tnum py-2.5 text-right text-ink">{v.precision.toFixed(3)}</td>
                <td className="tnum py-2.5 text-right text-ink-muted">{v.recall.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <p className="mt-3 max-w-prose text-[0.78rem] leading-relaxed text-ink-faint">
          The trade-off is visible in the numbers rather than argued for: the quietest setting is
          the most precise and catches the least; the most sensitive catches roughly five times as
          much for a few points of precision. Measured against{' '}
          <span className="font-mono text-[0.72rem]">{r.labels[0]?.id}</span> on the same held-out
          sessions as the table above.
        </p>
      </section>

      <section className="mt-10 border-t border-ink-hairline pt-7">
        <h2 className="eyebrow">Method, and what it does not prove</h2>
        <ul className="mt-3 max-w-prose space-y-3 text-[0.82rem] leading-relaxed text-ink-muted">
          <li>
            <span className="text-ink">The harness runs the production code.</span>{' '}
            <span className="font-mono text-[0.75rem]">computeSignals</span> is imported from{' '}
            <span className="font-mono text-[0.75rem]">@since/core</span> — the same function the
            API calls. There is no second scoring implementation to drift.
          </li>
          <li>
            <span className="text-ink">It is causal.</span> Beta, residual scale and volume
            baselines at any date are fitted only on earlier data, and calibration grids come from a
            disjoint earlier period ({r.dataset.calibrationSessions} sessions) than the one evaluated
            ({r.dataset.evaluationSessions} sessions).
          </li>
          <li>
            <span className="text-ink">Three labels, not one.</span> A result that survives only the
            definition you happened to choose is not a result.
          </li>
          {r.dataset.simulated ? (
            <li className="border-l-2 border-signal pl-3">
              <span className="text-ink">This run used simulated data.</span> The NSE feed was
              rate-limited during ingestion, so these numbers measure the algorithm against data with
              known structure — not a claim about real markets. Re-running{' '}
              <span className="font-mono text-[0.75rem]">npm run ingest</span> against the live feed
              regenerates this page from real NSE history.
            </li>
          ) : null}
        </ul>
        <p className="mt-5 text-[0.72rem] text-ink-faint">
          Generated {new Date(r.generatedAt).toISOString().slice(0, 16).replace('T', ' ')} ·{' '}
          {r.dataset.symbols} symbols · benchmark {r.dataset.benchmark} ·{' '}
          regenerate with <span className="font-mono">npm run eval</span>
        </p>
      </section>
    </div>
  )
}
