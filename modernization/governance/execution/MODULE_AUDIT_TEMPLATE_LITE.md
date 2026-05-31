# MODULE AUDIT — LITE
## HRMS Modernization Working Audit

**Module:** `___________________________`  
**Auditor:** `___________________________`  
**Date:** `___________________________`  
**Reviewed With:** `___________________________ (operator / team lead)`

---

## 1. MODULE OVERVIEW

**What does this module do?**
```
[One paragraph. Plain language. What business problem does it solve?]
```

**Who uses it and how often?**

| Role | What They Do in This Module | How Often |
|---|---|---|
| | | |
| | | |
| | | |

**Business criticality:**  
`[ ] Critical — affects payroll or compliance directly`  
`[ ] High — affects operations daily`  
`[ ] Medium — important but not daily`  
`[ ] Low — occasional or supporting function`

**What breaks if this module is down for 1 hour?**
```
[Be specific. What operation cannot proceed?]
```

**What breaks if this module produces wrong data?**
```
[e.g., Wrong attendance → wrong payroll → incorrect statutory deduction]
```

**Direct dependencies (what this module needs to function):**

| Depends On | What It Needs | What Happens If It's Missing |
|---|---|---|
| | | |
| | | |

**What depends on this module (downstream):**

| Downstream Module / System | What It Receives | Impact If Wrong |
|---|---|---|
| | | |
| | | |

---

## 2. MAIN WORKFLOWS

> List every meaningful workflow an operator runs in this module. One table row per workflow. Add a detail block for anything complex.

### Workflow Summary

| # | Workflow Name | Who Triggers | How Often | Payroll Impact | Compliance Impact | Currently Reliable? |
|---|---|---|---|---|---|---|
| 1 | | | | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` |
| 2 | | | | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` |
| 3 | | | | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` |
| 4 | | | | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` |
| 5 | | | | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` |

---

### Workflow Detail

> Complete one block per workflow. Copy and paste as needed.

---

**Workflow:** `___________________________`

**Trigger:** `[What starts it — manual action / scheduled job / upstream event]`

**Steps:**
```
1.
2.
3.
4.
5.
```

**Output / End State:** `[What exists or has changed when this workflow completes]`

**Approval required?**  
`[ ] No  [ ] Yes — Who approves: _______________  At which step: _______________`

**What happens if it fails mid-way?**
```
[Does data stay consistent? Is there a rollback? Does the operator know it failed?]
```

**Known problems with this workflow:**
```
[Bugs, gaps, operator complaints, workarounds in use]
```

---

**Workflow:** `___________________________`

**Trigger:** `___________________________`

**Steps:**
```
1.
2.
3.
4.
5.
```

**Output / End State:** `___________________________`

**Approval required?**  
`[ ] No  [ ] Yes — Who: _______________  At step: _______________`

**What happens if it fails mid-way?**
```

```

**Known problems:**
```

