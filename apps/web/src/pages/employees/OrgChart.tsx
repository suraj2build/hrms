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
 *   • Print / Save as PDF (browser print)
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Tree, TreeNode } from 'react-organizational-chart'
import { Loader2, Users, Printer, ChevronDown, ChevronUp, Building2 } from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { Input }         from '@/components/ui/input'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

// Collect every department present in the tree (for the filter dropdown).
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
  node, collapsed, onToggle, highlighted, dimmed,
}: {
  node: OrgNode
  collapsed: boolean
  onToggle: () => void
  highlighted: boolean
  dimmed: boolean
}) {
  const hasChildren = node.children.length > 0
  return (
    <div
      className={cn(
        'inline-flex flex-col items-center rounded-xl border bg-card px-4 py-3 shadow-sm transition-all min-w-[180px]',
        highlighted ? 'border-primary ring-2 ring-primary/40' : 'border-border',
        dimmed && 'opacity-40',
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
          onClick={onToggle}
          className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
        >
          {collapsed
            ? <><ChevronDown className="h-3 w-3" />{node.children.length} report{node.children.length > 1 ? 's' : ''}</>
            : <><ChevronUp className="h-3 w-3" />Collapse</>}
        </button>
      )}
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
    />
  )

  if (collapsed || node.children.length === 0) {
    return <TreeNode label={card} key={node.id} />
  }

  return (
    <TreeNode label={card} key={node.id}>
      {node.children.map(child => renderNode(child, collapsedIds, toggle, search, deptFilter))}
    </TreeNode>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function OrgChart() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [search, setSearch]   = useState('')
  const [dept, setDept]       = useState('all')

  const { data, isLoading, isError } = useQuery<OrgTreeResponse>({
    queryKey: ['employees', 'org-tree'],
    queryFn:  () => api.get('/employees/org-tree'),
    staleTime: 60_000,
    enabled:  isAdmin,
  })

  const roots = data?.data.roots ?? []
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
        subtitle={`Reporting hierarchy · ${total} active employee${total === 1 ? '' : 's'}`}
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
                lineWidth="2px"
                lineColor="hsl(var(--border))"
                lineBorderRadius="8px"
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
                  />
                }
              >
                {!collapsedIds.has(root.id) &&
                  root.children.map(child => renderNode(child, collapsedIds, toggle, search, dept))}
              </Tree>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
