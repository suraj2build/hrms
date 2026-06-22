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
  employee_name:   { key: 'employee_name',   label: 'Employee Name',   source: 'employee', required: true },
  employee_code:   { key: 'employee_code',   label: 'Employee Code',   source: 'employee', required: false },
  designation:     { key: 'designation',     label: 'Designation',     source: 'employee', required: true },
  department:      { key: 'department',       label: 'Department',      source: 'employee', required: false },
  date_of_joining: { key: 'date_of_joining', label: 'Date of Joining', source: 'employee', required: true },
  ctc_annual:      { key: 'ctc_annual',      label: 'Annual CTC',      source: 'computed', required: false },
  work_location:   { key: 'work_location',   label: 'Work Location',   source: 'employee', required: false },
  company_name:    { key: 'company_name',    label: 'Company Name',    source: 'company',  required: true },
  current_date:    { key: 'current_date',    label: 'Date',            source: 'computed', required: true },
  last_working_day:{ key: 'last_working_day',label: 'Last Working Day',source: 'manual',   required: false },
  old_designation: { key: 'old_designation', label: 'Current Designation', source: 'manual', required: false },
  new_designation: { key: 'new_designation', label: 'New Designation',  source: 'manual',   required: true },
  effective_date:  { key: 'effective_date',  label: 'Effective Date',   source: 'manual',   required: true },
  reason:          { key: 'reason',          label: 'Reason / Details', source: 'manual',   required: true },
  review_period:   { key: 'review_period',   label: 'Review Period',    source: 'manual',   required: true },
  performance_rating: { key: 'performance_rating', label: 'Rating', source: 'manual', required: false },
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
