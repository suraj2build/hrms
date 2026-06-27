/**
 * useAssistant — the asked-lane transport for the My Assistant experience.
 *
 * A thin wrapper over the existing, mature backend (POST /assistant/chat) — it
 * does NOT add a route, does NOT write, and keeps provider keys server-side. It
 * holds the local message thread (the conversational FALLBACK) and exposes one
 * `ask()` verb that the page renders as a Focus-shaped answer + (when the answer
 * implies one) a single action card.
 *
 * Request shape the backend expects (apps/api/src/routes/assistant/index.ts):
 *   { message: string, history?: { role:'user'|'assistant', content:string }[] }
 * Response shape it returns:
 *   { data: { reply: string|null, not_configured?: boolean, error?: boolean,
 *             tools_used?: string[], model?: string, provider?: string } }
 *
 * This hook intentionally carries NO unprompted lane — the Reflection pattern is
 * omitted here (that is Ambient AI's lane). It only answers when asked.
 */

import { useCallback, useState } from 'react'
import { api } from '@/lib/api/client'

export interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatResp {
  data: {
    reply:          string | null
    not_configured?: boolean
    error?:          boolean
    tools_used?:     string[]
    model?:          string
    provider?:       string
  }
}

export type AskOutcome =
  | { kind: 'answer'; reply: string; toolsUsed: string[] }
  | { kind: 'not_configured' }
  | { kind: 'error'; reply: string }

export interface UseAssistant {
  /** The conversational fallback thread — empty until the first ask. */
  messages:     AssistantMessage[]
  /** True while a /assistant/chat round-trip is in flight. */
  asking:       boolean
  /** Set when the last transport call threw (network) — distinct from a graceful error reply. */
  transportError: boolean
  /** The most recent assistant outcome, for the answer-first render. */
  last:         AskOutcome | null
  /** Send a message. Appends to the thread and returns the outcome. */
  ask:          (text: string) => Promise<AskOutcome>
  /** Clear the fallback thread (does not touch the server). */
  reset:        () => void
}

export function useAssistant(): UseAssistant {
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [asking, setAsking] = useState(false)
  const [transportError, setTransportError] = useState(false)
  const [last, setLast] = useState<AskOutcome | null>(null)

  const ask = useCallback(async (text: string): Promise<AskOutcome> => {
    const trimmed = text.trim()
    if (!trimmed) return { kind: 'error', reply: 'Ask me something first.' }

    // History = the prior thread (bounded, matching the backend's max of 12).
    const history = messages.slice(-8)
    setMessages(m => [...m, { role: 'user', content: trimmed }])
    setAsking(true)
    setTransportError(false)

    try {
      const res = await api.post<ChatResp>('/assistant/chat', { message: trimmed, history })

      let outcome: AskOutcome
      if (res.data.not_configured) {
        outcome = { kind: 'not_configured' }
        setMessages(m => [...m, { role: 'assistant', content: '__NOT_CONFIGURED__' }])
      } else if (res.data.error) {
        const reply = res.data.reply ?? 'Sorry — I couldn’t answer that just now.'
        outcome = { kind: 'error', reply }
        setMessages(m => [...m, { role: 'assistant', content: reply }])
      } else {
        const reply = res.data.reply ?? '…'
        outcome = { kind: 'answer', reply, toolsUsed: res.data.tools_used ?? [] }
        setMessages(m => [...m, { role: 'assistant', content: reply }])
      }
      setLast(outcome)
      return outcome
    } catch {
      setTransportError(true)
      const reply = 'Sorry — I couldn’t reach the assistant. Please try again.'
      const outcome: AskOutcome = { kind: 'error', reply }
      setMessages(m => [...m, { role: 'assistant', content: reply }])
      setLast(outcome)
      return outcome
    } finally {
      setAsking(false)
    }
  }, [messages])

  const reset = useCallback(() => {
    setMessages([])
    setLast(null)
    setTransportError(false)
  }, [])

  return { messages, asking, transportError, last, ask, reset }
}
