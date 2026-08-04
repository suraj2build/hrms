import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Briefcase, Calendar, Clock, CheckCircle2, XCircle, Loader2, MapPin, Video, Phone, Users } from 'lucide-react'
import { LogoMark } from '@/components/brand/Logo'
import { fmtDate as fmtDateUtil } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Stage {
  id:          string
  name:        string
  stage_type:  string
  stage_order: number
  color:       string
}

interface Interview {
  round_number: number
  title:        string | null
  type:         string
  scheduled_at: string | null
  duration_mins: number
  status:       string
}

interface PortalData {
  id:               string
  status:           string
  applied_at:       string
  first_name:       string
  candidate_name:   string
  job_title:        string
  department:       string
  company_name:     string
  current_stage_id: string | null
  stages:           Stage[]
  interviews:       Interview[]
  offer?: {
    id:             string
    status:         string
    offered_amount: number | null
    joining_date:   string | null
    valid_until:    string | null
    html_content:   string | null
    accepted_at:    string | null
    declined_at:    string | null
  } | null
}

// ── Status display config ──────────────────────────────────────────────────────

const STATUS_DISPLAY: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  applied:      { label: 'Application Received', color: '#6B7280', bg: '#F3F4F6', icon: <CheckCircle2 className="h-5 w-5" /> },
  screening:    { label: 'Under Screening',       color: '#2563EB', bg: '#EFF6FF', icon: <CheckCircle2 className="h-5 w-5" /> },
  interviewing: { label: 'Interviewing',           color: '#7C3AED', bg: '#F5F3FF', icon: <CheckCircle2 className="h-5 w-5" /> },
  offer:        { label: 'Offer Extended',          color: '#059669', bg: '#ECFDF5', icon: <CheckCircle2 className="h-5 w-5" /> },
  hired:        { label: 'Offer Accepted',          color: '#0D9488', bg: '#F0FDFA', icon: <CheckCircle2 className="h-5 w-5" /> },
  rejected:     { label: 'Not Selected',           color: '#DC2626', bg: '#FEF2F2', icon: <XCircle     className="h-5 w-5" /> },
  withdrawn:    { label: 'Withdrawn',              color: '#9CA3AF', bg: '#F9FAFB', icon: <XCircle     className="h-5 w-5" /> },
}

const INTERVIEW_TYPE_ICON: Record<string, React.ReactNode> = {
  video:      <Video  className="h-4 w-4" />,
  phone:      <Phone  className="h-4 w-4" />,
  in_person:  <Users  className="h-4 w-4" />,
  assignment: <Briefcase className="h-4 w-4" />,
}

const INTERVIEW_TYPE_LABEL: Record<string, string> = {
  video: 'Video Call', phone: 'Phone Call', in_person: 'In-Person', assignment: 'Assignment',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null, withTime = true) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (withTime) {
    return d.toLocaleString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
    }) + ' IST'
  }
  return fmtDateUtil(iso)
}

// ── Components ─────────────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-muted via-primary/5 to-success/5">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <LogoMark className="h-8 w-8" />
          <span className="font-semibold text-foreground text-sm tracking-tight">
            Cognix<span className="text-[#15B8A6]">HR</span>
          </span>
          <span className="text-muted-foreground text-sm">·</span>
          <span className="text-muted-foreground text-sm">Candidate Portal</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-5">
        {children}
      </main>

      <footer className="max-w-2xl mx-auto px-4 py-8 text-center text-xs text-muted-foreground">
        Powered by CognixHR — Smarter Workforce. Stronger Future.
      </footer>
    </div>
  )
}

