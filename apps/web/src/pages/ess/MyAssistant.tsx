/**
 * MyAssistant — the My Assistant experience (the Intelligence · asked lens):
 * "Can you help me?"  Purpose: intelligence AND execution — never a generic
 * chatbot. The front door is an ASK FIELD over action/suggestion cards, never an
 * empty chat thread or a "Hi, how can I help?" greeting.
 *
 * Every answer leads with a Focus-shaped sentence + (when the answer implies one)
 * ONE action card (SignalCard-shaped) that deep-links into a real module flow.
 * A person's FACE (PersonAvatar) appears when the answer is about a named person.
 * Conversation unfolds BEHIND the answer only for open-ended asks — it is the
 * FALLBACK, never the entry. The Reflection pattern is deliberately OMITTED here
 * (that is Ambient AI's unprompted lane); this surface only answers when asked.
 *
 * Reads + hands off only — it never writes. It reuses the existing, mature backend
 * POST /assistant/chat as-is (no new route); the module of record performs any
 * write behind its own validation and the auth write-gate.
 */

import { useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Sparkles, ArrowRight, MessageSquare, Send } from 'lucide-react'
import { FocusPanel } from '@/components/experience/FocusPanel'
import { SignalCard, type Signal } from '@/components/experience/SignalCard'
import { PersonAvatar } from '@/components/experience/PersonAvatar'
import { LoadingState } from '@/components/layout/LoadingState'
import { ErrorState } from '@/components/layout/ErrorState'
import { useAssistant, type AskOutcome } from '@/components/experience/useAssistant'

// ── Suggested + recent chips (the action-first front door) ──────────────────────
// Read → understand → act: a few high-intent jumping-off points, NOT a cursor.
const SUGGESTED = [
  'Leave balance',
  'My payslip',
  "Who's off today",
] as const

const RECENT = [
  'Apply leave',
  'My attendance',
] as const

// ── Action inference (the differentiator) ───────────────────────────────────────
// The backend is read-only ("guide the user to the right screen"). The experience
// elevates that into ONE SignalCard-shaped action that deep-links into a module
// flow. We infer it from the ask + the answer text — no backend change. `href` is
// relative to `base` (resolved by the page) so it works for /ess and /manager/self.
interface InferredAction {
  type:  Signal['type']
  title: string
  body?: string
  href:  string
}

function inferAction(ask: string, reply: string): InferredAction | null {
  const t = `${ask} ${reply}`.toLowerCase()

  // Order matters — most specific intent first. At most ONE action (Need §3.2).
  if (/\bapply\b.*\bleave\b|\btake leave\b|\bbook leave\b|\brequest leave\b/.test(t)) {
    return { type: 'leave', title: 'Apply for leave', body: 'Open the leave flow — dates pre-shaped from your ask.', href: '/leave/apply' }
  }
  if (/\bleave\b|\bcasual\b|\bsick\b|\bvacation\b|\bholiday balance\b|\bdays? (left|off)\b/.test(t)) {
    return { type: 'leave', title: 'Open leave balance', body: 'See your balance, ledger and comp-off.', href: '/leave/balance' }
  }
  if (/\bpayslip\b|\bpay slip\b|\bsalary\b|\bpay(check|cheque)\b|\bnet pay\b|\bcompensation\b|\bctc\b/.test(t)) {
    return { type: 'documents', title: 'View payslips', body: 'Open compensation — payslips and pay history.', href: '/compensation' }
  }
  if (/\battendance\b|\bclock\b|\bcheck[- ]?in\b|\bhours (this|last) week\b|\bregulari[sz]ation\b|\btimesheet\b/.test(t)) {
    return { type: 'attendance', title: 'Open my attendance', body: 'Your hours, calendar and requests.', href: '/attendance' }
  }
  if (/\bapproval\b|\bpending\b.*\b(request|approv)|\bneeds? (me|you)\b|\bawaiting\b/.test(t)) {
    return { type: 'approvals', title: 'See what needs you', body: 'Decisions and reviews waiting on you.', href: '/attention' }
  }
  if (/\bteam\b|\bwho'?s (off|out|on leave)\b|\bon leave today\b|\breports?\b/.test(t)) {
    return { type: 'requests', title: 'Open my team', body: "Who's in, who's off, and team requests.", href: '/team' }
  }
  if (/\bdocument\b|\brenew\b|\bexpir(e|y|ing)\b|\bID proof\b|\bcertificate\b/.test(t)) {
    return { type: 'documents', title: 'Open my profile', body: 'Documents and details that may need a refresh.', href: '/me' }
  }
  return null
}

