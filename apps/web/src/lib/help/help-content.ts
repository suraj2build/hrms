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
  /** Optional deep-link: jump to this route for the step */
  to?:     string
  /** Optional action to perform on arrival (e.g. open the create dialog) */
  action?: 'new'
  /** Button label for the deep-link (defaults to "Take me there") */
  cta?:    string
}

/** A prominent call-to-action shown at the top of a runbook. */
export interface HelpAction {
  label:   string
  to:      string
  action?: 'new'
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
  /** Runbook category override (otherwise derived from the route) */
  category?: string
  /** Quick-action deep-links shown as buttons at the top of the runbook */
  actions?:  HelpAction[]
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
    why:     'A single place to spot issues across modules means nothing slips through before it affects payroll or compliance.',
    steps: [
      { title: 'Scan the exception tiles', detail: 'Each tile is a category of issues. A non-zero count is work waiting for you.' },
      { title: 'Drill into a tile', detail: 'Click a tile to open the module where the issue lives and resolve it.' },
    ],
  },

  // ── People / Employees ────────────────────────────────────────────────────
  {
    match:    '/admin/employees/new',
    title:    'Add an employee (manually)',
    summary:  'Create an employee in three steps — basic identity, initial job placement, then review & onboard.',
    why:      'For hires you enter directly (not via the candidate onboarding portal). Statutory & bank details are completed afterwards on the profile.',
    category: 'People & Workforce',
    actions: [
      { label: 'Add Employee', to: '/admin/employees/new' },
    ],
    steps: [
      { title: 'Basic information', detail: 'Enter **First/Last Name**, **Work Email**, optional phone, and the **Joining Date**, then **Continue**.', to: '/admin/employees/new', cta: 'Add Employee' },
      { title: 'Initial job placement', detail: 'Set **Employment Type** (required) and, optionally, Department, Designation, Grade, **Reporting Manager**, Site, **Roster**, Work Location and Cost Center, then **Continue**.' },
      { title: 'Review & onboard', detail: 'Check the summary and click **Create Employee** — it creates the record plus the first job-history entry and opens the profile.' },
      { title: 'Complete statutory & pay', detail: 'On the profile, add **PAN/UAN/ESI** and **bank** details and assign a **salary structure** — payroll needs these or it raises a held slip.' },
    ],
    tips: ['Job details (manager, department, site) can all be changed later from the profile.'],
  },
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
    why:     'Complete, accurate profile data is what payroll and statutory filings draw from — gaps here surface as held slips later.',
    steps: [
      { title: 'Move through the tabs', detail: 'Each tab (Personal, Job, Bank & Statutory, Documents…) loads its own section. Switch tabs to view or edit that area.' },
      { title: 'Keep statutory IDs complete', detail: 'Under **Bank & Statutory**, fill PAN, UAN, ESI and bank/IFSC — these feed payroll and statutory filings.' },
      { title: 'Save as you go', detail: 'Each section saves independently, so you can update one area without touching the rest.' },
    ],
  },

  // ── Onboarding ────────────────────────────────────────────────────────────
  {
    match:   '/admin/onboarding',
    title:   'Onboard a new joiner (invite → approve)',
    summary: 'Invite a candidate to a pre-join portal, let them submit details + documents, run AI review, then approve to auto-create the employee.',
    why:     'Self-service onboarding removes manual data entry and the errors that come with it — approval creates the employee with no re-keying.',
    actions: [
      { label: 'Open Onboarding', to: '/admin/onboarding' },
    ],
    steps: [
      { title: 'Invite the candidate', detail: 'On the **Invites** tab click **+ Invite Candidate**; enter name, email, phone, designation/department and **Joining Date**, then **Send Invite**. Copy the pre-join link and share it.', to: '/admin/onboarding', cta: 'Open Onboarding' },
      { title: 'Candidate submits online', detail: 'They open the link and fill personal, address, bank and compliance (PAN/Aadhaar/UAN) details, upload documents, accept the declaration and **Submit**. Status moves Pending → Submitted.' },
      { title: 'Run AI Review', detail: 'On the **AI Review** tab open a submitted candidate. The system extracts document data with confidence scores and flags issues (bad PAN format, mismatches). Fix any extraction errors inline.' },
      { title: 'Handle re-hire matches', detail: 'If the candidate matches an existing person (email/phone/PAN/Aadhaar), choose **Rehire** (reuse the record) or **Create as New Employee**.' },
      { title: 'Approve → employee created', detail: 'Click **Approve** — the employee record is created automatically from the submitted data. Open their profile to set department, manager and site if needed.' },
    ],
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
    title:   'Process daily attendance',
    summary: 'Turn raw punches into present / late / LOP days, review the muster, clear corrections, then finalize for payroll.',
    why:     'Payroll’s loss-of-pay depends on this — always process and finalize the full month before running payroll.',
    actions: [
      { label: 'Open Attendance', to: '/admin/attendance' },
    ],
    steps: [
      { title: 'Process the day/month', detail: 'On **Attendance Operations**, pick a date and click **Process Attendance** — raw logs become daily present/late/LOP records. The run dialog shows counts and any errors.', to: '/admin/attendance', cta: 'Open Attendance' },
      { title: 'Or upload punches (CSV)', detail: 'Expand **Bulk Upload**, drop a CSV (employee_code, date, in_time, out_time), review the preview, then **Upload & Process**.' },
      { title: 'Review the Muster Roll', detail: 'Open the **Muster Roll** to see each employee’s daily status, work hours and late minutes. Click a row for punch-level detail.', to: '/admin/attendance/muster', cta: 'Open Muster' },
      { title: 'Clear corrections', detail: 'On **Regularisation**, approve or reject correction requests (missing punch, status change) so the final attendance is clean.' },
      { title: 'Finalize for payroll', detail: 'Once corrections are done, **finalize** the month — it locks the muster so payroll can compute LOP accurately.' },
    ],
    tips: ['Re-processing a date that’s already done warns you — only force re-process if the prior run failed.'],
  },

  // ── Leave ─────────────────────────────────────────────────────────────────
  {
    match:   '/admin/leave',
    title:   'Leave: set up, then approve',
    summary: 'Define leave types and policy (accrual, eligibility, windows), then run day-to-day approvals and balances.',
    why:     'Leave types and a configured policy must exist before employees can apply — after that, the daily job is just approvals.',
    actions: [
      { label: 'Open Approvals', to: '/admin/leave/approvals' },
    ],
    steps: [
      { title: 'Define leave types', detail: 'In **Leave Types**, add each type (e.g. Casual Leave) and mark it paid / active.', to: '/admin/leave-types', cta: 'Open Leave Types' },
      { title: 'Configure the policy', detail: 'In **Leave Policy**, pick a type and set **Accrual** (monthly / quarterly / yearly / upfront), days per year, carry-forward, eligibility and application windows, then **Save Policy**.', to: '/admin/leave-policy', cta: 'Open Leave Policy' },
      { title: 'Employees apply', detail: 'Staff apply from ESS (type, dates, session, reason); the system checks balance and policy windows.' },
      { title: 'Approve or reject', detail: 'Work the **Approvals** queue — approving deducts balance per policy timing; rejections capture a reason.', to: '/admin/leave/approvals', cta: 'Open Approvals' },
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
    why:     'Generating from finalized payroll gives you portal-ready files, so filings go through without manual rework or rejections.',
    steps: [
      { title: 'Run the readiness check', detail: 'A pre-flight verifies registrations and that payroll is finalized for the month.' },
      { title: 'Generate the artifact', detail: 'Export ECR (EPF), 24Q (TDS) or the challan sheet for the selected period.' },
    ],
  },
  {
    match:   '/admin/payroll',
    title:   'Run monthly payroll',
    summary: 'Create a run, process salaries (attendance, deductions, statutory), resolve held slips, approve to freeze, then generate payslips, bank file and statutory outputs.',
    why:     'Statutory figures and payslips only populate once the run is finalized — and payroll needs attendance finalized first.',
    actions: [
      { label: 'Open Payroll', to: '/admin/payroll' },
    ],
    steps: [
      { title: 'Finish prerequisites', detail: 'Ensure **attendance is finalized**, employees have a **salary structure**, and statutory IDs (PAN/UAN/ESI) + bank details are on file — gaps create held slips.', to: '/admin/attendance', cta: 'Open Attendance' },
      { title: 'Create the run', detail: 'On **Payroll Runs / Run Console**, click **Create Payroll Run**, pick the **Month**, then **Start Processing** — salaries, LOP, deductions and statutory are computed.', to: '/admin/payroll', cta: 'Open Payroll' },
      { title: 'Review exceptions', detail: 'Open the run to see totals (gross / deductions / net) and the **Exceptions** drawer of **held** (blocking) and **warning** slips. Fix held slips on the employee’s profile, then re-run.' },
      { title: 'Approve & freeze', detail: 'When clean, **Approve Payroll** — the run freezes (immutable) and is ready for payout.' },
      { title: 'Generate outputs', detail: 'From the **Payroll Center**, generate **payslips**, the **bank file**, and statutory outputs (ECR / ESI / 24Q). Employees download payslips from ESS.', to: '/admin/payroll/center', cta: 'Open Payroll Center' },
    ],
    tips: ['Once frozen, a run can’t be edited — that preserves the audit trail. Reopen only if absolutely necessary.'],
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
    why:     'Drilling from a number straight to the people behind it lets you verify the figure and act on it without exporting.',
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
    why:     'Pulling reports from a single hub against the right finalized period keeps the numbers you share consistent and audit-ready.',
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
    match:   '/admin/masters/states',
    title:   'Set up States',
    summary: 'The India state/UT master — the statutory axis for every site (GST code, Professional Tax and Labour Welfare Fund applicability).',
    why:     'States drive PT/LWF rules for all employees at a site. They are seeded for you; you usually just review the flags.',
    actions: [
      { label: 'Open States', to: '/admin/masters/states' },
      { label: 'Add a State', to: '/admin/masters/states', action: 'new' },
    ],
    steps: [
      { title: 'Open the States master', detail: 'States are pre-seeded for India with GST codes and default PT/LWF flags.', to: '/admin/masters/states', cta: 'Open States' },
      { title: 'Review PT / LWF flags', detail: 'Confirm **Professional Tax** and **Labour Welfare Fund** applicability per state; set the LWF frequency where it applies.' },
      { title: 'Add a missing state', detail: 'Rarely needed, but you can add a state with its GST code and name.', to: '/admin/masters/states', action: 'new', cta: 'Add State' },
    ],
  },
  {
    match:   '/admin/masters/clusters',
    title:   'Create a Cluster',
    summary: 'Clusters are the operational grouping of sites (Region → Cluster → Site) and carry a cluster manager.',
    why:     'A cluster manager automatically gains visibility over the employees working at that cluster’s sites — set this up before assigning sites.',
    actions: [
      { label: 'Open Clusters', to: '/admin/masters/clusters' },
      { label: 'New Cluster', to: '/admin/masters/clusters', action: 'new' },
    ],
    steps: [
      { title: 'Open the Clusters master', detail: 'Go to the Clusters page under Organization.', to: '/admin/masters/clusters', cta: 'Open Clusters' },
      { title: 'Create a cluster', detail: 'Enter a name and code, optionally a region and parent cluster for multi-level roll-ups.', to: '/admin/masters/clusters', action: 'new', cta: 'New Cluster' },
      { title: 'Assign a cluster manager', detail: 'Pick the employee who manages the cluster — they gain RBAC visibility over employees at the cluster’s sites.' },
    ],
  },
  {
    match:   '/admin/masters/sites',
    title:   'Create & configure a Site',
    summary: 'Sites are your campuses/branches. Each links to a State (statutory) and a Cluster (operational), plus address, statutory IDs and governance defaults.',
    why:     'Sites anchor where people work — they drive statutory jurisdiction, holiday calendars and roster/leave defaults that employees inherit.',
    actions: [
      { label: 'Open Sites', to: '/admin/masters/sites' },
      { label: 'New Site', to: '/admin/masters/sites', action: 'new' },
    ],
    steps: [
      { title: 'Set up States & Clusters first', detail: 'Sites reference both — seed your **States** and create your **Clusters** before adding sites.', to: '/admin/masters/clusters', cta: 'Open Clusters' },
      { title: 'Create the site', detail: 'Click **New Site**, then fill Basics (name, short name, timezone) and pick the **State** and **Cluster**.', to: '/admin/masters/sites', action: 'new', cta: 'New Site' },
      { title: 'Complete address & statutory', detail: 'Add the address, GSTIN and PF/ESI/PT/LWF registration numbers in the Statutory section.' },
      { title: 'Set governance defaults', detail: 'Choose the default Roster, Rotation, Leave policy and Holiday group — employees at this site inherit these.' },
    ],
  },
  {
    match:   '/admin/import',
    title:   'Import master data (CSV)',
    summary: 'Bulk-load masters and records from CSV — download a template, fill it, upload and validate.',
    why:     'Importing in the right order (States → Clusters → Sites → Work Locations → Employees) keeps references intact.',
    actions: [
      { label: 'Open Import', to: '/admin/import' },
    ],
    steps: [
      { title: 'Open the Import workspace', detail: 'Pick the master you want to load.', to: '/admin/import', cta: 'Open Import' },
      { title: 'Download the template', detail: 'Each master has a CSV template with the required and optional columns.' },
      { title: 'Upload & validate', detail: 'Upload your filled CSV; fix any rows the validator flags, then confirm the import. Import **States and Clusters before Sites**.' },
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
    match:    '/admin/shift-master',
    title:    'Create a Shift',
    summary:  'Define a working-hour pattern (start/end time, grace, overnight) that attendance is measured against and that gets assigned via rosters.',
    why:      'Shifts are the foundation of attendance and scheduling — create them before building rosters or assigning schedules.',
    category: 'Attendance & Roster',
    actions: [
      { label: 'Open Shifts', to: '/admin/shift-master' },
    ],
    steps: [
      { title: 'Open the Shifts page', detail: 'Go to **Shift Definitions**. Existing shifts are listed in the table below the form.', to: '/admin/shift-master', cta: 'Open Shifts' },
      { title: 'Click “Add Shift”', detail: 'Use the **Add Shift** button (top-right) to start a new shift.' },
      { title: 'Enter the timing', detail: 'Fill **Shift Name** (e.g. “Morning”), an optional **Shift Code** (e.g. MRN), and the **Start Time** and **End Time**.' },
      { title: 'Set grace & overnight', detail: 'Set **Grace Minutes** (the late buffer, default 15). Tick **Night shift** if it spans midnight. Leave **Active** on.' },
      { title: 'Create it', detail: 'Click **Create Shift** — it appears in the table and becomes selectable in rosters.' },
    ],
    tips: ['Shifts define **timing only**. Weekly-off days (Sat/Sun) are set in Roster Templates, not here.'],
  },
  {
    match:    '/admin/masters/rosters',
    title:    'Build a Roster Template (weekly-off pattern)',
    summary:  'A reusable weekly-off pattern — which days are off — over a 7 / 14 / 28-day cycle, applied to employees to drive their working days.',
    why:      'Roster templates let you apply a consistent week pattern to many employees at once. Set them up before building the monthly roster.',
    category: 'Attendance & Roster',
    actions: [
      { label: 'Open Roster Templates', to: '/admin/masters/rosters' },
    ],
    steps: [
      { title: 'Open Roster Templates', detail: 'Existing templates show with their cycle badge (e.g. “7-day”).', to: '/admin/masters/rosters', cta: 'Open Templates' },
      { title: 'Click “Add Template”', detail: 'Opens the template dialog.' },
      { title: 'Name it & pick a cycle', detail: 'Enter a **Name** (e.g. “5-Day Standard”), an optional **Code**, and a **Cycle** (7 / 14 / 28-day).' },
      { title: 'Choose the weekly-offs', detail: 'In the day grid, click the days that are **off** (e.g. Sat + Sun). The **2-week preview** shows work days vs off days.' },
      { title: 'Save', detail: 'Click **Save**. You can now apply this template to employees from the Shift Roster.' },
    ],
    tips: ['No shifts are chosen here — the template only defines off-days. You pick the shift for work-days when you apply the template in the roster.'],
  },
  {
    match:    '/admin/roster',
    title:    'Schedule shifts on the monthly Roster',
    summary:  'The calendar grid where you assign shifts to employees — day-by-day, in bulk, or by applying a roster template. This is the main scheduling screen.',
    why:      'This is where coverage actually gets planned; coverage gaps and fatigue (5+ consecutive work days) are flagged at the top.',
    category: 'Attendance & Roster',
    actions: [
      { label: 'Open Shift Roster', to: '/admin/roster' },
    ],
    steps: [
      { title: 'Set up shifts & templates first', detail: 'You need **Shifts** (and optionally **Roster Templates**) before scheduling.', to: '/admin/shift-master', cta: 'Open Shifts' },
      { title: 'Open the roster & pick the month', detail: 'Rows are employees, columns are days. Use the month navigator and the **location filter** to focus.', to: '/admin/roster', cta: 'Open Roster' },
      { title: 'Assign a single day', detail: 'Click any cell and pick a shift from the dropdown. Choose **“✕ Clear”** to remove a day override.' },
      { title: 'Assign in bulk', detail: 'Click **Bulk Assign**, tick the employees, set a **From/To** date range (or a week preset), choose a **Shift**, then **Assign to N employees**.' },
      { title: 'Apply a template', detail: 'Click **Apply Template**, pick employees + date range, choose a **Roster Template** and a **Shift for Work Days**, then **Apply** — off-days come from the template, the shift fills the work-days.' },
      { title: 'Copy last week', detail: 'In Bulk Assign, select employees and a target week, then **Copy Previous Week** to repeat the prior week’s pattern.' },
    ],
    tips: ['A **blue pill** is a day-specific override; a **muted pill** is the standing shift; **“Off”** is a weekly-off from the template.', 'If payroll is locked for the period, a lock banner appears and editing is restricted.'],
  },
  {
    match:    '/admin/employee-shifts',
    title:    'Apply a shift override to an employee',
    summary:  'Set or change a single employee’s standing shift from a given date — for exceptions, not bulk scheduling.',
    why:      'Use this for one-off reassignments; for regular scheduling use the monthly Shift Roster instead.',
    category: 'Attendance & Roster',
    actions: [
      { label: 'Open Shift Overrides', to: '/admin/employee-shifts' },
    ],
    steps: [
      { title: 'Open Shift Overrides', detail: 'The left panel lists employees — search by name/code or filter by work location.', to: '/admin/employee-shifts', cta: 'Open Overrides' },
      { title: 'Pick the employee', detail: 'Click a row to select them; the apply panel opens on the right.' },
      { title: 'Choose shift & date', detail: 'Select the **Shift** and an **Effective From** date (defaults to today).' },
      { title: 'Apply', detail: 'Click **Apply Override**. The **Override History** tab shows past assignments; the **✕** removes a current override.' },
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
