/**
 * CareersList — /careers/:tenantSlug
 *
 * Public, unauthenticated job listing page. Reads GET /careers/:tenantSlug/openings
 * — no session, no tenant JWT; the tenant is resolved server-side from the
 * slug in the URL. A missing/suspended tenant and a tenant with zero public
 * openings render the same "nothing here" state (the backend 404s either way).
 */
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Briefcase, MapPin, Users, Loader2, Building2 } from 'lucide-react'
import { LogoMark } from '@/components/brand/Logo'
import { api } from '@/lib/api/client'

interface OpeningSummary {
  id: string
  title: string
  location: string | null
  employment_type: string
  openings: number
  min_experience: number | null
  max_experience: number | null
  department: string | null
}

interface CareersListResponse {
  company_name: string
  openings: OpeningSummary[]
}

const EMPLOYMENT_LABEL: Record<string, string> = {
  full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', intern: 'Internship',
}

function experienceLabel(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null
  if (min != null && max != null) return `${min}–${max} yrs experience`
  if (min != null) return `${min}+ yrs experience`
  return `Up to ${max} yrs experience`
}

export function CareersList() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>()

  const { data, isLoading, isError } = useQuery<{ data: CareersListResponse }>({
    queryKey: ['careers', tenantSlug],
    queryFn:  () => api.get(`/careers/${tenantSlug}/openings`),
    retry:    false,
  })

  const companyName = data?.data.company_name
  const openings = data?.data.openings ?? []

  return (
    <div className="min-h-screen bg-gradient-to-br from-muted via-primary/5 to-success/5">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="flex items-center gap-2 mb-8">
          <LogoMark className="h-7 w-7" />
          <span className="text-sm font-semibold text-muted-foreground">Careers</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : isError || !companyName ? (
          <div className="flex flex-col items-center justify-center gap-2 py-24 text-center text-muted-foreground">
            <Building2 className="h-8 w-8 opacity-30" />
            <p className="text-sm">This careers page isn't available.</p>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-foreground">Open Positions at {companyName}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {openings.length === 0 ? 'No open positions right now — check back soon.' : `${openings.length} open position${openings.length === 1 ? '' : 's'}`}
              </p>
            </div>

            <div className="space-y-3">
              {openings.map(o => (
                <Link
                  key={o.id}
                  to={`/careers/${tenantSlug}/${o.id}`}
                  className="block rounded-xl border border-border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold text-foreground">{o.title}</h2>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                        {o.department && <span className="flex items-center gap-1"><Briefcase className="h-3 w-3" />{o.department}</span>}
                        {o.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{o.location}</span>}
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" />{o.openings} opening{o.openings === 1 ? '' : 's'}</span>
                      </div>
                      {experienceLabel(o.min_experience, o.max_experience) && (
                        <p className="text-xs text-muted-foreground mt-1">{experienceLabel(o.min_experience, o.max_experience)}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-[11px] font-medium px-2 py-1 rounded-full bg-primary/10 text-primary">
                      {EMPLOYMENT_LABEL[o.employment_type] ?? o.employment_type}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
