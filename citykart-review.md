# Citykart HRMS — Screen-by-Screen Review

**URL:** https://citykart.cloudzmall.com
**Role logged in as:** HR (role switcher also offers "Workforce Management" and a tenant/company selector "CSPL")
**Reviewed:** 2026-10-11
**Purpose:** Walk every reachable screen of Citykart's HRMS, document layout/data/actions, and use it as a comparison point for simplifying CognixHR's own navigation and screens.

> Screenshots were captured and visually reviewed live during this session (shown inline in the chat transcript). The browser tool used here does not expose a "save screenshot to disk" capability, so this file documents each screen in detailed prose/data form rather than embedding image files.

---

## 1. Global shell / navigation

**Sidebar (left, fixed, ~220px wide, pink/maroon brand color `#8E2436`-ish on active state, Citykart shopping-cart logo at top):**

Flat list, 13 top-level items, several expand in place (accordion, not a flyout) to reveal sub-items:

1. **Dashboard** — no sub-items
2. **Employee** ▸ expands to: Employee, Transfer, Resignations, PIP, Absconding Cases, Feedbacks
3. **Warehouse** ▸ (not yet expanded — see below)
4. **Confirmation** ▸
5. **Transfer** ▸ *(duplicate label — also exists nested inside "Employee")*
6. **Promotion Request** ▸ expands to: Manager Recommended, System Recommended
7. **Academy** ▸
8. **Employee Clearance** ▸
9. **Letters** — no expand arrow (direct link)
10. **Organisation Structure** — no expand arrow
11. **HR Policies** — no expand arrow
12. **Reports**
13. **Requests**

Below the nav list, pinned at the bottom, is a 3-row **context switcher**: `HR` / `Workforce Ma...` (Workforce Management) / `CSPL`, each its own dropdown, followed by **Log out**. These look like three independent selectors stacked vertically rather than one coherent control — this turns out to be the single most important piece of navigation in the whole app (section 15).

**Top bar (dashboard only):** page title on the left, and on the right a `Select Location` dropdown + a `Select Department` dropdown (defaulted to "HR") with a clear (×) button. Other pages replace this with page-specific controls (tabs, search, filters, primary actions) — there's no single persistent top bar across pages.

**Interaction quirk worth noting:** clicking a sidebar row via a plain simulated mouse click intermittently failed to register in this app (it uses custom pointer-event handling rather than standard click semantics); had to fall back to dispatching a native `.click()`. Not something an end-user would hit with a real mouse/trackpad, but a flag that the sidebar's hit-testing is non-standard.

---

## 2. Dashboard

**Layout:** top bar with "Dashboard" title + Location/Department filters. Below it, a row of **6 stat cards**: Active Employees (8), Resigned (0), Attrition Rate (0%), New Joinees (0), Exits This Month (0), Open Positions (0) — each with a small icon and a tiny sparkline trend.

Below that, a full-width **"Employee Growth Trend"** line chart — headcount over the last 12 months (Nov–Oct), axis 0–12.

Below the chart, a **3-column row**:
- **Today's Activities** — list of activity items with a colored status pill, e.g. "0 Interview scheduled this week — Software Engineer, Product Manager roles [Recruitment]", "Onboarding in progress: 2 [Pending]".
- **Celebrations 🎉** — two mini-stats (Birthdays 0, Anniversaries 0) plus an illustrated empty state ("No celebrations today").
- **Recent Joiners** — illustrated empty state ("No recent joiners found").

No widgets for pending approvals, leave balance, or payroll on this dashboard — it's purely a headcount/recruiting-flavored summary for an HR admin, not a self-service/ESS-style dashboard.

---

## 3. Employee section (sidebar: Employee)

Expands to 6 sub-items: **Employee, Transfer, Resignations, PIP, Absconding Cases, Feedbacks**.

### 3.1 Employee (list)

