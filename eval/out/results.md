### Precision@3

Dataset: **synthetic** (simulated) · nifty50 · 50 symbols · 165 evaluation sessions (calibrated on 251 disjoint earlier sessions)

| Ranker | followthrough-1.5s-2d | followthrough-2.0s-3d | followthrough-1.0s-1d |
|---|---|---|---|
| Absolute % change (baseline) | 0.156 | 0.059 | 0.352 |
| Absolute ₹ move (baseline) | 0.149 | 0.044 | 0.364 |
| Market-adjusted residual only (ablation) | 0.186 | 0.083 | 0.382 |
| **Since composite** | **0.200** | **0.081** | **0.394** |

Labels:
- `followthrough-1.5s-2d` — Market-adjusted move over the next 2 sessions exceeded 1.5σ of the symbol's own residual scale
- `followthrough-2.0s-3d` — Market-adjusted move over the next 3 sessions exceeded 2.0σ
- `followthrough-1.0s-1d` — Market-adjusted move on the next session alone exceeded 1.0σ

### Alert volume (per session, 50-symbol watchlist)

| Budget | Threshold | Mean/session | Max | Precision | Recall |
|---|---|---|---|---|---|
| LOW | p99 | 0.72 | 3 | 0.237 | 0.022 |
| MEDIUM | p95 | 2.70 | 8 | 0.193 | 0.068 |
| HIGH | p90 | 4.84 | 13 | 0.185 | 0.116 |