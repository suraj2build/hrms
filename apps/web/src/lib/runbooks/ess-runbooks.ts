/**
 * Employee (ESS) runbooks — a focused, employee-facing set of how-tos.
 *
 * Separate from the admin runbook registry: these cover what an employee can
 * actually do in self-service, with deep-links straight into the /ess screens.
 */
export interface EssRunbookStep {
  title:  string
  detail: string
  to?:    string
  cta?:   string
}

export interface EssRunbook {
  id:      string
  title:   string
  summary: string
  /** Primary "open" deep-link for the whole runbook. */
  to:      string
  steps:   EssRunbookStep[]
  tips?:   string[]
}

export const ESS_RUNBOOKS: EssRunbook[] = [
  {
    id:      'apply-leave',
    title:   'Apply for leave',
    summary: 'Submit a leave request — the system checks your balance and the policy windows for you.',
    to:      '/ess/leave/apply',
    steps: [
      { title: 'Open the leave form', detail: 'Go to **Apply for Leave**.', to: '/ess/leave/apply', cta: 'Apply for Leave' },
      { title: 'Pick type & dates', detail: 'Choose the **Leave Type**, your **From / To** dates, and (if allowed) a **Half-Day** session.' },
      { title: 'Add a reason & submit', detail: 'Enter a short reason and click **Submit**. Your manager is notified if approval is required.' },
      { title: 'Track it', detail: 'See the status of every request under **My Leave Requests**.', to: '/ess/leave', cta: 'My Requests' },
    ],
    tips: ['If a date is greyed out it may fall in a payroll lock window or you may be short on balance.'],
  },
  {
    id:      'leave-balance',
    title:   'Check my leave & comp-off balance',
    summary: 'See how much leave you have left, what is pending, and your comp-off balance.',
    to:      '/ess/leave/balance',
    steps: [
      { title: 'Open balances', detail: 'Go to **Leave & Comp-Off**.', to: '/ess/leave/balance', cta: 'Open Balances' },
      { title: 'Read each type', detail: 'For every leave type you see **accrued, used and available** days. Pending requests are shown separately (not yet deducted).' },
      { title: 'Check comp-off', detail: 'Switch to the **Comp-Off** tab for your compensatory-off balance and history.' },
    ],
  },
  {
    id:      'regularise-attendance',
    title:   'Fix / regularise my attendance',
    summary: 'Raise a correction when a punch is missing or a day is marked wrong.',
    to:      '/ess/attendance',
    steps: [
      { title: 'Open My Attendance', detail: 'The monthly view shows each day’s status and your punches.', to: '/ess/attendance', cta: 'My Attendance' },
      { title: 'Pick the day', detail: 'Click the day that’s wrong (missing punch, absent but you worked, etc.).' },
      { title: 'Submit a regularisation', detail: 'Enter the correct in/out time and a reason, then submit. Your manager approves it.' },
    ],
    tips: ['Raise corrections before the month’s payroll is finalised, or they may not reflect in pay.'],
  },
  {
    id:      'payslip',
    title:   'View & download my payslip',
    summary: 'Open your monthly payslip and salary breakup, and download the PDF.',
    to:      '/ess/compensation',
    steps: [
      { title: 'Open Pay & Compensation', detail: 'Go to **Pay & Compensation**.', to: '/ess/compensation', cta: 'Open Payslips' },
      { title: 'Pick a month', detail: 'Select the payroll month to see earnings, deductions and net pay.' },
      { title: 'Download the PDF', detail: 'Use **Download** to save the payslip. Only finalised months are available.' },
    ],
  },
  {
    id:      'tax-declaration',
    title:   'Declare investments to save tax',
    summary: 'Plan and submit your income-tax declaration (80C, HRA, home-loan interest, regime) so your TDS is accurate.',
    to:      '/ess/salary/tax-planner',
    steps: [
      { title: 'Open the Tax Planner', detail: 'Go to **Tax Planner**. Declarations are only accepted while the window is open.', to: '/ess/salary/tax-planner', cta: 'Open Tax Planner' },
      { title: 'Choose your regime', detail: 'Pick **Old** or **New** — the planner shows the tax under each so you can compare.' },
      { title: 'Enter your investments', detail: 'Add amounts for 80C, 80D, HRA, home-loan interest, etc. The projected tax updates live.' },
      { title: 'Submit & upload proofs', detail: 'Submit the plan as your declaration, then upload supporting proofs for HR to verify.' },
    ],
    tips: ['Your elected regime and approved declarations directly drive the TDS deducted from your salary.'],
  },
  {
    id:      'update-profile',
    title:   'Update my profile & bank details',
    summary: 'Keep your contact, address and bank account up to date.',
    to:      '/ess/profile',
    steps: [
      { title: 'Open My Profile', detail: 'Go to **My Profile**.', to: '/ess/profile', cta: 'Open Profile' },
      { title: 'Edit what you can', detail: 'Update contact number, address, emergency contact and bank account where editing is allowed.' },
      { title: 'Save', detail: 'Save each section. Some changes may need HR approval before they take effect.' },
    ],
    tips: ['Correct bank and statutory details (PAN/UAN) prevent salary and filing issues.'],
  },
  {
    id:      'reimbursement',
    title:   'Claim a reimbursement',
    summary: 'Submit an expense claim with receipts and track its status.',
    to:      '/ess/reimbursements',
    steps: [
      { title: 'Open Reimbursements', detail: 'Go to **Reimbursements**.', to: '/ess/reimbursements', cta: 'Open Reimbursements' },
      { title: 'Create a claim', detail: 'Add the amount, category and date, and **upload the receipt**.' },
      { title: 'Submit & track', detail: 'Submit for approval; the status updates as your manager/finance processes it.' },
    ],
  },
  {
    id:      'helpdesk',
    title:   'Raise a support ticket',
    summary: 'Ask HR/IT for help and track the resolution.',
    to:      '/ess/issues',
    steps: [
      { title: 'Open the Helpdesk', detail: 'Go to **Helpdesk**.', to: '/ess/issues', cta: 'Open Helpdesk' },
      { title: 'Raise a ticket', detail: 'Pick a category, describe the issue, and attach a file if needed.' },
      { title: 'Track replies', detail: 'Follow the conversation and status until it’s resolved.' },
    ],
  },
  {
    id:      'letters',
    title:   'Download HR letters',
    summary: 'Get your offer, appointment, experience or salary letters.',
    to:      '/ess/letters',
    steps: [
      { title: 'Open Letters', detail: 'Go to **Letters**.', to: '/ess/letters', cta: 'Open Letters' },
      { title: 'Pick the letter', detail: 'Choose the letter you need; request it if it isn’t generated yet.' },
      { title: 'Download', detail: 'Download the PDF once it’s available.' },
    ],
  },
]
