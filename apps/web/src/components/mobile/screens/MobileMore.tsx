import { useNavigate } from 'react-router-dom'
import {
  User2, FileText, Receipt, Home, Boxes, Landmark, CalendarRange,
  BookOpen, LifeBuoy, Users2, ChevronRight, LogOut, Award, MessageCircle, Rocket,
} from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/authStore'
import { glossy } from '../glossy'

const links = (base: string) => [
  { label: 'My Growth', icon: Rocket, to: `${base}/identity`, from: '#1A4D8F', c: '#15B8A6' },
  { label: 'Recognition', icon: Award, to: `${base}/recognition`, from: '#7C3AED', c: '#A78BFA' },
  { label: 'Community', icon: MessageCircle, to: `${base}/community`, from: '#2E6FE6', c: '#15B8A6' },
  { label: 'My Profile', icon: User2, to: `${base}/profile`, from: '#2E6FE6', c: '#5C9AFF' },
  { label: 'Documents', icon: FileText, to: `${base}/documents`, from: '#1A4D8F', c: '#2E6FE6' },
  { label: 'Reimbursements', icon: Receipt, to: `${base}/reimbursements`, from: '#15B8A6', c: '#2DD4BF' },
  { label: 'Work From Home', icon: Home, to: `${base}/wfh`, from: '#7C3AED', c: '#A78BFA' },
  { label: 'Assets', icon: Boxes, to: `${base}/assets`, from: '#B07B18', c: '#D9A441' },
  { label: 'Loans & Advances', icon: Landmark, to: `${base}/loans`, from: '#1A8050', c: '#34B27B' },
  { label: 'Holidays', icon: CalendarRange, to: `${base}/company-holidays`, from: '#2E6FE6', c: '#5C9AFF' },
  { label: 'Policies', icon: BookOpen, to: `${base}/policies`, from: '#7C3AED', c: '#A78BFA' },
  { label: 'Team', icon: Users2, to: `${base}/team`, from: '#15B8A6', c: '#2DD4BF' },
  { label: 'HR Support', icon: LifeBuoy, to: `${base}/hr-support`, from: '#B07B18', c: '#D9A441' },
]

export function MobileMore({ base }: { base: string }) {
  const navigate = useNavigate()
  const { profile, clear } = useAuthStore()

  async function signOut() {
    try { await supabase.auth.signOut() } catch { /* noop */ }
    clear()
    navigate('/login')
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-4 shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
        <p className="text-sm font-bold text-foreground">{profile?.full_name ?? 'Employee'}</p>
        <p className="text-xs text-muted-foreground">{profile?.role ?? ''}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {links(base).map((l) => (
          <button key={l.label} onClick={() => navigate(l.to)} className="flex items-center gap-2.5 rounded-2xl bg-white p-3 text-left shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white" style={glossy(l.from, l.c)}>
              <l.icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-foreground/80">{l.label}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>

      <button onClick={signOut} className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-white py-3 text-sm font-semibold text-destructive shadow-sm">
        <LogOut className="h-4 w-4" /> Sign out
      </button>
    </div>
  )
}