- Status tabs across the top: **Draft, Active, Inactive, Abscond, On Notice, Terminated, All**
- Right side: search box, a sort/density icon, **Filters** button, **+ Add Employee** (red primary button), **Import**
- Table columns: avatar+name+code, Current Desg, Department, Location, Reporting Manager(s) (with their own mini-avatar), Tenure — each column sortable
- Pagination footer: "1-20 of 31", page 1/2
- Row click → opens the employee's full profile (see 3.3)
- **Filters panel**: opens as a popover anchored to the Filters button, not a full page. Two-pane layout — left list of filter categories (Department, Designation, Location, Location Type, Gender), right pane shows a searchable checkbox list for whichever category is selected. For "Location" specifically, the list is a long **flat, unpaginated list of 50+ raw store codes** (e.g. `STORE-OPS-VSW`, `STORE-OPS-VSH`, …) with no grouping — a real usability rough edge: an HR admin has to scroll/search a flat code soup to find a store, rather than something hierarchical (region → cluster → store).

### 3.2 Add Employee (wizard)

Clicking **+ Add Employee** opens a **7-step wizard** (breadcrumb: "Employee List › New"):

1. **Store Details** — Profile Photo upload, then "Store & Employment Details" with **28 fields on this single step alone**: Title, First Name, Middle Name, Last Name, DOB, Joining Date, Employment Type, Is Geotagging Allowed, Booking Location, Base Location, Department, Designation, Grade, Band, Preferred Location, Preferred State, Reporting Manager, Last Working Day, Notice Period, Bonus Applicable, ESI No., Relative in Company, Fingerprint Registered, Cost Centre Code, Cluster, Region, State
2. **Personal**
3. **Experience**
4. **Family**
5. **Id & Bank Details**
6. **Nomination**
7. **Others**

The step tabs are **gated** — you can't jump ahead to step 2+ without passing validation on step 1 (didn't fill the form in to avoid creating a real employee record in this live tenant). Cancel/Next buttons bottom-right. This is a genuinely heavy onboarding flow — 7 full steps just to add one employee, with step 1 alone denser than most entire forms.

### 3.3 Employee Profile (detail view)

URL pattern: `/employee-list-hr/employeeId:<id>/view`. Header: avatar, name, designation, `EMP CODE`, status pill (Active/etc.), email, Reporting Manager, plus **Export** and **View Applicant** buttons. A **Profile Completeness** bar (e.g. "62%") with "Missing: Middle Name, Spouse Name, Grade +41 more" — implying **40+ trackable profile fields** per employee in total.

**9 tabs**: General, Personal, Experience, Qualification, Attendance, Nomination, Attachments, Academy Eligibility, Employment History.

- **General** — Profile & Identity, Employment Details (incl. Cost Centre, Cluster, Region, State), Govt. IDs (Aadhar/PAN/Passport/DL), Address (present + permanent, each with 7 fields) — all on one long scrolling page, no sub-tabs.
- **Personal** — Contact & Identity (marital status, mobile, personal email, nationality, religion, blood group, category, smoke/alcohol/physically-challenged flags, uniform size, jeans size!), Emergency Contact.
- **Qualification** — Highest Qualification, Total Work Experience, a repeatable Educational Qualifications table with uploaded proof-copy attachments.
- **Attendance** (this is the *only* place attendance shows up on an individual employee — see note below) — Schedule Information, Shift Information, Card Number Information (a full reissue history table, e.g. "Lost Card" reason), Leave Policy Information. This is **attendance configuration**, not a punch log or calendar — no daily present/absent grid here.
- **Employment History** — rolls up **Promotions**, **Transfers**, **Probation Confirmation**, and **Internship Confirmation** into one page, each its own empty-state table until something happens to the employee. This is the single feed that the Confirmation/Transfer/Promotion Request workflows (sections 6–8) write into.
- Nomination, Attachments, Academy Eligibility were seen in the tab list but not opened in depth.

**Note on where "Attendance" and "Payroll" actually live:** they are **not** top-level sidebar items in the HR module at all. The HR sidebar you see by default is only one of several **modules** reachable via a module switcher tucked at the very bottom of the sidebar (see section 12) — this surprised us enough that it's worth flagging up front before the rest of this doc.

---

## 4. Warehouse (sidebar: Warehouse)

Expands to: **Contractors, Off-Roll Approvals, Function Transfer Requests(HR), Productivity Dashboard(HR)**. This whole section is labor/contractor management specific to retail warehouse operations — not something a typical office-only HRMS would need.

