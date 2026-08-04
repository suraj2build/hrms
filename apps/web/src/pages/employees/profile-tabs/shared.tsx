/**
 * Shared types/helpers used by more than one EmployeeProfile tab file.
 * Split out of the former monolithic EmployeeProfile.tsx.
 */
import { Badge } from '@/components/ui/badge'

export type Section = 'core' | 'employment' | 'compensation' | 'documents' | 'relationships' | 'assets'

export interface FullProfile {
  employee: {
    id: string; first_name: string; last_name: string; email: string; phone: string | null
    employee_code: string; joining_date: string | null; status: string
    site_id:   string | null; roster_id:   string | null
    sites:   { id: string; name: string; timezone: string } | null
    rosters: { id: string; name: string; cycle_days: number } | null
    version: number
  }
  personal_info: {
    gender: string | null; dob: string | null; marital_status: string | null
    blood_group: string | null; nationality: string | null; profile_photo: string | null
    version: number
  } | null
  job_info: {
    id: string; employment_type: string; effective_from: string; effective_to: string | null
    departments:    { id: string; name: string } | null
    designations:   { id: string; name: string } | null
    grades:         { id: string; name: string; code: string } | null
    work_locations: { id: string; name: string; city: string } | null
    shifts:         { id: string; name: string; start_time?: string; end_time?: string } | null
    manager:        { id: string; first_name: string; last_name: string; employee_code: string } | null
    cost_center:    { id: string; name: string; code: string } | null
  } | null
  compensation: {
    id: string; ctc_annual: number; ctc_monthly: number
    structure: { id: string; name: string; code: string } | null
    components: Array<{
      id: string; salary_component_id: string | null; sequence: number; calculation_type: string; value: number
      name: string | null; code: string | null
      component_type: 'earning' | 'deduction' | 'employer_contribution' | null
      is_basic: boolean; affects_pf: boolean; affects_nlc: boolean
      monthly_amount: number; annual_amount: number
    }>
    totals: {
      gross_monthly: number; gross_annual: number
      basic_monthly: number; basic_annual: number
      deductions_monthly: number; deductions_annual: number
      employer_contributions_monthly: number; employer_contributions_annual: number
      net_monthly: number; net_annual: number
    } | null
  } | null
  bank_statutory: {
    bank_name: string | null; account_number_masked: string | null; ifsc: string | null
    branch: string | null; account_type: string | null; pan: string | null
    aadhaar_masked: string | null; uan: string | null; pf_number: string | null
    esi_number: string | null; pt_applicable: boolean; lwf_applicable: boolean
    tax_regime: string | null
    pt_state_code: string | null; lwf_state_code: string | null
    site_state_code: string | null
    version: number
  } | null
}

