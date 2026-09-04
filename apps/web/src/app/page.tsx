'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { api, type Brief, type Card } from '@/lib/api'
import { BandBreakout, BandLegend } from '@/components/BandBreakout'
import { AttentionScore, Delta, QualityBadge, TierLabel } from '@/components/Indicators'
import { Skeleton, ErrorState, EmptyState, SimulatedBanner } from '@/components/States'
import { timeIST, dateIST } from '@/components/format'
import { TimeTravel } from '@/components/TimeTravel'

export default function BriefPage() {
  const [brief, setBrief] = useState<Brief | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [at, setAt] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (when?: string) => {
    setLoading(true)
    setError(null)
    try {
      await api.session()
      setBrief(await api.brief(when))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(at) }, [load, at])

  if (loading && !brief) return <Skeleton lines={4} />
  if (error) return <ErrorState message={error} onRetry={() => void load(at)} />
  if (!brief) return null

  return (
    <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <Hero brief={brief} />

      <TimeTravel
        value={at}
        windowStart={brief.window.windowStart}
        onChange={setAt}
      />

      {brief.simulated ? <SimulatedBanner provider={brief.provider} /> : null}

      {brief.cards.length > 0 ? (
        <section className="mt-12" aria-labelledby="attention-heading">
          <div className="flex items-baseline justify-between">
            <h2 id="attention-heading" className="eyebrow">Deserves your attention</h2>
            <span className="text-[0.7rem] text-ink-faint">
              {brief.budgetLabel} · top {brief.cap}
            </span>
          </div>
          <div className="mt-5 space-y-0">
            {brief.cards.map((card, i) => (
              <ChangeRow key={card.symbolId} card={card} brief={brief} index={i} />
            ))}
          </div>
        </section>
      ) : (
        <NothingHappened brief={brief} />
      )}

      <FilteredNote brief={brief} />
      <Withheld brief={brief} />
      <SeenControl brief={brief} onDone={() => void load(at)} />
    </div>
  )
}

/* ------------------------------------------------------------------- hero */

function Hero({ brief }: { brief: Brief }) {
  const w = brief.window
  const lede = useMemo(() => buildLede(brief), [brief])

  return (
    <section className="pt-10">
      <p className="eyebrow">
        {w.isFirstVisit
          ? 'Your first look'
          : <>Since {timeIST(w.windowStart)} · {dateIST(w.windowStart)} · away {w.awayLabel}</>}
      </p>
      <h1 className="lede mt-4 max-w-[36rem] text-balance">{lede}</h1>
      <p className="mt-5 text-[0.8rem] text-ink-faint">
        <span className="tnum">{brief.totalWatched}</span> watched ·{' '}
        <span className="tnum">{brief.changedCount}</span> moved ·{' '}
        <span className="tnum text-ink">{brief.attentionCount}</span> shown
      </p>
    </section>
  )
}

/**
 * The hero is a sentence, not a stat grid.
 *
 * When the market itself explains everything, that IS the story, and saying so
 * plainly is the most useful thing the product can do.
 */