- **Contractors** — Active/Inactive tabs, Search, Filters, +Add Contractor, Import. Table: Contractor, Contact Person, Warehouse(s), License Validity, Agreement End.
- **Off-Roll Approvals** ("Off-Roll Manpower Approvals") — Pending Review/Approved/Rejected tabs. Table: Employee Code, Name, Contractor, Skill Category, Warehouse, Department, Designation, Joining Date, Status. Approves contract/off-roll labor onto warehouse floors.
- **Function Transfer Requests(HR)** — Pending/Approved/Rejected tabs, +Add Request, Import. Table: Employee, Location, From Function, To Function, Effective From, Reason.
- **Productivity Dashboard(HR)** ("Employee Productivity") — date + employee + "Warehouse Operation" filters, +Add Productivity, Import. Stat cards: Total Employees, Total Done Qty, Total Hrs, Avg Unit/Hr. Table: Employee, Function (Activity Type), Work Reference, Time & Hrs, Output, Performance, Action — a units-per-hour labor-productivity tracker, more warehouse-management-system than HRMS.

---

## 5. Confirmation (sidebar: Confirmation)

Expands to: **Internship, Probation**. Both are review queues, not data-entry forms:

- **Probation** ("Probation Confirmation") — tabs Manager Feedback Pending / Extended / Closed. Table: Employee, Designation, Reporting To, Due on — with an explicit **OVERDUE** red badge on rows past their due date. 3-dot row action menu per row (not opened).
- **Internship** ("Internship Confirmation") — identical structure/tabs, empty in this tenant.

These feed the "Probation Confirmation" / "Internship Confirmation" tables on the Employee Profile → Employment History tab (section 3.3).

---

## 6. Transfer (top-level sidebar item)

Expands to a single sub-item, **Employee Transfer** (distinct from the "Transfer" sub-item nested inside the Employee menu, which is likely the same underlying feature surfaced in two places in the nav).

- Status tabs: All / Pending Approval / Approved / Started / Rejected / Completed
- Date-range filter, **+ Add Employee Transfer**, Import
- Table columns (wide — 12 columns): Employee, From Location, To Location, From Date, To Date, Category (e.g. "Deputation"), Distance (KM), Amount, Reason, Status, Created By, Created On

---

## 7. Promotion Request (sidebar: Promotion Request)

Expands to: **Manager Recommended, System Recommended** — two separate inboxes for the same approval action depending on where the promotion was initiated from.

