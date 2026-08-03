/**
 * EmployeeProfile › Overview (profile) tab.
 * Split out of the former monolithic EmployeeProfile.tsx.
 *
 * `editProfile`/`profileForm`/`profileMutation` are owned by the shell (the
 * hero's "Edit Profile" button writes them) and passed down here — see the
 * shell's docblock for why they can't move wholly into this tab.
 */
import type { UseMutationResult } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Check, X, GraduationCap } from 'lucide-react'
import { Employee360Tab } from '@/pages/intelligence/Employee360Tab'
import { MetricCard, MetricRow } from '@/components/dashboard/MetricCard'
import { Grid2, fmtDate, type OnboardingDocItem, type Section } from './shared'

interface OnboardingStatus {
  session: { id: string; status: string; created_at: string; updated_at: string } | null
  draft:   { id: string; status: string; confidence_score: number | null; created_at: string; updated_at: string }
  documents: { total: number; extracted: number; failed: number; items: OnboardingDocItem[] }
}

interface OverviewTabProps {
  id: string | undefined
  subTab: string
  visited: Set<Section>
  editProfile: boolean
  setEditProfile: (v: boolean) => void
  profileForm: Record<string, string>
  setProfileForm: (fn: (p: Record<string, string>) => Record<string, string>) => void
  profileMutation: UseMutationResult<unknown, Error, Record<string, string>, unknown>
}

export function OverviewTab({
  id, subTab, visited, editProfile, setEditProfile, profileForm, setProfileForm, profileMutation,
}: OverviewTabProps) {
  const { data: onboardingData } = useQuery<{ data: OnboardingStatus | null }>({
    queryKey: ['onboarding-status', id],
    queryFn:  () => api.get(`/employees/${id}/onboarding-status`),
    enabled:  !!id && visited.has('core'),
    staleTime: 120_000,
  })
  const onboardingStatus = onboardingData?.data ?? null

  return (
    <>
      {subTab === 'profile' && editProfile && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Edit Profile</CardTitle>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => profileMutation.mutate(profileForm)} disabled={profileMutation.isPending}><Check className="h-3.5 w-3.5 text-success" /></Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditProfile(false)}><X className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Grid2>
              {([{ label: 'First Name', key: 'first_name' }, { label: 'Last Name', key: 'last_name' }, { label: 'Email', key: 'email' }, { label: 'Phone', key: 'phone' }, { label: 'Joining Date', key: 'joining_date', type: 'date' }] as Array<{label:string;key:string;type?:string}>).map(f => (
                <div key={f.key}>
                  <p className="text-xs text-muted-foreground mb-1">{f.label}</p>
                  <Input className="h-7 text-xs" type={f.type ?? 'text'} value={profileForm[f.key] ?? ''} onChange={e => setProfileForm((p) => ({ ...p, [f.key]: e.target.value }))} />
                </div>
              ))}
              <div>
                <p className="text-xs text-muted-foreground mb-1">Status</p>
                <select className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none" value={profileForm.status ?? ''} onChange={e => setProfileForm((p) => ({ ...p, status: e.target.value }))}>
                  {['active','inactive','on_notice','separated'].map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
                </select>
              </div>
            </Grid2>
          </CardContent>
        </Card>
      )}

      {/* Overview = live 360 cockpit — no static reprints of hero / aside / Personal */}
      {subTab === 'profile' && !editProfile && id && (
        <Employee360Tab employeeId={id} />
      )}

      {subTab === 'profile' && onboardingStatus && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-muted-foreground" />
              Document Extraction Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <MetricRow cols={3}>
                <MetricCard label="Uploaded"  value={onboardingStatus.documents.total}     variant="neutral" />
                <MetricCard label="Extracted" value={onboardingStatus.documents.extracted} variant="success" />
                <MetricCard label="Failed"    value={onboardingStatus.documents.failed}    variant="destructive" />
              </MetricRow>
            </div>
            {onboardingStatus.documents.items.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {['Document Type', 'Extraction', 'Uploaded'].map(h => (
                        <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {onboardingStatus.documents.items.map((doc) => (
                      <tr key={doc.id} className="border-b border-border/50">
                        <td className="px-3 py-2 capitalize font-medium">{(doc.document_type ?? '—').replace(/_/g, ' ')}</td>
                        <td className="px-3 py-2">
                          <Badge
                            variant={
                              doc.extraction_status === 'completed' ? 'success'     :
                              doc.extraction_status === 'failed'    ? 'destructive' :
                              doc.extraction_status === 'pending'   ? 'secondary'   : 'outline'
                            }
                            className="rounded-full text-[9px] capitalize"
                          >
                            {doc.extraction_status ?? 'pending'}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{fmtDate(doc.uploaded_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  )
}
