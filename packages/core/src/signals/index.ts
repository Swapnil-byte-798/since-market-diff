import type { ScoreInput, SignalContribution } from '../types.js'
import type { Decomposition } from '../market/decompose.js'
import { clip, logReturn } from '../stats/robust.js'

/**
 * Signal weights.
 *
 * These are the initial values. They are deliberately NOT hand-tuned to look
 * good: `eval/` measures Precision@3 against baselines and the weights that
 * ship are the ones that measurement supports. See README "Evaluation".
 */
export interface Weights {
  residual: number
  volume: number
  gap: number
  crossing52w: number
  userThreshold: number
  event: number
  cumulative: number
}

export const DEFAULT_WEIGHTS: Weights = {
  residual: 1.0,
  volume: 0.6,
  gap: 0.4,
  crossing52w: 1.5,
  userThreshold: 2.0,
  event: 1.0,
  cumulative: 0.5,
}

/** Every z is clipped into this band before weighting, so no single signal can dominate. */
export const Z_CLIP = 6

export function computeSignals(
  input: ScoreInput,
  d: Decomposition,
  weights: Weights = DEFAULT_WEIGHTS,
): SignalContribution[] {
  const out: SignalContribution[] = []
  const stats = input.stats

  // 1. Market-adjusted residual surprise — the central signal.
  if (d.residualZ !== null) {
    const z = clip(Math.abs(d.residualZ), 0, Z_CLIP)
    const dir = (d.residual ?? 0) < 0 ? 'below' : 'above'
    out.push({
      key: 'residual',
      label: 'Market-adjusted move',
      z,
      weight: weights.residual,
      points: z * weights.residual,
      detail: `${z.toFixed(1)}σ ${dir} what the market implied` +
        (d.beta !== null ? ` (β ${d.beta.toFixed(2)})` : ''),
    })
  }

  // 2. Volume anomaly, measured in LOG space.
  //
  //    Traded volume is lognormal, not normal. Taking the MAD of raw volumes
  //    makes the scale far too tight, so an ordinary 2x day scores past the
  //    clip and the signal stops discriminating between a busy day and a
  //    genuinely extraordinary one. Working in logs keeps it informative.
  //    Only unusually HIGH volume counts; a quiet day is not a reason to
  //    interrupt someone.
  if (input.volume !== null && input.volume > 0
      && stats?.volMedian20 && stats.volMedian20 > 0
      && stats.volMad20 && stats.volMad20 > 0) {
    const raw = Math.log(input.volume / stats.volMedian20) / stats.volMad20
    if (raw > 0) {
      const z = clip(raw, 0, Z_CLIP)
      const mult = input.volume / stats.volMedian20
      out.push({
        key: 'volume',
        label: 'Volume anomaly',
        z,
        weight: weights.volume,
        points: z * weights.volume,
        detail: `${mult.toFixed(1)}× the usual volume`,
      })
    }
  }

  // 3. Overnight gap. A gap means something happened while the market was shut,
  //    which is a different kind of event from intraday drift.
  if (input.prevClose !== null && input.sessionOpen !== null && stats?.gapSigma && stats.gapSigma > 0) {
    const gap = logReturn(input.prevClose, input.sessionOpen)
    if (gap !== null) {
      const z = clip(Math.abs(gap) / stats.gapSigma, 0, Z_CLIP)
      if (z > 1) {
        out.push({
          key: 'gap',
          label: 'Overnight gap',
          z,
          weight: weights.gap,
          points: z * weights.gap,
          detail: `Opened ${((Math.exp(gap) - 1) * 100).toFixed(1)}% away from the previous close`,
        })
      }
    }
  }

  // 4. 52-week crossing. A discrete state change, not a magnitude.
  if (input.priceEnd !== null && stats) {
    const { high52w, low52w } = stats
    const crossedHigh = high52w !== null && input.priceEnd > high52w
    const crossedLow = low52w !== null && input.priceEnd < low52w
    if (crossedHigh || crossedLow) {
      out.push({
        key: 'crossing52w',
        label: '52-week crossing',
        z: 1,
        weight: weights.crossing52w,
        points: weights.crossing52w,
        detail: crossedHigh ? 'New 52-week high' : 'New 52-week low',
      })
    }
  }

  // 5. User threshold. They told us this level matters, so we trust them over
  //    our own statistics — this is the highest flat weight in the model.
  if (input.userThreshold && input.priceEnd !== null && input.priceStart !== null) {
    const { kind, value } = input.userThreshold
    const crossed =
      kind === 'BELOW' ? input.priceStart >= value && input.priceEnd < value
      : input.priceStart <= value && input.priceEnd > value
    if (crossed) {
      out.push({
        key: 'userThreshold',
        label: 'Your threshold',
        z: 1,
        weight: weights.userThreshold,
        points: weights.userThreshold,
        detail: `Crossed ${kind === 'BELOW' ? 'below' : 'above'} ₹${value.toLocaleString('en-IN')}`,
      })
    }
  }

  // 6. A known event inside the window.
  if (input.hasEventInWindow) {
    out.push({
      key: 'event',
      label: 'Event in window',
      z: 1,
      weight: weights.event,
      points: weights.event,
      detail: input.eventHeadline ?? 'A company event was published during this window',
    })
  }

  // 7. Persistence. Repeated daily residuals are a different story from one pop:
  //    a slow bleed over four sessions deserves attention that any single day
  //    of it would not.
  if (input.sessions > 1 && input.sessionResiduals && input.stats?.residMad) {
    const sigma = input.stats.residMad
    const notable = input.sessionResiduals.filter((r) => Math.abs(r) > sigma).length
    if (notable >= 2) {
      const z = clip(notable, 0, Z_CLIP)
      out.push({
        key: 'cumulative',
        label: 'Persistent move',
        z,
        weight: weights.cumulative,
        points: z * weights.cumulative,
        detail: `${notable} of the last ${input.sessions} sessions moved against the market`,
      })
    }
  }

  return out
}
