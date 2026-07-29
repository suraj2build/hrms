/**
 * OrgChart — /admin/employees/org-chart  (EMP-02)
 *
 * Interactive reporting-hierarchy visualisation built from the
 * GET /employees/org-tree endpoint (employees.manager_id → children).
 * Uses react-organizational-chart (already a dependency).
 *
 * Features:
 *   • Department filter (shows only matching nodes + their ancestors)
 *   • Live search highlight (matches name / code / designation)
 *   • Collapse / expand any subtree
 *   • Click node → action popover → Change Manager dialog
 *   • Print / Save as PDF (browser print)
 */

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tree, TreeNode } from 'react-organizational-chart'
import {
  Loader2, Users, Printer, ChevronDown, ChevronUp, Building2,
  UserCog, X, Search, Check,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { Input }         from '@/components/ui/input'
import { Button }        from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrgNode {
  id: string
  employee_code: string
  name: string
  email: string
  status: string
  designation: string | null
  department: string | null
  profile_photo: string | null
  manager_id: string | null
  children: OrgNode[]
}

interface OrgTreeResponse {
  data: { roots: OrgNode[]; total: number }
}

interface EmployeeSearchResult {
  id: string
  employee_code: string
  first_name: string
  last_name: string
  designation?: string | null
  department?: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

function collectDepartments(roots: OrgNode[]): string[] {
  const set = new Set<string>()
  const walk = (n: OrgNode) => {
    if (n.department) set.add(n.department)
    n.children.forEach(walk)
  }
  roots.forEach(walk)
  return Array.from(set).sort()
}

// ── Node card ─────────────────────────────────────────────────────────────────

function NodeCard({
  node, collapsed, onToggle, highlighted, dimmed, isAdmin, onSelect,
}: {
  node: OrgNode
  collapsed: boolean
  onToggle: () => void
  highlighted: boolean
  dimmed: boolean
  isAdmin: boolean
  onSelect: (node: OrgNode) => void
}) {
  const hasChildren = node.children.length > 0

  const card = (
    <div
      className={cn(
        'inline-flex flex-col items-center rounded-xl border bg-card px-4 py-3 shadow-sm transition-all min-w-[180px]',
        highlighted ? 'border-primary ring-2 ring-primary/40' : 'border-border',
        dimmed && 'opacity-40',
        isAdmin && 'cursor-pointer hover:border-primary/50 hover:shadow-md',
      )}
    >
      <Avatar className="h-12 w-12 mb-2">
        {node.profile_photo ? <AvatarImage src={node.profile_photo} alt={node.name} /> : null}
        <AvatarFallback className="bg-primary/10 text-primary text-sm">{initials(node.name)}</AvatarFallback>
      </Avatar>
      <p className="text-sm font-semibold text-foreground text-center leading-tight">{node.name}</p>
      {node.designation && (
        <p className="text-[11px] text-muted-foreground text-center mt-0.5">{node.designation}</p>
      )}
      {node.department && (
        <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <Building2 className="h-3 w-3" />{node.department}
        </span>
      )}
      <span className="text-[10px] text-muted-foreground/70 mt-0.5 font-mono">{node.employee_code}</span>

      {hasChildren && (
        <button
          onClick={e => { e.stopPropagation(); onToggle() }}
          className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
        >
          {collapsed
            ? <><ChevronDown className="h-3 w-3" />{node.children.length} report{node.children.length > 1 ? 's' : ''}</>
            : <><ChevronUp className="h-3 w-3" />Collapse</>}
        </button>
      )}
    </div>
  )

  // Non-admins just see the card. For admins, the card is a dropdown trigger.
  // The menu renders in a portal (via Radix) so it is never clipped by the
  // chart's overflow-auto container — fixing the popover overlap/cut-off.
  if (!isAdmin) return <div className="inline-block">{card}</div>

  return (
    <div className="inline-block">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{card}</DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-56">
          <DropdownMenuLabel className="truncate text-xs">
            {node.name}
            <span className="block font-normal text-muted-foreground">
              {node.designation ?? node.employee_code}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => onSelect(node)} className="text-xs">
            <UserCog className="h-3.5 w-3.5 mr-2" /> Change Reporting Manager
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ── Recursive renderer ────────────────────────────────────────────────────────

function renderNode(
  node: OrgNode,
  collapsedIds: Set<string>,
  toggle: (id: string) => void,
  search: string,
  deptFilter: string,
  isAdmin: boolean,
  onSelect: (node: OrgNode) => void,
): JSX.Element {
  const collapsed = collapsedIds.has(node.id)
  const term = search.trim().toLowerCase()
  const highlighted = term.length > 0 && (
    node.name.toLowerCase().includes(term) ||
    node.employee_code.toLowerCase().includes(term) ||
    (node.designation ?? '').toLowerCase().includes(term)
  )
  const dimmed = deptFilter !== 'all' && node.department !== deptFilter

  const card = (
    <NodeCard
      node={node}
      collapsed={collapsed}
      onToggle={() => toggle(node.id)}
      highlighted={highlighted}
      dimmed={dimmed}
      isAdmin={isAdmin}
      onSelect={onSelect}
    />
  )

  if (collapsed || node.children.length === 0) {
    return <TreeNode label={card} key={node.id} />
  }

  return (
    <TreeNode label={card} key={node.id}>
      {node.children.map(child =>
        renderNode(child, collapsedIds, toggle, search, deptFilter, isAdmin, onSelect)
      )}
    </TreeNode>
  )
}

// ── Change Manager Dialog ─────────────────────────────────────────────────────

function ChangeManagerDialog({
  target,
  onClose,
}: {
  target: OrgNode | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [managerSearch, setManagerSearch] = useState('')
  const [picked, setPicked] = useState<EmployeeSearchResult | null>(null)

  const { data: searchResp, isFetching } = useQuery<{ data: EmployeeSearchResult[] }>({
    queryKey: ['emp-search-manager', managerSearch],
    queryFn:  () => api.get(`/employees?search=${encodeURIComponent(managerSearch)}&limit=20&status=active`),
    enabled:  !!target && managerSearch.length >= 2,
    staleTime: 20_000,
  })
  const results = searchResp?.data ?? []

  const mutation = useMutation({
    mutationFn: ({ empId, managerId }: { empId: string; managerId: string | null }) =>
      api.put(`/employees/${empId}/manager`, { manager_id: managerId }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['employees', 'org-tree'] })
      // Employee Profile's Job tab reads the same manager under a separate key.
      qc.invalidateQueries({ queryKey: ['employee-full', vars.empId] })
      toast.success(
        picked
          ? `Manager updated — ${target?.name} now reports to ${picked.first_name} ${picked.last_name}`
          : `Reporting manager removed for ${target?.name}`
      )
      handleClose()
    },
    onError: (e: unknown) => {
      const err = e as { body?: { message?: string }; message?: string } | null
      toast.error('Could not update manager', {
        description: err?.body?.message ?? err?.message ?? 'Check for circular reporting chains',
      })
    },
  })

  function handleClose() {
    onClose()
    setManagerSearch('')
    setPicked(null)
  }

  if (!target) return null

  return (
    <Dialog open={!!target} onOpenChange={v => { if (!v) handleClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5 text-primary" />
            Change Reporting Manager
          </DialogTitle>
          <DialogDescription>
            Reassign <strong>{target.name}</strong>'s reporting line. The org chart will update immediately.
          </DialogDescription>
        </DialogHeader>

        {/* Current manager info */}
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
          <p className="text-xs text-muted-foreground mb-0.5">Employee</p>
          <p className="font-semibold">{target.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{target.designation ?? target.employee_code} · {target.department ?? '—'}</p>
        </div>

        {/* Manager search */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search new manager by name or code…"
              value={managerSearch}
              onChange={e => { setManagerSearch(e.target.value); setPicked(null) }}
              className="pl-9"
              autoFocus
            />
            {isFetching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Picked badge */}
          {picked && (
            <div className="flex items-center justify-between rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
              <div>
                <p className="text-sm font-medium">{picked.first_name} {picked.last_name}</p>
                <p className="text-xs text-muted-foreground">{picked.employee_code}{picked.designation ? ` · ${picked.designation}` : ''}</p>
              </div>
              <button type="button" onClick={() => setPicked(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Search results */}
          {managerSearch.length >= 2 && !picked && (
            <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
              {results.length === 0 && !isFetching && (
                <p className="py-4 text-center text-sm text-muted-foreground">No employees found</p>
              )}
              {results
                .filter(e => e.id !== target.id)
                .map(emp => (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => { setPicked(emp); setManagerSearch('') }}
                    className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors"
                  >
                    <p className="text-sm font-medium">{emp.first_name} {emp.last_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {emp.employee_code}{emp.designation ? ` · ${emp.designation}` : ''}{emp.department ? ` · ${emp.department}` : ''}
                    </p>
                  </button>
                ))}
            </div>
          )}

          {managerSearch.length < 2 && !picked && (
            <p className="text-xs text-center text-muted-foreground py-1">Type at least 2 characters to search</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          {target.manager_id && (
            <Button
              variant="outline"
              className="text-destructive border-destructive/40 hover:bg-destructive/5"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ empId: target.id, managerId: null })}
            >
              Remove Manager
            </Button>
          )}
          <Button
            onClick={() => picked && mutation.mutate({ empId: target.id, managerId: picked.id })}
            disabled={!picked || mutation.isPending}
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function OrgChart() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [search, setSearch]   = useState('')
  const [dept, setDept]       = useState('all')
  const [editTarget, setEditTarget] = useState<OrgNode | null>(null)

  const { data, isLoading, isError } = useQuery<OrgTreeResponse>({
    queryKey: ['employees', 'org-tree'],
    queryFn:  () => api.get('/employees/org-tree'),
    staleTime: 60_000,
    enabled:  isAdmin,
  })

  const roots = useMemo(() => data?.data.roots ?? [], [data])
  const total = data?.data.total ?? 0
  const departments = useMemo(() => collectDepartments(roots), [roots])

  const toggle = (id: string) =>
    setCollapsedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const collapseAll = () => {
    const ids = new Set<string>()
    const walk = (n: OrgNode) => { if (n.children.length) ids.add(n.id); n.children.forEach(walk) }
    roots.forEach(walk)
    setCollapsedIds(ids)
  }
  const expandAll = () => setCollapsedIds(new Set())

  if (!isAdmin) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-2 text-muted-foreground">
          <Users className="h-8 w-8" />
          <p className="text-sm">Org chart is available to HR admins only.</p>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Organisation Chart"
        subtitle={`Reporting hierarchy · ${total} active employee${total === 1 ? '' : 's'} · Click any card to reassign manager`}
        actions={
          <div className="flex items-center gap-2 flex-wrap print:hidden">
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name / code / role"
              className="w-56"
            />
            <select
              value={dept}
              onChange={e => setDept(e.target.value)}
              className="text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
            >
              <option value="all">All departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <button onClick={expandAll}   className="text-xs px-3 py-2 rounded-md border border-border hover:bg-muted">Expand all</button>
            <button onClick={collapseAll} className="text-xs px-3 py-2 rounded-md border border-border hover:bg-muted">Collapse all</button>
            <button onClick={() => window.print()} className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-md border border-border hover:bg-muted">
              <Printer className="h-3.5 w-3.5" />Print
            </button>
          </div>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center min-h-[50vh] text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-2 text-muted-foreground">
          <p className="text-sm">Could not load the org chart.</p>
        </div>
      ) : roots.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-2 text-muted-foreground">
          <Users className="h-8 w-8" />
          <p className="text-sm">No employees with reporting relationships yet.</p>
          <p className="text-xs">Assign reporting managers on employee profiles to build the chart.</p>
        </div>
      ) : (
        <div className="overflow-auto rounded-xl border border-border bg-muted/10 p-8">
          {roots.map(root => (
            <div key={root.id} className="inline-block mr-12 align-top">
              <Tree
                lineWidth="1.5px"
                lineColor="var(--muted-foreground)"
                lineBorderRadius="10px"
                label={
                  <NodeCard
                    node={root}
                    collapsed={collapsedIds.has(root.id)}
                    onToggle={() => toggle(root.id)}
                    highlighted={
                      search.trim().length > 0 &&
                      (root.name.toLowerCase().includes(search.trim().toLowerCase()) ||
                        root.employee_code.toLowerCase().includes(search.trim().toLowerCase()))
                    }
                    dimmed={dept !== 'all' && root.department !== dept}
                    isAdmin={isAdmin}
                    onSelect={setEditTarget}
                  />
                }
              >
                {!collapsedIds.has(root.id) &&
                  root.children.map(child =>
                    renderNode(child, collapsedIds, toggle, search, dept, isAdmin, setEditTarget)
                  )}
              </Tree>
            </div>
          ))}
        </div>
      )}

      <ChangeManagerDialog
        target={editTarget}
        onClose={() => setEditTarget(null)}
      />
    </PageContainer>
  )
}
