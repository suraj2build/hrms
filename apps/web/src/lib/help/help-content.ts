/**
 * Help & Guidance content registry.
 *
 * Route-keyed, step-by-step guidance shown in the Help drawer. Matching is
 * longest-prefix on the pathname, so more specific routes win. Every entry
 * explains WHAT the page is for, the STEPS to use it, and WHY it helps — so a
 * user can self-serve without leaving the page.
 */

export interface HelpStep {
  title:  string
  detail: string
}

export interface HelpEntry {
  /** Route prefix this entry matches (longest prefix wins) */
  match:   string
  title:   string
  summary: string
  steps:   HelpStep[]
  tips?:   string[]
  /** One-line "why this matters" */
  why?:    string
}

export const HELP_CONTENT: HelpEntry[] = [
  // ── Dashboards ────────────────────────────────────────────────────────────
  {
    match:   '/admin/dashboard',
    title:   'Workspace Overview',
    summary: 'Your daily command center — headcount, attendance health and the items that need action today.',
    why:     'Start here each morning to catch exceptions before they affect payroll.',
    steps: [
      { title: 'Read the KPI strip', detail: 'The cards at the top show live totals — total/active employees, present today, pending approvals. Numbers in **red or amber** need attention.' },
      { title: 'Clear the “Attention Required” panel', detail: 'These are blocking items (failed runs, SLA breaches). Click any row to jump straight to where you fix it.' },
      { title: 'Use Quick Actions', detail: 'The action grid is the fastest way to process attendance, add an employee, or open payroll.' },
      { title: 'Refresh after processing', detail: 'Hit **Refresh** (top right) once you’ve run attendance so the figures reflect the latest state.' },
    ],
    tips: ['The processing banner turns green when today’s attendance is processed — red means it failed and should be re-run.'],
  },
  {
    match:   '/admin/control-center',
    title:   'Control Center',
    summary: 'Cross-module operational overview — exceptions, KPIs and platform health in one view.',
    steps: [
      { title: 'Scan the exception tiles', detail: 'Each tile is a category of issues. A non-zero count is work waiting for you.' },
      { title: 'Drill into a tile', detail: 'Click a tile to open the module where the issue lives and resolve it.' },
    ],
  },

  // ── People / Employees ────────────────────────────────────────────────────
  {
    match:   '/admin/employees',
    title:   'People Operations',
    summary: 'Your live employee directory — search, filter, and open any employee’s full profile.',
    why:     'A complete, accurate directory is the foundation for payroll, attendance and compliance.',
    steps: [
      { title: 'Add an employee', detail: 'Click **Add Employee** (top right). Enter the core identity fields; you can complete bank, statutory and job details from the profile afterwards.' },
      { title: 'Find someone fast', detail: 'Use the search box (name, code, email) or the **Status / Access / Department / Location** filters to narrow the list.' },
      { title: 'Open a profile', detail: 'Click **Open Profile** on a row to view and edit everything — personal info, job history, bank & statutory IDs, documents.' },
      { title: 'Fix “No-login accounts”', detail: 'The stat card flags employees without a login. Open their profile to invite them so they can use self-service.' },
    ],
    tips: ['Statutory IDs (PAN, UAN, ESI, bank) are captured under the profile’s **Bank & Statutory** tab — completing them prevents filing rejections later.'],
  },
  {
    match:   '/admin/employees/',   // employee profile (deeper than list)
    title:   'Employee Profile',
    summary: 'The full record for one employee, organised into tabs.',
    steps: [
      { title: 'Move through the tabs', detail: 'Each tab (Personal, Job, Bank & Statutory, Documents…) loads its own section. Switch tabs to view or edit that area.' },
      { title: 'Keep statutory IDs complete', detail: 'Under **Bank & Statutory**, fill PAN, UAN, ESI and bank/IFSC — these feed payroll and statutory filings.' },
      { title: 'Save as you go', detail: 'Each section saves independently, so you can update one area without touching the rest.' },
    ],
  },

  // ── Onboarding ────────────────────────────────────────────────────────────
  {
    match:   '/admin/onboarding',
    title:   'Onboarding',
    summary: 'Invite candidates, collect documents, run AI review, and convert them to employees — in one flow.',
    steps: [
      { title: 'Invite a candidate', detail: 'Click **Invite Candidate / New Onboarding** and send the pre-join link. They submit their details and documents online.' },
      { title: 'Track the pipeline', detail: 'The stat cards show Total / Pending / Submitted / Approved. Work the pending items left to right.' },
      { title: 'Run AI Review', detail: 'On the **AI Review** tab, the system extracts and validates document data (Aadhaar, PAN, etc.). Resolve any flagged extraction errors.' },
      { title: 'Approve → create employee', detail: 'Approving a session creates the employee record automatically, so you don’t re-key data.' },
    ],
    why: 'Self-service onboarding removes manual data entry and the errors that come with it.',
  },

  // ── Attendance ────────────────────────────────────────────────────────────
  {
    match:   '/admin/attendance/center',
    title:   'Attendance Operations',
    summary: 'Real-time operational state — anomalies, corrections, staffing pressure and payroll-continuity gaps.',
    why:     'Resolving attendance exceptions here keeps payroll accurate and on time.',
    steps: [
      { title: 'Triage the metric chips', detail: 'Unresolved anomalies, pending corrections and **payroll gaps** are the priorities — a red chip means payroll accuracy is at risk.' },
      { title: 'Investigate a gap', detail: 'Click **Investigate** on the payroll-continuity alert to see which employees’ attendance doesn’t match payroll inputs.' },
      { title: 'Use the Operational Tools', detail: 'Jump to Muster Roll, Corrections, Regularisation or Anomalies to action items in bulk.' },
    ],
  },
  {
    match:   '/admin/attendance',
    title:   'Attendance',
    summary: 'Process daily attendance, review the muster, and manage corrections, shifts and overtime.',
    steps: [
      { title: 'Process attendance', detail: 'Run processing so raw punches become present/absent/LOP days. Do this before payroll.' },
      { title: 'Check the Muster Roll', detail: 'The month grid shows each employee’s daily status — spot gaps and absences at a glance.' },
      { title: 'Handle corrections', detail: 'Approve or reject regularisation/correction requests so the final attendance is clean.' },
    ],
    tips: ['Always process attendance for the full month before finalizing payroll, or LOP days may be wrong.'],
  },

  // ── Leave ─────────────────────────────────────────────────────────────────
  {
    match:   '/admin/leave',
    title:   'Leave',
    summary: 'Approvals, balances and the leave register for your team.',
    steps: [
      { title: 'Action pending requests', detail: 'Approve or reject leave from the approvals queue; rejections capture a reason.' },
      { title: 'Check balances', detail: 'Open balances to confirm an employee has enough leave before approving.' },
    ],
  },

  // ── Payroll ───────────────────────────────────────────────────────────────
  {
    match:   '/admin/payroll/center',
    title:   'Payroll Center',
    summary: 'Run, review and finalize the monthly payroll, with readiness checks before you lock it.',
    why:     'Finalizing here locks the month’s contributions so statutory filings and payouts are correct.',
    steps: [
      { title: 'Check readiness', detail: 'The KPI strip shows whether attendance is processed and inputs are complete. Clear any blockers first.' },
      { title: 'Run a dry-run', detail: 'Compute the payroll without locking to preview gross, deductions and net. Review variances.' },
      { title: 'Finalize the run', detail: 'When the numbers look right, **finalize** — this locks slips, advances/loan EMIs and statutory contributions.' },
      { title: 'Proceed to payout & filings', detail: 'After finalizing, move to payout and the Filing Pack for ECR/challans.' },
    ],
    tips: ['Slips move finalized → processed → paid through the cycle — analytics and registers count all of these as final.'],
  },
  {
    match:   '/admin/payroll/statutory-dashboard',
    title:   'Compliance Cockpit',
    summary: 'Statutory health, liabilities and exceptions for EPF / ESI / PT / TDS / LWF — at a glance.',
    why:     'Catch missing IDs and registration gaps before they cause filing rejections.',
    steps: [
      { title: 'Set the period', detail: 'Use the month picker (defaults to your latest finalized payroll month).' },
      { title: 'Read the health KPIs', detail: 'Total statutory liability, modules ready, open exceptions and ID completeness summarise where you stand.' },
      { title: 'Work the exceptions', detail: 'Each exception lists a **corrective step** and a Fix button — e.g. missing UAN/PAN, unconfigured registration, unfinalized payroll.' },
      { title: 'Fix missing IDs', detail: 'The “Employees Missing Statutory IDs” table drills to each person’s profile so you can complete PAN/UAN/ESI/bank.' },
    ],
  },
  {
    match:   '/admin/payroll/filing-pack',
    title:   'Filing Pack',
    summary: 'Generate ready-to-file statutory bundles — ECR 2.0, Form 24Q and consolidated challans.',
    steps: [
      { title: 'Run the readiness check', detail: 'A pre-flight verifies registrations and that payroll is finalized for the month.' },
      { title: 'Generate the artifact', detail: 'Export ECR (EPF), 24Q (TDS) or the challan sheet for the selected period.' },
    ],
  },
  {
    match:   '/admin/payroll',
    title:   'Payroll',
    summary: 'Run payroll and manage compensation, advances, loans and statutory components.',
    steps: [
      { title: 'Pick the task', detail: 'Use the left nav to choose Payroll Center, Loans & Advances, Variable Pay, or a statutory module.' },
      { title: 'Finalize before filing', detail: 'Statutory figures only populate once the month’s run is finalized.' },
    ],
  },

  // ── Reports / Analytics / Explorer ────────────────────────────────────────
  {
    match:   '/admin/reports/analytics',
    title:   'Analytics Studio',
    summary: 'Answer workforce questions instantly — pick a dataset, dimension, metric and period, then chart it.',
    why:     'No exports or report tickets — get the answer in a few clicks and drill into it.',
    steps: [
      { title: 'Choose a dataset', detail: 'Payroll, Headcount, Attendance, People, Leave, Compensation, Separation or Assets.' },
      { title: 'Group by a dimension', detail: 'e.g. Department, Location, Grade, Designation, Gender — then pick the **metric** and **period**.' },
      { title: 'Drill down', detail: 'Click a bar / slice / row to drill into the next level. The breadcrumb lets you step back.' },
      { title: 'Save or export', detail: 'Save the view for later, or export the data as CSV.' },
    ],
  },
  {
    match:   '/admin/explorer',
    title:   'Data Explorer',
    summary: 'Slice any dataset into a table, chain group-bys, and drill all the way down to the employee list.',
    steps: [
      { title: 'Pick a surface', detail: 'People, Payroll, Attendance, Leave, Separation or Assets.' },
      { title: 'Group & measure', detail: 'Choose a Group-By and a Metric; the summary stats (Count/Sum/Average/Median/%) update live.' },
      { title: 'Drill to people', detail: 'Click a row to drill in, level by level, ending in the actual **employee list** for that segment.' },
      { title: 'Export', detail: 'Download the current view as CSV or Excel.' },
    ],
  },
  {
    match:   '/admin/reports',
    title:   'Reports Hub',
    summary: 'All reporting, analytics and executive views in one place.',
    steps: [
      { title: 'Pick a category', detail: 'Operational registers, Analytics surfaces, or Executive read-outs.' },
      { title: 'Set the period', detail: 'Payroll-based reports default to your latest finalized month; change it with the month picker.' },
      { title: 'Export', detail: 'Most registers offer a server-generated .xlsx export with freeze panes and a metadata sheet.' },
    ],
  },

  // ── Setup / Configuration ─────────────────────────────────────────────────
  {
    match:   '/admin/settings/roles',
    title:   'Roles & Permissions',
    summary: 'Control who can see and do what across the admin portal (role-based access).',
    why:     'Right-sizing access keeps sensitive payroll/compliance data safe and the UI uncluttered for each role.',
    steps: [
      { title: 'Open the Permission Matrix', detail: 'The matrix lists every **module** down the side and each **role** across the top.' },
      { title: 'Toggle access', detail: 'Switch a module on/off for a role to grant or revoke it. Changes apply to the menu and route access.' },
      { title: 'Review roles', detail: 'Use the **Role Overview** tab to see each role’s summary before assigning it to users.' },
    ],
  },
  {
    match:   '/admin/settings/users',
    title:   'Users',
    summary: 'Manage who can log into the admin portal and which role they hold.',
    why:     'Every admin action is tied to a user + role — set these up before handing the system to your team.',
    steps: [
      { title: 'Add a user', detail: 'Create the login and **assign a role** (HR admin, manager, etc.). They receive access immediately.' },
      { title: 'Activate / deactivate', detail: 'Suspend access instantly when someone leaves — no need to delete the record.' },
    ],
  },
  {
    match:   '/admin/settings',
    title:   'Company Settings',
    summary: 'Your company profile, branding and the first-time **Getting Started** checklist.',
    why:     'Company details flow onto payslips, letters and statutory filings — get them right once, here.',
    steps: [
      { title: 'Complete the company profile', detail: 'Legal name, address and identifiers. These appear on official documents.' },
      { title: 'Upload your logo', detail: 'Used on payslips and letters for a branded experience.' },
      { title: 'Work the Getting Started checklist', detail: 'It walks you through the **essential setup** (structure, policies, first payroll) in order.' },
      { title: 'Tune Help & Guidance', detail: 'The **Help & Guidance** card controls whether this Guide appears, and for which roles/modules.' },
    ],
  },
  {
    match:   '/admin/organization',
    title:   'Departments & Org Structure',
    summary: 'Define departments, designations and the reporting hierarchy.',
    why:     'Structure drives approvals (who approves whom), analytics grouping, and access — build it before adding people.',
    steps: [
      { title: 'Create departments', detail: 'Add each department (e.g. Sales, Operations). Employees are grouped and reported by these.' },
      { title: 'Add designations', detail: 'Job titles within departments — used on letters and in analytics.' },
      { title: 'Set the hierarchy', detail: 'Define reporting lines so **manager approvals** route correctly.' },
    ],
  },
  {
    match:   '/admin/masters/grades',
    title:   'Grades & Pay Bands',
    summary: 'Salary grades/bands that anchor compensation and benchmarking.',
    why:     'Grades let you set consistent pay ranges and analyse compensation by band across the org.',
    steps: [
      { title: 'Create a grade', detail: 'Give it a name/level (e.g. L3, Manager Band).' },
      { title: 'Set the pay band', detail: 'Define the **min–max** salary range for the grade.' },
      { title: 'Map employees', detail: 'Assign grades via the employee’s job history; analytics can then group by grade.' },
    ],
  },
  {
    match:   '/admin/masters/work-locations',
    title:   'Work Locations',
    summary: 'The offices / sites employees are mapped to.',
    why:     'Location drives **state-specific PT/LWF rules**, attendance geofencing, and location analytics.',
    steps: [
      { title: 'Add a location', detail: 'Name, code and **state** — the state determines statutory rules that apply.' },
      { title: 'Assign employees', detail: 'Map people to a location via job history; payroll & compliance use it automatically.' },
    ],
  },
  {
    match:   '/admin/masters',
    title:   'Reference Data',
    summary: 'The lookup/master data (categories, types, codes) that keeps records consistent.',
    why:     'Defining masters once prevents typos and mismatches that break filtering and reporting.',
    steps: [
      { title: 'Pick a master', detail: 'Choose the list to manage (document types, asset categories, cost centers, etc.).' },
      { title: 'Add or edit entries', detail: 'Keep them tidy — these appear as dropdown options across the app.' },
    ],
  },
  {
    match:   '/admin/leave-types',
    title:   'Leave Types',
    summary: 'Define the kinds of leave employees can apply for (CL, SL, PL, EL…).',
    why:     'Leave types are the foundation of the whole leave module — applications, balances and accruals all reference them.',
    steps: [
      { title: 'Add a leave type', detail: 'Set a name and **code** (e.g. CL).' },
      { title: 'Set the rules', detail: 'Paid/unpaid, max days, whether it needs approval.' },
      { title: 'Activate it', detail: 'Active types become selectable when employees apply for leave.' },
    ],
  },
  {
    match:   '/admin/leave-policy',
    title:   'Leave Policies',
    summary: 'How leave is earned and governed — accrual, eligibility, carry-forward and encashment.',
    why:     'Policies turn leave types into rules the system enforces automatically each month.',
    steps: [
      { title: 'Configure accrual & eligibility', detail: 'Set how much leave accrues, for whom, and from when.' },
      { title: 'Set windows & lifecycle', detail: 'Application windows, carry-forward and encashment rules.' },
      { title: 'Save & simulate', detail: 'Use the **Policy Simulator** to test the rules before rolling them out.' },
    ],
  },
  {
    match:   '/admin/attendance/policy',
    title:   'Attendance Policy',
    summary: 'The rules that turn raw punches into present / late / half-day / LOP.',
    why:     'These thresholds directly affect payroll — a wrong grace period can over- or under-pay.',
    steps: [
      { title: 'Set grace & late rules', detail: 'Define the **grace period** and when a late mark or half-day applies.' },
      { title: 'Configure OT & LOP', detail: 'Overtime eligibility and loss-of-pay treatment.' },
      { title: 'Save', detail: 'The next attendance processing run uses the new rules.' },
    ],
  },
  {
    match:   '/admin/shift-master',
    title:   'Shifts',
    summary: 'Define working-hour patterns that get assigned to employees and rosters.',
    why:     'Shifts tell the system the expected in/out times, which attendance is measured against.',
    steps: [
      { title: 'Create a shift', detail: 'Set start/end time and break; mark it active.' },
      { title: 'Assign via rosters', detail: 'Apply shifts to employees through the shift roster.' },
    ],
  },
  {
    match:   '/admin/holidays',
    title:   'Holiday Calendar',
    summary: 'Public holidays and weekly-offs for the year, grouped by location/policy.',
    why:     'Holidays feed working-days and LOP calculations — keeping payroll accurate.',
    steps: [
      { title: 'Add holidays', detail: 'Enter the year’s public holidays.' },
      { title: 'Use holiday groups', detail: 'Group holidays by region, then assign the group to employees.' },
    ],
  },
  {
    match:   '/admin/setup',
    title:   'Setup',
    summary: 'Define the masters, policies and structures the rest of the system runs on.',
    why:     'Configure once here, and every operational module behaves consistently.',
    steps: [
      { title: 'Build your structure', detail: 'Set up departments, designations, grades and work locations before adding employees.' },
      { title: 'Configure policies', detail: 'Leave types, attendance and payroll policies define how the system calculates everything.' },
    ],
  },
]

/** Default shown when no specific entry matches the route. */
export const DEFAULT_HELP: HelpEntry = {
  match:   '',
  title:   'Getting around CognixHR',
  summary: 'Every screen has guidance like this. Here’s how to find your way.',
  steps: [
    { title: 'Use the top tabs', detail: 'The top navigation switches between domains (Operations, Workforce, Attendance, Payroll, Compliance, Reports…). The left sidebar shows pages within the current domain.' },
    { title: 'Search anything', detail: 'Open **Search (⌘K)** from the bottom-right to jump to any page, employee or action by name.' },
    { title: 'Open this Guide on any page', detail: 'Click the **?** button (next to Search) for step-by-step help tailored to the page you’re on.' },
  ],
  tips: ['Look for KPI strips at the top of operational pages — coloured numbers (red/amber) always mean “needs attention”.'],
}

/** Resolve the best help entry for a pathname (longest matching prefix). */
export function getHelpForPath(pathname: string): HelpEntry {
  let best: HelpEntry | null = null
  for (const entry of HELP_CONTENT) {
    if (entry.match && pathname.startsWith(entry.match)) {
      if (!best || entry.match.length > best.match.length) best = entry
    }
  }
  return best ?? DEFAULT_HELP
}
