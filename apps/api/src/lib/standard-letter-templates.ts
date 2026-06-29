/**
 * standard-letter-templates.ts
 *
 * Canonical best-practice HR letter templates (India-first), seeded in one click.
 * Bodies are Handlebars — variables resolve from the employee/company at
 * generation time. Tenants edit wording, branding and approval flow after loading.
 *
 * category: 'hr_initiated' (HR issues) | 'ess_requestable' (employee can request)
 * letter_type: offer | appointment | confirmation | increment | relieving |
 *              experience | salary | custom
 */

export interface StandardLetterVariable {
  key:      string
  label:    string
  source:   string   // where the value comes from (employee | company | manual | computed)
  required: boolean
}

export interface StandardLetterTemplate {
  name:             string
  code:             string
  category:         'hr_initiated' | 'ess_requestable'
  letter_type:      string
  subject_template: string
  body_html:        string
  variables:        StandardLetterVariable[]
  requires_approval: boolean
  approval_levels:   number
}

// Common variables reused across templates.
const V = {
  employee_name:    { key: 'employee_name',    label: 'Employee Name',         source: 'employee', required: true },
  employee_code:    { key: 'employee_code',    label: 'Employee Code',         source: 'employee', required: false },
  designation:      { key: 'designation',      label: 'Designation',           source: 'employee', required: true },
  department:       { key: 'department',        label: 'Department',            source: 'employee', required: false },
  date_of_joining:  { key: 'date_of_joining',  label: 'Date of Joining',       source: 'employee', required: true },
  ctc_annual:       { key: 'ctc_annual',       label: 'Annual CTC',            source: 'computed', required: false },
  work_location:    { key: 'work_location',    label: 'Work Location',         source: 'employee', required: false },
  company_name:     { key: 'company_name',     label: 'Company Name',          source: 'company',  required: true },
  current_date:     { key: 'current_date',     label: 'Date',                  source: 'computed', required: true },
  last_working_day: { key: 'last_working_day', label: 'Last Working Day',      source: 'manual',   required: false },
  old_designation:  { key: 'old_designation',  label: 'Current Designation',   source: 'manual',   required: false },
  new_designation:  { key: 'new_designation',  label: 'New Designation',       source: 'manual',   required: true },
  effective_date:   { key: 'effective_date',   label: 'Effective Date',        source: 'manual',   required: true },
  reason:           { key: 'reason',           label: 'Reason / Details',      source: 'manual',   required: true },
  review_period:    { key: 'review_period',    label: 'Review Period',         source: 'manual',   required: true },
  performance_rating: { key: 'performance_rating', label: 'Rating',            source: 'manual',   required: false },
  // Absconding-specific
  absent_from_date: { key: 'absent_from_date', label: 'Absent From Date',      source: 'manual',   required: true },
  absent_days:      { key: 'absent_days',      label: 'Number of Absent Days', source: 'manual',   required: true },
  response_deadline:{ key: 'response_deadline',label: 'Response Deadline',     source: 'manual',   required: true },
  ref_number:       { key: 'ref_number',       label: 'Reference Number',      source: 'computed', required: true },
} as const

