/**
 * AadhaarVerifyCard — Phase 1 Aadhaar verification widget (reusable).
 *
 * What works today: format + Verhoeff checksum validation with recorded consent
 * (calls POST /trust/verifications/aadhaar/:employeeId — HR admin). The result
 * is masked and stored, and shows here + in Trust Workspace.
 *
 * Phase 2 (online e-KYC against UIDAI via a licensed provider) is shown as a
 * "coming soon" affordance so the surface is complete and won't be missed.
 *
 * Used by: admin Employee master, ESS self-verify (when its endpoint lands),
 * onboarding, and surfaced read-only in Trust Workspace.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, Loader2, CheckCircle2, XCircle, AlertTriangle, Sparkles, Info } from 'lucide-react'
import { api } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface VerificationRecord {
  verification_type: string
  status:            string
  score:             number | null
  explanation:       string | null
  verified_at:       string | null
}

const STATUS_META: Record<string, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  verified:     { label: 'Verified',      tone: 'text-success',   icon: CheckCircle2 },
  failed:       { label: 'Failed',        tone: 'text-destructive', icon: XCircle },
  needs_review: { label: 'Needs review',  tone: 'text-warning',   icon: AlertTriangle },
  pending:      { label: 'Pending',       tone: 'text-muted-foreground', icon: Info },
  degraded:     { label: 'Provider down', tone: 'text-warning',   icon: AlertTriangle },
}

export function AadhaarVerifyCard({
  employeeId,
  self = false,
  className,
}: {
  employeeId: string
  /** Self-service mode (employee verifies their own Aadhaar via /ess endpoint). */
  self?: boolean
  className?: string
}) {
  const qc = useQueryClient()
  const [aadhaar, setAadhaar] = useState('')
  const [consent, setConsent] = useState(false)

  // Current Aadhaar verification status (if any)
  const { data, isLoading } = useQuery<{ data: VerificationRecord[] }>({
    queryKey:  ['aadhaar-verification', employeeId],
    queryFn:   () => api.get(`/trust/verifications/employee/${employeeId}`),
    enabled:   !!employeeId,
    staleTime: 60_000,
  })
  const record = (data?.data ?? []).find(r => r.verification_type === 'aadhaar')
  const meta   = record ? (STATUS_META[record.status] ?? STATUS_META.pending) : null

  const verify = useMutation({
    mutationFn: () =>
      self
        ? api.post('/ess/aadhaar/verify', { consent, aadhaar: aadhaar.replace(/\s/g, '') })
        : api.post(`/trust/verifications/aadhaar/${employeeId}`, {
            consent,
            aadhaar: aadhaar.replace(/\s/g, '') || undefined,
          }),
    onSuccess: () => {
      setAadhaar('')
      qc.invalidateQueries({ queryKey: ['aadhaar-verification', employeeId] })
    },
  })

  const digits = aadhaar.replace(/\D/g, '')
  const formatHint = digits.length > 0 && digits.length !== 12

  return (
    <div className={cn('rounded-xl border border-border bg-card overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">Aadhaar Verification</p>
        </div>
        <Badge variant="secondary" className="rounded-full text-[10px] gap-1">
          <Sparkles className="h-3 w-3" /> Online e-KYC — soon
        </Badge>
      </div>

      <div className="p-4 space-y-3">
        {/* Current status */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking status…
          </div>
        ) : record && meta ? (
          <div className="flex items-start gap-2.5 rounded-lg bg-muted/40 px-3 py-2.5">
            <meta.icon className={cn('h-4 w-4 mt-0.5 shrink-0', meta.tone)} />
            <div className="min-w-0">
              <p className={cn('text-xs font-semibold', meta.tone)}>{meta.label}</p>
              {record.explanation && (
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{record.explanation}</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Not yet verified.</p>
        )}

        {/* Input */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground">
            Aadhaar number{' '}
            <span className="opacity-60">
              {self ? '(12 digits)' : '(leave blank to use the number on file)'}
            </span>
          </label>
          <input
            inputMode="numeric"
            value={aadhaar}
            onChange={e => setAadhaar(e.target.value.replace(/[^\d\s]/g, '').slice(0, 14))}
            placeholder="XXXX XXXX XXXX"
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm tabular-nums tracking-wider outline-none focus:ring-1 focus:ring-primary/50"
          />
          {formatHint && (
            <p className="text-[10px] text-warning">Aadhaar is 12 digits.</p>
          )}
        </div>

        {/* Consent — mandatory */}
        <label className="flex items-start gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={consent}
            onChange={e => setConsent(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-[var(--primary)]"
          />
          <span className="text-[11px] text-muted-foreground leading-relaxed">
            The employee has given explicit consent to verify their Aadhaar
            (Aadhaar Act §8 / DPDP Act). Required to proceed.
          </span>
        </label>

        {/* Action */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-[10px] text-muted-foreground/70 leading-relaxed max-w-[60%]">
            Today this checks format &amp; checksum. Online UIDAI e-KYC arrives with the provider integration.
          </p>
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            disabled={!consent || verify.isPending || (self ? digits.length !== 12 : (digits.length > 0 && digits.length !== 12))}
            onClick={() => verify.mutate()}
          >
            {verify.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Verify
          </Button>
        </div>

        {verify.isError && (
          <p className="text-[11px] text-destructive">
            {verify.error instanceof Error ? verify.error.message : 'Verification failed. Please try again.'}
          </p>
        )}
      </div>
    </div>
  )
}

export default AadhaarVerifyCard