- **Manager Recommended** — tabs Submitted(1)/Completed(0)/Rejected(0). Table: Employee, Requested By, Designation, Applicable Grade (e.g. "L04 → L05"), Cycle (e.g. "Q3 2026"), Applicable Date, with inline **Approve / Reject** row actions — directly actionable, no need to open a detail page.
- **System Recommended** — identical structure, empty in this tenant (presumably driven by the Academy module's eligibility criteria, see section 8).

---

## 8. Academy (sidebar: Academy)

Expands to: **Academy Dashboard, Assessment Rounds, Batches**. This is an internal career-ladder / L&D program manager — define a path from one designation to another, with eligibility and assessment gating.

- **Academy Dashboard** — **+ Create Academy**. List of defined "academies", e.g. "Div to ASM: Division Incharge → ASM-Trainee" and "Test Academy: Billing Associate → Senior Manager", each showing Eligible Employees count and Batch Running count, with an Edit action.
- **Assessment Rounds** — table: Academy, Employees, Assessment Deadline, Status (Completed/etc.) — the test/evaluation step employees go through.
- **Batches** — table: Batch, Academy, Designation, Employees, Start Date, Status, Push Error — the cohort/training-batch tracker (empty in this tenant).

---

## 9. Employee Clearance (sidebar: Employee Clearance)

Expands to: **No Dues, FNF** — exit/offboarding workflow.

- **No Dues** — Pending/Processing/Completed tabs, Filters. Table: Employee, Department, Designation, Reporting To, Relieving, **Dept. Clearance / Manager Clearance / Self Clearance** (shown as fraction, e.g. "0/3"), overall status (PENDING / UNAPPROVED). A multi-party sign-off checklist condensed into one row per exiting employee.
- **FNF** (Full & Final settlement) — Pending/Generate/Completed tabs, **Download FNF Report**. Table: Employee, Relieving Date, Designation, Reporting To, Department.

---

## 10. Letters (sidebar: Letters, no sub-items)

Tabs: Pending / Approved / Sent / Rejected. **Generate Logs**, **+ Add Letter**. Table: Employee, Letter Type, Letter, Status, Created By, Created On, Sent, **Acknowledgement** — tracks not just whether a letter (offer/relieving/experience/etc.) was generated and approved, but whether the employee acknowledged receiving it.

---

## 11. Organisation Structure (sidebar, no sub-items)

Not a visual org chart — a **flat, drill-down list**. Top level shows company-wide roles (e.g. "CFO (CO_CFO) — Corporate", "COO (CO_COO) — Corporate"), each row with a chevron to expand into that person's direct reports. Simple and clean, but means understanding the full shape of the org requires expanding node by node rather than seeing it at a glance.

---

## 12. HR Policies (sidebar, no sub-items)

Tabs: All, plus a Filter control. Empty state in this tenant: "No HR policies found — HR policies will appear here once published." A document/policy repository.

---

## 13. Reports (sidebar: Reports)

Expands to: **HR Reports, Custom Reports**.

- **HR Reports** — a short fixed list of **4 canned reports**, each with a Download action: Headcount vs Budget (MPP), Attrition & Replacement, Employee Transfer, Deputation Report.
- **Custom Reports** — "All Reports" tab, **+ Add New Report** (a self-service report builder). One example custom report already defined: "Openings" on module `employee.Openings`, with Download.

---

## 14. Requests (sidebar: Requests)

This name is misleading at first glance — it is **not** leave/attendance requests. It expands to: **Location, Department, Designation** — master-data **change-request queues**. Even adding a brand-new store Location or Department goes through a formal **Requested → Active / Rejected** approval workflow (tabs: Requested/Active/Rejected) rather than being a direct CRUD table, e.g.:

- **Location** — `+ Request Location`. Table: Code, Name, Type, Cluster Code, Address, Status. Example row: `locationtest-001`, "location testing", Corporate, cluster BR1, address "hisar", status **Requested**.
- **Department** — `+ Request Department`. Table: Code, Name, Department Type, Location, Status.
- **Designation** — same pattern (not opened in depth).

---

## 15. The module switcher (the big structural finding)

At the very bottom of the sidebar sits a stack of **3 dropdowns** — visually they look like a minor footer control, but they're actually the most structurally important piece of navigation in the whole app:

1. **Role/context** — `HR` ⇄ `Employee` (a self-service persona for the same logged-in user, see section 17)
2. **Module** — `Workforce Management` ⇄ a full list of **named modules**:
   - Recruitment Management
   - Attendance Management
   - Payroll Management
   - PMS Management (performance/goals)
   - Tour & Travel Management
   - Masters Management
   - Other Modules Management
3. **Tenant/company** — `CSPL` (only one option seen; presumably multi-entity support for groups with several legal entities)

**Everything documented in sections 2–14 above is just the "HR" module.** Switching the 2nd dropdown swaps the *entire* left sidebar and page content for a different, independently-built-feeling module — this is effectively **7 separate mini-apps** stitched together under one login, each with its own sidebar taxonomy, and the only way to discover that is to notice three small dropdowns below 13 nav items and a scrollbar. **Attendance and Payroll — which most HR admins would expect front-and-center — are one module-switch away from the default landing module, not in it.**

### 15.1 Attendance Management

Own sidebar: **Dashboard, Attendance, Requests (Leave Requests / EWD Requests / Regularisation Requests), Shift Roster, Reports, Comp Off Register, Comp Off Balances, Attendance Cycle, Freeze Requests, Leave Grant**.

- **Dashboard** — stat cards: Total Employees (38), Punched In Today, Late Arrivals, Leaves Applied; a 30-day Present/Absent/Leave trend chart; Attendance Activity (late arrivals/early exits) feed; a mini Requests panel (Leave/EWD/Tour tabs); Department Attendance breakdown.
- **Attendance** — toggles between **Monthly Attendance** and **Daily Attendance**:
  - *Monthly* — Month filter, +Create, Import, Sync Attendance. A dense per-employee grid with **13 numeric columns** (Total Days, Payable, Present, Off, EWD, Paid Leaves, Holiday, Late Deduction, Total, LOP, Absent, Unpaid Leaves, Total) — effectively a computed payroll-ready attendance summary, paginated 10/page.
  - *Daily* — Date filter, Recompute Attendance, +Add Attendance, Import. Per-punch table: Employee, Date, First Half, Second Half, In Time, Out Time, Duration, Punch Mode, Late Status, Remarks.
- **Leave Requests** — Opened/Approved/Rejected/Deleted tabs, **+ Raise Leave on behalf** (HR can file leave for an employee), Filters. Table: Employee, First Half, Second Half, Duration, Requested On.
- **Shift Roster** ("Shift Assignment & Roster") — the most visually dense screen in the whole product: a legend of 5 named shifts (Night/Evening/Morning/General Shift 2/General Shift 1, each with clock times) plus L/H/O/½ status codes, then a **5-week × 38-employee editable grid** (one cell per employee per day, click to edit shift or off-day), with Current Roster / Assignments tabs and an **Assign Shifts** bulk action.
- **Attendance Cycle** — a single small form: Organization Name (read-only), Attendance Cycle Start/End Date, Save. Defines the pay-period boundary.
- **Leave Grant** — ad-hoc leave credit tool. **Grant Leave** action. Table: Employee, Leave Type, Granted Leaves, Month, Granted By.
- Comp Off Register / Comp Off Balances / Freeze Requests / EWD Requests / Regularisation Requests were seen in the nav but not opened in depth (EWD = "Early/Extended Work Day" presumably; Freeze Requests likely locks a pay period once processed).

### 15.2 Payroll Management

Own sidebar: **Dashboard, Setup, Processing, Taxes, Reports, Self** (note: the sidebar literally has a typo, "Dashbord").

- **Dashboard** — a genuinely rich finance dashboard: Total Salary Disbursed (₹, with MoM % change), Employees on Payroll, Net Pay Ratio, a Gross/Net/Deductions monthly bar chart (6-month trend), Compensation Components (% of Gross) breakdown, a Statutory Deductions panel (PF employee/employer contribution, ESI employee/employer, TDS/LWF/PT deducted), a Tax Regime Split (New vs Old regime, % and headcount), and a Departmental Breakdown of cost.
- **Setup** expands to: Salary Structure, Structure Change Requests, Tax Setup, Reimbursement Setup, Reimbursement Plan, Reimbursement Claim.
- **Processing** expands to: Monthly Payroll, Additional Earnings, Additional Deductions, Variable Pay, Arrear Payments, Additional Benefit, Payment.
- **Taxes** — employee IT-declaration review queue. Tabs: Open/Submitted/Accepted/Reopened, with a Financial Year selector (FY 2026-27). Table: Employee, Financial Year, Type, PAN Number, Landlord, Taxable Income.
- **Self** expands to: Salary Structure, Payroll Register, Taxes, Benefit — the logged-in user's own payroll self-service, nested inside the admin-facing Payroll module rather than surfaced only in the Employee/self-service persona.

### 15.3 Recruitment Management

Own sidebar: **Dashboard, Bgt Seat Master** (Budget Seat Master), **Talent Requisition, Openings, Applicants, Candidates, Onboarding Submission, New Application, Reports**. This is a full embedded ATS.

- **Dashboard** ("HR Dashboard") — Total Openings (21), Active Roles (10), Open Positions (21), Total Applicants (39), In Selection Pipeline (8), Hired Candidates (15); an Openings Overview bar chart by role; a **10-stage Recruitment Pipeline Breakdown** (Pending Applicant List → Resume Shortlisted → Schedule Pending → Upcoming Interviews → Interview Completed → Negotiation → On Hold → Rejected → Offer Accepted → Offer Rejected), each with count and %; and an **Openings** table (Title, Location, Department, Designation, Salary Budget, Positions, Offers, Vacant, Priority) — e.g. "Store Manager, MOTIHARI-3, Store Operations, ₹5,60,000 budget, 2 positions, 1 vacant, Medium priority".

### 15.4 PMS Management (Performance Management)

Own sidebar: **Self** (My Goals, Self Rate Competencies, Manager Feedbacks, Manager Recommendations, Appraisal Summary, My Review), **Team** (Team Member, Team Competency, Team Feedback, Team Recommendation, Team Review).

- **My Goals** — a Balanced-Scorecard-style goal tracker: Cycle selector, "0 Goals Assigned", **View BSC**, **+ Add Goal**, Pending/Active/Submitted/Closed counters, table columns Goal Name, Perspective, KRA, KPI, Weightage (%), Cycle, Target.

### 15.5 Tour & Travel Management

Own sidebar: **Self, Team, Employee** (a 3-way scope toggle). "My Tour Request" — Processing/Approved/Rejected/Cancelled counters, Date-range filter, **+ Add Tour Request**.

### 15.6 Masters Management

The real system-admin / settings area, organized into 3 categories, each expandable:

- **Organization** → Region, Area, Cluster, Location. (Region list shown: NCR Region, North East & Odisha Region, West UP & MP Region, Central UP Region, East UP Region, Bihar & Jharkhand Region, Bihar Region 1, Head Office, North — each with a code like `R7`, `R1`, `HO` and an Active status, `+ Add Region` button.)
- **Employee** → Skill, Designation, Department, Languages, Opening Questions, JD, Interview Feedback Question Types, Interview Feedback Question Bank, Organization Document.
- **Attendance** → Auto Attendance.

This is the actual place raw master data is *managed* (as opposed to section 14's "Requests", which is a change-request/approval queue layered in front of some of the same entities — Location and Department exist in **both** places under different interaction models: direct CRUD here vs. request-and-approve there).

### 15.7 Other Modules Management (quirk)

Selecting this option in the module switcher does **not** open an admin screen at all — it navigates straight to `https://citykart.cloudzmall.com/careers`, Citykart's **public, unauthenticated job-application microsite** (job cards like "Store Manager — Store Operations — 1 vacant — MOTIHARI-3 — Apply Now", 9 openings listed, an "All Organizations" filter). It appears to reuse the Openings data from Recruitment Management (section 15.3) to power a public careers page, but surfacing it as a sidebar "module" inside the authenticated admin shell — with no visible way back into the app from that page — reads as a bug or leftover placeholder rather than an intentional admin feature.

---

## 16. Employee (self-service) persona

Switching the first dropdown from `HR` to `Employee` swaps to a **personal, "My X" sidebar**, reached while remaining logged in as the same HR user (who is also, structurally, "an employee" with their own profile and a team under them):

Sidebar: **Self** (My Dashboard, My Profile, My Resignation, My No Dues, My Signature, My PIP, My Documents, My Promotion Request, Feedbacks), **Team** (Transfer, Dept. No Dues), **Organisation Structure, HR Policies, Dept. Checklist, Requests**.

- **My Dashboard** — visually similar to the HR dashboard's stat-card-plus-chart layout, but adds a **Recruitment Status Breakdown** panel (the same 10-stage pipeline from section 15.3, mirrored here) and drops the Location/Department top-bar filters in favor of a plain search box.
- **My Profile** — opens the *exact same* profile component used for the admin "view employee" screen (section 3.3) — same 9 tabs, same General/Personal/etc. sections — just scoped to the logged-in user and without the Export/View Applicant buttons. Confirms the profile UI is a single shared component reused for both admin and self views, which is good reuse.

---

## 17. Summary

### Navigation structure

Citykart isn't really "one HRMS with a sidebar" — it's **7 independently-built modules** (HR, Attendance, Payroll, Recruitment, PMS, Tour & Travel, Masters — plus a near-miss "Other Modules" that just links out to a public site) stitched together behind a single login, switched via **3 small dropdowns stacked at the very bottom of the sidebar** rather than any top-level tab/menu. Each module brings its own, differently-organized sidebar (flat list in HR, 2-level accordion in Masters, Self/Team split in PMS and Tour & Travel). There is also a second, parallel **persona switch** (HR ⇄ Employee) layered on top of the module switch, so the *same* 3-dropdown control block is doing two conceptually different jobs (which module, and which persona) plus tenant selection, with no visual distinction between the three rows beyond their current label.

Counting only the default "HR" module: 13 top-level nav items, 7 of which expand into 2–6 sub-items (≈35 distinct leaf screens). Add the other 6 modules (Attendance: 10 leaf items, Payroll: ~20 across Setup/Processing sub-menus, Recruitment: 9, PMS: 11, Tour & Travel: 3, Masters: 14) and the full app is well over **100 distinct screens**, essentially none of it discoverable from the default landing view without knowing to scroll to the bottom of the sidebar and open a dropdown.

### Clicks to reach common tasks (from fresh login, landing on HR Dashboard)

| Task | Clicks | Path |
|---|---|---|
| View an employee's profile | 2 | Employee (expand) → Employee (list) → click row |
| Add a new employee | 2 to open the wizard, **+6 more screens** to complete it | Employee → Employee → + Add Employee → (7-step wizard) |
| Approve a promotion | 3 | Promotion Request (expand) → Manager Recommended → Approve (inline) |
| View today's attendance | 2 | *module switch* (HR → Attendance Management) → Attendance (already on Daily by toggle) |
| Check payroll for the month | 2 | *module switch* (HR → Payroll Management) → Dashboard (default) |
| Approve a leave request | 3 | *module switch* → Attendance Management → Requests (expand) → Leave Requests |
| Add/request a new department | 3 | Requests (expand) → Department → + Request Department |
| Run a canned HR report | 3 | Reports (expand) → HR Reports → Download |

The module switch itself is "1 click" mechanically, but **cognitively it's the expensive step** — nothing on the HR dashboard hints that Attendance or Payroll exist at all; a new admin would have to stumble onto the 3 dropdowns at the bottom of a long sidebar to discover roughly 80% of the product.

### Notably simple

- **Inline approve/reject** on Promotion Request rows — no detail page needed for a yes/no decision.
- **Organisation Structure** as a plain drill-down list rather than a heavy chart library — fast, no rendering cost, though it trades away at-a-glance shape.
- **HR Reports** — 4 reports, 1 click each to download, no report-builder ceremony for the common cases.
- **My Profile reusing the admin profile component** — one profile UI serves both the "HR views an employee" and "employee views themselves" cases.
- **Attendance Cycle** setup — a single 3-field form, appropriately small for a once-a-year setting.

### Notably complex

- **The module switcher itself** — the single biggest navigation/discoverability problem in the product. Three unlabeled-by-type dropdowns at the bottom of a sidebar, doing three different jobs (module, persona, tenant), gate access to most of the app's actual functionality (Attendance, Payroll, Recruitment, PMS, Masters).
- **Add Employee wizard** — 7 steps, 28+ fields on step 1 alone, "+41 more" fields referenced by the profile-completeness indicator on top of what's already visible. A lot of this (ESI No., Fingerprint Registered, Cost Centre Code, Relative in Company, jeans/uniform size) reads like retail-chain/blue-collar-workforce-specific fields bolted onto a generic HR form rather than a lean core schema with extensions.
- **Shift Roster grid** — a 5-week × 38-employee editable calendar is powerful but dense; no visible bulk-edit-by-row/column shortcut beyond the "Assign Shifts" button, so any individual correction likely means hunting one cell in a large grid.
- **Monthly Attendance table** — 13 numeric columns per employee row is a lot of simultaneous information; most admins probably only care about 3–4 of those in a normal review.
- **Two parallel systems for the same master data** — Location/Department exist as both a direct-CRUD list (Masters Management → Organization) and a separate request-and-approve queue (Requests → Location/Department), with no obvious signal for which one to use when, or how/whether they reconcile.
- **"Requests" as a sidebar label** is actively misleading — in context it reads like "my leave/attendance requests," but it's actually "master-data change requests." A returning user would likely click it expecting the wrong thing at least once.
- **"Other Modules Management"** silently exits the authenticated app into a public page with no return path — a trap for anyone exploring the module switcher out of curiosity.

### Takeaways worth carrying into the CognixHR comparison

1. Citykart's core problem is **discoverability, not feature count** — most of its screens are reasonable in isolation, but burying 6 of 7 modules behind an unlabeled dropdown stack means the product *feels* sparse until an admin stumbles onto the real functionality. CognixHR's flatter, single-sidebar structure (even if it ends up with more top-level items) is probably more honest about what exists.
2. Where Citykart nests related data two different ways (Masters CRUD vs. Requests approval-queue for the same Location/Department entities), it creates ambiguity about the source of truth — worth checking CognixHR doesn't have a similar split-brain pattern anywhere (e.g., employee picker patterns, tenant settings).
3. Multi-step wizards (Add Employee) scale badly once a schema accretes retail/ops-specific fields over time — a flag for keeping CognixHR's own employee-creation form resistant to "just add one more field" pressure, or deliberately splitting a lean required-fields step from an optional-fields step that can be filled in later.
4. Approval queues that support **inline decisions on the list row** (Promotion Request's Approve/Reject) are meaningfully faster than queues that force a detail-page visit per item — worth checking which of CognixHR's own approval flows could drop the extra click.
5. A single shared profile component across admin and self-service views (section 16) is good reuse worth preserving/matching if CognixHR doesn't already do this.