export const STANDARD_LETTER_TEMPLATES: StandardLetterTemplate[] = [
  {
    name: 'Offer Letter', code: 'offer_letter', category: 'hr_initiated', letter_type: 'offer',
    subject_template: 'Offer of Employment — {{company_name}}',
    body_html:
      '<p>Dear {{employee_name}},</p>' +
      '<p>We are pleased to offer you the position of <strong>{{designation}}</strong> at {{company_name}}. ' +
      'Your annual CTC will be <strong>₹{{ctc_annual}}</strong>, effective from your date of joining, {{date_of_joining}}.</p>' +
      '<p>This offer is contingent on successful background verification and submission of required documents.</p>' +
      '<p>We look forward to welcoming you aboard.</p><p>Warm regards,<br/>HR Department<br/>{{company_name}}</p>',
    variables: [V.employee_name, V.designation, V.ctc_annual, V.date_of_joining, V.company_name],
    requires_approval: true, approval_levels: 1,
  },
  {
    name: 'Appointment Letter', code: 'appointment_letter', category: 'hr_initiated', letter_type: 'appointment',
    subject_template: 'Appointment Letter — {{designation}}',
    body_html:
      '<p>Dear {{employee_name}},</p>' +
      '<p>With reference to your application and subsequent interview, we are pleased to appoint you as ' +
      '<strong>{{designation}}</strong> in the {{department}} department at {{company_name}}, effective {{date_of_joining}}.</p>' +
      '<p>Your employment is governed by the company’s policies and terms of service shared separately.</p>' +
      '<p>Sincerely,<br/>HR Department<br/>{{company_name}}</p>',
    variables: [V.employee_name, V.designation, V.department, V.date_of_joining, V.company_name],
    requires_approval: true, approval_levels: 1,
  },
  {
    name: 'Confirmation Letter', code: 'confirmation_letter', category: 'hr_initiated', letter_type: 'confirmation',
    subject_template: 'Confirmation of Employment',
    body_html:
      '<p>Dear {{employee_name}},</p>' +
      '<p>We are pleased to confirm your employment as <strong>{{designation}}</strong> at {{company_name}} ' +
      'with effect from {{current_date}}, on successful completion of your probation period.</p>' +
      '<p>Congratulations and continued success.</p><p>Regards,<br/>HR Department<br/>{{company_name}}</p>',
    variables: [V.employee_name, V.designation, V.current_date, V.company_name],
    requires_approval: true, approval_levels: 1,
  },
  {
    name: 'Salary Revision / Increment Letter', code: 'increment_letter', category: 'hr_initiated', letter_type: 'increment',
    subject_template: 'Salary Revision Letter',
    body_html:
      '<p>Dear {{employee_name}},</p>' +
      '<p>In recognition of your performance and contribution, your revised annual CTC will be ' +
      '<strong>₹{{ctc_annual}}</strong>, effective {{current_date}}. Your designation as {{designation}} remains unchanged.</p>' +
      '<p>We appreciate your efforts and look forward to your continued contribution.</p>' +
      '<p>Regards,<br/>HR Department<br/>{{company_name}}</p>',
    variables: [V.employee_name, V.designation, V.ctc_annual, V.current_date, V.company_name],
    requires_approval: true, approval_levels: 2,
  },
  {
    name: 'Experience Letter', code: 'experience_letter', category: 'ess_requestable', letter_type: 'experience',
    subject_template: 'Experience Certificate',
    body_html:
      '<p>To Whomsoever It May Concern,</p>' +
      '<p>This is to certify that {{employee_name}} (Emp Code: {{employee_code}}) was employed with {{company_name}} ' +
      'as <strong>{{designation}}</strong> from {{date_of_joining}} to {{last_working_day}}.</p>' +
      '<p>During the tenure, their conduct and performance were found to be satisfactory. ' +
      'We wish them success in their future endeavours.</p>' +
      '<p>For {{company_name}},<br/>HR Department</p>',
    variables: [V.employee_name, V.employee_code, V.designation, V.date_of_joining, V.last_working_day, V.company_name],
    requires_approval: true, approval_levels: 1,
  },
  {
    name: 'Relieving Letter', code: 'relieving_letter', category: 'hr_initiated', letter_type: 'relieving',
    subject_template: 'Relieving Letter',
    body_html:
      '<p>Dear {{employee_name}},</p>' +
      '<p>This is to confirm that you have been relieved from your duties as <strong>{{designation}}</strong> ' +
      'at {{company_name}} with effect from the close of business on {{last_working_day}}.</p>' +
      '<p>We confirm that all dues have been settled. We thank you for your contribution and wish you the best.</p>' +
      '<p>Regards,<br/>HR Department<br/>{{company_name}}</p>',
    variables: [V.employee_name, V.designation, V.last_working_day, V.company_name],
    requires_approval: true, approval_levels: 1,
  },
  {
    name: 'Salary Certificate', code: 'salary_certificate', category: 'ess_requestable', letter_type: 'salary',
    subject_template: 'Salary Certificate',
    body_html:
      '<p>To Whomsoever It May Concern,</p>' +
      '<p>This is to certify that {{employee_name}} (Emp Code: {{employee_code}}) is employed with {{company_name}} ' +
      'as <strong>{{designation}}</strong> since {{date_of_joining}}. Their current annual CTC is ₹{{ctc_annual}}.</p>' +
      '<p>This certificate is issued on request for {{employee_name}}.</p>' +
      '<p>For {{company_name}},<br/>HR Department</p>',
    variables: [V.employee_name, V.employee_code, V.designation, V.date_of_joining, V.ctc_annual, V.company_name],
    requires_approval: false, approval_levels: 1,
  },
  {
    name: 'Employment Verification Letter', code: 'employment_verification', category: 'ess_requestable', letter_type: 'custom',
    subject_template: 'Employment Verification',
    body_html:
      '<p>To Whomsoever It May Concern,</p>' +
      '<p>This is to confirm that {{employee_name}} (Emp Code: {{employee_code}}) is currently employed with ' +
      '{{company_name}} as <strong>{{designation}}</strong> at {{work_location}} since {{date_of_joining}}.</p>' +
      '<p>This letter is issued upon the employee’s request for verification purposes.</p>' +
      '<p>For {{company_name}},<br/>HR Department</p>',
    variables: [V.employee_name, V.employee_code, V.designation, V.work_location, V.date_of_joining, V.company_name],
    requires_approval: false, approval_levels: 1,
  },
  {
    name: 'Promotion Letter', code: 'promotion_letter', category: 'hr_initiated', letter_type: 'promotion',
    subject_template: 'Promotion Letter — {{new_designation}}',
    body_html:
      '<p>Dear {{employee_name}},</p>' +
      '<p>We are delighted to inform you that, in recognition of your performance and contribution, you have been ' +
      'promoted from <strong>{{old_designation}}</strong> to <strong>{{new_designation}}</strong>, effective {{effective_date}}.</p>' +
      '<p>Your new role carries enhanced responsibilities, and we are confident you will continue to excel. ' +
      'Revised compensation, if any, will be communicated separately.</p>' +
      '<p>Congratulations!</p><p>Warm regards,<br/>HR Department<br/>{{company_name}}</p>',
    variables: [V.employee_name, V.old_designation, V.new_designation, V.effective_date, V.company_name],
    requires_approval: true, approval_levels: 1,
  },
  {
    name: 'Warning / Show-Cause Notice', code: 'warning_letter', category: 'hr_initiated', letter_type: 'warning',
    subject_template: 'Show-Cause Notice',
    body_html:
      '<p>Dear {{employee_name}},</p>' +
      '<p>This letter serves as a formal notice in connection with the following: <strong>{{reason}}</strong>, ' +
      'brought to our attention on or around {{current_date}}.</p>' +
      '<p>You are hereby required to show cause, in writing within seven (7) days of receipt of this notice, as to why ' +
      'disciplinary action should not be taken against you. Your explanation will be reviewed before any decision is made.</p>' +
      '<p>This matter is being treated as confidential.</p>' +
      '<p>For {{company_name}},<br/>HR Department</p>',
    variables: [V.employee_name, V.designation, V.reason, V.current_date, V.company_name],
    requires_approval: true, approval_levels: 1,
  },
  {
    name: 'Performance Improvement Plan (PIP)', code: 'pip_letter', category: 'hr_initiated', letter_type: 'pip',
    subject_template: 'Performance Improvement Plan',
    body_html:
      '<p>Dear {{employee_name}},</p>' +
      '<p>Following a review of your performance as <strong>{{designation}}</strong>, you are being placed on a ' +
      'Performance Improvement Plan (PIP) for the period <strong>{{review_period}}</strong>, commencing {{current_date}}.</p>' +
      '<p>The specific objectives, expectations, and support available to you will be discussed and documented with your ' +
      'manager. Your progress will be reviewed periodically through this period.</p>' +
      '<p>We are committed to supporting you in meeting these expectations.</p>' +
      '<p>Regards,<br/>HR Department<br/>{{company_name}}</p>',
    variables: [V.employee_name, V.designation, V.review_period, V.current_date, V.company_name],
    requires_approval: true, approval_levels: 1,
  },
  // ── Absconding Letters ───────────────────────────────────────────────────────
  {
    name: 'Absconding Warning Letter 1', code: 'absconding_wl1', category: 'hr_initiated', letter_type: 'absconding_warning',
    subject_template: 'Warning Letter — Unauthorised Absence (Ref: {{ref_number}})',
    body_html:
      '<p style="text-align:right">Ref: {{ref_number}}<br/>Date: {{current_date}}</p>' +
      '<p>Dear {{employee_name}},</p>' +
      '<p>This letter is to bring to your notice that you have been absent from work without prior authorisation or intimation ' +
      'since <strong>{{absent_from_date}}</strong>, totalling <strong>{{absent_days}} days</strong> as on the date of this letter.</p>' +
      '<p>Your continued absence without approval or information to the company is in violation of the terms of your employment and company policies.</p>' +
      '<p>You are hereby directed to:</p>' +
      '<ol>' +
      '<li>Report to duty <strong>immediately</strong>, or</li>' +
      '<li>Submit, in writing, a satisfactory explanation for your absence along with supporting evidence, ' +
      'within <strong>seven (7) days</strong> of receipt of this letter, i.e., by <strong>{{response_deadline}}</strong>.</li>' +
      '</ol>' +
      '<p>Failure to respond or report to duty within the stipulated period will be viewed seriously and may result in further disciplinary action, ' +
      'including termination of your employment on grounds of abandonment of service.</p>' +
      '<p>This letter serves as your <strong>first and formal warning</strong>. Please treat this as urgent.</p>' +
      '<p>Regards,<br/>HR Department<br/>{{company_name}}</p>',
    variables: [V.employee_name, V.designation, V.department, V.absent_from_date, V.absent_days, V.response_deadline, V.ref_number, V.current_date, V.company_name],
    requires_approval: false, approval_levels: 1,
  },
  {
    name: 'Absconding Warning Letter 2 (Final)', code: 'absconding_wl2', category: 'hr_initiated', letter_type: 'absconding_warning',
    subject_template: 'Final Warning — Unauthorised Absence & Show-Cause Notice (Ref: {{ref_number}})',
    body_html:
      '<p style="text-align:right">Ref: {{ref_number}}<br/>Date: {{current_date}}</p>' +
      '<p>Dear {{employee_name}},</p>' +
      '<p>This is to bring to your attention that despite our earlier communication regarding your unauthorised absence ' +
      'since <strong>{{absent_from_date}}</strong>, you have neither reported to duty nor provided any satisfactory explanation.</p>' +
      '<p>Your total unauthorised absence now stands at <strong>{{absent_days}} days</strong>, which constitutes a serious ' +
      'breach of your employment contract and company policies.</p>' +
      '<p>This letter therefore serves as your <strong>Final Warning and Show-Cause Notice</strong>. You are required to:</p>' +
      '<ol>' +
      '<li>Report to duty <strong>immediately</strong> with a written explanation, or</li>' +
      '<li>Submit a written show-cause reply within <strong>seven (7) days</strong> from the date of this notice, ' +
      'i.e., by <strong>{{response_deadline}}</strong>, explaining why disciplinary action, including termination of employment, ' +
      'should not be initiated against you.</li>' +
      '</ol>' +
      '<p>Please note that failure to comply within the prescribed period will leave the company with no option but to initiate ' +
      'termination proceedings for <strong>abandonment of service</strong>, without further notice or reference.</p>' +
      '<p>For {{company_name}},<br/>HR Department</p>',
    variables: [V.employee_name, V.designation, V.department, V.absent_from_date, V.absent_days, V.response_deadline, V.ref_number, V.current_date, V.company_name],
    requires_approval: false, approval_levels: 1,
  },
  {
    name: 'Absconding Termination Letter', code: 'absconding_termination', category: 'hr_initiated', letter_type: 'absconding_termination',
    subject_template: 'Termination of Employment — Abandonment of Service (Ref: {{ref_number}})',
    body_html:
      '<p style="text-align:right">Ref: {{ref_number}}<br/>Date: {{current_date}}</p>' +
      '<p>Dear {{employee_name}},</p>' +
      '<p>You are employed with <strong>{{company_name}}</strong> as <strong>{{designation}}</strong> in the ' +
      '{{department}} department since {{date_of_joining}}.</p>' +
      '<p>You have been on unauthorised absence from <strong>{{absent_from_date}}</strong>, a period of ' +
      '<strong>{{absent_days}} days</strong>. The company issued two formal warning letters with show-cause notices ' +
      '(Ref Nos. as on record), calling upon you to report to duty or submit an explanation. ' +
      'Despite these communications, you have neither reported to duty nor provided any response.</p>' +
      '<p>Your prolonged, unexplained absence and wilful abandonment of your duties has severely disrupted business ' +
      'operations and constitutes a breach of your terms of employment.</p>' +
      '<p>After careful consideration of all facts, the management has decided to <strong>terminate your employment ' +
      'with immediate effect from {{current_date}}</strong> on the grounds of <strong>abandonment of service / absconding</strong>.</p>' +
      '<p>Your Full &amp; Final settlement, including any statutory dues payable, will be processed in accordance with ' +
      'company policy and applicable law. Please contact the HR department to initiate the settlement process and ' +
      'return any company property in your possession.</p>' +
      '<p>This letter is being sent to your last known address and email on record.</p>' +
      '<p>For {{company_name}},<br/>HR Department<br/>(Authorised Signatory)</p>',
    variables: [V.employee_name, V.employee_code, V.designation, V.department, V.date_of_joining, V.absent_from_date, V.absent_days, V.ref_number, V.current_date, V.company_name],
    requires_approval: true, approval_levels: 2,
  },

  // ── Performance ─────────────────────────────────────────────────────────────
  {
    name: 'Appraisal Letter', code: 'appraisal_letter', category: 'hr_initiated', letter_type: 'appraisal',
    subject_template: 'Performance Appraisal — {{review_period}}',
    body_html:
      '<p>Dear {{employee_name}},</p>' +
      '<p>Following your performance appraisal for <strong>{{review_period}}</strong>, we are pleased to share that your ' +
      'overall rating is <strong>{{performance_rating}}</strong>.</p>' +
      '<p>In recognition of your performance, your revised annual CTC will be <strong>₹{{ctc_annual}}</strong>, ' +
      'effective {{effective_date}}, in your role as {{designation}}.</p>' +
      '<p>Thank you for your contribution. We look forward to your continued success.</p>' +
      '<p>Regards,<br/>HR Department<br/>{{company_name}}</p>',
    variables: [V.employee_name, V.designation, V.review_period, V.performance_rating, V.ctc_annual, V.effective_date, V.company_name],
    requires_approval: true, approval_levels: 2,
  },
]
