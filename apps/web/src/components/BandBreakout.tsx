/**
 * The signature visual: normal range as a band, today as a marker outside it.
 *
 * This is not a chart for its own sake — it is a literal picture of the product
 * thesis. "Here is what ordinary looks like for this stock. Here is today."
 * A reader understands the claim before reading a single number.
 */
export function BandBreakout({
  label, sigmas, detail, max = 4,
}: {
  label: string
  /** Signed magnitude in robust sigmas. */
  sigmas: number
  detail?: string
  max?: number
}) {
  const clamped = Math.max(-max, Math.min(max, sigmas))
  const toPct = (s: number) => ((s + max) / (2 * max)) * 100
  const markerAt = toPct(clamped)
  const outside = Math.abs(sigmas) > 2

  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-center gap-x-4 gap-y-1 sm:grid-cols-[9rem_1fr]">
      <div className="text-[0.75rem] text-ink-muted">{label}</div>
      <div>
        <div
          className="relative h-5"
          role="img"
          aria-label={`${label}: ${Math.abs(sigmas).toFixed(1)} sigma ${sigmas < 0 ? 'below' : 'above'} normal${outside ? ', outside the normal range' : ', within the normal range'}`}
        >
          {/* baseline */}
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ink-hairline" />
          {/* +/- 2 sigma */}
          <div
            className="absolute top-1/2 h-3 -translate-y-1/2 rounded-sm bg-paper-sunk"
            style={{ left: `${toPct(-2)}%`, width: `${toPct(2) - toPct(-2)}%` }}
          />
          {/* +/- 1 sigma: the normal range */}
          <div
            className="absolute top-1/2 h-3 -translate-y-1/2 rounded-sm bg-ink-hairline"
            style={{ left: `${toPct(-1)}%`, width: `${toPct(1) - toPct(-1)}%` }}
          />
          {/* centre */}
          <div className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-ink-faint" style={{ left: '50%' }} />
          {/* today */}
          <div
            className={`absolute top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full ${
              outside ? 'bg-signal' : 'bg-ink-muted'
            }`}
            style={{ left: `${markerAt}%` }}
          />
        </div>
        {detail ? <div className="mt-0.5 text-[0.7rem] text-ink-faint">{detail}</div> : null}
      </div>
    </div>
  )
}

/** Legend, shown once per group of bands rather than on every row. */
export function BandLegend() {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-x-4 sm:grid-cols-[9rem_1fr]">
      <div />
      <div className="flex items-center gap-3 text-[0.65rem] text-ink-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm bg-ink-hairline" /> normal range
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-[3px] rounded-full bg-signal" /> today
        </span>
      </div>
    </div>
  )
}
