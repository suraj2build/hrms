/**
 * AssistantWidget — the always-present floating AI chat bubble.
 *
 * Mounted once globally (App.tsx). Self-guards: renders nothing on auth/owner
 * pages or when logged out. Calls POST /assistant/chat (role-scoped server-side).
 * Can both answer questions and take some actions (apply leave, raise a
 * helpdesk ticket, update contact info, etc — see assistant-tools.ts for the
 * full write-tool list). Shows a friendly "not configured" state with a
 * link to the admin AI settings when no provider key is set.
 */
import { useState, useRef, useEffect } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Sparkles, X, Send, Loader2, Settings, RotateCcw } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { DEMO_MODE } from '@/lib/demo'

interface Msg { role: 'user' | 'assistant'; content: string; toolsUsed?: string[] }
interface ChatResp { data: { reply: string | null; not_configured?: boolean; error?: boolean; tools_used?: string[] } }
interface StatusResp { data: { enabled: boolean; provider: string; model: string } }

const HIDE_ON = ['/login', '/owner', '/onboarding/portal', '/recruitment/portal', '/candidate']

export function AssistantWidget() {
  const { profile, accessToken } = useAuthStore()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  // Persist the transcript across page refreshes (sessionStorage = cleared on tab close).
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try {
      const raw = sessionStorage.getItem('cognixhr-assistant-chat')
      return raw ? (JSON.parse(raw) as Msg[]) : []
    } catch { return [] }
  })
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Keep the saved transcript in sync (cap to last 50 to bound storage).
  useEffect(() => {
    try { sessionStorage.setItem('cognixhr-assistant-chat', JSON.stringify(msgs.slice(-50))) } catch { /* quota / disabled */ }
  }, [msgs])

  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'hr_admin'
  const hidden  = HIDE_ON.some(p => pathname.startsWith(p))

  const { data: status } = useQuery<StatusResp>({
    queryKey: ['assistant-status'],
    queryFn:  () => api.get('/assistant/status'),
    // Only probe when the widget can actually render AND a token is available.
    // `profile` is persisted to localStorage but `accessToken` is NOT — on reload
    // the profile rehydrates instantly while the token is still null until Supabase
    // re-bootstraps. Gating on the token avoids a "No token provided" 401 in that gap.
    enabled:  !!profile && !!accessToken && !hidden,
    staleTime: 5 * 60_000,
    retry: false,                 // a 401/500 here is non-critical — don't retry-spam
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [msgs, open, sending])

  if (!profile) return null
  if (hidden) return null

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    const history = msgs.slice(-8)
    setMsgs(m => [...m, { role: 'user', content: text }])
    setInput('')
    setSending(true)
    try {
      const res = await api.post<ChatResp>('/assistant/chat', { message: text, history })
      if (res.data.not_configured) {
        setMsgs(m => [...m, { role: 'assistant', content: '__NOT_CONFIGURED__' }])
      } else {
        setMsgs(m => [...m, { role: 'assistant', content: res.data.reply ?? '…', toolsUsed: res.data.tools_used }])
      }
    } catch {
      setMsgs(m => [...m, { role: 'assistant', content: 'Sorry — I could not reach the assistant. Please try again.' }])
    } finally {
      setSending(false)
    }
  }

  const greeting = profile.role === 'employee'
    ? 'Ask me about your leave, payslip, or how to do something in CognixHR.'
    : 'Ask about your team, pending approvals, headcount, or how to use CognixHR.'

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open AI assistant"
          className="fixed bottom-5 right-5 z-[60] flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg transition-transform hover:scale-105"
          style={{ background: 'linear-gradient(135deg, #2E6FE6 0%, #15B8A6 100%)' }}
        >
          <Sparkles className="h-5 w-5" />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-[60] flex h-[min(560px,80vh)] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 text-white" style={{ background: 'linear-gradient(135deg, #1A4D8F 0%, #15B8A6 100%)' }}>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">CognixHR Assistant</p>
              <p className="text-[10px] text-white/70 leading-tight">
                {DEMO_MODE ? 'Demo · sample answers' : status?.data.enabled ? 'Answers questions & can take actions for you' : 'Not configured'}
              </p>
            </div>
            {msgs.length > 0 && (
              <button onClick={() => setMsgs([])} aria-label="New chat" title="Clear chat" className="rounded-md p-1 hover:bg-white/15">
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
            <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-md p-1 hover:bg-white/15">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
            {msgs.length === 0 && (
              <div className="mt-2 rounded-xl bg-muted/50 px-3.5 py-3 text-xs text-muted-foreground">
                <p className="mb-1 font-medium text-foreground">Hi {profile.full_name?.split(' ')[0] ?? 'there'} 👋</p>
                {greeting}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.content === '__NOT_CONFIGURED__' ? (
                  <div className="max-w-[85%] rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                    The assistant isn't switched on yet.{' '}
                    {isAdmin ? (
                      <Link to="/admin/settings/ai" onClick={() => setOpen(false)} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                        <Settings className="h-3 w-3" /> Configure it
                      </Link>
                    ) : 'Ask an admin to enable it in Settings → AI Assistant.'}
                  </div>
                ) : (
                  <div className="max-w-[85%]">
                    <div className={`whitespace-pre-wrap rounded-xl px-3 py-2 text-xs ${
                      m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                    }`}>
                      {m.content}
                    </div>
                    {m.role === 'assistant' && m.toolsUsed && m.toolsUsed.length > 0 && (
                      <p className="mt-1 px-1 text-[10px] text-muted-foreground">✓ From your data</p>
                    )}
                  </div>
                )}
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-border p-2.5">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                rows={1}
                maxLength={2000}
                placeholder="Ask anything…"
                className="max-h-24 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
              />
              <button
                onClick={send}
                disabled={!input.trim() || sending}
                aria-label="Send"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 px-1 text-[9px] text-muted-foreground">AI can be wrong — verify important details.</p>
          </div>
        </div>
      )}
    </>
  )
}
