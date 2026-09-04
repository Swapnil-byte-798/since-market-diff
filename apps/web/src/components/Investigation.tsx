'use client'
import { useEffect, useRef, useState } from 'react'
import type { InvestigationResponse, EvidenceRow } from '@/lib/api'

const HYPOTHESES = [
  { id: 'MARKET', label: 'The broad market explains it' },
  { id: 'SECTOR', label: 'A sector-wide move explains it' },
  { id: 'EVENT', label: 'A company-specific event explains it' },
  { id: 'UNEXPLAINED', label: 'Idiosyncratic, nothing found' },
  { id: 'DATA_ARTIFACT', label: 'Not a real move — data or corporate action' },
] as const

const STAGE_ORDER = [
  ['ANALYZING_MOVEMENT', 'Analysing movement'],
  ['COMPARING_MARKET', 'Comparing against the market'],
  ['CHECKING_SECTOR', 'Checking the sector'],
  ['INSPECTING_VOLUME', 'Inspecting volume'],
  ['READING_INTRADAY_SHAPE', 'Reading the intraday shape'],
  ['INVESTIGATING_EVENTS', 'Investigating events'],
  ['VERIFYING_DATA_HEALTH', 'Verifying data health'],
  ['FORMING_CONCLUSION', 'Forming a conclusion'],
] as const

/**
 * The investigation panel — deliberately not a chat window.
 *
 * What it shows is hypothesis elimination: five candidate explanations, and
 * which ones the evidence ruled out. That is what the agent actually does, so
 * it is what the interface should look like.
 */
export function Investigation({
  changeId, initial, onStart, poll,
}: {
  changeId: string
  initial: InvestigationResponse | null
  onStart: () => Promise<void>
  poll: () => Promise<InvestigationResponse>
}) {
  const [state, setState] = useState<InvestigationResponse | null>(initial)
  const [running, setRunning] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => setState(initial), [initial])
  useEffect(() => () => { if (timer.current) clearInterval(timer.current) }, [])

  const done = state?.investigation && ['COMPLETED', 'INSUFFICIENT_EVIDENCE', 'FAILED'].includes(state.status)

  async function start() {
    setRunning(true)
    await onStart()
    timer.current = setInterval(async () => {
      const next = await poll()
      setState(next)
      if (next.investigation && ['COMPLETED', 'INSUFFICIENT_EVIDENCE', 'FAILED'].includes(next.status)) {
        if (timer.current) clearInterval(timer.current)
        setRunning(false)
      }
    }, 900)
  }

  const findings = parseFindings(state?.investigation?.hypotheses)

  return (
    <section id="investigation" className="mt-12 scroll-mt-8 border-t border-ink-hairline pt-8">
      <h2 className="eyebrow">Investigation</h2>

      {!state?.investigation && !running ? (
        <div className="mt-4">
          <p className="max-w-prose text-[0.85rem] leading-relaxed text-ink-muted">
            The scoring engine has already decided this change is significant — that is arithmetic,
            not judgement. An investigation asks a different question: <span className="text-ink">why</span> did
            it happen? An agent works through five candidate explanations, choosing which evidence to
            gather based on what it finds, and rules out the ones the data contradicts.
          </p>
          <button
            onClick={() => void start()}
            className="mt-5 border border-ink px-4 py-2 text-[0.8rem] transition-colors hover:bg-ink hover:text-paper"
          >
            Investigate this change
          </button>
        </div>
      ) : null}

      {running && !done ? <Stages /> : null}

      {done && state?.investigation ? (
        <div className="mt-5">
          {state.investigation.fallbackUsed ? (
            <div className="mb-5 border-l-2 border-ink-hairline pl-3">
              <p className="text-[0.78rem] leading-relaxed text-ink-muted">
                <span className="text-ink">AI investigation unavailable.</span> The change was still
                detected, scored and explained by the deterministic engine — that path is the default,
                not a degraded one.
              </p>
            </div>
          ) : null}

          <ol className="space-y-2.5">
            {HYPOTHESES.map((h) => {
              const f = findings.find((x) => x.hypothesis === h.id)
              const primary = state.investigation?.primaryHypothesis === h.id
              const rejected = f?.verdict === 'REJECTED'
              return (
                <li key={h.id} className="flex items-baseline gap-3 text-[0.85rem]">
                  <span aria-hidden className={`w-4 shrink-0 ${primary ? 'text-signal' : 'text-ink-faint'}`}>
                    {primary ? '●' : rejected ? '✕' : f ? '○' : '·'}
                  </span>
                  <span className={rejected ? 'text-ink-faint line-through' : primary ? 'text-ink' : 'text-ink-muted'}>
                    {h.label}
                  </span>
                  {f ? <span className="text-[0.7rem] text-ink-faint">{f.reason}</span> : null}
                </li>
              )
            })}
          </ol>

          {state.investigation.conclusion ? (
            <blockquote className="mt-6 border-l-2 border-signal pl-4">
              <p className="font-serif text-[1.05rem] leading-snug text-ink">
                {state.investigation.conclusion}
              </p>
            </blockquote>
          ) : null}

          <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-[0.75rem]">
            <div>
              <dt className="text-ink-faint">Confidence</dt>
              <dd className="text-ink">{state.investigation.confidence ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">Tools used</dt>
              <dd className="tnum text-ink">{state.investigation.toolCalls}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">Status</dt>
              <dd className="text-ink">{state.status.replace(/_/g, ' ').toLowerCase()}</dd>
            </div>
          </dl>

          {state.status === 'INSUFFICIENT_EVIDENCE' ? (
            <p className="mt-4 max-w-prose border-l-2 border-ink-hairline pl-3 text-[0.8rem] leading-relaxed text-ink-muted">
              A significant move was detected, but the available evidence does not establish why.
              Saying so is the correct answer — the alternative is a confident guess.
            </p>
          ) : null}

          <EvidenceList rows={state.evidence} />
        </div>
      ) : null}
    </section>
  )
}

