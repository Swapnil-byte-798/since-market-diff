/**
 * @since/core — the domain.
 *
 * HARD RULE: this package is pure. No database, no network, no LLM, no clock.
 * Every function takes its inputs explicitly and returns a value.
 *
 * This is not stylistic. It is what lets the offline evaluation harness run the
 * EXACT production scoring code against historical data. If eval and production
 * could drift, the measured Precision@3 in the README would mean nothing.
 * See DECISIONS.md #3.
 */
export const CORE_VERSION = '0.1.0'
