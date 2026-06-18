/**
 * Employee (ESS) runbooks — a focused, employee-facing set of how-tos.
 *
 * Separate from the admin runbook registry: these cover what an employee can
 * actually do in self-service, with deep-links straight into the /ess screens.
 * Each runbook carries a category (for grouping) and a one-line "why it matters".
 */
export interface EssRunbookStep {
  title:   string
  detail:  string
  to?:     string
  /** Auto-open a dialog on arrival (e.g. the create form). */
  action?: 'new'
  cta?:    string
}

export interface EssRunbook {
  id:       string
  title:    string
  summary:  string
  /** Grouping bucket shown in the left rail. */
  category: string
  /** One-line "why this matters" shown as a callout. */
  why?:     string
  /** Primary "open" deep-link for the whole runbook. */
  to:       string
  /** Auto-open a dialog when the primary link is followed. */
  action?:  'new'
  steps:    EssRunbookStep[]
  tips?:    string[]
}

/** Fixed display order for the ESS runbook categories. */
export const ESS_CATEGORY_ORDER = [
  'Leave & Time Off',
  'Attendance',
  'Pay & Tax',
  'Claims & Requests',
  'Profile & Documents',
] as const

export const ESS_RUNBOOKS: EssRunbook[] = [
  // ── Leave & Time Off ──────────────────────────────────────────────────────
  {
    id:       'apply-leave',
    title:    'Apply for leave',
    summary:  'Submit a leave request — the system checks your balance and the policy windows for you.',
    category: 'Leave & Time Off',
    why:      'Applying in advance lets your manager plan cover and keeps your balance and payroll accurate.',
    to:       '/ess/leave/apply',
    steps: [
      { title: 'Open the leave form', detail: 'Go to **Apply for Leave**.', to: '/ess/leave/apply', cta: 'Apply for Leave' },
      { title: 'Pick type & dates', detail: 'Choose the **Leave Type**, your **From / To** dates, and (if allowed) a **Half-Day** session.' },
      { title: 'Add a reason & submit', detail: 'Enter a short reason and click **Submit**. Your manager is notified if approval is required.' },
      { title: 'Track it', detail: 'See the status of every request under **My Leave Requests**.', to: '/ess/leave', cta: 'My Requests' },
    ],
    tips: ['If a date is greyed out it may fall in a payroll lock window or you may be short on balance.'],
  },
  {
    id:       'leave-balance',
    title:    'Check my leave & comp-off balance',
    summary:  'See how much leave you have left, what is pending, and your comp-off balance.',
    category: 'Leave & Time Off',
    why:      'Knowing your real available balance before you apply avoids rejected requests and loss-of-pay surprises.',
    to:       '/ess/leave/balance',
    steps: [
      { title: 'Open balances', detail: 'Go to **Leave & Comp-Off**.', to: '/ess/leave/balance', cta: 'Open Balances' },
      { title: 'Read each type', detail: 'For every leave type you see **accrued, used and available** days. Pending requests are shown separately (not yet deducted).' },
      { title: 'Check comp-off', detail: 'Switch to the **Comp-Off** tab for your compensatory-off balance and history.' },
    ],
    tips: ['Comp-off often expires if not used within a window — spend it before it lapses.'],
  },

  // ── Attendance ────────────────────────────────────────────────────────────
  {
    id:       'regularise-attendance',
    title:    'Fix / regularise my attendance',
    summary:  'Raise a correction when a punch is missing or a day is marked wrong.',
    category: 'Attendance',
    why:      'Uncorrected missing punches can read as absent and cut your pay or leave balance for that day.',
    to:       '/ess/attendance',
    steps: [
      { title: 'Open My Attendance', detail: 'The monthly view shows each day’s status and your punches.', to: '/ess/attendance', cta: 'My Attendance' },
      { title: 'Pick the day', detail: 'Click the day that’s wrong (missing punch, absent but you worked, etc.).' },
      { title: 'Submit a regularisation', detail: 'Enter the correct in/out time and a reason, then submit. Your manager approves it.' },
    ],
    tips: ['Raise corrections before the month’s payroll is finalised, or they may not reflect in pay.'],
  },
  {
    id:       'my-schedule',
    title:    'See my shift & weekly schedule',
    summary:  'Check which shift you are on, your weekly-offs, and any upcoming roster changes.',
    category: 'Attendance',
    why:      'Knowing your shift and week-offs in advance prevents accidental late marks or missed days.',
    to:       '/ess/schedule',
    steps: [
      { title: 'Open My Schedule', detail: 'Go to **My Schedule** to see your assigned shift and weekly pattern.', to: '/ess/schedule', cta: 'My Schedule' },
      { title: 'Read the shift timing', detail: 'Each working day shows the **shift name and in/out window** you’re expected to follow.' },
      { title: 'Spot your week-offs', detail: 'Days marked as weekly-off (or holiday) are highlighted so you can plan around them.' },
    ],
    tips: ['If your roster looks wrong, raise it with your manager or HR before the week starts.'],
  },
  {
    id:       'holidays',
    title:    'View holidays & pick optional ones',
    summary:  'See the company holiday calendar and choose your optional (floating) holidays.',
    category: 'Attendance',
    why:      'Selecting optional holidays in time guarantees the day off you want before the quota fills up.',
    to:       '/ess/company-holidays',
    steps: [
      { title: 'Open the holiday calendar', detail: 'Go to **Company Holidays** to see every fixed holiday for the year.', to: '/ess/company-holidays', cta: 'Company Holidays' },
      { title: 'Choose optional holidays', detail: 'Open **Optional Holidays** and pick from the floating list, up to your allowed count.', to: '/ess/optional-holidays', cta: 'Optional Holidays' },
      { title: 'Confirm your picks', detail: 'Save your selection — chosen days are then treated as holidays for you.' },
    ],
    tips: ['Optional-holiday windows can close early once everyone has chosen — don’t leave it late.'],
  },

  // ── Pay & Tax ─────────────────────────────────────────────────────────────
  {
    id:       'payslip',
    title:    'View & download my payslip',
    summary:  'Open your monthly payslip and salary breakup, and download the PDF.',
    category: 'Pay & Tax',
    why:      'Checking each payslip early lets you flag a wrong earning or deduction before the next run.',
    to:       '/ess/compensation',
    steps: [
      { title: 'Open Pay & Compensation', detail: 'Go to **Pay & Compensation**.', to: '/ess/compensation', cta: 'Open Payslips' },
      { title: 'Pick a month', detail: 'Select the payroll month to see earnings, deductions and net pay.' },
      { title: 'Download the PDF', detail: 'Use **Download** to save the payslip. Only finalised months are available.' },
    ],
  },
  {
    id:       'tax-declaration',
    title:    'Declare investments to save tax',
    summary:  'Plan and submit your income-tax declaration (80C, HRA, home-loan interest, regime) so your TDS is accurate.',
    category: 'Pay & Tax',
    why:      'Your elected regime and approved declarations directly drive the TDS deducted from every salary.',
    to:       '/ess/salary/tax-planner',
    steps: [
      { title: 'Open the Tax Planner', detail: 'Go to **Tax Planner**. Declarations are only accepted while the window is open.', to: '/ess/salary/tax-planner', cta: 'Open Tax Planner' },
      { title: 'Choose your regime', detail: 'Pick **Old** or **New** — the planner shows the tax under each so you can compare.' },
      { title: 'Enter your investments', detail: 'Add amounts for 80C, 80D, HRA, home-loan interest, etc. The projected tax updates live.' },
      { title: 'Submit & upload proofs', detail: 'Submit the plan as your declaration, then upload supporting proofs for HR to verify.' },
    ],
    tips: ['Declare early in the year so TDS is spread evenly instead of a large cut in the last months.'],
  },
  {
    id:       'tax-statements',
    title:    'Check my tax & YTD statements',
    summary:  'See your year-to-date earnings, TDS deducted so far, and your detailed income-tax statement.',
    category: 'Pay & Tax',
    why:      'Reviewing TDS through the year helps you top up declarations before the final months’ deductions bite.',
    to:       '/ess/salary/it-statement',
    steps: [
      { title: 'Open the IT statement', detail: 'Go to **Income-Tax Statement** for a full projected tax computation.', to: '/ess/salary/it-statement', cta: 'IT Statement' },
      { title: 'Review YTD figures', detail: 'Open the **YTD Statement** to see earnings paid and tax deducted so far this year.', to: '/ess/salary/ytd', cta: 'YTD Statement' },
      { title: 'Add a previous employer', detail: 'If you joined mid-year, declare prior-employer income so your tax is computed correctly.', to: '/ess/salary/previous-employer', cta: 'Previous Employer' },
    ],
  },

  // ── Claims & Requests ─────────────────────────────────────────────────────
  {
    id:       'reimbursement',
    title:    'Claim a reimbursement',
    summary:  'Submit an expense claim with receipts and track its status.',
    category: 'Claims & Requests',
    why:      'Filing claims promptly with valid receipts gets you paid back faster and avoids cut-off misses.',
    to:       '/ess/reimbursements',
    action:   'new',
    steps: [
      { title: 'Open Reimbursements', detail: 'Go to **Reimbursements**.', to: '/ess/reimbursements', cta: 'Open Reimbursements' },
      { title: 'Create a claim', detail: 'Add the amount, category and date, and **upload the receipt**.', to: '/ess/reimbursements', action: 'new', cta: 'New Claim' },
      { title: 'Submit & track', detail: 'Submit for approval; the status updates as your manager/finance processes it.' },
    ],
    tips: ['Keep the original receipt — claims without a clear attachment are usually sent back.'],
  },
  {
    id:       'helpdesk',
    title:    'Raise a support ticket',
    summary:  'Ask HR/IT for help and track the resolution.',
    category: 'Claims & Requests',
    why:      'A ticket creates a tracked record, so your request isn’t lost in chat and you can see progress.',
    to:       '/ess/issues',
    action:   'new',
    steps: [
      { title: 'Open the Helpdesk', detail: 'Go to **Helpdesk**.', to: '/ess/issues', cta: 'Open Helpdesk' },
      { title: 'Raise a ticket', detail: 'Pick a category, describe the issue, and attach a file if needed.', to: '/ess/issues', action: 'new', cta: 'New Ticket' },
      { title: 'Track replies', detail: 'Follow the conversation and status until it’s resolved.' },
    ],
  },

  // ── Profile & Documents ───────────────────────────────────────────────────
  {
    id:       'update-profile',
    title:    'Update my profile & bank details',
    summary:  'Keep your contact, address and bank account up to date.',
    category: 'Profile & Documents',
    why:      'Correct bank and statutory details (PAN/UAN) prevent salary failures and filing issues.',
    to:       '/ess/profile',
    steps: [
      { title: 'Open My Profile', detail: 'Go to **My Profile**.', to: '/ess/profile', cta: 'Open Profile' },
      { title: 'Edit what you can', detail: 'Update contact number, address, emergency contact and bank account where editing is allowed.' },
      { title: 'Save', detail: 'Save each section. Some changes may need HR approval before they take effect.' },
    ],
  },
  {
    id:       'letters',
    title:    'Download HR letters',
    summary:  'Get your offer, appointment, experience or salary letters.',
    category: 'Profile & Documents',
    why:      'Self-serving your own letters saves a wait on HR when a bank or landlord needs proof.',
    to:       '/ess/letters',
    steps: [
      { title: 'Open Letters', detail: 'Go to **Letters**.', to: '/ess/letters', cta: 'Open Letters' },
      { title: 'Pick the letter', detail: 'Choose the letter you need; request it if it isn’t generated yet.' },
      { title: 'Download', detail: 'Download the PDF once it’s available.' },
    ],
  },
  {
    id:       'separation',
    title:    'Resign / start my exit',
    summary:  'Submit your resignation and follow the exit checklist through to your last day.',
    category: 'Profile & Documents',
    why:      'Initiating exit in the system starts notice, clearances and full-and-final on time — delays hold up your settlement.',
    to:       '/ess/separation',
    steps: [
      { title: 'Open Separation', detail: 'Go to **Separation** to begin or view your exit.', to: '/ess/separation', cta: 'Open Separation' },
      { title: 'Submit your resignation', detail: 'Enter your **intended last working day** and reason; the notice period is applied per policy.' },
      { title: 'Work the checklist', detail: 'Complete clearance items and the exit survey as they’re assigned to you.' },
    ],
    tips: ['Talk to your manager before submitting — the notice period is calculated from your submission date.'],
  },
]
