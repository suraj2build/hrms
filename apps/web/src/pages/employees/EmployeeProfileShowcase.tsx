/**
 * EmployeeProfileShowcase.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * LOVABLE SHOWCASE FILE — FOR UI/THEME REDESIGN ONLY
 *
 * This is a self-contained, dependency-free version of the real EmployeeProfile.
 * All data is mocked. All mutations are no-ops. No auth, no API, no router.
 *
 * Structure mirrors the real page exactly:
 *   Left card (sticky) — avatar, meta, org line
 *   Right panel        — flat tab bar + tab content cards
 *
 * Tabs: Overview · Personal · Journey · Job & Position · Shift & Roster ·
 *       Compensation · Bank & Statutory · Documents · Family & Nominees
 *
 * Redesign freely — layout, spacing, typography, colours, card treatment, etc.
 * The functional logic will be ported from the redesign back into the real file.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react'
import {
  User, UserCircle, History, LayoutGrid, CalendarClock, DollarSign,
  Landmark, Files, Users, Camera, Edit2, Check, X, Globe,
  MapPin, Building2, GraduationCap, Phone, Mail,
  BadgeCheck, Clock, FileText, ShieldCheck, AlertTriangle,
  ChevronRight, Star, TrendingUp, Calendar,
} from 'lucide-react'

// ── Minimal shadcn-compatible stubs (works in any shadcn/tailwind project) ─────

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ')
}

function Badge({ children, className, variant = 'default' }: {
  children: React.ReactNode
  className?: string
  variant?: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'
}) {
  const variants: Record<string, string> = {
    default:     'bg-primary text-primary-foreground',
    secondary:   'bg-secondary text-secondary-foreground',
    success:     'bg-emerald-100 text-emerald-800 border border-emerald-200',
    warning:     'bg-amber-100 text-amber-800 border border-amber-200',
    destructive: 'bg-red-100 text-red-800 border border-red-200',
    outline:     'border border-border text-foreground',
  }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', variants[variant], className)}>
      {children}
    </span>
  )
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-2xl border border-border bg-card shadow-sm', className)}>{children}</div>
}

function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-col space-y-1.5 p-5 pb-3', className)}>{children}</div>
}

function CardTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn('text-sm font-semibold leading-none tracking-tight text-foreground', className)}>{children}</h3>
}

function CardContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('p-5 pt-0', className)}>{children}</div>
}

function Button({ children, className, variant = 'default', size = 'md', onClick, disabled }: {
  children: React.ReactNode
  className?: string
  variant?: 'default' | 'outline' | 'ghost' | 'destructive'
  size?: 'sm' | 'md' | 'lg'
  onClick?: () => void
  disabled?: boolean
}) {
  const variants: Record<string, string> = {
    default:     'bg-primary text-primary-foreground hover:bg-primary/90',
    outline:     'border border-border bg-background hover:bg-muted text-foreground',
    ghost:       'hover:bg-muted text-foreground',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  }
  const sizes: Record<string, string> = {
    sm: 'h-7 px-2.5 text-xs',
    md: 'h-9 px-4 text-sm',
    lg: 'h-10 px-6 text-sm',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant], sizes[size], className,
      )}
    >
      {children}
    </button>
  )
}

// ── Mock Data ──────────────────────────────────────────────────────────────────

const EMPLOYEE = {
  first_name:    'Priya',
  last_name:     'Sharma',
  employee_code: 'EMP0042',
  email:         'priya.sharma@cognixhr.in',
  phone:         '+91 98765 43210',
  status:        'active',
  joining_date:  '2022-04-01',
  initials:      'PS',
}

const JOB = {
  designation:      'Senior HR Manager',
  department:       'Human Resources',
  employment_type:  'Permanent',
  work_location:    'Andheri West Office',
  site:             'Mumbai Flagship',
  cost_center:      'CC-HR-001',
  reporting_manager:'Rajesh Kumar',
  grade:            'L4 — Senior',
  effective_from:   '2023-01-15',
}

const PERSONAL = {
  gender:         'Female',
  dob:            '14-Sep-1990',
  age:            '35 years',
  nationality:    'Indian',
  marital_status: 'Married',
  blood_group:    'B+',
}

const COMPENSATION = {
  ctc_annual:     '₹18,00,000',
  ctc_monthly:    '₹1,50,000',
  basic:          '₹72,000',
  hra:            '₹36,000',
  special_allow:  '₹27,000',
  pf_employer:    '₹8,640',
  last_revised:   '01-Jan-2025',
  revision_count: 3,
}

const BANK = {
  bank_name:      'HDFC Bank',
  account_number: '****  ****  3821',
  ifsc:           'HDFC0001234',
  account_type:   'Salary',
  pan:            'ABCPS1234D',
  uan:            '100234567890',
  pf_number:      'MH/12345/67890',
}

const DOCUMENTS = [
  { name: 'Offer Letter',       type: 'offer_letter',    date: '01-Apr-2022', verified: true  },
  { name: 'Aadhaar Card',       type: 'aadhaar',         date: '15-Apr-2022', verified: true  },
  { name: 'PAN Card',           type: 'pan',             date: '15-Apr-2022', verified: true  },
  { name: 'Experience Letter',  type: 'exp_letter',      date: '28-Mar-2022', verified: false },
  { name: 'Salary Slip (Mar)',  type: 'salary_slip',     date: '05-Apr-2025', verified: true  },
  { name: 'Form 16 (FY24-25)', type: 'tax_document',    date: '15-Jun-2025', verified: false },
]

const FAMILY = [
  { name: 'Suresh Sharma',   relation: 'Husband',    dob: '10-Feb-1988', pf_nominee: true  },
  { name: 'Ananya Sharma',   relation: 'Daughter',   dob: '22-Jul-2016', pf_nominee: true  },
]

const JOURNEY = [
  { date: '01-Apr-2022', event: 'Joined as HR Executive',         type: 'join'     },
  { date: '01-Oct-2022', event: 'Probation confirmed',            type: 'milestone'},
  { date: '15-Jan-2023', event: 'Promoted to HR Manager',         type: 'promo'    },
  { date: '01-Jan-2024', event: 'Compensation revised (+18%)',     type: 'comp'     },
  { date: '15-Jan-2025', event: 'Promoted to Senior HR Manager',  type: 'promo'    },
  { date: '01-Jan-2025', event: 'Compensation revised (+12%)',     type: 'comp'     },
]

const SHIFT = {
  shift_name:    'General Shift',
  shift_time:    '09:30 AM – 06:30 PM',
  roster:        'Standard 5-day Roster',
  rotation:      'Fixed',
  weekly_off:    'Saturday & Sunday',
  holiday_group: 'Maharashtra 2025',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const JOURNEY_ICON: Record<string, React.ElementType> = {
  join:      Star,
  milestone: BadgeCheck,
  promo:     TrendingUp,
  comp:      DollarSign,
}

const JOURNEY_COLOR: Record<string, string> = {
  join:      'text-emerald-600 bg-emerald-50 border-emerald-200',
  milestone: 'text-blue-600   bg-blue-50   border-blue-200',
  promo:     'text-violet-600 bg-violet-50 border-violet-200',
  comp:      'text-amber-600  bg-amber-50  border-amber-200',
}

function KV({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value ?? '—'}</p>
    </div>
  )
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-4">{children}</div>
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-3">
      {children}
    </p>
  )
}

// ── Tab definitions ────────────────────────────────────────────────────────────

type TabKey =
  | 'overview' | 'personal' | 'journey'
  | 'job' | 'shift'
  | 'compensation' | 'bank'
  | 'documents' | 'family'

const TABS: Array<{ key: TabKey; label: string; icon: React.ElementType }> = [
  { key: 'overview',     label: 'Overview',         icon: User          },
  { key: 'personal',     label: 'Personal',         icon: UserCircle    },
  { key: 'journey',      label: 'Journey',          icon: History       },
  { key: 'job',          label: 'Job & Position',   icon: LayoutGrid    },
  { key: 'shift',        label: 'Shift & Roster',   icon: CalendarClock },
  { key: 'compensation', label: 'Compensation',     icon: DollarSign    },
  { key: 'bank',         label: 'Bank & Statutory', icon: Landmark      },
  { key: 'documents',    label: 'Documents',        icon: Files         },
  { key: 'family',       label: 'Family & Nominees',icon: Users         },
]

// ── Main Component ─────────────────────────────────────────────────────────────

export function EmployeeProfileShowcase() {
  const [tab, setTab] = useState<TabKey>('overview')

  return (
    <div className="flex gap-6 items-start p-6 min-h-screen bg-background">

      {/* ── LEFT CARD ─────────────────────────────────────────────────────────── */}
      <div className="w-72 flex-shrink-0 sticky top-6 space-y-3">
        <div className="overflow-hidden rounded-3xl bg-card border border-border shadow-md">

          {/* Banner */}
          <div className="h-32 bg-gradient-to-tr from-primary/40 via-primary/25 to-accent/30 relative overflow-hidden">
            <div className="absolute -top-6 -right-6 h-28 w-28 rounded-full bg-white/10" />
            <div className="absolute -bottom-10 -left-4 h-24 w-24 rounded-full bg-white/10" />
            <div className="absolute top-4 right-14 h-8 w-8 rounded-full bg-white/10" />
          </div>

          {/* Avatar */}
          <div className="flex justify-center -mt-14 relative z-10 px-5">
            <div className="h-28 w-28 rounded-2xl ring-[3px] ring-card bg-primary/10 border border-border/50
                            flex items-center justify-center shadow-lg overflow-hidden">
              <span className="text-3xl font-black text-primary tracking-tight select-none">
                {EMPLOYEE.initials}
              </span>
            </div>
          </div>

          {/* Name + designation + status */}
          <div className="pt-4 pb-6 px-5 flex flex-col items-center gap-4">
            <div className="text-center w-full space-y-1">
              <h2 className="text-[15px] font-extrabold text-foreground leading-tight tracking-tight">
                {EMPLOYEE.first_name} {EMPLOYEE.last_name}
              </h2>
              <p className="text-[10.5px] text-primary font-bold truncate uppercase tracking-widest">
                {JOB.designation}
              </p>
            </div>

            <Badge variant="success" className="rounded-full text-[9px] font-bold uppercase tracking-widest px-4 py-1">
              Active
            </Badge>

            {/* Meta fields */}
            <div className="w-full rounded-xl bg-muted/40 border border-border/60 overflow-hidden">
              {[
                { label: 'Employee ID', value: EMPLOYEE.employee_code },
                { label: 'Engagement',  value: JOB.employment_type   },
                { label: 'Date Joined', value: '01-Apr-2022'          },
              ].map(({ label, value }, i, arr) => (
                <div key={label} className={cn(
                  'flex justify-between items-center px-3.5 py-2.5 text-xs',
                  i < arr.length - 1 && 'border-b border-border/60',
                )}>
                  <span className="text-muted-foreground font-medium">{label}</span>
                  <span className="font-bold text-foreground text-right max-w-[130px] truncate">{value}</span>
                </div>
              ))}
            </div>

            {/* Org line */}
            <div className="w-full rounded-xl bg-muted/40 border border-border/60 px-3.5 py-3 space-y-2">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1">
                Organisation Line
              </p>
              {[
                { label: JOB.site,          Icon: Globe,      isLast: false },
                { label: JOB.work_location, Icon: MapPin,     isLast: false },
                { label: JOB.department,    Icon: Building2,  isLast: false },
                { label: JOB.cost_center,   Icon: DollarSign, isLast: true  },
              ].map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 text-[11px]">
                  <span className="text-muted-foreground/40 w-3 text-center shrink-0 font-mono text-[10px]">
                    {item.isLast ? '└' : '├'}
                  </span>
                  <item.Icon className="h-3.5 w-3.5 shrink-0 text-primary/80" />
                  <span className="truncate text-foreground/80 font-medium">{item.label}</span>
                </div>
              ))}
            </div>

            {/* Contact quick links */}
            <div className="w-full space-y-1.5">
              <a href={`mailto:${EMPLOYEE.email}`}
                className="flex items-center gap-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors truncate">
                <Mail className="h-3 w-3 shrink-0" />
                {EMPLOYEE.email}
              </a>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Phone className="h-3 w-3 shrink-0" />
                {EMPLOYEE.phone}
              </div>
            </div>

            <Button variant="outline" size="sm" className="w-full gap-2 text-[10px] font-bold uppercase tracking-wider">
              <Camera className="h-3.5 w-3.5" />
              Upload Photo
            </Button>
          </div>
        </div>

        {/* Quick stats card */}
        <div className="rounded-2xl border border-border bg-card shadow-sm p-4 space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
            At a Glance
          </p>
          {[
            { label: 'Tenure',          value: '3y 2m',        icon: Clock       },
            { label: 'Reporting to',    value: 'Rajesh Kumar',  icon: Users       },
            { label: 'Grade',           value: 'L4 — Senior',   icon: GraduationCap },
            { label: 'Trust Score',     value: '92 / 100',      icon: ShieldCheck },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Icon className="h-3 w-3" />
                {label}
              </div>
              <span className="font-semibold text-foreground">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── RIGHT PANEL ───────────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-4">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="hover:text-foreground cursor-pointer transition-colors">People</span>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground font-medium">
            {EMPLOYEE.first_name} {EMPLOYEE.last_name}
          </span>
        </nav>

        {/* Tab bar */}
        <div className="flex flex-wrap gap-1 border-b border-border pb-0">
          {TABS.map(t => {
            const Icon = t.icon
            const active = tab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-md transition-colors',
                  'border-b-2 -mb-px',
                  active
                    ? 'border-primary text-primary bg-primary/5'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* ── Tab content ─────────────────────────────────────────────────────── */}

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Profile</CardTitle>
                  <Button variant="ghost" size="sm" className="gap-1">
                    <Edit2 className="h-3.5 w-3.5" /> Edit
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Grid2>
                  <KV label="First Name"   value={EMPLOYEE.first_name}    />
                  <KV label="Last Name"    value={EMPLOYEE.last_name}     />
                  <KV label="Email"        value={EMPLOYEE.email}         />
                  <KV label="Phone"        value={EMPLOYEE.phone}         />
                  <KV label="Joining Date" value="01-Apr-2022"            />
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-1.5 font-medium uppercase tracking-wide">
                      Status
                    </p>
                    <Badge variant="success" className="rounded-full text-[10px] capitalize">
                      Active
                    </Badge>
                  </div>
                </Grid2>
              </CardContent>
            </Card>

            {/* Intelligence summary */}
            <Card>
              <CardHeader>
                <CardTitle>Intelligence Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Trust Score',     value: '92%', sub: 'All documents verified',  color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
                    { label: 'Leave Balance',   value: '14d', sub: '8 EL · 6 SL remaining',  color: 'text-blue-600',    bg: 'bg-blue-50   border-blue-200'   },
                    { label: 'Open Actions',    value: '0',   sub: 'No pending items',        color: 'text-slate-600',   bg: 'bg-slate-50  border-slate-200'  },
                  ].map(item => (
                    <div key={item.label} className={cn('rounded-xl border p-3', item.bg)}>
                      <p className={cn('text-xl font-black tabular-nums', item.color)}>{item.value}</p>
                      <p className="text-[10px] font-semibold text-foreground/70 mt-0.5">{item.label}</p>
                      <p className="text-[9px] text-muted-foreground mt-1">{item.sub}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* PERSONAL */}
        {tab === 'personal' && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Personal Information</CardTitle>
                <Button variant="ghost" size="sm" className="gap-1">
                  <Edit2 className="h-3.5 w-3.5" /> Edit
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <SectionLabel>Basic Details</SectionLabel>
                <Grid2>
                  <KV label="Gender"          value={PERSONAL.gender}         />
                  <KV label="Date of Birth"   value={PERSONAL.dob}            />
                  <KV label="Age"             value={PERSONAL.age}            />
                  <KV label="Nationality"     value={PERSONAL.nationality}    />
                  <KV label="Marital Status"  value={PERSONAL.marital_status} />
                  <KV label="Blood Group"     value={PERSONAL.blood_group}    />
                </Grid2>
              </div>
              <div className="border-t border-border pt-4">
                <SectionLabel>Address</SectionLabel>
                <Grid2>
                  <KV label="Line 1"   value="42, Shastri Nagar"    />
                  <KV label="City"     value="Mumbai"               />
                  <KV label="State"    value="Maharashtra"          />
                  <KV label="Pincode"  value="400053"              />
                </Grid2>
              </div>
              <div className="border-t border-border pt-4">
                <SectionLabel>Emergency Contact</SectionLabel>
                <Grid2>
                  <KV label="Name"         value="Suresh Sharma"  />
                  <KV label="Relation"     value="Husband"        />
                  <KV label="Phone"        value="+91 98700 12345"/>
                </Grid2>
              </div>
            </CardContent>
          </Card>
        )}

        {/* JOURNEY */}
        {tab === 'journey' && (
          <Card>
            <CardHeader><CardTitle>Employment Journey</CardTitle></CardHeader>
            <CardContent>
              <div className="relative space-y-0">
                {JOURNEY.map((event, idx) => {
                  const Icon = JOURNEY_ICON[event.type] ?? Star
                  const color = JOURNEY_COLOR[event.type] ?? 'text-slate-600 bg-slate-50 border-slate-200'
                  const isLast = idx === JOURNEY.length - 1
                  return (
                    <div key={idx} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div className={cn('h-8 w-8 rounded-full border flex items-center justify-center flex-shrink-0', color)}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        {!isLast && <div className="w-px flex-1 bg-border mt-1 mb-1 min-h-[20px]" />}
                      </div>
                      <div className={cn('pb-4', isLast ? '' : '')}>
                        <p className="text-sm font-semibold text-foreground leading-tight">{event.event}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Calendar className="h-3 w-3" />{event.date}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* JOB & POSITION */}
        {tab === 'job' && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Current Position</CardTitle>
                  <Badge variant="outline" className="text-[10px]">Effective 15-Jan-2023</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <Grid2>
                  <KV label="Designation"        value={JOB.designation}       />
                  <KV label="Department"          value={JOB.department}        />
                  <KV label="Employment Type"     value={JOB.employment_type}   />
                  <KV label="Grade"               value={JOB.grade}             />
                  <KV label="Work Location"       value={JOB.work_location}     />
                  <KV label="Reporting Manager"   value={JOB.reporting_manager} />
                </Grid2>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Job History</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { title: 'Senior HR Manager', dept: 'Human Resources', type: 'Permanent', from: '15-Jan-2025', to: 'Present',     current: true  },
                    { title: 'HR Manager',         dept: 'Human Resources', type: 'Permanent', from: '15-Jan-2023', to: '14-Jan-2025', current: false },
                    { title: 'HR Executive',       dept: 'Human Resources', type: 'Permanent', from: '01-Apr-2022', to: '14-Jan-2023', current: false },
                  ].map((row, i) => (
                    <div key={i} className={cn(
                      'flex items-start justify-between rounded-xl px-4 py-3 border text-sm',
                      row.current ? 'bg-primary/5 border-primary/20' : 'bg-muted/30 border-border',
                    )}>
                      <div>
                        <p className="font-semibold text-foreground flex items-center gap-2">
                          {row.title}
                          {row.current && (
                            <span className="text-[9px] bg-primary text-primary-foreground rounded-full px-2 py-0.5 font-bold uppercase tracking-wide">
                              Current
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {row.dept} · {row.type}
                        </p>
                      </div>
                      <p className="text-[11px] text-muted-foreground text-right shrink-0 ml-4">
                        {row.from}<br />→ {row.to}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* SHIFT & ROSTER */}
        {tab === 'shift' && (
          <Card>
            <CardHeader><CardTitle>Shift & Roster Configuration</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <div>
                <SectionLabel>Current Shift</SectionLabel>
                <div className="rounded-xl bg-muted/40 border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-foreground">{SHIFT.shift_name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{SHIFT.shift_time}</p>
                    </div>
                    <Badge variant="success" className="text-[10px]">Active</Badge>
                  </div>
                </div>
              </div>
              <div className="border-t border-border pt-4">
                <SectionLabel>Configuration</SectionLabel>
                <Grid2>
                  <KV label="Roster"        value={SHIFT.roster}        />
                  <KV label="Rotation"      value={SHIFT.rotation}      />
                  <KV label="Weekly Off"    value={SHIFT.weekly_off}    />
                  <KV label="Holiday Group" value={SHIFT.holiday_group} />
                </Grid2>
              </div>
            </CardContent>
          </Card>
        )}

        {/* COMPENSATION */}
        {tab === 'compensation' && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Current Compensation</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      Last revised {COMPENSATION.last_revised}
                    </Badge>
                    <Button variant="ghost" size="sm" className="gap-1">
                      <Edit2 className="h-3.5 w-3.5" /> Revise
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="rounded-xl bg-primary/5 border border-primary/20 p-4">
                    <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Annual CTC</p>
                    <p className="text-2xl font-black text-primary mt-1 tabular-nums">{COMPENSATION.ctc_annual}</p>
                  </div>
                  <div className="rounded-xl bg-muted/40 border border-border p-4">
                    <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Monthly CTC</p>
                    <p className="text-2xl font-black text-foreground mt-1 tabular-nums">{COMPENSATION.ctc_monthly}</p>
                  </div>
                </div>
                <SectionLabel>Salary Breakdown (Monthly)</SectionLabel>
                <div className="space-y-2">
                  {[
                    { label: 'Basic',              value: COMPENSATION.basic,         type: 'earning' },
                    { label: 'HRA',                value: COMPENSATION.hra,           type: 'earning' },
                    { label: 'Special Allowance',  value: COMPENSATION.special_allow, type: 'earning' },
                    { label: 'PF (Employer)',       value: COMPENSATION.pf_employer,   type: 'contrib' },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between text-sm py-1.5 border-b border-border/50 last:border-0">
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className={cn('font-semibold tabular-nums', row.type === 'contrib' ? 'text-muted-foreground' : 'text-foreground')}>
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Revision History ({COMPENSATION.revision_count} revisions)</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[
                    { date: '01-Jan-2025', before: '₹16,07,143', after: '₹18,00,000', delta: '+12%' },
                    { date: '01-Jan-2024', before: '₹13,66,476', after: '₹16,07,143', delta: '+18%' },
                    { date: '01-Apr-2022', before: '—',           after: '₹13,66,476', delta: 'Joining' },
                  ].map((r, i) => (
                    <div key={i} className="flex items-center justify-between rounded-xl bg-muted/30 px-4 py-3 text-sm border border-border">
                      <span className="text-muted-foreground text-xs">{r.date}</span>
                      <span className="text-muted-foreground line-through text-xs">{r.before}</span>
                      <span className="font-semibold text-foreground">{r.after}</span>
                      <Badge variant={r.delta.startsWith('+') ? 'success' : 'outline'} className="text-[10px]">
                        {r.delta}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* BANK & STATUTORY */}
        {tab === 'bank' && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Bank Details</CardTitle>
                  <Button variant="ghost" size="sm" className="gap-1">
                    <Edit2 className="h-3.5 w-3.5" /> Edit
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Grid2>
                  <KV label="Bank Name"       value={BANK.bank_name}      />
                  <KV label="Account Number"  value={BANK.account_number} />
                  <KV label="IFSC Code"       value={BANK.ifsc}           />
                  <KV label="Account Type"    value={BANK.account_type}   />
                </Grid2>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Statutory Details</CardTitle></CardHeader>
              <CardContent>
                <Grid2>
                  <KV label="PAN Number" value={BANK.pan}       />
                  <KV label="UAN Number" value={BANK.uan}       />
                  <KV label="PF Number"  value={BANK.pf_number} />
                </Grid2>
                <div className="mt-4 flex flex-wrap gap-2">
                  {[
                    { label: 'PF Applicable',  active: true  },
                    { label: 'ESI Applicable', active: false },
                    { label: 'PT Applicable',  active: true  },
                    { label: 'LWF Applicable', active: true  },
                  ].map(item => (
                    <div key={item.label} className={cn(
                      'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
                      item.active
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : 'bg-muted/40 border-border text-muted-foreground',
                    )}>
                      {item.active ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                      {item.label}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* DOCUMENTS */}
        {tab === 'documents' && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Documents ({DOCUMENTS.length})</CardTitle>
                <Button variant="outline" size="sm" className="gap-1">
                  <FileText className="h-3.5 w-3.5" /> Add Document
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {DOCUMENTS.map((doc, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <FileText className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{doc.name}</p>
                        <p className="text-[11px] text-muted-foreground">{doc.date}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {doc.verified ? (
                        <Badge variant="success" className="text-[9px] gap-1">
                          <BadgeCheck className="h-3 w-3" /> Verified
                        </Badge>
                      ) : (
                        <Badge variant="warning" className="text-[9px] gap-1">
                          <AlertTriangle className="h-3 w-3" /> Pending
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* FAMILY & NOMINEES */}
        {tab === 'family' && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Family & Nominees</CardTitle>
                <Button variant="outline" size="sm" className="gap-1">
                  <Users className="h-3.5 w-3.5" /> Add Member
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {FAMILY.map((member, i) => (
                  <div key={i} className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-black text-primary">
                            {member.name.split(' ').map(n => n[0]).join('')}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{member.name}</p>
                          <p className="text-[11px] text-muted-foreground">{member.relation} · DOB: {member.dob}</p>
                        </div>
                      </div>
                      {member.pf_nominee && (
                        <Badge variant="outline" className="text-[9px]">PF Nominee</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  )
}
