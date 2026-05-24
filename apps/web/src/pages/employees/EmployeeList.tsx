import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useBasePath } from '@/lib/routing'
import { useQuery } from '@tanstack/react-query'
import {
  useReactTable, getCoreRowModel, getFilteredRowModel,
  getPaginationRowModel, getSortedRowModel, flexRender,
  type ColumnDef, type SortingState,
} from '@tanstack/react-table'
import { UserPlus, Search, Filter, Download, ChevronUp, ChevronDown, ChevronsUpDown, MoreHorizontal } from 'lucide-react'
import { api } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getInitials, formatDate, getStatusColor, getEmploymentTypeColor } from '@/lib/utils'
import type { EmployeeListItem } from '@/types'

// Deterministic avatar background — picks a color from the employee code's last character
const AVATAR_COLORS = [
  'bg-accent-violet/20 text-accent-violet',
  'bg-info/20 text-info',
  'bg-success/20 text-success',
  'bg-warning/20 text-warning',
  'bg-destructive/20 text-destructive',
  'bg-accent-teal/20 text-accent-teal',
  'bg-primary/20 text-primary',
  'bg-accent-magenta/20 text-accent-magenta',
]
function avatarColor(code: string): string {
  const idx = code.charCodeAt(code.length - 1) % AVATAR_COLORS.length
  return AVATAR_COLORS[idx]
}

export function EmployeeList() {
  const navigate     = useNavigate()
  const basePath     = useBasePath()
  const [globalFilter, setGlobalFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sorting, setSorting] = useState<SortingState>([])

  const { data, isLoading } = useQuery<{ data: EmployeeListItem[]; total: number }>({
    queryKey: ['employees', statusFilter],
    queryFn: () => api.get(`/employees${statusFilter !== 'all' ? `?status=${statusFilter}` : ''}`),
    staleTime: 30_000,
  })

  const employees = data?.data ?? []

  const columns: ColumnDef<EmployeeListItem>[] = [
    {
      id: 'employee',
      header: 'Employee',
      accessorFn: (row) => `${row.first_name} ${row.last_name}`,
      cell: ({ row }) => {
        const emp = row.original
        return (
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarImage src={emp.personal_info?.profile_photo ?? undefined} />
              <AvatarFallback className={`text-xs font-semibold ${avatarColor(emp.employee_code)}`}>
                {getInitials(`${emp.first_name} ${emp.last_name}`)}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium">{emp.first_name} {emp.last_name}</p>
              <p className="text-xs text-muted-foreground">{emp.employee_code}</p>
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'email',
      header: 'Email',
      cell: ({ getValue }) => <span className="text-sm text-muted-foreground">{getValue() as string}</span>,
    },
    {
      id: 'department',
      header: 'Department',
      accessorFn: (row) => row.department?.name ?? '—',
      cell: ({ getValue }) => {
        const val = getValue() as string
        if (val === '—') return <span className="text-sm text-muted-foreground">—</span>
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-info">
            <span className="h-1.5 w-1.5 rounded-full bg-info shrink-0" />
            {val}
          </span>
        )
      },
    },
    {
      id: 'designation',
      header: 'Designation',
      accessorFn: (row) => row.designation?.name ?? '—',
      cell: ({ getValue }) => <span className="text-sm">{getValue() as string}</span>,
    },
    {
      id: 'employment_type',
      header: 'Employment',
      accessorFn: (row) => row.current_job?.employment_type ?? '—',
      cell: ({ getValue }) => {
        const type = getValue() as string
        if (type === '—') return <span className="text-sm text-muted-foreground">—</span>
        return (
          <Badge className={`text-[10px] border rounded-full ${getEmploymentTypeColor(type)}`}>
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </Badge>
        )
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => {
        const status = getValue() as string
        return (
          <Badge className={`text-[10px] border rounded-full ${getStatusColor(status)}`}>
            {status.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
          </Badge>
        )
      },
    },
    {
      accessorKey: 'joining_date',
      header: 'Joining Date',
      cell: ({ getValue }) => <span className="text-sm text-muted-foreground">{formatDate(getValue() as string)}</span>,
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => navigate(`${basePath}/employees/${row.original.id}`)}>
              View Profile
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  const table = useReactTable({
    data: employees,
    columns,
    state: { globalFilter, sorting },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  })

  const filteredCount = table.getFilteredRowModel().rows.length

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">People Directory</h1>
          <p className="text-sm text-muted-foreground">
            {data?.total ?? 0} employees · {filteredCount} shown
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button size="sm" className="h-9" asChild>
            <Link to={`${basePath}/employees/new`}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add Employee
            </Link>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, code..."
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36 h-9">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="on_notice">On Notice</SelectItem>
                  <SelectItem value="separated">Separated</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="border-b border-border">
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer select-none hover:text-foreground"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <div className="flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getCanSort() && (
                            <span className="text-muted-foreground/50">
                              {header.column.getIsSorted() === 'asc' ? (
                                <ChevronUp className="h-3 w-3" />
                              ) : header.column.getIsSorted() === 'desc' ? (
                                <ChevronDown className="h-3 w-3" />
                              ) : (
                                <ChevronsUpDown className="h-3 w-3" />
                              )}
                            </span>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border animate-pulse">
                      {columns.map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-muted rounded w-24" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : table.getRowModel().rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-12 text-center text-muted-foreground text-sm">
                      No employees found. <Link to={`${basePath}/employees/new`} className="text-primary hover:underline">Add your first employee</Link>
                    </td>
                  </tr>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => navigate(`${basePath}/employees/${row.original.id}`)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="h-7 text-xs">
                Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="h-7 text-xs">
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
