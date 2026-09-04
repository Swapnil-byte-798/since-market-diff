# Since

**Not what your stocks are doing. What meaningfully changed since *you* last looked.**

---

## The thesis

A watchlist is not a display problem. It is a **diff problem over a per-user read
cursor** — closer to an inbox than to a ticker.

The reason is that *meaningful* is not a property of a stock. It is a property of
the triple:

```
(user, symbol, time-since-you-last-looked)
```

A 3% move in a stock you have held for two years and check daily is noise. The
same 3% in one you added yesterday at a target price is a signal. Same data,
different meaning. Any system that ranks by the data alone is answering the wrong
question.

So Since remembers where you left off, computes what changed *for you*, removes
the part of every move that the whole market explains, and shows you the two or
three things that are left.

The most common correct answer this product gives is **"nothing happened."**

---

## What makes a change meaningful

Not percentage change. Everything falling 2% because the index fell 2.5% is not
news — it is one piece of news, about the index, repeated forty times.

Since decomposes each move into the part the market explains and the part it does
not, and ranks only on the remainder:

```
resid   = r_stock − β · r_index          β from 60 trailing sessions
σ_resid = 1.4826 · MAD(trailing residuals)
z       = resid / σ_resid
```

That residual, plus volume anomaly, overnight gap, 52-week crossings, user
thresholds and events, forms a composite score which is then **calibrated to a
percentile against that symbol's own history** — so the number has a unit:

> **97th percentile for HDFCBANK** — a day this notable happens about 7× a year.

Which in turn makes the attention setting a false-positive budget the user
controls, rather than a slider with no meaning.

---

## Status

Early. This README documents what is built as it is built; sections appear when
the thing they describe exists and has been run.

| | |
|---|---|
| Schema + local infrastructure | done |
| Market data ingestion | not started |
| Scoring engine + tests | not started |
| Evaluation harness | not started |
| API | not started |
| Frontend | not started |
| Investigation agent | not started |

**Evaluation results are not reported until the harness has actually run.**
No number appears in this README that the repository cannot reproduce with
`npm run eval`.

---

## Running it

Since runs entirely on one machine. There is no cloud dependency.

```bash
docker compose up -d db     # local Postgres on :5544, own volume
npm install
npm run db:push             # apply schema
npm run ingest              # one-shot historical load
npm run dev
```

An `ANTHROPIC_API_KEY` enables the investigation agent. Without it every other
part of the product works and changes are explained deterministically — that
path is tested, not hypothetical.

---

## Documents

- [`DECISIONS.md`](./DECISIONS.md) — engineering decisions, why, and what each cost
