# Change requests arising from the questionnaire

> **Revised 2 Nov 2026 (scope recheck for Version 1).** After checking each item against the quotation lines and the written requirements:
> - **CR-4** (payment proof attachments), **CR-5** (lead shift on deactivation) and **CR-6** (team weekends) are reclassified as **in scope** and withdrawn as change requests; reasons are given in each section.
> - **CR-1** (attendance) is a **commercial decision for Zeploy Tech**: the quotation lists "Attendance" under Performance, so it is not automatically additional.
> - **CR-2** and **CR-3** remain change requests.

Prepared 2 Nov 2026. Compares the questionnaire answers with the signed-off scope of the **PKR 175,000** quotation (`quotation/quotation.html`).

The quotation says:
> "Any item not listed here is outside the agreed scope unless approved separately."
> "Any additional feature, integration, customization or change beyond the modules and features listed in this quotation will be reviewed and quoted separately before work begins."

**No prices are proposed here.** Effort is an engineering estimate in developer-days for one developer: design, build, tests, documentation. It is meant to inform a separate quotation, and it assumes the open questions are answered first. Pricing is a commercial decision for Zeploy Tech.

---

## 1. How the quotation lines map to the answers

| Quotation line | Questionnaire answers | Assessment |
|---|---|---|
| HR · Employee records | Q1, Q2, Q3, Q5 | **In scope:**<br>- records for staff without logins (Q1); FR-140 defines the directory by name, designation, department, contact, joining date and status, not by login;<br>- user account create and deactivate (Q2, Q3);<br>- the one-step lead shift on deactivation (Q3), a convenience over the quoted *Lead assignment* and FR-030 manual reassignment (revised; formerly CR-5);<br>- team-based region (Q5). |
| HR · Leave requests & approvals; Leave balances | Q4, Q6–Q17 | **In scope**, once C-4, C-5 and C-13 are answered. |
| My Workplace · My leaves | Q6–Q17 | In scope. |
| Teams · Duty roster | Q18, Q19 | In scope: leave filling the roster, rotation skipping leave. |
| Performance · Attendance | Q20–Q22 | **Commercial decision (revised).** The quotation lists "Attendance", so some attendance is owed. The line is listed under *Performance* (a metric). The original requirement (FR-143) defined it as "sign-in log based (no biometric)", superseded on 30 Oct with the client's agreement (Q51). The answers ask for a full time-and-attendance module: check-in/out, late, absences, working hours, breaks, HR correction. That goes beyond a Performance line. Zeploy Tech should decide how much is in the price and quote the rest. **CR-1.** |
| Performance · Agent performance | Q23–Q28 | In scope once the rules are given (C-17, C-20). These are definitions, not new features. |
| Bookings · Receipts & sales order | Q29, Q30 | In scope (receipt numbering format). |
| Accounts & Finance · Booking payments | Q31, Q33, Q34, Q35 | In scope: approval change, Pay order method, payment types, and **proof attachments** (revised, formerly CR-4). The quoted Finance module already requires attachments on income and expense records (FR-200 / FR-201), and payment attachments were an open Finance question (Q-F9), not an exclusion. |
| Accounts & Finance (exclusions) | Q32 | The quotation excludes "other financial workflows unless expressly listed". Refunds with variable deductions are not listed. **CR-3.** |
| Tasks · Proposal & payment plan printing | Q36–Q48 | In scope (rules, defaults, due dates, permissions). |
| Tasks · Proposal & payment plan printing | Q49 (map) | The print exists, but a floor map with the unit marked needs map assets and a placement tool, which were not described. **CR-2.** |
| Teams · Duty roster | Q9 | **In scope (revised, formerly CR-6).** Team weekends pre-fill off-days in the quoted duty roster. Their use in attendance is part of CR-1. Leave is unaffected (calendar days). |
| Security | Q50–Q53 | In scope. The recording delete was deferred pending the client's rule, which is now given. |

## 2. Change requests