/** Stages map to real tool calls, not a timer. */
function Stages() {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STAGE_ORDER.length - 1)), 1100)
    return () => clearInterval(t)
  }, [])
  return (
    <ol className="mt-5 space-y-2" aria-live="polite">
      {STAGE_ORDER.map(([id, label], i) => (
        <li key={id} className={`flex items-baseline gap-3 text-[0.82rem] ${i <= step ? 'text-ink' : 'text-ink-faint'}`}>
          <span aria-hidden className="w-4 shrink-0">{i < step ? '✓' : i === step ? '◍' : '·'}</span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  )
}

function EvidenceList({ rows }: { rows: EvidenceRow[] }) {
  if (rows.length === 0) return null
  return (
    <div className="mt-7">
      <h3 className="eyebrow">Evidence</h3>
      <ul className="mt-3 space-y-3">
        {rows.map((e, i) => (
          <li key={e.id} className="rise border-l border-ink-hairline pl-3" style={{ animationDelay: `${i * 90}ms` }}>
            <p className="text-[0.85rem] leading-relaxed text-ink">{e.observation}</p>
            <p className="mt-0.5 text-[0.7rem] text-ink-faint">
              {e.stance.toLowerCase()} · {e.type.toLowerCase()} · {e.source}
              {e.observedAt ? ` · ${new Date(e.observedAt).toISOString().slice(0, 16).replace('T', ' ')}` : ''}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-4 max-w-prose text-[0.72rem] leading-relaxed text-ink-faint">
        Every figure in the conclusion is checked against these observations before it is shown. A
        number that does not appear here causes the generated wording to be discarded.
      </p>
    </div>
  )
}

interface Finding { hypothesis: string; verdict: string; reason: string }
function parseFindings(raw: unknown): Finding[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((f): f is Finding =>
    typeof f === 'object' && f !== null && 'hypothesis' in f && 'verdict' in f)
}
