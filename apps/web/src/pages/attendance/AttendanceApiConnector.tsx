/**
 * AttendanceApiConnector — /admin/attendance/api-connector
 *
 * Manage external API sources that supply attendance punch data.
 * Allows HR admins to register, test, and schedule external API endpoints
 * whose responses contain employee punch records.
 */

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Link2, Wifi, Play, Settings2, Trash2,
  RefreshCw, ChevronRight, ChevronDown, Eye, EyeOff,
  CheckCircle2, XCircle, Clock, Zap, AlertTriangle,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHero }       from '@/components/layout/PageHero'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Button }         from '@/components/ui/button'
import { Badge }          from '@/components/ui/badge'
import { Input }          from '@/components/ui/input'
import { Label }          from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api }            from '@/lib/api/client'

// ── Types ──────────────────────────────────────────────────────────────────────

type AuthType = 'none' | 'api_key' | 'bearer' | 'basic' | 'hmac' | 'oauth2'
type HttpMethod = 'GET' | 'POST'

interface ApiSource {
  id:                   string
  name:                 string
  description:          string | null
  endpoint_url:         string
  http_method:          HttpMethod
  auth_type:            AuthType
  poll_interval_min:    number
  is_active:            boolean
  last_fetched_at:      string | null
  last_fetch_status:    'success' | 'error' | 'running' | 'never_run' | null
  last_fetch_count:     number | null
  last_fetch_error:     string | null
  last_test_at:         string | null
  last_test_status:     'success' | 'error' | null
  created_at:           string
}

interface TestResult {
  success:    boolean
  status:     number
  latency_ms: number
  sample:     unknown[]
  total:      number
  error:      string | null
}