function StageProgress({ stages, currentStageId, appStatus }: {
  stages: Stage[]
  currentStageId: string | null
  appStatus: string
}) {
  const sorted = [...stages].sort((a, b) => a.stage_order - b.stage_order)
  if (sorted.length === 0) return null

  const currentIdx = sorted.findIndex(s => s.id === currentStageId)
  const isTerminal  = appStatus === 'rejected' || appStatus === 'withdrawn' || appStatus === 'hired'

  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm p-6">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-5">Application Progress</h2>
      <div className="relative">
        {/* Connector line */}
        <div className="absolute top-4 left-4 right-4 h-0.5 bg-muted" />
        <div
          className="absolute top-4 left-4 h-0.5 bg-gradient-to-r from-primary to-success transition-all duration-700"
          style={{
            width: isTerminal
              ? '100%'
              : currentIdx >= 0
                ? `${(currentIdx / Math.max(sorted.length - 1, 1)) * 100}%`
                : '0%',
          }}
        />

        <div className="relative flex justify-between">
          {sorted.map((stage, idx) => {
            const isPast    = currentIdx >= 0 && idx < currentIdx
            const isCurrent = stage.id === currentStageId
            const isFuture  = currentIdx >= 0 ? idx > currentIdx : true

            return (
              <div key={stage.id} className="flex flex-col items-center gap-2 flex-1">
                <div
                  className={[
                    'h-8 w-8 rounded-full border-2 flex items-center justify-center z-10 transition-all',
                    isCurrent
                      ? 'border-primary bg-primary text-primary-foreground shadow-md shadow-primary/20'
                      : isPast
                        ? 'border-success bg-success text-success-foreground'
                        : 'border-border bg-white text-muted-foreground',
                  ].join(' ')}
                >
                  {isPast || isCurrent
                    ? <CheckCircle2 className="h-4 w-4" />
                    : <span className="text-xs font-bold">{idx + 1}</span>
                  }
                </div>
                <span className={[
                  'text-xs text-center leading-tight max-w-[64px]',
                  isCurrent ? 'font-semibold text-primary' : isPast ? 'text-success' : 'text-muted-foreground',
                  isFuture && !isCurrent ? 'opacity-50' : '',
                ].join(' ')}>
                  {stage.name}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function InterviewCard({ interview }: { interview: Interview }) {
  const typeIcon  = INTERVIEW_TYPE_ICON[interview.type]  ?? <Calendar className="h-4 w-4" />
  const typeLabel = INTERVIEW_TYPE_LABEL[interview.type] ?? interview.type
  const isUpcoming = interview.scheduled_at && new Date(interview.scheduled_at) > new Date()

  const statusBadge: Record<string, string> = {
    scheduled:  'bg-primary/10 text-primary',
    completed:  'bg-success/10 text-success',
    cancelled:  'bg-destructive/10 text-destructive',
    rescheduled: 'bg-warning/10 text-warning',
  }

  return (
    <div className="flex gap-4 items-start p-4 rounded-xl border border-border bg-muted/50">
      <div className="h-9 w-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center flex-shrink-0">
        {typeIcon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {interview.title || `Round ${interview.round_number}`}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{typeLabel}</p>
          </div>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize flex-shrink-0 ${statusBadge[interview.status] ?? 'bg-muted text-muted-foreground'}`}>
            {interview.status}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {interview.scheduled_at && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {fmtDate(interview.scheduled_at)}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {interview.duration_mins} min
          </span>
          {isUpcoming && (
            <span className="text-primary font-medium">Upcoming</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function CandidatePortal() {
  const { token } = useParams<{ token: string }>()
  const [data,    setData]    = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [acting,  setActing]  = useState<null | 'accept' | 'decline'>(null)
  const [actionError, setActionError] = useState('')

  const API_URL = (import.meta as ImportMeta & { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL || ''

  const load = useCallback(async () => {
    if (!token) { setNotFound(true); setLoading(false); return }
    try {
      const r = await fetch(`${API_URL}/recruitment/portal/candidate/${token}`)
      if (!r.ok) throw new Error('not_found')
      const json = await r.json()
      setData(json.data)
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [token, API_URL])

  useEffect(() => { void load() }, [load])

  async function respondToOffer(decision: 'accept' | 'decline') {
    if (!token) return
    if (decision === 'decline' && !window.confirm('Are you sure you want to decline this offer? This cannot be undone.')) return
    setActing(decision)
    setActionError('')
    try {
      const r = await fetch(`${API_URL}/recruitment/portal/candidate/${token}/offer/${decision}`, { method: 'POST' })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) { setActionError(body?.message ?? 'Something went wrong. Please contact the recruiter.'); return }
      await load()
    } catch {
      setActionError('Network error. Please try again.')
    } finally {
      setActing(null)
    }
  }

  if (loading) {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Loading your application…</p>
        </div>
      </PageShell>
    )
  }

  if (notFound || !data) {
    return (
      <PageShell>
        <div className="bg-white rounded-2xl border border-border shadow-sm p-10 text-center">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <XCircle className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">Application Not Found</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            This link may have expired or the application doesn't exist.<br />
            Contact the recruiting team if you believe this is a mistake.
          </p>
        </div>
      </PageShell>
    )
  }

  const statusConfig = STATUS_DISPLAY[data.status] ?? STATUS_DISPLAY['applied']
  const appliedDate  = fmtDate(data.applied_at, false)

  return (
    <PageShell>
      {/* Hero card */}
      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        {/* Gradient strip */}
        <div className="h-1.5 bg-gradient-to-r from-[#2E6FE6] to-[#15B8A6]" />
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                {data.company_name}
              </p>
              <h1 className="text-xl font-bold text-foreground">
                Hi, {data.first_name || data.candidate_name}!
              </h1>
            </div>
            <span
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0"
              style={{ background: statusConfig.bg, color: statusConfig.color }}
            >
              {statusConfig.icon}
              {statusConfig.label}
            </span>
          </div>

          <div className="mt-4 pt-4 border-t border-border space-y-2">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Briefcase className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="font-semibold">{data.job_title}</span>
            </div>
            {data.department && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span>{data.department}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4 flex-shrink-0" />
              <span>Applied on {appliedDate}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stage progress */}
      {data.stages.length > 0 && (
        <StageProgress
          stages={data.stages}
          currentStageId={data.current_stage_id}
          appStatus={data.status}
        />
      )}

      {/* Interviews */}
      {data.interviews.length > 0 && (
        <div className="bg-white rounded-2xl border border-border shadow-sm p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Interviews</h2>
          <div className="space-y-3">
            {data.interviews.map(iv => (
              <InterviewCard key={iv.round_number} interview={iv} />
            ))}
          </div>
        </div>
      )}

      {/* Offer — actionable */}
      {data.offer && (
        <div className="bg-white rounded-2xl border border-border shadow-sm p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Your Offer</h2>

          <div className="grid grid-cols-2 gap-4 mb-4">
            {data.offer.offered_amount != null && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Annual CTC</p>
                <p className="text-base font-bold text-foreground tabular-nums">₹{Number(data.offer.offered_amount).toLocaleString('en-IN')}</p>
              </div>
            )}
            {data.offer.joining_date && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Joining date</p>
                <p className="text-sm font-medium">{fmtDate(data.offer.joining_date, false)}</p>
              </div>
            )}
            {data.offer.valid_until && data.offer.status === 'sent' && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Respond by</p>
                <p className="text-sm font-medium">{fmtDate(data.offer.valid_until, false)}</p>
              </div>
            )}
          </div>

          {data.offer.status === 'sent' ? (
            <>
              <div className="flex gap-3">
                <button
                  onClick={() => respondToOffer('accept')}
                  disabled={acting !== null}
                  className="flex-1 inline-flex items-center justify-center rounded-lg bg-[#15B8A6] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0D9488] transition disabled:opacity-60"
                >
                  {acting === 'accept' ? 'Accepting…' : 'Accept Offer'}
                </button>
                <button
                  onClick={() => respondToOffer('decline')}
                  disabled={acting !== null}
                  className="flex-1 inline-flex items-center justify-center rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted transition disabled:opacity-60"
                >
                  {acting === 'decline' ? 'Declining…' : 'Decline'}
                </button>
              </div>
              {actionError && <p className="text-destructive text-xs mt-3">{actionError}</p>}
            </>
          ) : data.offer.status === 'accepted' ? (
            <div className="bg-success/10 border border-success/30 rounded-lg p-4 text-center">
              <p className="text-success font-semibold text-sm">🎉 You accepted this offer!</p>
              <p className="text-success text-sm mt-1">Check your email for the onboarding link to complete your joining formalities.</p>
            </div>
          ) : (
            <div className="bg-muted border border-border rounded-lg p-4 text-center">
              <p className="text-muted-foreground text-sm">You declined this offer.</p>
            </div>
          )}
        </div>
      )}

      {/* Generic congrats — only when there's no actionable/explicit offer card */}
      {!data.offer && (data.status === 'hired' || data.status === 'offer') && (
        <div className="bg-success/10 border border-success/30 rounded-2xl p-5 text-center">
          <p className="text-success font-semibold text-sm">🎉 Congratulations!</p>
          <p className="text-success text-sm mt-1">
            Our team will reach out to you shortly with further details.
          </p>
        </div>
      )}
      {data.status === 'rejected' && (
        <div className="bg-muted border border-border rounded-2xl p-5 text-center">
          <p className="text-muted-foreground text-sm leading-relaxed">
            Thank you for your time and interest. We wish you all the best in your career journey.
          </p>
        </div>
      )}
    </PageShell>
  )
}
