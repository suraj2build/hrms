// ─── Tenant ────────────────────────────────────────────────────────────────
export interface Tenant {
  id: string
  name: string
  slug: string
  plan: 'starter' | 'growth' | 'enterprise'
  logo_url?: string
  industry?: string
  size_range?: string
  country: string
  settings: Record<string, unknown>
  created_at: string
}

// ─── User / Profile ─────────────────────────────────────────────────────────
export type UserRole = 'super_admin' | 'hr_admin' | 'manager' | 'employee'

export interface Profile {
  id: string
  tenant_id: string
  employee_id?: string
  role: UserRole
  full_name?: string
  avatar_url?: string
  is_active: boolean
  created_at: string
}

// ─── Org Structure ───────────────────────────────────────────────────────────
export interface Department {
  id: string
  tenant_id: string
  name: string
  code?: string
  parent_id?: string
  head_id?: string
  created_at: string
  children?: Department[]
}

export interface Designation {
  id: string
  tenant_id: string
  name: string
  level?: number
  department_id?: string
  created_at: string
}

export interface Grade {
  id: string
  tenant_id: string
  name: string
  code?: string
  min_salary?: number
  max_salary?: number
  created_at: string
}

// ─── Employee (Lean — Sprint 2) ──────────────────────────────────────────────
export type EmployeeStatus = 'active' | 'inactive' | 'on_notice' | 'separated'

export interface Employee {
  id: string
  tenant_id: string
  employee_code: string
  first_name: string
  last_name: string
  email: string
  phone?: string
  joining_date: string
  status: EmployeeStatus
  work_location_id?: string
  created_by?: string
  created_at: string
  updated_at: string
  // Joined helpers (populated by API selects)
  department?: Pick<Department, 'id' | 'name'>
  designation?: Pick<Designation, 'id' | 'name'>
  grade?: Pick<Grade, 'id' | 'name'>
  manager?: Pick<Employee, 'id' | 'first_name' | 'last_name' | 'employee_code'>
  personal_info?: EmployeePersonalInfo
  current_job?: JobHistory
}

export type EmployeeListItem = Pick<
  Employee,
  | 'id'
  | 'employee_code'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'status'
  | 'joining_date'
  | 'created_at'
> & {
  department?: Pick<Department, 'id' | 'name'>
  designation?: Pick<Designation, 'id' | 'name'>
  personal_info?: Pick<EmployeePersonalInfo, 'profile_photo' | 'gender'>
  current_job?: Pick<JobHistory, 'employment_type'>
}

// ─── Document ────────────────────────────────────────────────────────────────
export type DocType =
  | 'aadhaar'
  | 'pan'
  | 'offer_letter'
  | 'contract'
  | 'certificate'
  | 'relieving_letter'
  | 'experience_letter'
  | 'other'

export interface Document {
  id: string
  tenant_id: string
  employee_id: string
  doc_type: DocType
  document_type_id?: string
  name: string
  storage_path: string
  file_size?: number
  mime_type?: string
  expires_at?: string
  uploaded_by?: string
  created_at: string
}

// ─── Dashboard Stats ─────────────────────────────────────────────────────────
export interface DashboardStats {
  total_employees: number
  active_employees: number
  new_joiners_this_month: number
  separations_this_month: number
  department_breakdown: { name: string; count: number }[]
  employment_type_breakdown: { type: EmploymentType; count: number }[]
}

// ─── API Response ────────────────────────────────────────────────────────────
export interface ApiResponse<T> {
  data: T
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
}

export interface ApiError {
  error: string
  message: string
  statusCode: number
}

// ════════════════════════════════════════════════════════════════════════════
// SPRINT 2 — Master Types
// ════════════════════════════════════════════════════════════════════════════

