import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { MobileEssShell } from '@/components/mobile/MobileEssShell'

/**
 * MobilePreview — a PUBLIC, auth-free preview of the mobile ESS experience.
 * Seeds a mock profile + mock React Query data for every screen so the whole
 * glossy mobile UI is fully clickable without logging in. Route: /mobile-preview.
 */
const EMP = 'preview-emp'

function weekFrom() {
  const now = new Date()
  const day = (now.getDay() + 6) % 7
  const mon = new Date(now); mon.setDate(now.getDate() - day)
  return mon.toLocaleDateString('en-CA')
}

export function MobilePreview() {
  const qc = useQueryClient()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const today = new Date().toLocaleDateString('en-CA')
    const ym = today.slice(0, 7)
    const year = new Date().getFullYear()

    const store = useAuthStore.getState()
    store.setProfile({ id: 'preview-user', role: 'manager', employee_id: EMP, full_name: 'Aarav Sharma' } as never)
    store.setBootstrapping(false)

    // Keep seeded mock data — never refetch against the (absent) API in preview.
    qc.setDefaultOptions({ queries: { staleTime: Infinity, retry: false, refetchOnMount: false, refetchOnWindowFocus: false } })

    const todayLogs = { logs: [{ check_in: `${today}T08:30:00+05:30`, check_out: null, date: today }], daily: [{ date: today, status: 'present' }] }
    const weekDaily = {
      logs: [], daily: [
        { date: today, status: 'present' }, { date: today, status: 'present' },
        { date: today, status: 'late' }, { date: today, status: 'present' },
      ],
    }
    const balances = {
      data: [
        { leave_type_id: 'el', balance: 12, leave_types: { name: 'Earned' } },
        { leave_type_id: 'cl', balance: 5, leave_types: { name: 'Casual' } },
        { leave_type_id: 'sl', balance: 8, leave_types: { name: 'Sick' } },
        { leave_type_id: 'co', balance: 2, leave_types: { name: 'Comp-off' } },
      ],
    }
    const leaveHistory = {
      data: [
        { id: 'l1', status: 'approved', from_date: `${ym}-05`, to_date: `${ym}-06`, leave_types: { name: 'Earned Leave' } },
        { id: 'l2', status: 'pending', from_date: `${ym}-22`, leave_types: { name: 'Casual Leave' } },
        { id: 'l3', status: 'pending', from_date: `${ym}-28`, leave_types: { name: 'Sick Leave' } },
      ],
    }
    const slips = {
      data: [
        { slip_id: 's1', month: ym, gross_pay: 82000, net_pay: 68400 },
        { slip_id: 's2', month: `${year}-03`, gross_pay: 82000, net_pay: 68400 },
        { slip_id: 's3', month: `${year}-02`, gross_pay: 80000, net_pay: 66900 },
      ],
    }
    const corrections = { data: [{ id: 'c1', status: 'pending', date: `${ym}-18` }] }
    const holidays = {
      data: [
        { id: 'h1', date: `${ym}-26`, name: 'Founders Day', is_optional: false },
        { id: 'h2', date: `${year}-08-15`, name: 'Independence Day', is_optional: false },
        { id: 'h3', date: `${year}-10-02`, name: 'Gandhi Jayanti', is_optional: false },
      ],
    }
    const teamReg = {
      data: [
        { id: 't1', status: 'pending', date: `${ym}-17`, reason: 'Forgot to punch out after client visit', employee_name: 'Neha Gupta', employee_code: 'EMP102' },
        { id: 't2', status: 'pending', date: `${ym}-16`, reason: 'Biometric not captured at gate', employee_name: 'Rahul Verma', employee_code: 'EMP118' },
      ],
    }

    const recognitionMe = { data: { received: 7, given: 4, points: 85, recent: [{ message: 'Brilliant client save on the Q2 rollout!', from_name: 'Neha Gupta' }] } }
    const recognitionFeed = {
      data: [
        { id: 'r1', from_name: 'Neha Gupta', to_name: 'Aarav Sharma', badge_code: 'customer_hero', message: 'Brilliant client save on the Q2 rollout!', points: 15, created_at: new Date(Date.now() - 3600e3).toISOString() },
        { id: 'r2', from_name: 'Rahul Verma', to_name: 'Sara Khan', badge_code: 'team_player', message: 'Always first to help the team. Legend.', points: 10, created_at: new Date(Date.now() - 8 * 3600e3).toISOString() },
        { id: 'r3', from_name: 'Aarav Sharma', to_name: 'Vikram Rao', badge_code: 'innovator', message: 'That automation saved us hours every week.', points: 15, created_at: new Date(Date.now() - 26 * 3600e3).toISOString() },
      ],
    }
    const recognitionLeaders = {
      data: [
        { rank: 1, employee_id: 'e1', name: 'Sara Khan', points: 120, count: 9 },
        { rank: 2, employee_id: 'e2', name: 'Aarav Sharma', points: 85, count: 7 },
        { rank: 3, employee_id: 'e3', name: 'Vikram Rao', points: 70, count: 5 },
        { rank: 4, employee_id: 'e4', name: 'Neha Gupta', points: 55, count: 4 },
        { rank: 5, employee_id: 'e5', name: 'Rahul Verma', points: 40, count: 3 },
      ],
    }
    const recognitionBadges = {
      data: [
        { code: 'ownership_champion', label: 'Ownership Champion', icon: 'Award', description: '', points: 15 },
        { code: 'customer_hero', label: 'Customer Hero', icon: 'Heart', description: '', points: 15 },
        { code: 'team_player', label: 'Team Player', icon: 'Users', description: '', points: 10 },
        { code: 'innovator', label: 'Innovator', icon: 'Lightbulb', description: '', points: 15 },
      ],
    }
    const communityFeed = {
      data: [
        { id: 'p1', author_name: 'HR Team', type: 'announcement', title: 'Diwali holiday schedule', body: 'Offices will be closed Oct 31 – Nov 2. Wishing everyone a joyful festival!', pinned: true, created_at: new Date(Date.now() - 2 * 3600e3).toISOString(), reaction_count: 24, comment_count: 5, my_reaction: 'celebrate' },
        { id: 'p2', author_name: 'Vikram Rao', type: 'update', title: null, body: 'Shoutout to the ops team for a flawless month-end close 🙌', pinned: false, created_at: new Date(Date.now() - 20 * 3600e3).toISOString(), reaction_count: 12, comment_count: 2, my_reaction: null },
      ],
    }

    // Seed every query key the mobile screens read.
    qc.setQueryData(['mobile-home-att', EMP, today], todayLogs)
    qc.setQueryData(['mobile-home-leave'], leaveHistory)
    qc.setQueryData(['mobile-home-slips'], slips)
    qc.setQueryData(['mobile-home-balance', EMP], balances)
    qc.setQueryData(['mobile-attendance', EMP, today], todayLogs)
    qc.setQueryData(['mobile-attendance-week', EMP, weekFrom()], weekDaily)
    qc.setQueryData(['mobile-leave-balance', EMP], balances)
    qc.setQueryData(['mobile-leave-history'], leaveHistory)
    qc.setQueryData(['mobile-payslips'], slips)
    qc.setQueryData(['mobile-approvals-leave'], leaveHistory)
    qc.setQueryData(['mobile-approvals-corrections'], corrections)
    qc.setQueryData(['mobile-holidays', year], holidays)
    qc.setQueryData(['mobile-team-reg'], teamReg)
    qc.setQueryData(['mobile-recognition-me'], recognitionMe)
    qc.setQueryData(['mobile-recognition-feed'], recognitionFeed)
    qc.setQueryData(['mobile-recognition-leaderboard'], recognitionLeaders)
    qc.setQueryData(['mobile-recognition-badges'], recognitionBadges)
    qc.setQueryData(['mobile-community-feed'], communityFeed)
    qc.setQueryData(['mobile-home-recognition'], recognitionMe)
    qc.setQueryData(['mobile-home-community'], communityFeed)

    setReady(true)
  }, [qc])

  if (!ready) return null

  return (
    <div className="min-h-screen bg-[#0F172A] py-6">
      <div className="mx-auto w-full max-w-[420px] overflow-hidden bg-[#EEF3FF] sm:rounded-[2rem] sm:shadow-2xl sm:ring-8 sm:ring-black/80">
        <MobileEssShell previewHome />
      </div>
      <p className="mt-4 text-center text-xs text-white/50">CognixHR mobile ESS — preview (mock data)</p>
    </div>
  )
}
