/**
 * ManagerTeamAssets — P6.7
 *
 * Read-only view of all assets currently assigned to the manager's direct
 * reports. Highlights outstanding return obligations (useful context for
 * separation clearance). HR retains assign/return authority.
 *
 * Reuses: GET /manager/team/assets (new P6.7 endpoint).
 */

import { useState, useMemo }  from 'react'
import { useQuery }            from '@tanstack/react-query'
import { Package, RefreshCw, Loader2, Search } from 'lucide-react'
import { api }           from '@/lib/api/client'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TeamAsset {
  id:            string
  asset_code:    string
  name:          string
  serial_number: string | null
  notes:         string | null
  category_name: string | null
  employee_id:   string | null
  employee_name: string | null
  employee_code: string | null
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ManagerTeamAssets() {
  const [search, setSearch] = useState('')

  const { data, isFetching, refetch } = useQuery<{ data: TeamAsset[]; total: number }>({
    queryKey: ['manager-team-assets'],
    queryFn:  () => api.get('/manager/team/assets'),
    staleTime: 5 * 60_000,
  })

  const rows = data?.data ?? []

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter(r =>
      r.asset_code.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      (r.employee_name ?? '').toLowerCase().includes(q) ||
      (r.serial_number ?? '').toLowerCase().includes(q),
    )
  }, [rows, search])

  // Group by employee
  const byEmployee = useMemo(() => {
    const map = new Map<string, { name: string; code: string; assets: TeamAsset[] }>()
    for (const a of filtered) {
      const key = a.employee_id ?? 'unknown'
      if (!map.has(key)) {
        map.set(key, { name: a.employee_name ?? 'Unknown', code: a.employee_code ?? '—', assets: [] })
      }
      map.get(key)!.assets.push(a)
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [filtered])

  return (
    <PageContainer>
      <PageHeader
        title="Team Assets"
        subtitle="Assets currently assigned to your direct reports. Contact HR to assign or return assets."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('h-4 w-4 mr-1', isFetching && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8 h-9"
            placeholder="Search assets or employees…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {rows.length} asset{rows.length !== 1 ? 's' : ''} assigned
        </p>
      </div>

      {isFetching && rows.length === 0 ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Package className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">No assets assigned to your team</p>
          </div>
        </SectionCard>
      ) : byEmployee.length === 0 ? (
        <SectionCard>
          <p className="py-8 text-center text-sm text-muted-foreground">No results match your search.</p>
        </SectionCard>
      ) : (
        <div className="space-y-4">
          {byEmployee.map(emp => (
            <SectionCard key={emp.code}>
              <div className="mb-3 flex items-center gap-2">
                <p className="text-sm font-semibold">{emp.name}</p>
                <span className="text-xs text-muted-foreground">{emp.code}</span>
                <span className="ml-auto text-[11px] font-medium text-muted-foreground">
                  {emp.assets.length} item{emp.assets.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground text-left">
                      <th className="py-1.5 pr-3">Code</th>
                      <th className="py-1.5 pr-3">Name</th>
                      <th className="py-1.5 pr-3">Category</th>
                      <th className="py-1.5 pr-3">Serial</th>
                      <th className="py-1.5">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emp.assets.map(a => (
                      <tr key={a.id} className="border-b border-border last:border-0">
                        <td className="py-2 pr-3 font-mono text-xs">{a.asset_code}</td>
                        <td className="py-2 pr-3 font-medium">{a.name}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{a.category_name ?? '—'}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">{a.serial_number ?? '—'}</td>
                        <td className="py-2 text-xs text-muted-foreground max-w-[160px] truncate">{a.notes ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          ))}
        </div>
      )}
    </PageContainer>
  )
}

export default ManagerTeamAssets