### CR-1 Employee attendance module (Q20, Q21, Q22): commercial decision
- **Commercial position:**
  - The quotation lists "Attendance" under **Performance**, so it can't be treated as entirely new.
  - The written requirement (FR-143) was "sign-in log based", which the client has now ruled out (Q51).
  - The answers describe a full operational module.
  - **Options for Zeploy Tech:**
    - (a) treat a basic daily attendance record as in scope: present / absent / on leave, with check-in and check-out times, feeding the Performance column, and quote the rest (late rules, breaks, working-hours reports, corrections workflow) separately;
    - (b) quote the whole module.
  - Either way, it can't be built before C-16 is answered.
- **Requested:** a separate attendance feature recording check-in, check-out, late arrivals, absences, working hours and breaks. HR and Super Admin view, manage and correct it.
- **Why it is additional:** the quoted "Attendance" sits under Performance. The approved requirement (FR-143) was sign-in based, which the client has now agreed is not attendance. The answer asks for a new operational module with its own data, screens, rules and corrections.
- **Depends on:** C-16 (capture method, office hours, late threshold, breaks, absence rule, self-view); C-3 and C-8 (team and weekend); the leave module (approved leave ≠ absent); holidays.
- **Outline:**
  - `attendance_days` and `attendance_events` tables (check-in/out and break start/end, with source and corrections, audited);
  - a team shift and weekend configuration;
  - a daily absence and late computation;
  - HR screens (day and month views, correction with reason);
  - My Workplace self check-in and view, if C-16(a/f) says so;
  - a monthly report;
  - Performance "Attendance" column.
- **Estimated effort:** **6–9 developer-days** if attendance is captured by clicking in the CRM. More if a device import is needed: the device and file format would have to be known.
- **Status:** awaiting C-16 and approval of a separate quotation.

### CR-2 Floor map with the unit marked on printed proposals (Q49)
- **Requested:** printed proposals show "designated map with unit number marked on it".
- **Why it is additional:** needs new map assets per project and floor, a way to mark each unit's position, and print rendering. None of this was in the quoted feature list or the requirements.
- **Depends on:** the client supplies floor plan images (PNG / JPG / PDF per floor), and someone places each unit on its plan.
- **Outline:**
  - project-floor map upload (private storage, reusing the documents pipeline);
  - a unit-position tool in Inventory (click to place a marker), storing x/y per unit;
  - the proposal print draws the plan and highlights the unit.
- **Estimated effort:** **3–4 developer-days**, plus the client's time to place units.
- **Status:** awaiting plan images and quotation approval.

### CR-3 Refunds with a variable deduction on cancelled bookings (Q32)
- **Requested:** "refund after specified deduction( variable)".
- **Why it is additional:**
  - The quotation's Finance exclusions cover "other financial workflows unless expressly listed".
  - Today a booking with payments can't be cancelled at all (Q-F10).
  - Refunds need new ledger entries, approval, unit release and reporting.
- **Depends on:** C-22 (who sets the deduction, who approves, whether the deduction is income, unit release).
- **Outline:**
  - a cancel-with-refund request: amount paid, deduction, refund due;
  - approval;
  - refund and deduction ledger rows (never deleting payments);
  - booking cancelled and unit released;
  - collections and outstanding reports adjusted;
  - audit, notifications and tests.
- **Estimated effort:** **3–5 developer-days**.
- **Status:** awaiting C-22 and approval.

### CR-4 Payment proof attachments (Q33): **withdrawn, in scope**
- **Reclassified 2 Nov 2026.** FR-200 / FR-201 in the quoted Finance module already require attachments, and Q-F9 was an open in-scope question. Kept below for the effort estimate; scheduled after Version 1.
- **Requested** (our reading, to be confirmed in C-23): "online receipt" and "cash images" are proof files attached to a payment.
- **Why it is additional:** payments have no attachments (Q-F9 was open). This needs private storage, validation and access rules for finance documents.
- **Outline:** reuse the lead-documents pipeline (content checks, private storage, audited download) for payment attachments; Finance-role access only; optional or required per C-23.
- **Estimated effort:** **1.5–2 developer-days**.
- **Status:** awaiting C-23.