interface SourceForm {
  name:                string
  description:         string
  endpoint_url:        string
  http_method:         HttpMethod
  auth_type:           AuthType
  auth_config:         Record<string, string>
  response_path:       string
  field_employee_code: string
  field_timestamp:     string
  field_direction:     string
  poll_interval_min:   number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const POLL_OPTIONS = [
  { label: 'Manual only', value: 0 },
  { label: 'Every 15 min', value: 15 },
  { label: 'Every 30 min', value: 30 },
  { label: 'Every hour',   value: 60 },
  { label: 'Every 2 hrs',  value: 120 },
  { label: 'Every 4 hrs',  value: 240 },
  { label: 'Every 6 hrs',  value: 360 },
  { label: 'Twice daily',  value: 720 },
  { label: 'Daily',        value: 1440 },
]

function formatPollInterval(min: number) {
  if (min === 0) return 'Manual only'
  const opt = POLL_OPTIONS.find(o => o.value === min)
  if (opt) return opt.label
  if (min < 60) return `Every ${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `Every ${h}h ${m}m` : `Every ${h}h`
}

function timeSince(ts: string | null) {
  if (!ts) return 'Never'
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1)   return 'Just now'
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const EMPTY_FORM: SourceForm = {
  name:                '',
  description:         '',
  endpoint_url:        '',
  http_method:         'GET',
  auth_type:           'none',
  auth_config:         {},
  response_path:       '',
  field_employee_code: 'employee_code',
  field_timestamp:     'timestamp',
  field_direction:     'direction',
  poll_interval_min:   60,
}

// ── Auth config fields per type ─────────────────────────────────────────────

type AuthFieldDef = { key: string; label: string; placeholder: string; secret?: boolean }

const AUTH_FIELDS: Partial<Record<AuthType, AuthFieldDef[]>> = {
  api_key: [
    { key: 'header', label: 'Header name',  placeholder: 'X-Api-Key' },
    { key: 'key',    label: 'Key value',    placeholder: 'sk-…', secret: true },
  ],
  bearer: [
    { key: 'token', label: 'Bearer token', placeholder: 'eyJ…', secret: true },
  ],
  basic: [
    { key: 'username', label: 'Username', placeholder: 'user' },
    { key: 'password', label: 'Password', placeholder: '••••', secret: true },
  ],
  hmac: [
    { key: 'secret',    label: 'HMAC secret',    placeholder: '…', secret: true },
    { key: 'algorithm', label: 'Algorithm',       placeholder: 'sha256' },
    { key: 'header',    label: 'Signature header',placeholder: 'X-Signature' },
  ],
  oauth2: [
    { key: 'token_url',     label: 'Token URL',     placeholder: 'https://…/oauth/token' },
    { key: 'client_id',     label: 'Client ID',     placeholder: '…' },
    { key: 'client_secret', label: 'Client secret', placeholder: '…', secret: true },
    { key: 'scope',         label: 'Scope',          placeholder: 'read' },
  ],
}

// ── Sub-component: Source card ────────────────────────────────────────────────

function SourceCard({
  source,
  onEdit,
  onTest,
  onFetch,
  onDelete,
  isTesting,
  isFetching,
}: {
  source:     ApiSource
  onEdit:     () => void
  onTest:     () => void
  onFetch:    () => void
  onDelete:   () => void
  isTesting:  boolean
  isFetching: boolean
}) {
  const statusColor = {
    success:  'text-success',
    error:    'text-destructive',
    running:  'text-blue-500',
    never_run:'text-muted-foreground',
  }[source.last_fetch_status ?? 'never_run']

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`flex-shrink-0 h-8 w-8 rounded-lg flex items-center justify-center ${source.is_active ? 'bg-teal-500/10' : 'bg-muted'}`}>
            <Link2 className={`h-4 w-4 ${source.is_active ? 'text-teal-500' : 'text-muted-foreground'}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-foreground truncate">{source.name}</p>
              {!source.is_active && (
                <Badge variant="secondary" className="text-[10px] px-1.5">Disabled</Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground truncate max-w-xs">{source.endpoint_url}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Badge variant="outline" className="text-[10px] px-1.5">{source.auth_type}</Badge>
          <Badge variant="outline" className="text-[10px] px-1.5">{source.http_method}</Badge>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatPollInterval(source.poll_interval_min)}
        </span>
        <span className="flex items-center gap-1">
          {source.last_fetch_status === 'success' && <CheckCircle2 className="h-3 w-3 text-success" />}
          {source.last_fetch_status === 'error'   && <XCircle      className="h-3 w-3 text-destructive" />}
          {source.last_fetch_status === 'running' && <RefreshCw    className="h-3 w-3 text-primary animate-spin" />}
          {(!source.last_fetch_status || source.last_fetch_status === 'never_run') && <Zap className="h-3 w-3" />}
          <span className={statusColor}>
            {source.last_fetch_status === 'success' && `${source.last_fetch_count ?? 0} records · ${timeSince(source.last_fetched_at)}`}
            {source.last_fetch_status === 'error'   && `Error · ${timeSince(source.last_fetched_at)}`}
            {source.last_fetch_status === 'running' && 'Fetching…'}
            {(!source.last_fetch_status || source.last_fetch_status === 'never_run') && 'Not yet fetched'}
          </span>
        </span>
        {source.last_fetch_error && (
          <span className="flex items-center gap-1 text-destructive/70 truncate max-w-[180px]">
            <AlertTriangle className="h-3 w-3 flex-shrink-0" />
            {source.last_fetch_error}
          </span>
        )}
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2 pt-0.5">
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onTest} disabled={isTesting || !source.is_active}>
          {isTesting ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />}
          Test
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onFetch} disabled={isFetching || !source.is_active}>
          {isFetching ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Fetch now
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 ml-auto" onClick={onEdit}>
          <Settings2 className="h-3 w-3" />
          Edit
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive/70 hover:text-destructive gap-1" onClick={onDelete}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

// ── Sub-component: Source form ────────────────────────────────────────────────

function SourceFormPanel({
  form,
  onChange,
  onTest,
  testResult,
  testLoading,
}: {
  form:        SourceForm
  onChange:    (f: SourceForm) => void
  onTest:      () => void
  testResult:  TestResult | null
  testLoading: boolean
}) {
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({})
  const authFields = AUTH_FIELDS[form.auth_type] ?? []

  const set = (k: keyof SourceForm) => (v: string | number) =>
    onChange({ ...form, [k]: v })

  const setAuth = (k: string) => (v: string) =>
    onChange({ ...form, auth_config: { ...form.auth_config, [k]: v } })

  return (
    <div className="space-y-5">
      {/* Name + URL */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Source name *</Label>
          <Input value={form.name} onChange={e => set('name')(e.target.value)}
            placeholder="e.g. ZKTeco Biometric" className="h-8 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Description</Label>
          <Input value={form.description} onChange={e => set('description')(e.target.value)}
            placeholder="Optional note" className="h-8 text-sm" />
        </div>
      </div>

      {/* Endpoint */}
      <div className="space-y-1.5">
        <Label className="text-xs">API endpoint URL *</Label>
        <div className="flex gap-2">
          <Select value={form.http_method} onValueChange={v => set('http_method')(v)}>
            <SelectTrigger className="h-8 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="POST">POST</SelectItem>
            </SelectContent>
          </Select>
          <Input value={form.endpoint_url} onChange={e => set('endpoint_url')(e.target.value)}
            placeholder="https://your-device-api.example.com/punches"
            className="h-8 text-sm flex-1" />
        </div>
      </div>

      {/* Auth */}
      <div className="space-y-2">
        <Label className="text-xs">Authentication</Label>
        <Select value={form.auth_type} onValueChange={v => onChange({ ...form, auth_type: v as AuthType, auth_config: {} })}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No auth</SelectItem>
            <SelectItem value="api_key">API Key header</SelectItem>
            <SelectItem value="bearer">Bearer token</SelectItem>
            <SelectItem value="basic">HTTP Basic</SelectItem>
            <SelectItem value="hmac">HMAC signature</SelectItem>
            <SelectItem value="oauth2">OAuth 2.0 (Client Credentials)</SelectItem>
          </SelectContent>
        </Select>

        {authFields.length > 0 && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            {authFields.map(f => (
              <div key={f.key} className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">{f.label}</Label>
                <div className="relative">
                  <Input
                    value={form.auth_config[f.key] ?? ''}
                    onChange={e => setAuth(f.key)(e.target.value)}
                    type={f.secret && !showSecret[f.key] ? 'password' : 'text'}
                    placeholder={f.placeholder}
                    className="h-8 text-sm pr-8"
                  />
                  {f.secret && (
                    <button type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowSecret(s => ({ ...s, [f.key]: !s[f.key] }))}>
                      {showSecret[f.key] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Response path + field mapping */}
      <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
        <p className="text-xs font-medium text-foreground">Response parsing</p>
        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">Array path in response (leave blank if response IS the array)</Label>
          <Input value={form.response_path} onChange={e => set('response_path')(e.target.value)}
            placeholder="data.records  or  $.punches" className="h-8 text-sm" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { key: 'field_employee_code' as const, label: 'Employee code field' },
            { key: 'field_timestamp'     as const, label: 'Timestamp field' },
            { key: 'field_direction'     as const, label: 'Direction field (in/out)' },
          ].map(f => (
            <div key={f.key} className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">{f.label}</Label>
              <Input value={form[f.key] as string} onChange={e => set(f.key)(e.target.value)}
                className="h-8 text-sm" />
            </div>
          ))}
        </div>
      </div>

      {/* Poll interval */}
      <div className="space-y-1.5">
        <Label className="text-xs">Auto-fetch schedule</Label>
        <Select
          value={String(form.poll_interval_min)}
          onValueChange={v => set('poll_interval_min')(Number(v))}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {POLL_OPTIONS.map(o => (
              <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Test connection */}
      <div className="rounded-lg border border-dashed border-border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium">Test connection</p>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
            onClick={onTest} disabled={!form.endpoint_url || testLoading}>
            {testLoading
              ? <><RefreshCw className="h-3 w-3 animate-spin" />Testing…</>
              : <><Wifi className="h-3 w-3" />Test now</>}
          </Button>
        </div>

        {testResult && (
          <div className="space-y-2">
            <div className={`flex items-center gap-1.5 text-xs font-medium ${testResult.success ? 'text-success' : 'text-destructive'}`}>
              {testResult.success
                ? <><CheckCircle2 className="h-3.5 w-3.5" />Connected · {testResult.latency_ms}ms · {testResult.total} record(s) found</>
                : <><XCircle     className="h-3.5 w-3.5" />{testResult.error ?? `HTTP ${testResult.status}`}</>}
            </div>

            {testResult.success && testResult.sample.length > 0 && (
              <div className="rounded border border-border bg-muted/30 p-2">
                <p className="text-[10px] text-muted-foreground mb-1">Sample records (first {testResult.sample.length})</p>
                <pre className="text-[10px] text-foreground overflow-auto max-h-32 whitespace-pre-wrap">
                  {JSON.stringify(testResult.sample, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AttendanceApiConnector() {
  const qc = useQueryClient()

  const [showForm,    setShowForm]    = useState(false)
  const [editId,      setEditId]      = useState<string | null>(null)
  const [form,        setForm]        = useState<SourceForm>(EMPTY_FORM)
  const [testResult,  setTestResult]  = useState<TestResult | null>(null)
  const [testLoading, setTestLoading] = useState(false)
  const [testingId,   setTestingId]   = useState<string | null>(null)
  const [fetchingId,  setFetchingId]  = useState<string | null>(null)
  const [fetchResult, setFetchResult] = useState<{ id: string; message: string; ok: boolean } | null>(null)

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: sourcesData, isLoading } = useQuery<{ data: ApiSource[]; total: number }>({
    queryKey:  ['attendance-api-sources'],
    queryFn:   () => api.get('/attendance/api-sources'),
    staleTime: 30_000,
  })

  const sources = sourcesData?.data ?? []

  // ── Mutations ──────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: (payload: SourceForm) =>
      editId
        ? api.put(`/attendance/api-sources/${editId}`, payload)
        : api.post('/attendance/api-sources', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance-api-sources'] })
      setShowForm(false)
      setEditId(null)
      setForm(EMPTY_FORM)
      setTestResult(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/attendance/api-sources/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance-api-sources'] }),
  })

  // ── Handlers ───────────────────────────────────────────────────────────────

  const openCreate = useCallback(() => {
    setEditId(null)
    setForm(EMPTY_FORM)
    setTestResult(null)
    setShowForm(true)
  }, [])

  const openEdit = useCallback((s: ApiSource) => {
    setEditId(s.id)
    setForm({
      name:                s.name,
      description:         s.description ?? '',
      endpoint_url:        s.endpoint_url,
      http_method:         s.http_method,
      auth_type:           s.auth_type,
      auth_config:         {},    // never pre-fill secrets
      response_path:       '',
      field_employee_code: 'employee_code',
      field_timestamp:     'timestamp',
      field_direction:     'direction',
      poll_interval_min:   s.poll_interval_min,
    })
    setTestResult(null)
    setShowForm(true)
  }, [])

  const handleAdHocTest = useCallback(async () => {
    setTestLoading(true)
    setTestResult(null)
    try {
      const res = await api.post('/attendance/api-sources/test', {
        endpoint_url:  form.endpoint_url,
        http_method:   form.http_method,
        auth_type:     form.auth_type,
        auth_config:   form.auth_config,
        response_path: form.response_path || undefined,
      })
      setTestResult(res as TestResult)
    } catch (e: unknown) {
      setTestResult({ success: false, status: 0, latency_ms: 0, sample: [], total: 0, error: e instanceof Error ? e.message : 'Request failed' })
    } finally {
      setTestLoading(false)
    }
  }, [form])

  const handleTestSource = useCallback(async (id: string) => {
    setTestingId(id)
    setFetchResult(null)
    try {
      await api.post(`/attendance/api-sources/${id}/test`)
      qc.invalidateQueries({ queryKey: ['attendance-api-sources'] })
    } finally {
      setTestingId(null)
    }
  }, [qc])

  const handleFetchSource = useCallback(async (id: string) => {
    setFetchingId(id)
    setFetchResult(null)
    try {
      const res = await api.post(`/attendance/api-sources/${id}/fetch`) as { ingested?: number }
      setFetchResult({ id, message: `${res.ingested} records ingested`, ok: true })
      qc.invalidateQueries({ queryKey: ['attendance-api-sources'] })
    } catch (e: unknown) {
      setFetchResult({ id, message: e instanceof Error ? e.message : 'Fetch failed', ok: false })
    } finally {
      setFetchingId(null)
    }
  }, [qc])

  const handleSave = useCallback(() => {
    if (!form.name.trim() || !form.endpoint_url.trim()) return
    saveMutation.mutate(form)
  }, [form, saveMutation])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <PageHero
        eyebrow="Time & Attendance"
        title="API Connector"
        subtitle="Connect external punch-data APIs. Configure authentication, preview sample data, and set an auto-fetch schedule."
        actions={
          <Button size="sm" className="h-8 gap-1.5 bg-white/15 border-white/20 text-white hover:bg-white/25"
            variant="outline" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            Add connector
          </Button>
        }
      />

      <div className="flex gap-5 items-start">

        {/* ── Source list ───────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-3">

          {/* Fetch result toast */}
          {fetchResult && (
            <div className={`rounded-lg border px-4 py-2.5 text-sm flex items-center gap-2 ${
              fetchResult.ok
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-destructive/30 bg-destructive/10 text-destructive'
            }`}>
              {fetchResult.ok
                ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                : <XCircle      className="h-4 w-4 flex-shrink-0" />}
              {fetchResult.message}
              <button type="button" className="ml-auto text-xs opacity-60 hover:opacity-100"
                onClick={() => setFetchResult(null)}>Dismiss</button>
            </div>
          )}

          {isLoading ? (
            <div className="text-sm text-muted-foreground p-6 text-center">Loading connectors…</div>
          ) : sources.length === 0 && !showForm ? (
            <div className="rounded-xl border-2 border-dashed border-border p-10 text-center space-y-3">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mx-auto">
                <Link2 className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">No API connectors yet</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Connect a biometric device API or any JSON endpoint that returns punch data.
                </p>
              </div>
              <Button size="sm" onClick={openCreate} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Add your first connector
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {sources.map(s => (
                <SourceCard
                  key={s.id}
                  source={s}
                  onEdit={() => openEdit(s)}
                  onTest={() => handleTestSource(s.id)}
                  onFetch={() => handleFetchSource(s.id)}
                  onDelete={() => { if (confirm(`Disable "${s.name}"?`)) deleteMutation.mutate(s.id) }}
                  isTesting={testingId === s.id}
                  isFetching={fetchingId === s.id}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Create / Edit form ─────────────────────────────────────────────── */}
        {showForm && (
          <div className="w-[440px] flex-shrink-0">
            <SectionCard
              title={editId ? 'Edit connector' : 'New connector'}
              action={
                <button type="button" className="text-muted-foreground hover:text-foreground text-xs"
                  onClick={() => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); setTestResult(null) }}>
                  Cancel
                </button>
              }
            >
              <div className="space-y-5">
                <SourceFormPanel
                  form={form}
                  onChange={setForm}
                  onTest={handleAdHocTest}
                  testResult={testResult}
                  testLoading={testLoading}
                />

                <div className="flex items-center justify-end gap-2 pt-1 border-t border-border">
                  <Button variant="outline" size="sm" className="h-8"
                    onClick={() => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); setTestResult(null) }}>
                    Cancel
                  </Button>
                  <Button size="sm" className="h-8 gap-1.5"
                    disabled={!form.name.trim() || !form.endpoint_url.trim() || saveMutation.isPending}
                    onClick={handleSave}>
                    {saveMutation.isPending
                      ? <><RefreshCw className="h-3 w-3 animate-spin" />Saving…</>
                      : <><ChevronRight className="h-3.5 w-3.5" />{editId ? 'Save changes' : 'Connect'}</>}
                  </Button>
                </div>

                {saveMutation.isError && (
                  <p className="text-xs text-destructive">{saveMutation.error instanceof Error ? saveMutation.error.message : 'Save failed'}</p>
                )}
              </div>
            </SectionCard>
          </div>
        )}

      </div>

      {/* ── How it works ──────────────────────────────────────────────────────── */}
      {!showForm && (
        <SectionCard title="How it works" className="mt-4">
          <div className="grid grid-cols-4 gap-4">
            {[
              { step: '1', icon: Link2,       title: 'Enter API URL',      body: 'Point to any JSON endpoint that returns punch records — biometric device API, third-party time-tracking platform, or custom service.' },
              { step: '2', icon: Wifi,        title: 'Configure & test',   body: 'Set authentication (API key, Bearer, Basic, HMAC or OAuth2). Test the connection and preview the first records in real time.' },
              { step: '3', icon: ChevronDown, title: 'Map fields',         body: 'Tell the system which JSON keys contain employee_code, timestamp and direction (in/out). Leave defaults if your API already uses those names.' },
              { step: '4', icon: Clock,       title: 'Schedule auto-fetch',body: 'Pick a polling interval (15 min → daily) or leave it as manual-only. The scheduler runs in the background and ingests new punches automatically.' },
            ].map(({ step, icon: Icon, title, body }) => (
              <div key={step} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="h-5 w-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0">{step}</span>
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs font-medium">{title}</p>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </PageContainer>
  )
}

export default AttendanceApiConnector
