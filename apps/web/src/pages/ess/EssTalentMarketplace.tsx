/**
 * EssTalentMarketplace — /ess/talent-marketplace
 *
 * Employees browse open internal roles and express interest.
 * Shows all currently open roles with department/location/skills info.
 * Employees can register interest with a cover note + availability.
 * "My Applications" tab tracks the status of submitted interests.
 */

import { useState } from'react'
import { useQuery, useMutation, useQueryClient } from'@tanstack/react-query'
import { toast } from'sonner'
import {
 Briefcase, MapPin, Building2, Clock, CheckCircle2,
 Loader2, X, Sparkles, ArrowRight,
 Tag, Star,
} from'lucide-react'

import { PageContainer } from'@/components/layout/PageContainer'
import { PageHeader } from'@/components/layout/PageHeader'
import { SectionCard } from'@/components/layout/SectionCard'
import { Badge } from'@/components/ui/badge'
import { Button } from'@/components/ui/button'
import { Textarea } from'@/components/ui/textarea'
import { Label } from'@/components/ui/label'
import {
 Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from'@/components/ui/select'
import {
 Dialog, DialogContent, DialogHeader, DialogTitle,
} from'@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from'@/components/ui/tabs'
import { api } from'@/lib/api/client'
import { cn } from'@/lib/utils'
import { invalidateTalentMarketplace } from '@/lib/talent-marketplace-cache'

// ── Types ─────────────────────────────────────────────────────────────────────

type Availability ='immediate'|'1_month'|'3_months'|'open'
type InterestStatus ='interested'|'shortlisted'|'selected'|'not_selected'|'withdrawn'

interface OpenRole {
 id: string
 title: string
 department: string | null
 location: string | null
 description: string | null
 skills_required: string[]
 experience_min: number | null
 posted_at: string
 closes_at: string | null
 my_status: InterestStatus | null
}

interface MyInterest {
 id: string
 status: InterestStatus
 availability: Availability | null
 cover_note: string | null
 created_at: string
 talent_roles: {
 id: string
 title: string
 department: string | null
 location: string | null
 is_open: boolean
 } | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AVAILABILITY_LABELS: Record<Availability, string> = {
 immediate:'Immediate',
'1_month':'Within 1 Month',
'3_months':'Within 3 Months',
 open:'Open / Flexible',
}

const STATUS_CONFIG: Record<InterestStatus, { label: string; color: string }> = {
 interested: { label:'Applied', color:'bg-info/20 text-info'},
 shortlisted: { label:'Shortlisted', color:'bg-warning/10 text-warning'},
 selected: { label:'Selected', color:'bg-success/20 text-success'},
 not_selected: { label:'Not Selected', color:'bg-muted text-muted-foreground'},
 withdrawn: { label:'Withdrawn', color:'bg-muted text-muted-foreground'},
}

// ── RoleCard ──────────────────────────────────────────────────────────────────

function RoleCard({ role, onApply }: { role: OpenRole; onApply: (role: OpenRole) => void }) {
 const status = role.my_status
 const applied = status && status !=='withdrawn'

 return (
 <div className="bg-card border border-border rounded-xl p-5 hover:border-info/40 hover:shadow-sm transition-all">
 <div className="flex items-start justify-between gap-3">
 <div className="flex-1 min-w-0">
 <h3 className="text-base font-semibold text-foreground truncate">{role.title}</h3>
 <div className="flex flex-wrap gap-3 mt-1.5">
 {role.department && (
 <span className="flex items-center gap-1 text-xs text-muted-foreground">
 <Building2 className="h-3 w-3" /> {role.department}
 </span>
 )}
 {role.location && (
 <span className="flex items-center gap-1 text-xs text-muted-foreground">
 <MapPin className="h-3 w-3" /> {role.location}
 </span>
 )}
 {role.experience_min != null && (
 <span className="flex items-center gap-1 text-xs text-muted-foreground">
 <Clock className="h-3 w-3" /> {role.experience_min}+ yrs
 </span>
 )}
 </div>
 </div>

 {applied ? (
 <Badge className={cn('text-xs shrink-0', STATUS_CONFIG[status!].color)}>
 {STATUS_CONFIG[status!].label}
 </Badge>
 ) : (
 <Button size="sm" onClick={() => onApply(role)} className="shrink-0">
 Apply <ArrowRight className="ml-1 h-3.5 w-3.5" />
 </Button>
 )}
 </div>

 {role.description && (
 <p className="mt-3 text-sm text-muted-foreground line-clamp-2">{role.description}</p>
 )}

 {(role.skills_required ?? []).length > 0 && (
 <div className="flex flex-wrap gap-1.5 mt-3">
 {role.skills_required.slice(0, 5).map(skill => (
 <span key={skill} className="inline-flex items-center gap-1 bg-info/20 text-info text-xs px-2 py-0.5 rounded-full">
 <Tag className="h-2.5 w-2.5" /> {skill}
 </span>
 ))}
 {role.skills_required.length > 5 && (
 <span className="text-xs text-muted-foreground">+{role.skills_required.length - 5} more</span>
 )}
 </div>
 )}

 {role.closes_at && (
 <p className="mt-2 text-xs text-muted-foreground">
 Closes {new Date(role.closes_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric'})}
 </p>
 )}
 </div>
 )
}

// ── ApplyDialog ───────────────────────────────────────────────────────────────

function ApplyDialog({
 role, open, onClose, onSubmit, loading,
}: {
 role: OpenRole | null
 open: boolean
 onClose: () => void
 onSubmit: (data: { role_id: string; cover_note: string; availability: Availability }) => void
 loading: boolean
}) {
 const [coverNote, setCoverNote] = useState('')
 const [availability, setAvailability] = useState<Availability>('open')

 if (!role) return null

 function handleSubmit() {
 onSubmit({ role_id: role!.id, cover_note: coverNote, availability })
 }

 return (
 <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
 <DialogContent className="max-w-lg">
 <DialogHeader>
 <DialogTitle>Express Interest — {role.title}</DialogTitle>
 </DialogHeader>

 <div className="space-y-4 pt-2">
 <div className="bg-muted rounded-lg p-3 text-sm space-y-1">
 {role.department && <p className="text-muted-foreground"><span className="font-medium">Department:</span> {role.department}</p>}
 {role.location && <p className="text-muted-foreground"><span className="font-medium">Location:</span> {role.location}</p>}
 {role.experience_min != null && <p className="text-muted-foreground"><span className="font-medium">Experience:</span> {role.experience_min}+ years</p>}
 </div>

 <div className="space-y-1">
 <Label>Availability</Label>
 <Select value={availability} onValueChange={v => setAvailability(v as Availability)}>
 <SelectTrigger>
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 {(Object.entries(AVAILABILITY_LABELS) as [Availability, string][]).map(([k, v]) => (
 <SelectItem key={k} value={k}>{v}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>

 <div className="space-y-1">
 <Label>Cover Note <span className="text-muted-foreground font-normal">(optional)</span></Label>
 <Textarea
 value={coverNote}
 onChange={e => setCoverNote(e.target.value)}
 placeholder="Why are you interested in this role? Highlight relevant experience or skills..."
 rows={4}
 maxLength={2000}
 />
 <p className="text-xs text-muted-foreground text-right">{coverNote.length}/2000</p>
 </div>

 <div className="flex gap-2 justify-end pt-2">
 <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
 <Button onClick={handleSubmit} disabled={loading}>
 {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
 Submit Interest
 </Button>
 </div>
 </div>
 </DialogContent>
 </Dialog>
 )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function EssTalentMarketplace() {
 const qc = useQueryClient()
 const [tab, setTab] = useState<'browse'|'my'>('browse')
 const [applyingRole, setApplyingRole] = useState<OpenRole | null>(null)

 const { data: rolesData, isLoading: rolesLoading } = useQuery<OpenRole[]>({
 queryKey: ['talent-browse'],
 queryFn: () => api.get<{ data: OpenRole[] }>('/talent/browse').then(r => r.data),
 })
 const roles = rolesData ?? []

 const { data: myData, isLoading: myLoading } = useQuery<MyInterest[]>({
 queryKey: ['talent-my-interests'],
 queryFn: () => api.get<{ data: MyInterest[] }>('/talent/my-interests').then(r => r.data),
 })
 const myInterests = myData ?? []

 const applyMutation = useMutation({
 mutationFn: (body: { role_id: string; cover_note: string; availability: Availability }) =>
 api.post('/talent/interest', body),
 onSuccess: () => {
 toast.success('Interest registered successfully')
 setApplyingRole(null)
 // Also reaches admin's talent-roles interest_count — HR shouldn't need a
 // manual refresh to see a new applicant.
 invalidateTalentMarketplace(qc)
 },
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 onError: (e: any) => toast.error(e?.response?.data?.error ??'Failed to register interest'),
 })

 const withdrawMutation = useMutation({
 mutationFn: (iid: string) => api.delete(`/talent/interest/${iid}`),
 onSuccess: () => {
 toast.success('Interest withdrawn')
 invalidateTalentMarketplace(qc)
 },
 onError: () => toast.error('Failed to withdraw interest'),
 })

 return (
 <PageContainer>
 <PageHeader
 title="Internal Talent Marketplace"
 subtitle="Explore open roles within your organisation and express your interest"
 />

 <Tabs value={tab} onValueChange={v => setTab(v as'browse'|'my')} className="mt-6">
 <TabsList>
 <TabsTrigger value="browse">
 <Sparkles className="h-4 w-4 mr-1.5" /> Open Roles ({roles.length})
 </TabsTrigger>
 <TabsTrigger value="my">
 <Star className="h-4 w-4 mr-1.5" /> My Applications ({myInterests.filter(i => i.status !=='withdrawn').length})
 </TabsTrigger>
 </TabsList>

 {/* Browse Tab */}
 <TabsContent value="browse" className="mt-4">
 {rolesLoading ? (
 <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
 ) : roles.length === 0 ? (
 <SectionCard>
 <div className="text-center py-10 text-muted-foreground">
 <Briefcase className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
 <p className="font-medium">No open roles right now</p>
 <p className="text-sm mt-1">Check back soon — HR will post new internal opportunities here.</p>
 </div>
 </SectionCard>
 ) : (
 <div className="grid gap-3 sm:grid-cols-2">
 {roles.map(role => (
 <RoleCard key={role.id} role={role} onApply={setApplyingRole} />
 ))}
 </div>
 )}
 </TabsContent>

 {/* My Applications Tab */}
 <TabsContent value="my" className="mt-4">
 {myLoading ? (
 <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
 ) : myInterests.length === 0 ? (
 <SectionCard>
 <div className="text-center py-10 text-muted-foreground">
 <Star className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
 <p className="font-medium">No applications yet</p>
 <p className="text-sm mt-1">Browse open roles and express your interest to appear here.</p>
 </div>
 </SectionCard>
 ) : (
 <div className="space-y-3">
 {myInterests.map(interest => {
 const st = interest.status
 const role = interest.talent_roles
 return (
 <div key={interest.id} className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
 <div className="flex-1 min-w-0">
 <p className="font-medium text-foreground truncate">{role?.title ??'Unknown Role'}</p>
 <div className="flex flex-wrap gap-2 mt-1">
 {role?.department && <span className="text-xs text-muted-foreground">{role.department}</span>}
 {role?.location && <span className="text-xs text-muted-foreground">· {role.location}</span>}
 <span className="text-xs text-muted-foreground">
 Applied {new Date(interest.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short'})}
 </span>
 {interest.availability && (
 <span className="text-xs text-muted-foreground">· {AVAILABILITY_LABELS[interest.availability]}</span>
 )}
 </div>
 </div>

 <div className="flex items-center gap-3 shrink-0">
 <Badge className={cn('text-xs', STATUS_CONFIG[st].color)}>
 {STATUS_CONFIG[st].label}
 </Badge>
 {st ==='interested'&& (
 <Button
 size="sm"
 variant="ghost"
 className="text-destructive hover:text-destructive h-7 px-2"
 onClick={() => withdrawMutation.mutate(interest.id)}
 disabled={withdrawMutation.isPending}
 >
 <X className="h-3.5 w-3.5" /> Withdraw
 </Button>
 )}
 </div>
 </div>
 )
 })}
 </div>
 )}
 </TabsContent>
 </Tabs>

 <ApplyDialog
 role={applyingRole}
 open={!!applyingRole}
 onClose={() => setApplyingRole(null)}
 onSubmit={applyMutation.mutate}
 loading={applyMutation.isPending}
 />
 </PageContainer>
 )
}