### CR-5 Shift a deactivated employee's leads in one step (Q3): **withdrawn, in scope**
- **Reclassified 2 Nov 2026.** This is a convenience over quoted *Lead assignment* and FR-030 manual reassignment, attached to quoted employee records. Kept below for the effort estimate; scheduled after Version 1 (needs C-2).
- **Requested:** "Manual disable with lead shift option".
- **Why it is additional:**
  - Quoted lead assignment covers assigning and reassigning individual leads (FR-030), which exists.
  - A bulk transfer tied to deactivation, possibly moving follow-ups, tasks and meetings, is a new workflow.
  - Small. It can reasonably be treated as part of the user-account work if Zeploy Tech prefers.
- **Depends on:** C-2.
- **Outline:** in the deactivate dialog, choose a target agent and the leads to move (per C-2); one transaction; activity, audit and notification per lead.
- **Estimated effort:** **1–1.5 developer-days**.

### CR-6 Team-specific weekends (Q9): **withdrawn, in scope**
- **Reclassified 2 Nov 2026.** Weekends configure off-days on the quoted duty roster. Kept below for the effort estimate; scheduled after Version 1 (needs C-3, C-8).
- **Requested:** weekends vary by team.
- **Why it is additional:** no weekend concept exists. Under Q8 (calendar days) it has no effect on leave, so it only matters for the roster and attendance.
- **Depends on:** C-3, C-8. Only useful together with CR-1.
- **Estimated effort:** **0.5–1 developer-day** (inside CR-1 if both are approved).

## 3. Summary

| CR | Item | Status | Effort (dev-days) | Blocked by |
|---|---|---|---|---|
| CR-1 | Attendance module | **Commercial decision** (quote lists "Attendance") | 6–9 for the full module | C-16, C-3, C-8 |
| CR-2 | Floor map on proposals | Change request | 3–4 + client data | Plan images |
| CR-3 | Refunds with deduction | Change request | 3–5 | C-22 |
| CR-4 | Payment proof attachments | Withdrawn: in scope, after V1 | (1.5–2, counted in scope) | C-23 |
| CR-5 | Lead shift on deactivation | Withdrawn: in scope, after V1 | (1–1.5, counted in scope) | C-2 |
| CR-6 | Team weekends | Withdrawn: in scope, after V1 | (0.5–1, counted in scope) | C-3, C-8 |
| | **Remaining change requests** | | **12–18** (CR-1 full + CR-2 + CR-3) | |

**Already excluded by the quotation and not requested:** Meta / Instagram / TikTok / WhatsApp integrations, AI call analysis, payment gateways, bank integrations, tax, payroll, automated commissions, maintenance, and hosting or third-party costs.

## 4. Schedule note (revised 3 Nov 2026)

- The quotation's date for Version 1 is **10 November 2026**. Version 1 is the CRM **deployed on the client's production server and handed over** for acceptance testing; there is no separate demo.
- **In-scope work:**
  - The in-scope work in `POST_QUESTIONNAIRE_IMPLEMENTATION_PLAN.md` is estimated at **about 15–19.5 developer-days**, including the three items reclassified on 2 Nov.
  - Only a small, defined part is in Version 1: E1–E3 and production preparation P1–P5 (`VERSION_1_EXECUTION_PLAN.md`).
  - Leave in particular can't start until C-4, C-5 and C-13 are answered.
- **Recommendation:**
  - deliver Version 1 as defined in the execution plan;
  - agree with the client in writing which in-scope items follow Version 1;
  - quote CR-2 and CR-3 separately, and decide CR-1 commercially.
- **Open:** what "completion of Version 1" (the second 50% payment) means is still open (Q-P1; `VERSION_1_EXECUTION_PLAN.md` §8.5).
