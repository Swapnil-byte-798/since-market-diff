### Precision@3

Dataset: **twelvedata** · us · 51 symbols · 298 evaluation sessions (calibrated on 451 disjoint earlier sessions)

| Ranker | followthrough-1.5s-2d | followthrough-2.0s-3d | followthrough-1.0s-1d |
|---|---|---|---|
| Absolute % change (baseline) | 0.226 | 0.126 | 0.412 |
| Absolute price move (baseline) | 0.237 | 0.136 | 0.395 |
| Market-adjusted residual only (ablation) | 0.301 | 0.180 | 0.465 |
| **Since composite** | **0.311** | **0.186** | **0.493** |

Labels:
- `followthrough-1.5s-2d` — Market-adjusted move over the next 2 sessions exceeded 1.5σ of the symbol's own residual scale
- `followthrough-2.0s-3d` — Market-adjusted move over the next 3 sessions exceeded 2.0σ
- `followthrough-1.0s-1d` — Market-adjusted move on the next session alone exceeded 1.0σ

### Alert volume (per session, 50-symbol watchlist)

| Budget | Threshold | Mean/session | Max | Precision | Recall |
|---|---|---|---|---|---|
| LOW | p99 | 0.41 | 4 | 0.344 | 0.013 |
| MEDIUM | p95 | 2.24 | 12 | 0.329 | 0.070 |
| HIGH | p90 | 4.72 | 23 | 0.296 | 0.132 |