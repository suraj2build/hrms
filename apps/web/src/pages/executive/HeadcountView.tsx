/**
 * HeadcountView — /admin/executive/headcount
 *
 * The "Headcount Analytics" tab of the Executive (Manpower Intelligence)
 * dashboard. Embeds the workforce-analytics surface inside the shared exec
 * chrome so it sits alongside CEO / CHRO / Workforce / Financial / Compliance /
 * Trends as the last tab.
 */
import { ExecLayout } from '@/components/exec/ExecShell'
import { WorkforceAnalytics } from '@/pages/attendance/WorkforceAnalytics'

export default function HeadcountView() {
  return (
    <ExecLayout
      title="Headcount Analytics"
      subtitle="Workforce distribution, reliability and movement patterns"
    >
      <WorkforceAnalytics embedded />
    </ExecLayout>
  )
}
