/**
 * projectJourney — the shared Growth-spine projector (the milestone facet of the
 * Moments contract). Centralised here now that My Growth is the second consumer
 * after Timeline, so the significance logic lives in ONE place (EXPERIENCE_MOMENTS.md
 * §5: centralise the classifier when the second consumer needs it).
 *
 * Real milestones only, forward-ordered (joined → now), never fabricated. Also
 * returns the underlying "first" ids (so Timeline can mark them without re-querying)
 * and the next upcoming anniversary (so My Growth's "Looking Ahead" stays real).
 * Derive-on-read; no storage.
 */

import type { FastifyInstance } from 'fastify'

export type JourneyKind =
  | 'joined' | 'first_payslip' | 'first_recognition' | 'confirmation'
  | 'promotion' | 'role_change' | 'team_change' | 'learning' | 'anniversary'

export interface JourneyStep { id: string; kind: JourneyKind; label: string; at: string; detail?: string; person?: string }

export interface JourneyResult {
  steps: JourneyStep[]
  firstSlipId:  string | null
  firstKudosId: string | null
  /** The next service anniversary still ahead — real, dated. Null if none/unknown. */
  nextAnniversary: { years: number; at: string } | null
}

function safe<T>(p: PromiseLike<T>, fallback: T): Promise<T> {
  return Promise.resolve(p).then(v => v, () => fallback)
}

export async function projectJourney(
  fastify: FastifyInstance,
  { tenantId, employeeId, now }: { tenantId: string; employeeId: string | null; now: Date },
): Promise<JourneyResult> {
  if (!employeeId) return { steps: [], firstSlipId: null, firstKudosId: null, nextAnniversary: null }

  const [emp, firstSlip, firstKudos] = await Promise.all([
    safe(fastify.supabase.from('employees').select('joining_date')
      .eq('id', employeeId).eq('tenant_id', tenantId).maybeSingle().then(r => r.data as any), null),
    safe(fastify.supabase.from('payroll_slips').select('id, updated_at')
      .eq('employee_id', employeeId).eq('tenant_id', tenantId).eq('status', 'finalized')
      .order('updated_at', { ascending: true }).limit(1).maybeSingle().then(r => (r.data as any) ?? null), null),
    safe(fastify.supabase.from('recognition').select('id, from_employee, created_at')
      .eq('tenant_id', tenantId).eq('to_employee', employeeId)
      .order('created_at', { ascending: true }).limit(1).maybeSingle().then(r => (r.data as any) ?? null), null),
  ])

  const steps: JourneyStep[] = []
  let nextAnniversary: { years: number; at: string } | null = null

  const join = (emp?.joining_date as string | null) ?? null
  if (join) {
    const jat = join.length <= 10 ? join + 'T00:00:00Z' : join
    const jd = new Date(jat)
    if (!isNaN(jd.getTime())) {
      steps.push({ id: 'jny:joined', kind: 'joined', label: 'Joined', at: jat })
      const years = Math.floor((now.getTime() - jd.getTime()) / (365.25 * 86_400_000))
      for (let y = 1; y <= years; y++) {
        const a = new Date(jd); a.setUTCFullYear(jd.getUTCFullYear() + y)
        if (a.getTime() > now.getTime()) break
        steps.push({ id: `jny:anniv:${y}`, kind: 'anniversary', label: y === 1 ? '1 year' : `${y} years`, at: a.toISOString() })
      }
      // The next anniversary still ahead (forward-looking, real).
      const ny = years + 1
      const na = new Date(jd); na.setUTCFullYear(jd.getUTCFullYear() + ny)
      if (na.getTime() > now.getTime()) nextAnniversary = { years: ny, at: na.toISOString() }
    }
  }

  if (firstSlip?.updated_at) {
    steps.push({ id: 'jny:first_payslip', kind: 'first_payslip', label: 'First payslip', at: firstSlip.updated_at })
  }
  if (firstKudos?.created_at) {
    let giver: string | undefined
    if (firstKudos.from_employee) {
      const g = await safe(fastify.supabase.from('employees').select('first_name, last_name')
        .eq('id', firstKudos.from_employee).eq('tenant_id', tenantId).maybeSingle().then(r => r.data as any), null)
      giver = g ? `${g.first_name ?? ''} ${g.last_name ?? ''}`.trim() || undefined : undefined
    }
    steps.push({ id: 'jny:first_recognition', kind: 'first_recognition', label: 'First recognition',
      at: firstKudos.created_at, detail: giver ? `from ${giver}` : undefined, person: giver })
  }

  steps.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  return { steps, firstSlipId: firstSlip?.id ?? null, firstKudosId: firstKudos?.id ?? null, nextAnniversary }
}
