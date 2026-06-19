/**
 * OrgHealth — Phase 4 Organization Health
 * /admin/intelligence/org-health
 *
 * Read-only org intelligence. Three sections sourced from existing tables:
 * department headcount, 6-month headcount trend, attrition signal.
 * No charts — clean tables. Every section cites its source.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Badge } from '@/components/ui/badge'
import { Loader2, TrendingUp, TrendingDown, Minus, MapPin, Store } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'

interface Department {
  id: string; name: string; headcount: number
  joiners_30d: number; exits_30d: number; probation_due: number; summary_text: string
}
interface TrendMonth { period: string; headcount: number; joiners: number; exits: number }
interface AttritionDept { dept_name: string; count: number }
interface AttritionData { signal: 'elevated' | 'normal' | 'low'; by_department: AttritionDept[]; total: number }

interface SiteBucket { key: string; label: string; headcount: number; joiners_30d: number; city?: string | null; region?: string | null; zone?: string | null; site_type?: string | null }
interface SiteData {
  by_site: SiteBucket[]; by_region: SiteBucket[]; by_zone: SiteBucket[]; by_site_type: SiteBucket[]
  unassigned: number; total: number; dimensions_configured: boolean
}

function SignalBadge({ signal }: { signal: 'elevated' | 'normal' | 'low' }) {
  if (signal === 'elevated') return <Badge variant="destructive" className="capitalize">Elevated</Badge>
  if (signal === 'low')      return <Badge variant="info" className="capitalize">Low</Badge>
  return <Badge variant="success" className="capitalize">Normal</Badge>
}

function NetChange({ joiners, exits }: { joiners: number; exits: number }) {
  const net = joiners - exits
  if (net > 0) return <span className="text-success font-medium inline-flex items-center gap-0.5"><TrendingUp className="h-3 w-3" /> +{net}</span>
  if (net < 0) return <span className="text-destructive font-medium inline-flex items-center gap-0.5"><TrendingDown className="h-3 w-3" /> {net}</span>
  return <span className="text-muted-foreground inline-flex items-center gap-0.5"><Minus className="h-3 w-3" /> 0</span>
}

export function OrgHealth() {
  const depts = useQuery<{ departments: Department[] }>({
    queryKey: ['intelligence-org-departments'],
    queryFn:  () => api.get('/intelligence/org/departments'),
    staleTime: 5 * 60_000,
  })
  const trend = useQuery<{ months: TrendMonth[] }>({
    queryKey: ['intelligence-org-trend'],
    queryFn:  () => api.get('/intelligence/org/headcount-trend'),
    staleTime: 5 * 60_000,
  })
  const attrition = useQuery<{ data?: AttritionData } & AttritionData>({
    queryKey: ['intelligence-org-attrition'],
    queryFn:  () => api.get('/intelligence/org/attrition-signal'),
    staleTime: 5 * 60_000,
  })
  const sites = useQuery<SiteData>({
    queryKey: ['intelligence-org-headcount-by-site'],
    queryFn:  () => api.get('/intelligence/org/headcount-by-site'),
    staleTime: 5 * 60_000,
  })

  const deptRows  = depts.data?.departments ?? []
  const months    = trend.data?.months ?? []
  const attr       = attrition.data
  const siteData   = sites.data
  const loading   = depts.isLoading || trend.isLoading || attrition.isLoading || sites.isLoading

  return (
    <PageContainer>
      {/* Gradient header */}
      <div className="rounded-xl bg-gradient-to-r from-[#1A4D8F] via-[#1E5BA8] to-[#2260A8] text-white p-5">
        <h1 className="text-lg font-semibold">Organization Health</h1>
        <p className="text-sm text-white/80">
          Headcount, movement, and attrition signals — derived from live employee data
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading organization health…</span>
        </div>
      )}

      {!loading && (
        <>
          {/* Attrition signal */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Attrition Signal</p>
              {attr && (
                <div className="flex items-center gap-2">
                  <SignalBadge signal={attr.signal} />
                  <span className="text-xs text-muted-foreground">{attr.total} in last 90 days</span>
                </div>
              )}
            </div>
            {attr && attr.by_department.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {attr.by_department.map(d => (
                  <span key={d.dept_name} className="text-xs px-2 py-1 rounded-md bg-muted/50">
                    {d.dept_name}: <span className="font-semibold">{d.count}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No resignations or notice-period employees in the last 90 days.</p>
            )}
            <p className="text-[11px] text-muted-foreground">Source: employees (status in resigned/on_notice, last 90 days)</p>
          </div>

          {/* Department headcount */}
          <div className="rounded-lg border border-border bg-card">
            <div className="px-4 py-3 border-b border-border">
              <p className="text-sm font-semibold text-foreground">Department Headcount</p>
              <p className="text-[11px] text-muted-foreground">Source: employees JOIN departments · rows highlighted where probation due &gt; 3</p>
            </div>
            {deptRows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No department data available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border">
                      <th className="px-4 py-2 font-medium">Department</th>
                      <th className="px-4 py-2 font-medium text-right">Headcount</th>
                      <th className="px-4 py-2 font-medium text-right">Joiners (30d)</th>
                      <th className="px-4 py-2 font-medium text-right">Exits (30d)</th>
                      <th className="px-4 py-2 font-medium text-right">Probation Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deptRows.map(row => (
                      <tr key={row.id} className={'border-b border-border/50 ' + (row.probation_due > 3 ? 'bg-warning/10' : '')}>
                        <td className="px-4 py-2 font-medium text-foreground">{row.name}</td>
                        <td className="px-4 py-2 text-right">{row.headcount}</td>
                        <td className="px-4 py-2 text-right text-success">+{row.joiners_30d}</td>
                        <td className="px-4 py-2 text-right text-destructive">{row.exits_30d > 0 ? '-' + row.exits_30d : '0'}</td>
                        <td className={'px-4 py-2 text-right ' + (row.probation_due > 3 ? 'text-warning font-semibold' : 'text-muted-foreground')}>{row.probation_due}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Headcount by site / region (R5 — retail intelligence) */}
          {siteData && (siteData.by_site.length > 0 || siteData.unassigned > 0) && (
            <div className="rounded-lg border border-border bg-card">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <Store className="h-4 w-4 text-muted-foreground" /> Headcount by Site
                  </p>
                  <p className="text-[11px] text-muted-foreground">Source: employees.site_id JOIN sites · active headcount disaggregated by location</p>
                </div>
                {siteData.unassigned > 0 && (
                  <span className="text-xs text-muted-foreground">{siteData.unassigned} unassigned</span>
                )}
              </div>

              {!siteData.dimensions_configured && (
                <div className="px-4 py-2 bg-muted/30 text-[11px] text-muted-foreground border-b border-border">
                  Tip: set <span className="font-medium">region</span>, <span className="font-medium">zone</span>, and <span className="font-medium">site type</span> on each site (Masters → Sites) to unlock regional roll-ups.
                </div>
              )}

              {/* Region / Zone / Type roll-up chips */}
              {(siteData.by_region.length > 0 || siteData.by_zone.length > 0 || siteData.by_site_type.length > 0) && (
                <div className="px-4 py-3 border-b border-border grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    { title: 'By Region', rows: siteData.by_region },
                    { title: 'By Zone',   rows: siteData.by_zone },
                    { title: 'By Type',   rows: siteData.by_site_type },
                  ].filter(g => g.rows.length > 0).map(g => (
                    <div key={g.title}>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{g.title}</p>
                      <div className="space-y-1">
                        {g.rows.slice(0, 6).map(r => (
                          <div key={r.key} className="flex items-center justify-between text-xs">
                            <span className="text-foreground capitalize truncate">{r.label}</span>
                            <span className="font-semibold tabular-nums ml-2">{r.headcount}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Per-site table */}
              {siteData.by_site.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No site assignments recorded.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b border-border">
                        <th className="px-4 py-2 font-medium">Site</th>
                        <th className="px-4 py-2 font-medium">City</th>
                        <th className="px-4 py-2 font-medium">Region</th>
                        <th className="px-4 py-2 font-medium">Type</th>
                        <th className="px-4 py-2 font-medium text-right">Headcount</th>
                        <th className="px-4 py-2 font-medium text-right">Joiners (30d)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {siteData.by_site.map(row => (
                        <tr key={row.key} className="border-b border-border/50">
                          <td className="px-4 py-2 font-medium text-foreground">{row.label}</td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {row.city ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{row.city}</span> : '—'}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{row.region ?? '—'}</td>
                          <td className="px-4 py-2 text-muted-foreground capitalize">{row.site_type ?? '—'}</td>
                          <td className="px-4 py-2 text-right font-semibold">{row.headcount}</td>
                          <td className="px-4 py-2 text-right text-success">+{row.joiners_30d}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Headcount trend */}
          <div className="rounded-lg border border-border bg-card">
            <div className="px-4 py-3 border-b border-border">
              <p className="text-sm font-semibold text-foreground">Headcount Trend (6 months)</p>
              <p className="text-[11px] text-muted-foreground">Source: employees joining_date / termination_date · employee_separation</p>
            </div>
            {months.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No trend data available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border">
                      <th className="px-4 py-2 font-medium">Month</th>
                      <th className="px-4 py-2 font-medium text-right">Headcount</th>
                      <th className="px-4 py-2 font-medium text-right">Joiners</th>
                      <th className="px-4 py-2 font-medium text-right">Exits</th>
                      <th className="px-4 py-2 font-medium text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map(row => (
                      <tr key={row.period} className="border-b border-border/50">
                        <td className="px-4 py-2 font-medium text-foreground">{row.period}</td>
                        <td className="px-4 py-2 text-right font-semibold">{row.headcount}</td>
                        <td className="px-4 py-2 text-right text-success">+{row.joiners}</td>
                        <td className="px-4 py-2 text-right text-destructive">{row.exits > 0 ? '-' + row.exits : '0'}</td>
                        <td className="px-4 py-2 text-right"><NetChange joiners={row.joiners} exits={row.exits} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </PageContainer>
  )
}

export default OrgHealth
