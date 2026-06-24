import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { MobileEssShell } from '@/components/mobile/MobileEssShell'

/**
 * MobilePreview — a PUBLIC, auth-free preview of the mobile ESS experience.
 * Seeds a mock profile + mock React Query data so the glossy mobile UI renders
 * fully without logging in. Route: /mobile-preview. For demos only.
 */
export function MobilePreview() {
  const qc = useQueryClient()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const today = new Date().toLocaleDateString('en-CA')

    // Mock auth profile (manager → shows the Employee/Team toggle).
    const store = useAuthStore.getState()
    store.setProfile({
      id: 'preview-user',
      role: 'manager',
      employee_id: 'preview-emp',
      full_name: 'Aarav Sharma',
    } as never)
    store.setBootstrapping(false)

    // Today's punch for the mock employee.
    qc.setQueryData(['mobile-attendance', 'preview-emp', today], {
      logs: [{ check_in: `${today}T08:30:00+05:30`, check_out: null, date: today }],
    })

    // Seed query caches the mobile screens read from.
    qc.setQueryData(['mobile-home-att', 'preview-emp', today], {
      logs: [{ check_in: `${today}T08:30:00+05:30`, check_out: null, date: today }],
    })
    qc.setQueryData(['mobile-home-leave'], { data: [{ id: '1', status: 'pending' }, { id: '2', status: 'pending' }] })
    qc.setQueryData(['mobile-home-slips'], { data: [{ slip_id: 's1', month: today.slice(0, 7), net_pay: 68400 }] })

    setReady(true)
  }, [qc])

  if (!ready) return null

  return (
    <div className="min-h-screen bg-[#0F172A] py-6">
      {/* phone frame on desktop; full-bleed on mobile */}
      <div className="mx-auto w-full max-w-[420px] overflow-hidden bg-[#EEF3FF] sm:rounded-[2rem] sm:shadow-2xl sm:ring-8 sm:ring-black/80">
        <MobileEssShell previewHome />
      </div>
      <p className="mt-4 text-center text-xs text-white/50">CognixHR mobile ESS — preview (mock data)</p>
    </div>
  )
}