function buildLede(brief: Brief): string {
  const n = brief.cards.length
  if (brief.regime) {
    const moved = Math.round(brief.regime.breadth * brief.changedCount)
    const dir = brief.regime.indexReturnPct < 0 ? 'fell' : 'rose'
    const pct = Math.abs(brief.regime.indexReturnPct).toFixed(1)
    if (n === 0) {
      return `The market ${dir} ${pct}%, and your watchlist ${dir} with it. Nothing moved for reasons of its own.`
    }
    return `The market ${dir} ${pct}%. ${moved} of your ${brief.changedCount} stocks ${dir} with it. ${
      n === 1 ? 'One didn’t.' : `${cap(word(n))} didn’t.`
    }`
  }
  if (n === 0) {
    return brief.changedCount === 0
      ? 'Nothing moved while you were away.'
      : `${cap(word(brief.changedCount))} things moved. None of them mattered.`
  }
  return `${cap(word(brief.changedCount))} things changed. ${cap(word(n))} deserve${n === 1 ? 's' : ''} your attention.`
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const word = (n: number) => WORDS[n] ?? String(n)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/* -------------------------------------------------------------- change row */

function ChangeRow({ card, brief, index }: { card: Card; brief: Brief; index: number }) {
  const s = card.score
  const name = brief.symbolNames[card.symbolId] ?? card.symbolId
  const sector = brief.sectors[card.symbolId]

  const bands = s.contributions
    .filter((c) => c.key === 'residual' || c.key === 'volume' || c.key === 'gap')
    .map((c) => ({
      label: c.label,
      sigmas: c.key === 'residual' ? (s.residualZ ?? c.z) : c.z,
      detail: c.detail,
    }))

  return (
    <article
      className="rise border-t border-ink-hairline py-7 first:border-t-0 first:pt-0"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div className="min-w-0">
          <TierLabel tier={s.tier} />
          <h3 className="mt-1 font-serif text-xl leading-tight text-ink">{name}</h3>
          <p className="mt-0.5 text-[0.72rem] text-ink-faint">
            {card.symbolId.replace('.NS', '')} · {sector?.name ?? 'Uncategorised'}
          </p>
        </div>
        <div className="text-right">
          <div className="font-serif text-2xl leading-none">
            <Delta value={s.returnPct} />
          </div>
          <div className="mt-1.5">
            <QualityBadge quality={s.quality} reason={s.qualityReason} />
          </div>
        </div>
      </div>

      {card.group ? (
        <p className="mt-3 border-l-2 border-ink-hairline pl-3 text-[0.8rem] leading-relaxed text-ink-muted">
          <span className="text-ink">{card.group.sectorName} moved together.</span>{' '}
          {card.group.members.length} of your holdings in this sector are down for the same reason —
          shown once rather than {card.group.members.length} times.
        </p>
      ) : null}

      <div className="mt-4">
        <AttentionScore pctl={s.pctl} frequency={card.frequency} scoreText={card.scoreText} />
      </div>

      {s.expectedPct !== null ? (
        <p className="mt-3 max-w-prose text-[0.85rem] leading-relaxed text-ink-muted">
          The market implied <span className="tnum">{s.expectedPct.toFixed(1)}%</span>. It moved{' '}
          <span className="tnum">{s.returnPct?.toFixed(1)}%</span>, leaving{' '}
          <span className="tnum text-ink">{Math.abs(s.residualPct ?? 0).toFixed(1)}%</span> the market
          does not explain.
        </p>
      ) : null}

      {bands.length > 0 ? (
        <div className="mt-5 space-y-2">
          {bands.map((b) => (
            <BandBreakout key={b.label} label={b.label} sigmas={b.sigmas} detail={b.detail} />
          ))}
          <BandLegend />
        </div>
      ) : null}

      {card.changeId ? (
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href={`/change/${card.changeId}`}
            className="border border-ink px-3.5 py-1.5 text-[0.78rem] transition-colors hover:bg-ink hover:text-paper"
          >
            Why this?
          </Link>
          <Link
            href={`/change/${card.changeId}#investigation`}
            className="border border-ink-hairline px-3.5 py-1.5 text-[0.78rem] text-ink-muted transition-colors hover:border-ink hover:text-ink"
          >
            Investigate
          </Link>
          <Link
            href={`/change/${card.changeId}#replay`}
            className="border border-ink-hairline px-3.5 py-1.5 text-[0.78rem] text-ink-muted transition-colors hover:border-ink hover:text-ink"
          >
            Replay
          </Link>
        </div>
      ) : null}
    </article>
  )
}

/* --------------------------------------------------------------- sections */

function NothingHappened({ brief }: { brief: Brief }) {
  return (
    <section className="mt-12 border-t border-ink-hairline pt-10">
      <p className="font-serif text-lg text-ink">Nothing needed you.</p>
      <p className="mt-2 max-w-prose text-[0.88rem] leading-relaxed text-ink-muted">
        {brief.changedCount} of your {brief.totalWatched} stocks moved, and every one of those moves
        is within what that stock ordinarily does — or is explained by the market as a whole.
        Since is deliberately quiet when there is nothing worth saying.
      </p>
    </section>
  )
}

function FilteredNote({ brief }: { brief: Brief }) {
  if (brief.filteredCount === 0) return null
  return (
    <section className="mt-10 border-t border-ink-hairline pt-6">
      <p className="text-[0.85rem] text-ink-muted">
        <span className="tnum text-ink">{brief.filteredCount}</span> other movements were reviewed
        and withheld. None of them cleared{' '}
        <span className="tnum">{brief.budgetThreshold}</span>
        <span className="align-super text-[0.6rem]">th</span> percentile for their own stock.
      </p>
    </section>
  )
}

function Withheld({ brief }: { brief: Brief }) {
  if (brief.suppressed.length === 0) return null
  return (
    <section className="mt-6 border-t border-ink-hairline pt-6">
      <h2 className="eyebrow">Withheld — data we don’t trust</h2>
      <ul className="mt-3 space-y-2">
        {brief.suppressed.map((s) => (
          <li key={s.symbolId} className="flex flex-wrap items-baseline gap-x-3 text-[0.82rem]">
            <span className="text-ink">{brief.symbolNames[s.symbolId] ?? s.symbolId}</span>
            <QualityBadge quality={s.quality} />
            <span className="text-ink-faint">{s.reason}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 max-w-prose text-[0.78rem] leading-relaxed text-ink-faint">
        These may have moved. We are not telling you they did, because the data behind them did not
        pass its checks — and a confident wrong alert is worse than silence.
      </p>
    </section>
  )
}

function SeenControl({ brief, onDone }: { brief: Brief; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  if (brief.cards.length === 0 && brief.filteredCount === 0) return null

  return (
    <section className="mt-10 border-t border-ink-hairline pt-6">
      <button
        disabled={busy || done}
        onClick={async () => {
          setBusy(true)
          try { await api.markAllSeen(brief.at); setDone(true); onDone() } finally { setBusy(false) }
        }}
        className="text-[0.8rem] text-ink-muted underline decoration-ink-hairline underline-offset-4 hover:text-ink disabled:opacity-50"
      >
        {done ? 'Marked as seen' : busy ? 'Marking…' : 'Mark everything as seen'}
      </button>
      <p className="mt-2 max-w-prose text-[0.72rem] leading-relaxed text-ink-faint">
        Opening a card marks only that stock as seen. Reading the brief does not silently clear
        everything else.
      </p>
    </section>
  )
}
