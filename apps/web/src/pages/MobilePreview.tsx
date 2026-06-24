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
