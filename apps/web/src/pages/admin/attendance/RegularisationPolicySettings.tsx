/**
 * RegularisationPolicySettings — /admin/attendance/regularisation-policy
 *
 * Dedicated Setup page (Setup → Workforce Rules → Regularisation Policy) for the
 * tenant regularisation limit configuration. Renders the shared
 * RegularisationPolicyCard expanded. Save is HR-admin enforced server-side.
 */
import { PageContainer } from '@/components/layout/PageContainer'
import { RegularisationPolicyCard } from './RegularisationPolicyCard'

export function RegularisationPolicySettings() {
  return (
    <PageContainer>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-foreground">Regularisation Policy</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Submission window, request limits (per week/month/quarter/year), per-type caps and SLA rules for attendance correction requests.
        </p>
      </div>
      <RegularisationPolicyCard defaultOpen />
    </PageContainer>
  )
}

export default RegularisationPolicySettings
