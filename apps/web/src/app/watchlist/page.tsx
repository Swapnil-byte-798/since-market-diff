'use client'
import { useCallback, useEffect, useState } from 'react'
import { api, type WatchlistItem, type SymbolRow } from '@/lib/api'
import { QualityBadge } from '@/components/Indicators'
import { Skeleton, ErrorState, EmptyState } from '@/components/States'
import { rupees, ago } from '@/components/format'

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      await api.session()
      setItems((await api.watchlist()).items)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (error) return <ErrorState message={error} onRetry={() => void load()} />
  if (!items) return <Skeleton lines={6} />

  return (
    <div>
      <header className="pt-10">
        <h1 className="lede">Watchlist</h1>
        <p className="mt-3 max-w-prose text-[0.85rem] leading-relaxed text-ink-muted">
          What Since watches on your behalf. Thresholds are the one signal weighted above its own
          statistics — if you say a level matters, it matters.
        </p>
      </header>

      <AddSymbol onAdded={load} existing={new Set(items.map((i) => i.symbolId))} />

      {items.length === 0 ? (
        <EmptyState
          title="Nothing watched yet."
          body="Add a few stocks. When you come back, Since will remember where you left off and tell you only what changed in a way that matters."
        />
      ) : (
        <ul className="mt-8">
          {items.map((it) => <Row key={it.symbolId} item={it} onChanged={load} />)}
        </ul>
      )}
    </div>
  )
}

function AddSymbol({ onAdded, existing }: { onAdded: () => void; existing: Set<string> }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SymbolRow[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (q.trim().length < 1) { setResults([]); return }
    const t = setTimeout(async () => {
      try { setResults((await api.search(q.trim())).results) } catch { setResults([]) }
    }, 180)                                   // debounced: one request per pause, not per keystroke
    return () => clearTimeout(t)
  }, [q])

  return (
    <div className="mt-8">
      <label htmlFor="sym" className="eyebrow">Add a stock</label>
      <input
        id="sym" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="HDFCBANK, Infosys…" autoComplete="off"
        className="mt-2 w-full border-b border-ink-hairline bg-transparent py-2 text-[0.95rem] text-ink placeholder:text-ink-faint focus:border-ink"
      />
      {results.length > 0 ? (
        <ul className="mt-2 divide-y divide-ink-hairline border border-ink-hairline">
          {results.slice(0, 8).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-4 px-3 py-2">
              <span className="min-w-0 text-[0.85rem]">
                <span className="text-ink">{r.name}</span>
                <span className="ml-2 text-[0.72rem] text-ink-faint">{r.ticker}</span>
              </span>
              <button
                disabled={busy || existing.has(r.id)}
                onClick={async () => {
                  setBusy(true)
                  try { await api.addSymbol(r.id); setQ(''); setResults([]); onAdded() } finally { setBusy(false) }
                }}
                className="shrink-0 border border-ink-hairline px-2.5 py-1 text-[0.72rem] hover:border-ink disabled:opacity-40"
              >
                {existing.has(r.id) ? 'Added' : 'Add'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function Row({ item, onChanged }: { item: WatchlistItem; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(item.threshold?.value?.toString() ?? '')
  const [kind, setKind] = useState<'ABOVE' | 'BELOW'>(item.threshold?.kind ?? 'BELOW')

  return (
    <li className="border-t border-ink-hairline py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div className="min-w-0">
          <div className="text-[0.95rem] text-ink">{item.name}</div>
          <div className="mt-0.5 text-[0.72rem] text-ink-faint">
            {item.ticker} · last seen {ago(item.lastSeenAt)}
          </div>
        </div>
        <div className="text-right">
          <div className="tnum text-[0.95rem] text-ink">{rupees(item.price)}</div>
          <div className="mt-0.5 text-[0.7rem] text-ink-faint">{ago(item.observedAt)}</div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.75rem]">
        {item.threshold ? (
          <span className="text-ink-muted">
            Alert {item.threshold.kind === 'BELOW' ? 'below' : 'above'}{' '}
            <span className="tnum text-ink">{rupees(item.threshold.value)}</span>
          </span>
        ) : (
          <span className="text-ink-faint">No threshold</span>
        )}
        <button onClick={() => setEditing((e) => !e)} className="text-ink-muted underline decoration-ink-hairline underline-offset-4 hover:text-ink">
          {editing ? 'Cancel' : item.threshold ? 'Change' : 'Set threshold'}
        </button>
        <button
          onClick={async () => { await api.removeSymbol(item.symbolId); onChanged() }}
          className="text-ink-faint underline decoration-ink-hairline underline-offset-4 hover:text-signal"
        >
          Remove
        </button>
      </div>

      {editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value as 'ABOVE' | 'BELOW')}
            className="border border-ink-hairline bg-paper-raised px-2 py-1 text-[0.78rem]">
            <option value="BELOW">Below</option>
            <option value="ABOVE">Above</option>
          </select>
          <input
            type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)}
            placeholder="1400"
            className="w-28 border border-ink-hairline bg-paper-raised px-2 py-1 text-[0.78rem] tnum"
          />
          <button
            onClick={async () => {
              const v = Number(value)
              await api.setThreshold(item.symbolId, Number.isFinite(v) && v > 0 ? kind : null, Number.isFinite(v) && v > 0 ? v : null)
              setEditing(false); onChanged()
            }}
            className="border border-ink px-3 py-1 text-[0.78rem] hover:bg-ink hover:text-paper"
          >
            Save
          </button>
          {item.threshold ? (
            <button
              onClick={async () => { await api.setThreshold(item.symbolId, null, null); setEditing(false); onChanged() }}
              className="text-[0.75rem] text-ink-faint underline underline-offset-4 hover:text-signal"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