// Loosely-typed API row shapes (fields accessed in these tabs). These mirror the
// backend payloads without being exhaustive — unaccessed columns are omitted.
export interface AddressRow {
  id: string; address_type?: string | null; line1?: string | null; line2?: string | null
  city?: string | null; state?: string | null; pincode?: string | null; country?: string | null
}
export interface EmergencyContactRow {
  id: string; name?: string | null; relationship?: string | null; phone?: string | null
  alternate_phone?: string | null; email?: string | null; is_primary?: boolean
}
export interface DocumentRow {
  id: string; name?: string | null; doc_type?: string | null; storage_path?: string | null
  created_at?: string | null
}
export interface IdentityRow {
  id: string; identity_number?: string | null; issued_by?: string | null
  expiry_date?: string | null; identity_types?: { name?: string | null } | null
}
export interface OnboardingDocItem {
  id: string; document_type?: string | null; extraction_status?: string | null; uploaded_at?: string | null
}
export interface JobHistoryRow {
  id: string; effective_from: string; effective_to?: string | null; is_current?: boolean
  employment_type?: string | null
  departments?: { name?: string | null } | null
  designations?: { name?: string | null } | null
  grades?: { name?: string | null; code?: string | null } | null
  manager?: { first_name?: string | null; last_name?: string | null } | null
  work_locations?: { name?: string | null } | null
  cost_centers?: { name?: string | null } | null
  shifts?: { name?: string | null } | null
}
export interface PrevEmploymentRow {
  id: string; company_name?: string | null; designation?: string | null
  from_date?: string | null; to_date?: string | null
}
export interface EducationRow {
  id: string; qualification: string; institution?: string | null
  specialization?: string | null; year_of_completion?: number | null
  grade?: string | null; document_path?: string | null; document_name?: string | null
  document_url?: string | null
}
export interface ClearanceRow { id: string; department?: string | null; status?: string | null; sequence?: number | null }
export interface SeparationData {
  separation_type?: string | null; initiated_by?: string | null
  notice_date?: string | null; last_working_date?: string | null
  exit_reason?: string | null; exit_interview_done?: boolean; clearance_done?: boolean
  remarks?: string | null; clearances?: ClearanceRow[]
}
export interface RevisionRow {
  id: string; status?: string | null; revision_type?: string | null
  before_ctc_annual?: number | null; new_ctc_annual?: number | null; effective_date?: string | null
  reason?: string | null; notes?: string | null
}
export interface CompComponentRow {
  salary_component_id?: string | null; component_type?: string | null; sequence?: number | null
  calculation_type?: string | null; value?: number | null; name?: string | null; code?: string | null
  monthly_amount?: number | null; annual_amount?: number | null
}
export interface CompHistoryRow {
  id: string; ctc_annual?: number | null; ctc_monthly?: number | null
  effective_from?: string | null; effective_to?: string | null; is_active?: boolean
}
export interface ContractRow {
  id: string; contract_type?: string | null; start_date?: string | null; end_date?: string | null
  status?: string | null; notes?: string | null; storage_path?: string | null
  version?: number | null
}
export interface PassportVisaRow {
  id: string; record_type?: string | null; doc_number?: string | null; country?: string | null
  visa_type?: string | null; place_of_issue?: string | null; issue_date?: string | null; expiry_date?: string | null
}
export interface FamilyRow {
  id: string; name?: string | null; dob?: string | null; gender?: string | null
  occupation?: string | null; is_dependent?: boolean; relationship_type_id?: string | null
  relationship_types?: { name?: string | null } | null
}
export interface NominationRow {
  id: string; scheme?: string | null; share_percentage?: number | string | null; nominee_name?: string | null
  dob?: string | null; is_minor?: boolean; guardian_name?: string | null
  relationship_types?: { name?: string | null } | null
}
export interface AccessCardRow {
  id: string; card_number?: string | null; status?: string | null
  issued_date?: string | null; returned_date?: string | null
  version?: number | null
}
export interface AssetRow { id: string; asset_code?: string | null; name?: string | null; status?: string | null }
export interface AssetHistoryRow { id?: string; asset_id?: string | null; action?: string | null; action_date?: string | null }
export interface ShiftHistoryRow {
  id: string; effective_from?: string | null; effective_to?: string | null; is_current?: boolean
  shifts?: { name?: string | null; code?: string | null; start_time?: string | null; end_time?: string | null } | null
}
export interface MasterOption { id: string; name: string; code?: string; city?: string; start_time?: string; end_time?: string }
export interface HolidayGroupRow { id: string; name?: string | null; is_active?: boolean; state_code?: string | null }
export interface StateRow { state_code: string; state_name: string; enabled: boolean }

export type BadgeVariant = React.ComponentProps<typeof Badge>['variant']

// Generic form-state bag for dynamically-keyed text forms (profile/personal/etc.).
// Values are text/nullable so they bind cleanly to <input value> and to null-able selects.
export type FormBag = Record<string, string | null | undefined>
export interface EmergencyContactForm {
  id?: string; name?: string; relationship?: string; phone?: string
  alternate_phone?: string; email?: string; is_primary?: boolean
}
export interface FamilyForm {
  id?: string; name?: string; relationship_type_id?: string; dob?: string
  gender?: string; occupation?: string; is_dependent?: boolean
}
export interface JobFormState {
  employment_type?: string | null
  department_id?: string | null; designation_id?: string | null; grade_id?: string | null
  manager_id?: string | null; work_location_id?: string | null; cost_center_id?: string | null
  shift_id?: string | null
  site_id?: string | null; roster_id?: string | null; rotation_policy_id?: string | null
  effective_from?: string | null; reason_for_change?: string | null; is_current?: boolean
}

export function KV({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-medium text-foreground">{value ?? '—'}</p>
    </div>
  )
}

export function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
}

export function EmptySection({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
      <Icon className="h-7 w-7 opacity-30" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {subtitle && <p className="text-xs">{subtitle}</p>}
    </div>
  )
}