```

---

*(Add more workflow blocks as needed)*

---

## 3. CURRENT PROBLEMS

> Document what is actually broken, painful, or risky right now. Be direct. Use operator language.

---

### 3.1 Runtime Issues

> Errors, crashes, hangs, or failures that happen in production.

| Problem | How Often | Impact When It Happens | Workaround in Use? |
|---|---|---|---|
| | | | `[ ] Yes  [ ] No` |
| | | | `[ ] Yes  [ ] No` |
| | | | `[ ] Yes  [ ] No` |

**Most critical runtime issue:**
```
[Single biggest reliability problem operators face today]
```

---

### 3.2 UX Friction

> Things that are unnecessarily slow, confusing, or require too many steps.

| Screen / Workflow | What's Painful | How Many Operators Affected |
|---|---|---|
| | | |
| | | |
| | | |

**Biggest UX complaint from operators (verbatim if possible):**
```
[Role]: "[Quote]"
```

---

### 3.3 Data Problems

> Incorrect data, missing data, inconsistent data, or data operators don't trust.

| Problem | Table / Field Affected | How Often | Do Operators Know About It? |
|---|---|---|---|
| | | | `[ ] Yes  [ ] No` |
| | | | `[ ] Yes  [ ] No` |
| | | | `[ ] Yes  [ ] No` |

**Is there any data in this module that operators have stopped trusting?**
```
[ ] No
[ ] Yes — What data: _______________  Why: _______________
```

---

### 3.4 Manual Workarounds

> Things operators do outside the system to compensate for gaps.

| Workaround | Why It Exists | Risk If Workaround Fails |
|---|---|---|
| | | |
| | | |
| | | |

---

### 3.5 Excel / Offline Dependencies

> Work that should be in the system but happens in Excel, email, or paper.

| Process Done in Excel / Offline | Why It's Not in the System | Frequency |
|---|---|---|
| | | |
| | | |
| | | |

**Is any Excel output used as input to another system?**
```
[ ] No
[ ] Yes — What: _______________  Where it goes: _______________
```

---

### 3.6 Performance Issues

> Things that are slow enough to affect operator productivity or operational timing.

| Screen / Operation | Current Speed | Acceptable Speed | When It's Worst |
|---|---|---|---|
| | | | |
| | | | |

---

## 4. OPERATIONAL RISKS

> What could go wrong that would directly hurt payroll, compliance, employees, or the business.

---

### 4.1 Payroll Risk

**Does a failure or error in this module affect payroll calculations?**  
`[ ] No  [ ] Yes — How: ___________________________`

**What is the worst-case payroll impact if this module has a bad data day?**
```
[e.g., 200 employees receive incorrect salary; PF computed on wrong base]
```

**Is this risk currently mitigated?**  
`[ ] Yes — How: _______________  [ ] Partially  [ ] No`

---

### 4.2 Compliance Risk

**Does a failure in this module affect statutory filings (PF, ESI, TDS, PT)?**  
`[ ] No  [ ] Yes — Which filings: ___________________________`

**Has this module ever caused a compliance filing error?**  
`[ ] No  [ ] Yes — When / What happened: ___________________________`

**Is there a compliance deadline in the next 30 days that depends on this module?**  
`[ ] No  [ ] Yes — Deadline: _______________  Filing: _______________`

---

### 4.3 Data Integrity Risk

**Are there known duplicate records in this module?**  
`[ ] No  [ ] Yes — What: ___________________________`

**Are there orphaned records (references to deleted or non-existent data)?**  
`[ ] No  [ ] Yes — Where: ___________________________`

**Are there records with impossible or suspicious values (zero salary, future hire dates, etc.)?**  
`[ ] No  [ ] Yes — What: ___________________________`

**Is there an audit trail for all changes in this module?**  
`[ ] Full audit trail  [ ] Partial  [ ] No audit trail`

---

### 4.4 Approval Bottlenecks

**Are there approval steps that frequently delay operations?**

| Approval Step | Average Delay | Why It Gets Stuck |
|---|---|---|
| | | |
| | | |

**Is there any approval that is being bypassed in practice?**  
`[ ] No  [ ] Yes — Which one: _______________  Why: _______________`

---

### 4.5 Reconciliation Gaps

**Where does this module compare expected vs. actual data?**

| Reconciliation Point | Currently Automated | Currently Visible to Operator | Gap |
|---|---|---|---|
| | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | |
| | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | |

**Where should reconciliation exist but doesn't?**
```
[e.g., "No comparison between biometric punch counts and payroll attendance input — discrepancies go undetected"]
```

---

## 5. TECHNICAL DEBT

> Code-level problems that make the module fragile, hard to change, or easy to break.

---

### 5.1 Duplicate Logic

**Is the same calculation or business rule written in more than one place?**  
`[ ] No  [ ] Yes`

```
Where:
1.
2.
3.
```

---

### 5.2 Legacy APIs or Patterns

**Are there API endpoints or patterns that are outdated, undocumented, or inconsistent with the rest of the codebase?**  
`[ ] No  [ ] Yes`

```
What:
1.
2.
```

---

### 5.3 Hardcoded Rules

**Are there business rules, thresholds, or values hardcoded in the application that should be configurable?**  
`[ ] No  [ ] Yes`

| Hardcoded Value | Where in Code | Should Be | Risk |
|---|---|---|---|
| | | `[ ] Configurable  [ ] Database-driven` | |
| | | `[ ] Configurable  [ ] Database-driven` | |

---

### 5.4 Missing Validation

**Are there inputs that reach the database without being validated?**  
`[ ] No  [ ] Yes`

```
What:
1.
2.
```

**Are calculations executed without verifying their inputs are complete?**  
`[ ] No  [ ] Yes — Where: ___________________________`

---

### 5.5 Weak Error Handling

**Are there operations that fail silently (no error shown to operator, no log written)?**  
`[ ] No  [ ] Yes`

```
Where:
1.
2.
```

**Are there operations that fail and leave data in a partial or inconsistent state?**  
`[ ] No  [ ] Yes — Which operations: ___________________________`

---

### 5.6 Test Coverage

**Are critical calculations covered by automated tests?**  
`[ ] Yes — all  [ ] Partially  [ ] No`

**Are critical workflows covered by automated tests?**  
`[ ] Yes — all  [ ] Partially  [ ] No`

**Most dangerous untested path:**
```
[The calculation or workflow that has the highest operational risk and zero test coverage]
```

---

## 6. UX & WORKFLOW IMPROVEMENTS

> What would make operators faster, less error-prone, and more confident.

---

### 6.1 Bulk Operations Needed

**Where do operators currently process records one-by-one that should be bulk?**

| Operation | Current Method | Should Be |
|---|---|---|
| | One-by-one | Bulk with preview + confirm |
| | One-by-one | Bulk with preview + confirm |

---

### 6.2 Visibility Problems

**Where do operators lack visibility into the current state of operations?**

| What's Hidden | Where | What Should Be Visible |
|---|---|---|
| | | |
| | | |

**Is the status of long-running operations (payroll run, batch upload) visible while in progress?**  
`[ ] Yes  [ ] Partially  [ ] No`

---

### 6.3 Too Many Clicks

**Workflows that require more steps than they should:**

| Workflow | Current Steps | Should Be | What Can Be Eliminated |
|---|---|---|---|
| | | | |
| | | | |

---

### 6.4 Missing Filters and Search

**Data grids or lists that operators cannot filter or search effectively:**

| Screen | Missing Filter / Search | How Often Needed |
|---|---|---|
| | | |
| | | |

---

### 6.5 Reconciliation Visibility

**Where do reconciliation results exist but operators can't easily see them?**
```
[e.g., "Exception count is visible but the individual exceptions require drilling into each record individually"]
```

**Where should a diff view exist but doesn't?**
```
[e.g., "Upload result shows row count accepted/rejected but no side-by-side comparison with existing data"]
```

---

### 6.6 Operator Productivity Improvements

**Top 3 things that would save operators the most time each week:**

```
1.

