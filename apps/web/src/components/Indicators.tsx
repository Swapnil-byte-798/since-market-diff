import type { Quality, Tier } from '@/lib/api'

const QUALITY_COPY: Record<Quality, { label: string; tone: string; mark: string }> = {
  FRESH: { label: 'Live', tone: 'text-ink-faint', mark: '●' },
  DELAYED: { label: 'Delayed', tone: 'text-ink-muted', mark: '◐' },
  STALE: { label: 'Stale', tone: 'text-signal', mark: '○' },
  UNAVAILABLE: { label: 'Unavailable', tone: 'text-signal', mark: '✕' },
  CONFLICTING: { label: 'Conflicting sources', tone: 'text-signal', mark: '⚠' },
  SUSPECT: { label: 'Quarantined', tone: 'text-signal', mark: '⚠' },
}

/** Never colour alone: every state carries a mark and a word. */
export function QualityBadge({ quality, reason }: { quality: Quality; reason?: string }) {
  const c = QUALITY_COPY[quality]
  return (
    <span className={`inline-flex items-center gap-1.5 text-[0.7rem] ${c.tone}`} title={reason}>
      <span aria-hidden>{c.mark}</span>
      <span>{c.label}</span>
    </span>
  )
}

const TIER_COPY: Record<Tier, string> = {
  CRITICAL: 'Attention',
  SIGNIFICANT: 'Attention',
  WORTH_WATCHING: 'Worth watching',
  NORMAL: 'Normal',
  SUPPRESSED: 'Withheld',
}

export function TierLabel({ tier }: { tier: Tier }) {
  const strong = tier === 'CRITICAL' || tier === 'SIGNIFICANT'
  return (
    <span className={`eyebrow ${strong ? 'text-signal' : 'text-ink-faint'}`}>{TIER_COPY[tier]}</span>
  )
}

/**
 * The attention score, always shown with its frequency.
 * A bare "97" is a rating; "97 — about 7 days a year" is a fact.
 */
export function AttentionScore({
  pctl, frequency, scoreText,
}: {
  pctl: number
  frequency: string
  scoreText?: { text: string; saturated: boolean }
}) {
  // A saturated grid means "the most extreme value we have on record" — which is
  // a statement about our sample, not certainty. It must never read as "100".
  const text = scoreText?.text ?? (pctl >= 99.95 ? '99+' : String(Math.round(pctl)))
  const saturated = scoreText?.saturated ?? pctl >= 99.95
  return (
    <div className="flex items-baseline gap-2">
      <span className="tnum font-serif text-2xl leading-none text-ink">{text}</span>
      <span className="text-[0.7rem] text-ink-faint">
        {saturated ? 'top of its recorded range' : <><span className="tnum">{ordinal(Math.round(pctl))}</span> percentile</>}
        {' · '}{frequency}
      </span>
    </div>
  )
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

export function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-ink-faint">—</span>
  const down = value < 0
  return (
    <span className={`tnum ${down ? 'text-signal' : 'text-positive'}`}>
      <span aria-hidden>{down ? '▾' : '▴'}</span>{' '}
      {value > 0 ? '+' : ''}{value.toFixed(2)}%
    </span>
  )
}