// ── Person inference (People before metrics) ────────────────────────────────────
// When the answer is about a named person ("Priya recognised you"), show a FACE.
// Conservative: only proper-noun-shaped names tied to a recognition/people verb,
// so we never invent a face from an arbitrary capitalised word.
function inferPerson(reply: string): string | null {
  const verb = /(recogni[sz]ed|thanked|praised|appreciated|nominated|mentioned|from|by)\s+(by\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/
  const m = reply.match(verb)
  if (m && m[3]) {
    const name = m[3].trim()
    // Guard against sentence-start capitals that aren't names.
    if (!/^(You|Your|The|This|It|We|They|I|A|An|On|In|At|For)$/.test(name.split(/\s+/)[0]!)) {
      return name
    }
  }
  return null
}

// ── Instant retrieval (Search-as-instant-mode) ──────────────────────────────────
// A small set of asks resolve to a target with ZERO model latency — the "instant
// mode" the design names. These short-circuit /assistant/chat entirely.
const INSTANT: Array<{ test: RegExp; action: InferredAction }> = [
  { test: /^(leave balance|my leave|leave days?)\.?$/i, action: { type: 'leave', title: 'Open leave balance', body: 'See your balance, ledger and comp-off.', href: '/leave/balance' } },
  { test: /^(apply leave|take leave|book leave)\.?$/i,  action: { type: 'leave', title: 'Apply for leave', body: 'Open the leave flow.', href: '/leave/apply' } },
  { test: /^(my )?(payslip|pay slip|payslips|compensation)\.?$/i, action: { type: 'documents', title: 'View payslips', body: 'Open compensation — payslips and pay history.', href: '/compensation' } },
  { test: /^(my )?attendance\.?$/i, action: { type: 'attendance', title: 'Open my attendance', body: 'Your hours, calendar and requests.', href: '/attendance' } },
]

function matchInstant(text: string): InferredAction | null {
  for (const i of INSTANT) if (i.test.test(text.trim())) return i.action
  return null
}

// ── The answer block (Focus → action card → face → thread affordance) ───────────
interface AnswerView {
  ask:      string
  outcome:  AskOutcome
  action:   InferredAction | null
  person:   string | null
  instant:  boolean
}

export function MyAssistant() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const base = pathname.startsWith('/manager/self') ? '/manager/self' : '/ess'

  const { messages, asking, ask, reset } = useAssistant()
  const [input, setInput] = useState('')
  const [view, setView] = useState<AnswerView | null>(null)
  const [threadOpen, setThreadOpen] = useState(false)

  const go = (href: string) => navigate(`${base}${href}`)

  const submit = async (raw: string) => {
    const text = raw.trim()
    if (!text || asking) return
    setInput('')

    // Instant mode — a retrieval ask resolves to a target with no model round-trip.
    const instant = matchInstant(text)
    if (instant) {
      setView({
        ask: text,
        outcome: { kind: 'answer', reply: `Here’s ${instant.title.toLowerCase()}.`, toolsUsed: [] },
        action: instant,
        person: null,
        instant: true,
      })
      return
    }

    // Reasoning ask — hit the existing /assistant/chat tool-loop.
    const outcome = await ask(text)
    const reply = outcome.kind === 'answer' || outcome.kind === 'error' ? outcome.reply : ''
    setView({
      ask: text,
      outcome,
      action: outcome.kind === 'answer' ? inferAction(text, reply) : null,
      person: outcome.kind === 'answer' ? inferPerson(reply) : null,
      instant: false,
    })
  }

  const newAsk = () => {
    setView(null)
    setThreadOpen(false)
    reset()
  }

  // The thread (conversational FALLBACK) — only the open-ended-ask escape hatch.
  const thread = useMemo(() => messages.filter(m => m.content !== '__NOT_CONFIGURED__'), [messages])

  return (
    <div className="mx-auto max-w-[680px] space-y-8 py-2">
      {/* ── The ask field — the calm front door (always present, never a chat box) ── */}
      <form
        onSubmit={e => { e.preventDefault(); void submit(input) }}
        className="rounded-2xl bg-gradient-to-br from-primary/[0.06] to-[#15B8A6]/[0.06] p-5"
      >
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-[#15B8A6]" />
          CognixHR Assistant
        </p>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-background px-3.5 py-2.5 focus-within:border-primary">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            autoFocus
            maxLength={2000}
            placeholder="Ask me anything, or jump to…"
            aria-label="Ask the assistant"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={!input.trim() || asking}
            aria-label="Ask"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>

        {/* Suggested / Recent — action-first chips, NOT a blinking cursor. */}
        {!view && !asking && (
          <div className="mt-4 space-y-3">
            <div>
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Suggested</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTED.map(s => (
                  <Chip key={s} label={s} onClick={() => void submit(s)} />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Recent</p>
              <div className="flex flex-wrap gap-2">
                {RECENT.map(s => (
                  <Chip key={s} label={s} onClick={() => void submit(s)} muted />
                ))}
              </div>
            </div>
          </div>
        )}
      </form>

      {/* ── Understanding (loading) ── */}
      {asking && !view && (
        <LoadingState rows={2} label="Reading your data…" />
      )}

      {/* ── The answer (Focus → ONE action card → face) ── */}
      {view && (
        <div className="space-y-4">
          {asking ? (
            <LoadingState rows={2} label="Reading your data…" />
          ) : view.outcome.kind === 'not_configured' ? (
            <ErrorState
              title="The assistant isn’t switched on yet"
              description="Ask an admin to enable it in Settings → AI Assistant."
              onRetry={newAsk}
              retryLabel="Start over"
            />
          ) : view.outcome.kind === 'error' ? (
            <ErrorState
              title="Couldn’t answer that just now"
              description={view.outcome.reply}
              onRetry={() => void submit(view.ask)}
            />
          ) : (
            <>
              {/* Focus-shaped answer — one confident sentence, never a wall of prose. */}
              <FocusPanel eyebrow="Answer" sentence={view.outcome.reply} />

              {/* People before metrics — a FACE when the answer is about a person. */}
              {view.person && (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
                  <PersonAvatar name={view.person} size="md" />
                  <p className="text-sm text-foreground">
                    <span className="font-semibold">{view.person}</span>
                    <span className="text-muted-foreground"> — in this answer</span>
                  </p>
                </div>
              )}

              {/* The differentiator — ONE action card, deep-linking into a module flow. */}
              {view.action && (
                <SignalCard
                  signal={{
                    id:       'assistant-action',
                    type:     view.action.type,
                    severity: 'info',
                    priority: 1,
                    title:    view.action.title,
                    body:     view.action.body,
                    action:   { label: 'Open', href: view.action.href },
                  }}
                  onAction={go}
                />
              )}

              {/* Trust caption — persistent, mirrors the backend's no-fabrication rule. */}
              <p className="px-1 text-[11px] text-muted-foreground">
                AI can be wrong — verify important details.
              </p>

              {/* Conversation is the FALLBACK, never the front door. */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                {!view.instant && (
                  <button
                    onClick={() => setThreadOpen(o => !o)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    {threadOpen ? 'Hide conversation' : 'Open conversation'}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
                <button onClick={newAsk} className="text-xs text-muted-foreground hover:underline">
                  New ask
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Conversational fallback — unfolds BEHIND the answer, only on demand ── */}
      {threadOpen && view && view.outcome.kind === 'answer' && (
        <div className="space-y-3 rounded-2xl border border-border bg-card/50 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Conversation</p>
          <div className="space-y-2.5">
            {thread.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    m.role === 'user'
                      ? 'max-w-[85%] rounded-xl bg-primary px-3 py-2 text-xs text-primary-foreground'
                      : 'max-w-[85%] whitespace-pre-wrap rounded-xl bg-muted px-3 py-2 text-xs text-foreground'
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}
            {asking && <LoadingState rows={1} compact label="Thinking…" />}
          </div>
          {/* Continue the thread (same transport — still read + handoff only). */}
          <form
            onSubmit={e => { e.preventDefault(); const v = input.trim(); if (v) void submit(v) }}
            className="flex items-center gap-2 border-t border-border pt-3"
          >
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              maxLength={2000}
              placeholder="Continue the conversation…"
              aria-label="Continue the conversation"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={!input.trim() || asking}
              aria-label="Send"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

// ── Chip — a calm suggestion/recent affordance (read → understand → act) ─────────
function Chip({ label, onClick, muted = false }: { label: string; onClick: () => void; muted?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={
        muted
          ? 'rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary hover:text-foreground'
          : 'rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/10'
      }
    >
      {label}
    </button>
  )
}
