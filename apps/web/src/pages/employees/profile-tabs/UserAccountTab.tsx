/**
 * EmployeeProfile › User Account tab.
 * Split out of the former monolithic EmployeeProfile.tsx.
 */
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  KeyRound, ShieldCheck, ShieldOff, ShieldAlert, Mail, Send, Copy, CheckCircle2, Loader2,
} from 'lucide-react'
import { KV, fmtDate, type BadgeVariant, type Section } from './shared'

interface UserAccountData {
  status:    'no_account' | 'pending_verification' | 'active' | 'suspended'
  profile:   { id: string; role: string; is_active: boolean; full_name: string; created_at: string } | null
  auth_user: { email: string; email_confirmed_at: string | null; last_sign_in_at: string | null; created_at: string } | null
  email:     string | null
}

interface UserAccountTabProps {
  id: string | undefined
  isAdmin: boolean
  subTab: string
  visited: Set<Section>
  employeeEmail: string | undefined
}

export function UserAccountTab({ id, isAdmin, subTab, visited, employeeEmail }: UserAccountTabProps) {
  const { data: userAccountData, refetch: refetchUserAccount } = useQuery<UserAccountData>({
    queryKey: ['user-account', id],
    queryFn:  () => api.get(`/employees/${id}/user-account`),
    enabled:  !!id && visited.has('core') && isAdmin,
    staleTime: 30_000,
  })

  const [accountDlgOpen, setAccountDlgOpen] = useState(false)
  const [accountForm,    setAccountForm]    = useState({
    email:              '',
    role:               'employee' as 'employee' | 'manager',
    temporary_password: '',
    send_invite:        false,   // primary = direct creation
    is_active:          true,
  })
  // Holds auto-generated credentials after a successful direct-creation so admin can copy them
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null)

  const createAccountMutation = useMutation({
    mutationFn: () => api.post(`/employees/${id}/user-account`, {
      email:              accountForm.email,
      role:               accountForm.role,
      temporary_password: accountForm.send_invite ? undefined : (accountForm.temporary_password || undefined),
      send_invite:        accountForm.send_invite,
      is_active:          accountForm.is_active,
    }),
    onSuccess: (res: unknown) => {
      const genPwd = (res as { data?: { generated_password?: string } })?.data?.generated_password
      if (genPwd) {
        // Stay open — show credentials panel so admin can copy the password
        setCreatedCredentials({ email: accountForm.email, password: genPwd })
      } else {
        toast.success(accountForm.send_invite ? 'Invite sent successfully' : 'Account created')
        setAccountDlgOpen(false)
        setAccountForm({ email: '', role: 'employee', temporary_password: '', send_invite: false, is_active: true })
      }
      refetchUserAccount()
    },
    onError: (e: Error) => toast.error('Failed to create account', { description: e.message }),
  })

  const patchAccountMutation = useMutation({
    mutationFn: (action: 'suspend' | 'reactivate') => api.patch(`/employees/${id}/user-account`, { action }),
    onSuccess: (_, action) => {
      toast.success(action === 'suspend' ? 'Account suspended' : 'Account reactivated')
      refetchUserAccount()
    },
    onError: (e: Error) => toast.error('Failed to update account', { description: e.message }),
  })
  const [resetPwdOpen, setResetPwdOpen]   = useState(false)
  const [resetPwdValue, setResetPwdValue] = useState('')
  const resetPwdMutation = useMutation({
    mutationFn: (new_password: string) => api.post(`/employees/${id}/user-account/reset-password`, { new_password }),
    onSuccess: () => { setResetPwdOpen(false); toast.success('Password reset') },
    onError: (e: Error) => toast.error('Failed to reset password', { description: e.message }),
  })

  return (
    <>
      {subTab === 'account' && isAdmin && (() => {
        const acct    = userAccountData
        const status  = acct?.status ?? null

        const STATUS_CONFIG = {
          no_account:           { label: 'No Account',           icon: ShieldAlert, cls: 'text-muted-foreground', bg: 'bg-muted/60',      badge: 'secondary'   },
          pending_verification: { label: 'Pending Verification', icon: Mail,        cls: 'text-warning',          bg: 'bg-warning/8',     badge: 'warning'     },
          active:               { label: 'Active',               icon: ShieldCheck, cls: 'text-success',          bg: 'bg-success/8',     badge: 'success'     },
          suspended:            { label: 'Suspended',            icon: ShieldOff,   cls: 'text-destructive',      bg: 'bg-destructive/8', badge: 'destructive' },
        } as const

        const cfg = status ? STATUS_CONFIG[status] : STATUS_CONFIG.no_account
        const StatusIcon = cfg.icon

        return (
          <div className="space-y-4">
            {/* Status card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  Portal Access
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Status indicator */}
                <div className={cn('flex items-center gap-3 rounded-lg p-3 mb-4', cfg.bg)}>
                  <div className="h-8 w-8 rounded-full bg-background/60 flex items-center justify-center flex-shrink-0">
                    <StatusIcon className={cn('h-4 w-4', cfg.cls)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm font-semibold', cfg.cls)}>{cfg.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {status === 'no_account'
                        ? 'This employee has no portal login. Create an account to grant ESS access.'
                        : status === 'pending_verification'
                        ? `Invite sent to ${acct?.auth_user?.email ?? '—'}. Employee must click the link to activate.`
                        : status === 'active'
                        ? `Active since ${fmtDate(acct?.auth_user?.email_confirmed_at)}. Last login: ${acct?.auth_user?.last_sign_in_at ? fmtDate(acct.auth_user.last_sign_in_at) : 'Never'}.`
                        : `Account suspended. Employee cannot log in.`}
                    </p>
                  </div>
                  {/* CTA buttons */}
                  <div className="flex-shrink-0 flex gap-2">
                    {status === 'no_account' && (
                      <Button size="sm" className="h-7 text-xs gap-1.5"
                        onClick={() => {
                          setAccountForm(f => ({ ...f, email: employeeEmail ?? '' }))
                          setAccountDlgOpen(true)
                        }}
                      >
                        <Send className="h-3 w-3" />
                        Create Account
                      </Button>
                    )}
                    {(status === 'pending_verification' || status === 'active') && (
                      <Button size="sm" variant="outline"
                        className="h-7 text-xs text-destructive border-destructive/40 hover:bg-destructive/10"
                        onClick={() => patchAccountMutation.mutate('suspend')}
                        disabled={patchAccountMutation.isPending}
                      >
                        Suspend
                      </Button>
                    )}
                    {status === 'suspended' && (
                      <Button size="sm" variant="outline"
                        className="h-7 text-xs text-success border-success/40 hover:bg-success/10"
                        onClick={() => patchAccountMutation.mutate('reactivate')}
                        disabled={patchAccountMutation.isPending}
                      >
                        Reactivate
                      </Button>
                    )}
                    {(status === 'pending_verification' || status === 'active' || status === 'suspended') && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                        onClick={() => { setResetPwdValue(''); setResetPwdOpen(true) }}
                      >
                        <KeyRound className="h-3 w-3" />
                        Reset Password
                      </Button>
                    )}
                  </div>
                </div>

                {/* Account details grid */}
                {acct?.profile && acct.auth_user && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <KV label="Login Email"   value={acct.auth_user.email} />
                    <KV label="Portal Role"   value={acct.profile.role.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())} />
                    <KV label="Account Created" value={fmtDate(acct.profile.created_at)} />
                    <KV label="Email Confirmed" value={acct.auth_user.email_confirmed_at ? fmtDate(acct.auth_user.email_confirmed_at) : 'Not yet'} />
                    <KV label="Last Sign In"  value={acct.auth_user.last_sign_in_at ? fmtDate(acct.auth_user.last_sign_in_at) : 'Never'} />
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Account Status</p>
                      <Badge variant={cfg.badge as BadgeVariant} className="rounded-full text-[10px]">
                        {cfg.label}
                      </Badge>
                    </div>
                  </div>
                )}

                {status === 'no_account' && (
                  <div className="mt-2 text-center py-4 text-muted-foreground">
                    <KeyRound className="h-6 w-6 mx-auto mb-2 opacity-30" />
                    <p className="text-xs">No portal access has been configured for this employee.</p>
                    <p className="text-xs mt-0.5">Click "Create Account" to set up login credentials and ESS access.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Access scope info */}
            {status && status !== 'no_account' && acct?.profile && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">Access Scope</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {acct.profile.role === 'employee' && (
                      <div className="flex items-start gap-2.5">
                        <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium">Employee Self-Service (ESS)</p>
                          <p className="text-xs text-muted-foreground">View payslips, apply leave, raise regularisations, manage personal info</p>
                        </div>
                      </div>
                    )}
                    {acct.profile.role === 'manager' && (
                      <>
                        <div className="flex items-start gap-2.5">
                          <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-medium">Employee Self-Service (ESS)</p>
                            <p className="text-xs text-muted-foreground">All standard ESS capabilities for own profile</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2.5">
                          <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-medium">Team Management</p>
                            <p className="text-xs text-muted-foreground">Approve/reject team leave & regularisation requests, view team attendance</p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )
      })()}

      <Dialog open={resetPwdOpen} onOpenChange={setResetPwdOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Reset Portal Password</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">New Password</Label>
            <Input type="text" className="h-8 text-xs font-mono" placeholder="Min 8 characters"
              value={resetPwdValue} onChange={e => setResetPwdValue(e.target.value)} />
            <p className="text-[10px] text-muted-foreground">The employee can change it after signing in. Share it securely.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setResetPwdOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={resetPwdMutation.isPending || resetPwdValue.trim().length < 8}
              onClick={() => resetPwdMutation.mutate(resetPwdValue.trim())}>
              {resetPwdMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Set Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={accountDlgOpen} onOpenChange={open => {
        if (!open) {
          setAccountDlgOpen(false)
          setCreatedCredentials(null)
          setAccountForm({ email: '', role: 'employee', temporary_password: '', send_invite: false, is_active: true })
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              {createdCredentials ? 'Account Created — Save Credentials' : 'Create Portal Account'}
            </DialogTitle>
          </DialogHeader>

          {createdCredentials ? (
            /* ── Credentials panel: shown only when password was auto-generated ── */
            <div className="space-y-4 py-1">
              <p className="text-xs text-muted-foreground">
                Share these credentials with the employee. The password will <strong>not</strong> be shown again.
              </p>
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                <div className="space-y-1">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Login Email</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono bg-background border border-border rounded px-2 py-1.5 select-all">
                      {createdCredentials.email}
                    </code>
                    <Button
                      variant="outline" size="sm" className="h-7 w-7 p-0 shrink-0"
                      onClick={() => { navigator.clipboard.writeText(createdCredentials.email); toast.success('Email copied') }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Temporary Password</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono bg-background border border-border rounded px-2 py-1.5 select-all">
                      {createdCredentials.password}
                    </code>
                    <Button
                      variant="outline" size="sm" className="h-7 w-7 p-0 shrink-0"
                      onClick={() => { navigator.clipboard.writeText(createdCredentials.password); toast.success('Password copied') }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                The employee should change this password on first login.
              </p>
            </div>
          ) : (
            /* ── Account creation form ─────────────────────────────────────────── */
            <div className="space-y-3 py-1">
              {/* Login email */}
              <div className="space-y-1.5">
                <Label htmlFor="acc-email" className="text-xs">Login Email <span className="text-destructive">*</span></Label>
                <Input
                  id="acc-email"
                  type="email"
                  className="h-8 text-xs"
                  placeholder="employee@company.com"
                  value={accountForm.email}
                  onChange={e => setAccountForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>

              {/* Role */}
              <div className="space-y-1.5">
                <Label htmlFor="acc-role" className="text-xs">Portal Role</Label>
                <Select
                  value={accountForm.role}
                  onValueChange={v => setAccountForm(f => ({ ...f, role: v as 'employee' | 'manager' }))}
                >
                  <SelectTrigger id="acc-role" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee" className="text-xs">Employee — ESS self-service portal</SelectItem>
                    <SelectItem value="manager"  className="text-xs">Manager — ESS + team approval access</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Flow toggle: Direct vs Invite */}
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="grid grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setAccountForm(f => ({ ...f, send_invite: false }))}
                    className={cn(
                      'py-2 px-3 text-xs font-medium transition-colors text-left',
                      !accountForm.send_invite
                        ? 'bg-primary/8 text-primary border-b-2 border-primary'
                        : 'text-muted-foreground hover:bg-muted/40',
                    )}
                  >
                    <p className="font-semibold">Direct Creation</p>
                    <p className="text-[10px] opacity-70 mt-0.5">Set password now, activate immediately</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountForm(f => ({ ...f, send_invite: true }))}
                    className={cn(
                      'py-2 px-3 text-xs font-medium transition-colors text-left border-l border-border',
                      accountForm.send_invite
                        ? 'bg-primary/8 text-primary border-b-2 border-primary'
                        : 'text-muted-foreground hover:bg-muted/40',
                    )}
                  >
                    <p className="font-semibold">Send Invite</p>
                    <p className="text-[10px] opacity-70 mt-0.5">Employee sets own password via email</p>
                  </button>
                </div>

                {/* Direct creation: password field */}
                {!accountForm.send_invite && (
                  <div className="p-3 border-t border-border space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="acc-pwd" className="text-xs">
                        Temporary Password
                        <span className="text-muted-foreground ml-1">(auto-generated if blank)</span>
                      </Label>
                      <Input
                        id="acc-pwd"
                        type="text"
                        className="h-8 text-xs font-mono"
                        placeholder="Min 8 chars — leave blank to auto-generate"
                        value={accountForm.temporary_password}
                        onChange={e => setAccountForm(f => ({ ...f, temporary_password: e.target.value }))}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium">Activate Immediately</p>
                        <p className="text-[10px] text-muted-foreground">Employee can log in right away</p>
                      </div>
                      <Switch
                        checked={accountForm.is_active}
                        onCheckedChange={v => setAccountForm(f => ({ ...f, is_active: v }))}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            {createdCredentials ? (
              <Button size="sm" onClick={() => {
                setAccountDlgOpen(false)
                setCreatedCredentials(null)
                setAccountForm({ email: '', role: 'employee', temporary_password: '', send_invite: false, is_active: true })
              }}>
                Done
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => setAccountDlgOpen(false)}>Cancel</Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={!accountForm.email || createAccountMutation.isPending}
                  onClick={() => createAccountMutation.mutate()}
                >
                  {createAccountMutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Send className="h-3.5 w-3.5" />}
                  {accountForm.send_invite ? 'Send Invite' : 'Create Account'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