2.

3.
```

---

## 7. MODERNIZATION PRIORITIES

> What to do, in what order. Keep it realistic.

---

### Phase 1 — Stabilization
*Fix what's broken before changing anything.*

| Priority | Item | Why First |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |

**Estimated stabilization effort:** `___ days / ___ sprints`

**Can operations continue safely while Phase 1 is underway?**  
`[ ] Yes  [ ] Yes, with caution — _______________  [ ] No — must stabilize before anything else`

---

### Phase 2 — Workflow Improvements
*Make the workflows work better for operators.*

| Priority | Improvement | Operator Benefit |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |

**Estimated effort:** `___ days / ___ sprints`

---

### Phase 3 — UX Improvements
*Make the interface faster and less painful to use.*

| Priority | Improvement | Operator Benefit |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |

**Estimated effort:** `___ days / ___ sprints`

---

### Phase 4 — Intelligence Features
*Only after Phases 1–3 are complete and stable.*

| Signal / Feature | What It Detects | Where It Appears | Operator Value |
|---|---|---|---|
| | | | |
| | | | |
| | | | |

**Data quality good enough for intelligence features?**  
`[ ] Yes  [ ] Not yet — needs: ___________________________`

---

## 8. FINAL RECOMMENDATION

---

**Priority Level:**  
`[ ] Critical — start immediately`  
`[ ] High — next modernization cycle`  
`[ ] Medium — scheduled modernization`  
`[ ] Low — defer until higher-priority modules are complete`

**Estimated overall complexity:**  
`[ ] Low — well-understood, low risk`  
`[ ] Medium — some unknowns, manageable risk`  
`[ ] High — significant unknowns or risk`  
`[ ] Very High — requires deep investigation before scoping`

**The single biggest risk in modernizing this module:**
```
[One clear sentence. What could go wrong that would hurt operations?]
```

**The single most valuable improvement for operators:**
```
[One clear sentence. What change would operators feel most immediately?]
```

**Major risks to manage during modernization:**
```
1.
2.
3.
```

**Suggested execution order:**
```
1. [First thing to do — and why]
2.
3.
4.
```

**Deployment constraints:**
```
[When this module CANNOT be deployed to — payroll windows, filing deadlines, etc.]
```

**Anything that must NOT change during modernization:**
```
[Specific workflows, calculations, or behaviors that operators depend on and that must be preserved exactly]
```

---

**Sign-off:**

| | Name | Date |
|---|---|---|
| **Auditor** | | |
| **Operator / Team Lead** | | |
| **Engineering Lead** | | |

---

*Keep this document. It is the baseline record of what the module looked like before modernization began.*
