import { AnthropicProvider } from './anthropic.js'
import { GeminiProvider } from './gemini.js'
import type { LlmProvider } from './provider.js'

export * from './provider.js'
export { AnthropicProvider, GeminiProvider }

/**
 * Pick a provider from the environment.
 *
 * Gemini first when a key is present: its free tier means the investigation —
 * the differentiating feature here — does not depend on a paid account. Setting
 * AGENT_PROVIDER forces one either way, and returning null is a normal outcome
 * that puts the loop on its deterministic path.
 */
export function resolveProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider | null {
  const forced = env.AGENT_PROVIDER?.toLowerCase()
  const gemini = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY
  const anthropic = env.ANTHROPIC_API_KEY

  if (forced === 'gemini') return gemini ? new GeminiProvider(gemini) : null
  if (forced === 'anthropic') return anthropic ? new AnthropicProvider(anthropic) : null
  if (forced === 'none') return null

  if (gemini) return new GeminiProvider(gemini)
  if (anthropic) return new AnthropicProvider(anthropic)
  return null
}