// ─── Work Location ───────────────────────────────────────────────────────────
export interface WorkLocation {
  id: string
  tenant_id: string
  name: string
  code?: string
  city?: string
  state?: string
  country?: string
  pincode?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

// ─── Cost Center ─────────────────────────────────────────────────────────────
export interface CostCenter {
  id: string
  tenant_id: string
  name: string
  code?: string
  description?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

// ─── Shift ───────────────────────────────────────────────────────────────────
export interface Shift {
  id: string
  tenant_id: string
  name: string
  code?: string
  start_time?: string   // e.g. "09:00"
  end_time?: string     // e.g. "18:00"
  work_hours?: number
  is_night_shift: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

// ─── Identity Type ───────────────────────────────────────────────────────────
export interface IdentityType {
  id: string
  tenant_id: string
  name: string
  code?: string
  description?: string
  is_active: boolean
  created_at: string
}

// ─── Relationship Type ───────────────────────────────────────────────────────
export interface RelationshipType {
  id: string
  tenant_id: string
  name: string
  code?: string
  is_active: boolean
  created_at: string
}

// ─── Document Type ───────────────────────────────────────────────────────────
export interface DocumentType {
  id: string
  tenant_id: string
  name: string
  code?: string
  is_mandatory: boolean
  applicable_for?: string[]   // e.g. ['employee', 'contractor']
  is_active: boolean
  created_at: string
  updated_at: string
}

// ─── Salary Component ────────────────────────────────────────────────────────
export type ComponentType = 'earning' | 'deduction' | 'employer_contribution'

export interface SalaryComponent {
  id: string
  tenant_id: string
  name: string
  code: string
  component_type: ComponentType
  is_taxable: boolean
  is_pf_applicable: boolean
  is_esi_applicable: boolean
  is_pt_applicable: boolean
  is_lwf_applicable: boolean
  is_variable: boolean
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

// ─── Salary Structure ────────────────────────────────────────────────────────
export type CalculationType = 'fixed' | 'pct_of_basic' | 'pct_of_ctc' | 'pct_of_gross'

export interface SalaryStructureComponent {
  id: string
  tenant_id: string
  salary_structure_id: string
  salary_component_id: string
  calculation_type: CalculationType
  default_value: number
  sequence: number
  created_at: string
  // Joined
  salary_components?: Pick<SalaryComponent, 'id' | 'name' | 'code' | 'component_type'>
}

export interface SalaryStructure {
  id: string
  tenant_id: string
  name: string
  code: string
  description?: string
  is_active: boolean
  created_at: string
  updated_at: string
  // Joined
  components?: SalaryStructureComponent[]
}

// ════════════════════════════════════════════════════════════════════════════
// SPRINT 2 — Employee Sub-module Types
// ════════════════════════════════════════════════════════════════════════════

// ─── Personal Info ───────────────────────────────────────────────────────────
export type Gender = 'male' | 'female' | 'other'
export type MaritalStatus = 'single' | 'married' | 'divorced' | 'widowed'
export type CasteCategory = 'general' | 'obc' | 'sc' | 'st' | 'ews'
export type TaxRegime = 'old' | 'new'

export interface EmployeePersonalInfo {
  id: string
  tenant_id: string
  employee_id: string
  gender?: Gender
  dob?: string
  marital_status?: MaritalStatus
  blood_group?: string
  nationality?: string
  religion?: string
  caste_category?: CasteCategory
  physically_handicapped: boolean
  profile_photo?: string
  created_at: string
  updated_at: string
}

// ─── Previous Employment ─────────────────────────────────────────────────────
export interface PreviousEmployment {
  id: string
  tenant_id: string
  employee_id: string
  company_name: string
  designation?: string
  from_date?: string
  to_date?: string
  reason_for_leaving?: string
  last_ctc?: number
  reference_name?: string
  reference_phone?: string
  created_at: string
  updated_at: string
}

// ─── Bank & Statutory ────────────────────────────────────────────────────────
export type BankAccountType = 'savings' | 'current' | 'salary'

export interface EmployeeBankStatutory {
  id: string
  tenant_id: string
  employee_id: string
  // Bank
  bank_name?: string
  account_number?: string
  ifsc?: string
  branch?: string
  account_type?: BankAccountType
  // Statutory
  pan?: string
  aadhaar?: string
  uan?: string
  pf_number?: string
  esi_number?: string
  pt_applicable: boolean
  lwf_applicable: boolean
  tax_regime?: TaxRegime
  created_at: string
  updated_at: string
}

// ─── Identity Documents ──────────────────────────────────────────────────────
export interface EmployeeIdentity {
  id: string
  tenant_id: string
  employee_id: string
  identity_type_id: string
  identity_number: string
  issued_by?: string
  issued_date?: string
  expiry_date?: string
  storage_path?: string
  created_at: string
  // Joined
  identity_types?: Pick<IdentityType, 'id' | 'name' | 'code'>
}

// ─── Contracts ───────────────────────────────────────────────────────────────
export type ContractType = 'appointment' | 'renewal' | 'amendment' | 'nda' | 'other'
export type ContractStatus = 'draft' | 'active' | 'expired' | 'terminated'

export interface EmployeeContract {
  id: string
  tenant_id: string
  employee_id: string
  contract_type: ContractType
  start_date: string
  end_date?: string
  storage_path?: string
  status: ContractStatus
  notes?: string
  created_by?: string
  created_at: string
  updated_at: string
}

// ─── Family Members ──────────────────────────────────────────────────────────
export interface EmployeeFamily {
  id: string
  tenant_id: string
  employee_id: string
  relationship_type_id?: string
  name: string
  dob?: string
  gender?: Gender
  is_dependent: boolean
  is_nominee: boolean
  occupation?: string
  created_at: string
  updated_at: string
  // Joined
  relationship_types?: Pick<RelationshipType, 'id' | 'name' | 'code'>
}

// ─── Nominations ─────────────────────────────────────────────────────────────
export type NominationScheme = 'pf' | 'gratuity' | 'esi' | 'superannuation'

export interface EmployeeNomination {
  id: string
  tenant_id: string
  employee_id: string
  scheme: NominationScheme
  nominee_name: string
  relationship_type_id?: string
  share_percentage: number    // 0–100; per-scheme total must = 100%
  is_minor: boolean
  guardian_name?: string
  created_at: string
  updated_at: string
  // Joined
  relationship_types?: Pick<RelationshipType, 'id' | 'name' | 'code'>
}

// ─── Emergency Contacts ──────────────────────────────────────────────────────
export interface EmergencyContact {
  id: string
  tenant_id: string
  employee_id: string
  name: string
  relationship?: string
  phone: string
  alternate_phone?: string
  email?: string
  address?: string
  is_primary: boolean
  created_at: string
  updated_at: string
}

// ─── Addresses ───────────────────────────────────────────────────────────────
export type AddressType = 'current' | 'permanent' | 'correspondence'

export interface EmployeeAddress {
  id: string
  tenant_id: string
  employee_id: string
  address_type: AddressType
  line1: string
  line2?: string
  city?: string
  state?: string
  country?: string
  pincode?: string
  created_at: string
  updated_at: string
}

// ─── Separation ───────────────────────────────────────────────────────────────
export type SeparationType =
  | 'resignation'
  | 'termination'
  | 'retirement'
  | 'end_of_contract'
  | 'absconding'
  | 'deceased'
  | 'mutual_separation'

export type SeparationInitiatedBy = 'employee' | 'employer'

export interface EmployeeSeparation {
  id: string
  tenant_id: string
  employee_id: string
  separation_type: SeparationType
  initiated_by?: SeparationInitiatedBy
  notice_date?: string
  last_working_date?: string
  exit_reason?: string
  exit_interview_done: boolean
  clearance_done: boolean
  created_by?: string
  created_at: string
  updated_at: string
}

// ─── Access Cards ─────────────────────────────────────────────────────────────
export type AccessCardStatus = 'active' | 'returned' | 'lost' | 'deactivated'

export interface EmployeeAccessCard {
  id: string
  tenant_id: string
  employee_id: string
  card_number: string
  issued_date?: string
  returned_date?: string
  status: AccessCardStatus
  notes?: string
  created_at: string
  updated_at: string
}

// ════════════════════════════════════════════════════════════════════════════
// SPRINT 2 — History Types
// ════════════════════════════════════════════════════════════════════════════

// ─── Job History ─────────────────────────────────────────────────────────────
export type EmploymentType = 'permanent' | 'contract' | 'intern' | 'probation' | 'consultant'

export interface JobHistory {
  id: string
  tenant_id: string
  employee_id: string
  department_id?: string
  designation_id?: string
  grade_id?: string
  work_location_id?: string
  cost_center_id?: string
  shift_id?: string
  manager_id?: string
  employment_type: EmploymentType
  effective_from: string
  effective_to?: string
  is_current: boolean
  reason_for_change?: string
  created_by?: string
  created_at: string
  // Joined
  departments?: Pick<Department, 'id' | 'name' | 'code'>
  designations?: Pick<Designation, 'id' | 'name'>
  grades?: Pick<Grade, 'id' | 'name' | 'code'>
  work_locations?: Pick<WorkLocation, 'id' | 'name' | 'city'>
  cost_centers?: Pick<CostCenter, 'id' | 'name' | 'code'>
  shifts?: Pick<Shift, 'id' | 'name' | 'code'>
  manager?: Pick<Employee, 'id' | 'first_name' | 'last_name' | 'employee_code'>
}

// ─── Compensation ─────────────────────────────────────────────────────────────
export interface EmployeeCompensationComponent {
  id: string
  tenant_id: string
  compensation_id: string
  salary_component_id: string
  calculation_type: CalculationType
  value: number            // input value (amount or %)
  computed_monthly: number // stored at write time
  computed_annual: number  // stored at write time
  sequence: number
  created_at: string
  // Joined
  salary_components?: Pick<SalaryComponent, 'id' | 'name' | 'code' | 'component_type'>
}

export interface EmployeeCompensation {
  id: string
  tenant_id: string
  employee_id: string
  salary_structure_id: string
  effective_from: string
  effective_to?: string
  is_active: boolean
  ctc_annual: number
  ctc_monthly: number    // GENERATED ALWAYS AS (ROUND(ctc_annual / 12, 2))
  notes?: string
  created_by?: string
  approved_by?: string
  created_at: string
  updated_at: string
  // Joined
  salary_structures?: Pick<SalaryStructure, 'id' | 'name' | 'code'>
  components?: EmployeeCompensationComponent[]
}

// ════════════���════════════════════════════════���══════════════════════════════
// Full Profile — single-call response shape (GET /employees/:id/full-profile)
// ═════���═══════════════════════════════��══════════════════════════════════════

export interface FullProfileJobInfo {
  id: string
  employment_type: EmploymentType
  effective_from: string
  effective_to?: string
  reason_for_change?: string
  department:    Pick<Department,     'id' | 'name' | 'code'> | null
  designation:   Pick<Designation,    'id' | 'name'>          | null
  grade:         Pick<Grade,          'id' | 'name' | 'code'> | null
  work_location: Pick<WorkLocation,   'id' | 'name' | 'city'> | null
  cost_center:   Pick<CostCenter,     'id' | 'name' | 'code'> | null
  shift:         Pick<Shift,          'id' | 'name' | 'code'> | null
  manager: {
    id: string
    full_name: string
    employee_code: string
  } | null
}

export interface FullProfileCompensationComponent {
  id: string
  name: string | null
  code: string | null
  component_type: ComponentType | null
  calculation_type: CalculationType
  value: number
  monthly_amount: number
  annual_amount: number
  sequence: number
}

export interface FullProfileCompensation {
  id: string
  ctc_annual: number
  ctc_monthly: number
  effective_from: string
  effective_to?: string
  notes?: string
  structure: Pick<SalaryStructure, 'id' | 'name' | 'code'> | null
  components: FullProfileCompensationComponent[]
}

export interface FullProfileBankStatutory {
  id: string
  bank_name?: string
  account_number_masked?: string   // last 4 digits only (masked server-side)
  ifsc?: string
  branch?: string
  account_type?: BankAccountType
  pan?: string
  aadhaar_masked?: string          // XXXX-XXXX-NNNN (masked server-side)
  uan?: string
  pf_number?: string
  esi_number?: string
  pt_applicable: boolean
  lwf_applicable: boolean
  tax_regime?: TaxRegime
}

/** Complete employee profile returned by GET /employees/:id/full-profile */
export interface FullProfile {
  employee:           Employee
  personal_info:      EmployeePersonalInfo | null
  job_info:           FullProfileJobInfo   | null
  compensation:       FullProfileCompensation | null
  addresses:          EmployeeAddress[]
  emergency_contacts: EmergencyContact[]
  bank_statutory:     FullProfileBankStatutory | null
}
