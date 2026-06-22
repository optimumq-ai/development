# Optimum Q - Workflow Decision Inventory

> The single source of truth for every point in a request's life where the system, a person, or policy makes a decision. This one list feeds three surfaces: the **Workflow Engine** (the rulebook the engine runs), the **Process & Workflow Configuration** view (the cross-cutting list of every workflow/routing/fee toggle), and the **Process Flow Simulator** (walk a hypothetical request, answer each decision, backtrack and branch). As nodes move from PLANNED to BUILT, update the Status here.

**Status legend:** BUILT = live today | PARTIAL = partly built | PLANNED = designed, not yet built

---

## 0. How to read this

### The four deciders
Every decision is made by one of four kinds of actor. Tagging each decision this way is what keeps the whole thing straight:

- **AI** - reads unstructured input and *proposes* (classification, matching, extraction, drafting). Never the final authority on anything consequential.
- **CODE** - deterministic gating, math, and enforcement. Reproducible and auditable (fee math, deadline calc, deposit gating, permission checks).
- **HUMAN** - judgment and approval (responsiveness, which exemptions apply, redaction adequacy, granting a waiver).
- **POLICY** - not an actor but a set of configurable numbers and rules that CODE enforces (grace days, deposit %, overage tolerance). These live on the **Jurisdiction Profile**, per state - see Part 5.

The common case is **HYBRID**, and it always follows one pattern:
> **AI proposes  ->  HUMAN confirms  ->  CODE enforces and records.**

The Workflow Engine is the "code enforces and records" layer. The classifier is the "AI proposes" layer.

### The two kinds of trigger
- **Event-driven** decisions fire when something *happens* (a request arrives, a record is marked responsive, a payment lands). The engine handles these today.
- **Time-driven** decisions fire when *nothing* happens for long enough (deposit unpaid for N days, requestor silent for N days). These need a daily sweep - **the tickler** (Part 3). This is the single biggest piece the system does not have yet, and almost every "what stops the request" decision depends on it.

---

## Part 1 - Happy path (what moves a request forward)

### Intake & classification
| Decision | Decided by | Status |
|---|---|---|
| Which channel did it arrive on (portal form / chat agent / staff)? | CODE | BUILT |
| Is the requestor's email verified? | CODE | BUILT |
| What record type is this? | AI proposes | BUILT |
| How confident is the match? | AI | BUILT |
| Complexity (simple / standard / complex / redaction-required)? | AI proposes | BUILT |
| Is redaction likely needed? | AI proposes | BUILT |
| Is it a multi-record request (MRR)? | AI proposes | BUILT (flag only) |
| Is there a fee-waiver signal in the text? | AI proposes | BUILT (signal only) |
| Sensitivity flags (legal hold / investigation / sensitive)? | AI proposes | BUILT |
| Can the AI determine the department confidently? | AI + CODE threshold (70%) | BUILT |

### Routing (the engine / rulebook)
| Decision | Decided by | Status |
|---|---|---|
| Does a sensitivity flag force human intake? | CODE (rule) | BUILT |
| Confident + owning team known -> skip to record search? | CODE (rule) | BUILT |
| Low confidence -> Open Records triage? | CODE (rule) | BUILT |
| Which team owns the matched record type? | CODE (taxonomy) | BUILT |
| Catch-all fallback so nothing is unrouted | CODE (rule) | BUILT |
| Route to a specific person by specialization? | HYBRID (pgvector match) | PLANNED (text captured) |
| Balance across team members by workload? | CODE | PLANNED |

### Scoping / multi-record
| Decision | Decided by | Status |
|---|---|---|
| Should this be split into child requests? | HUMAN decides, AI proposes split | PLANNED |
| Record type & routing per child | AI proposes per child | PLANNED |

### Fees, estimate, deposit
| Decision | Decided by | Status |
|---|---|---|
| Does projected cost exceed the estimate threshold? | CODE (fee math) | BUILT |
| What is the estimated cost? | CODE (fee profile) | BUILT |
| Should a requested fee waiver be granted? | HUMAN (approver) | PARTIAL |
| **Manual or automated estimate?** (auto-estimate from the record-type profile, or route to a human?) | CODE (profile + variance gate) + POLICY | BUILT (profile + variance gate + assess + seed UI); historical writeback PLANNED |
| Is a deposit required before work begins? | CODE (policy) | PARTIAL |
| Has the required deposit been paid? | CODE (payment status) | PLANNED |
| **Can work begin?** (deposit paid OR none required OR waiver granted) | CODE gate | PLANNED |
| Estimate vs. final reconciliation | CODE | PLANNED |

### Record search & responsiveness
| Decision | Decided by | Status |
|---|---|---|
| Which records are responsive? | HUMAN, AI-assisted | BUILT |
| AI-suggested responsive documents | AI proposes | BUILT |
| Are there any responsive records at all? | HUMAN / CODE | PARTIAL |
| Enough found to advance? | CODE gate (>=1 responsive) | BUILT |

### Public-readiness & exemptions
| Decision | Decided by | Status |
|---|---|---|
| Is the record releasable as-is (public-ready)? | CODE reads flags, HUMAN confirms | PARTIAL |
| Which exemptions / statutes apply? | HUMAN decides, AI proposes | PLANNED (needs citation framework) |
| Is this a "known-clean" type that bypasses redaction? | CODE (registry) | PLANNED |

### Redaction
| Decision | Decided by | Status |
|---|---|---|
| In-department vs. central redaction? | CODE (config toggle) | PLANNED |
| Should auto-redaction fire on *entering* the redaction stage? | CODE (transition hook) | PLANNED |
| Draw / auto-detect redaction zones | HUMAN + AI assist | BUILT (parked) |
| Is separate redaction approval required? | CODE (config toggle) | PLANNED |
| Is the redaction adequate / approved? | HUMAN (approver) | PARTIAL |
| Generate Vaughn index from zones | CODE (zones + citations) | PLANNED |

### Review, delivery, compliance
| Decision | Decided by | Status |
|---|---|---|
| Always review before delivery? | CODE (config toggle) | PLANNED |
| Final approval to release | HUMAN | PARTIAL |
| Delivery method (email / download / mail)? | CODE (from request) | BUILT |
| Statutory deadline? | CODE (classification -> days) | BUILT |
| Is the clock tolled (awaiting deposit / clarification)? | CODE | PLANNED |
| Overdue / at-risk? | CODE | PARTIAL |
| Response category (granted / partial / denied / no records)? | HUMAN + CODE | PLANNED |

### Cross-cutting
| Decision | Decided by | Status |
|---|---|---|
| Can this user act at this stage / see this queue? | CODE (roles) | BUILT |
| Who is it assigned to? | HUMAN (manual) / CODE (claim, auto) | PARTIAL |

---

## Part 2 - Stalls, exceptions & exits (what stops or pauses a request)

These carry most of the compliance risk and most of the requestor disputes. Unlike the happy path, almost none of them involve AI - they are **CODE (timers + math) driven by POLICY, resolved by an event from the requestor or staff.** That is good news: this is exactly where you want zero ambiguity.

### The pending-state model
Anything that blocks a request puts it into a **PENDING state**. Every pending state is fully described by the same five attributes. Define these five and every blocking scenario falls out of one template:

1. **Waiting on** - the event that will resolve it (payment, requestor approval, requestor clarification, custodian response).
2. **Clock behavior** - does the statutory deadline **toll** (pause) while parked? Usually yes whenever the ball is in the requestor's court.
3. **Reminder schedule** - the day-offsets at which reminders fire, and how many.
4. **Terminal fallback** - what happens if it is never resolved (auto-close as abandoned / withdrawn, with which notice).
5. **Resume condition** - the event that un-pauses it and where it re-enters the workflow.

### Pending-states catalog
Policy numbers shown as `<...>` are placeholders to fill from your playbook (Part 5).

| Pending state | Waiting on | Clock tolls? | Reminders | Terminal fallback | Resumes when |
|---|---|---|---|---|---|
| AWAITING_DEPOSIT | Initial deposit payment | Yes | day `<7>`, day `<14>` | Close as **withdrawn (non-payment)** at day `<21>` + notice | Deposit recorded -> work begins |
| AWAITING_ADDITIONAL_DEPOSIT | Approval + added deposit after a cost overrun | Yes | day `<7>`, day `<14>` | Deliver what the paid deposit covers, then close **partially granted**; or **withdrawn** per policy | Approval + added deposit -> resume work |
| AWAITING_REQUESTOR_APPROVAL | Yes/no on a revised estimate (no extra money yet) | Yes | day `<5>`, day `<10>` | Treat non-response as **withdrawal** at day `<10 business>` | Approval received -> resume |
| AWAITING_CLARIFICATION | Requestor to narrow / clarify an overbroad or vague request | Yes | day `<5>`, day `<10>` | **Withdrawn (no clarification)** at day `<15>` + notice | Clarification received -> re-classify & resume |
| AWAITING_FEE_WAIVER_DECISION | Internal approver to grant/deny a waiver | No (internal) | escalate to supervisor at day `<3>` | Auto-deny and fall back to standard fee path | Decision recorded -> resume |
| AWAITING_CUSTODIAN | An internal department to return responsive records | No (internal) | nudge at day `<3>`, escalate at day `<5>` | Escalate to manager; flag at-risk | Records returned -> resume |

### Scenario decompositions (your examples)

**A. Single request, no responsive record found.**
- Decision: are there zero responsive records? **HUMAN** makes the determination; **CODE** issues the closure + notice.
- Path: record search returns nothing -> staff marks "no responsive records" -> request closes in terminal state **NO_RESPONSIVE_RECORDS** with the statutory no-records notice.
- Policy knob: must staff first offer a clarification opportunity before a no-records close? (Some jurisdictions expect it.)

**B. Multi-record request, some children empty.**
- Decision per child: found / not found (**HUMAN**). Roll-up across children (**CODE**).
- Path: each child resolves independently; parent rolls up to **PARTIALLY GRANTED** when at least one child is fulfilled and at least one returns no records (or is denied).
- Policy knobs: deliver found children as they complete, or hold until all children resolve? Re-fee per child or once at parent level?

**C. Deposit unpaid for N days -> reminder.**
- Decision: has the deposit been paid by reminder day? **CODE timer + POLICY.**
- Path: tickler scans AWAITING_DEPOSIT daily; at each reminder offset with no payment recorded, send a reminder email. Clock is tolled throughout.

**D. Deposit unpaid past the closure threshold -> close.**
- Decision: still unpaid at the closure threshold? **CODE timer + POLICY.**
- Path: at day `<21>` with no payment, auto-close as **WITHDRAWN (NON-PAYMENT)** and send the closure notice. (Texas, for example, commonly treats this as a withdrawal - confirm the exact day-count and citation per jurisdiction and store it on the Jurisdiction Profile.)

**E. Costs accrue past the approved estimate mid-process (the change-order case).**
- Decision: does projected/actual cost exceed the approved amount beyond tolerance? **CODE (math) + POLICY (overrun tolerance %).**
- Path: work **pauses** automatically -> a **revised** estimate is generated -> request enters AWAITING_ADDITIONAL_DEPOSIT (approval + added deposit), clock tolled -> resumes only when **both** the approval and the added deposit land.
- This is the cleanest of the lot because it reuses the existing estimate/deposit machinery, just triggered mid-stream. Policy knobs: overrun tolerance before a pause is required; additional-deposit % on the increment.

**F. Requestor refuses the increase (explicit "no").**
- Decision: requestor declined. **REQUESTOR event + POLICY.**
- Path options (policy-defined): (1) deliver only what the already-paid deposit covers, then close **PARTIALLY GRANTED**; (2) requestor narrows scope to fit the funded amount -> re-estimate and resume; (3) full **WITHDRAWAL**. Each raises the **refund question** - its own policy knob (refund unused deposit? retain costs already incurred?).

**G. Requestor never responds (silent).**
- Decision: same fork as F, but triggered by a **timer expiring** instead of an explicit event. **CODE timer + POLICY.**
- Path: reminder chain fires; at the terminal threshold, **constructive withdrawal** - close as **WITHDRAWN (NO RESPONSE)** with notice, applying the same refund policy.

> F and G are the same branch with different inputs: a refusal is an *event*, non-response is a *timer*. Both land on a policy-defined outcome and both trigger the refund question.

---

## Part 3 - The tickler (the time-driven sweep)

Today the engine only reacts to **events**. Every "what stops the request" decision in Part 2 is **time-driven** - it fires because *nothing* happened. That needs a mechanism the system does not have yet:

- A scheduled job (a daily cron / scheduled task) wakes up once a day.
- It scans every request currently in a PENDING state.
- For each, it computes days-in-state and compares against that state's reminder offsets and terminal threshold (Part 2).
- It fires the appropriate action: send a reminder, escalate, or auto-close with the correct terminal notice - and records the action on the request, exactly like the engine records routing decisions.

Design notes:
- **Idempotent**: track which reminders have already been sent so a re-run never double-sends.
- **Business days vs. calendar days**: most statutory thresholds are business days. The tickler must respect the Jurisdiction Profile's holiday calendar and business-day rules - this is also how tolling is computed.
- **One place for "now"**: the same day-math powers deadline status, tolling, and the tickler. Build it once.
- This is the prerequisite for: deposit reminders/closures, clarification/approval timeouts, custodian escalation, and overdue/at-risk deadline alerts.

---

## Part 4 - Terminal states & required notices

The happy path really only models "closed" today. These exits are distinct **compliance outcomes**, each with its own paperwork. A request ends in exactly one:

| Terminal state | Meaning | Notice sent |
|---|---|---|
| GRANTED | All responsive records released | Release / delivery notice |
| PARTIALLY_GRANTED | Some released, some withheld or not found | Partial-release notice + basis for any withholding |
| DENIED | Withheld in full under exemption(s) | Denial notice w/ statutory citation(s) |
| NO_RESPONSIVE_RECORDS | A diligent search found nothing | No-records notice |
| WITHDRAWN_BY_REQUESTOR | Requestor explicitly withdrew | Acknowledgement of withdrawal |
| WITHDRAWN_NON_PAYMENT | Deposit/payment never made by threshold | Closure-for-non-payment notice |
| WITHDRAWN_NO_RESPONSE | Requestor silent past threshold (constructive withdrawal) | Constructive-withdrawal notice |

Each terminal state should carry: the closing reason, the timestamp, who/what closed it (human or tickler), and any refund disposition.

---

## Part 5 - Policy knobs (Jurisdiction Profile)

Every `<...>` in this document is one of these. They are **not** hardcoded - they live as config on the per-state Jurisdiction Profile (the Stripe/Salesforce multi-jurisdiction pattern we locked in), so one codebase serves Texas, California, Florida, etc. Fill these from your own playbook; the suggested defaults are placeholders, not legal advice - confirm each against the governing statute and store the citation alongside the value.

| Knob | What it controls | Suggested default | Your value |
|---|---|---|---|
| estimate_threshold | Cost above which a written estimate is required | `$<40>` | |
| deposit_required_threshold | Cost above which a deposit is required before work | `$<100>` | |
| deposit_percent | Deposit as % of estimate | `<50>%` | |
| overrun_tolerance_percent | How far actual cost may exceed the approved estimate before a mandatory pause | `<0>%` | |
| additional_deposit_percent | Deposit % on the *increment* of a revised estimate | `<50>%` | |
| deposit_reminder_offsets | Days after which deposit reminders fire | `<7, 14>` | |
| deposit_close_threshold | Days unpaid after which the request auto-closes | `<21>` business | |
| approval_response_threshold | Days to respond to a (revised) estimate before constructive withdrawal | `<10>` business | |
| clarification_response_threshold | Days to clarify a vague request before withdrawal | `<15>` | |
| custodian_nudge / escalate | Days before nudging / escalating an internal custodian | `<3 / 5>` | |
| clock_tolls_when_awaiting_requestor | Whether the statutory clock pauses while waiting on the requestor | `<true>` | |
| require_clarification_before_no_records | Must staff offer clarification before a no-records close | `<true/false>` | |
| refund_policy | Refund of unused deposit on withdrawal | `<retain incurred / full refund>` | |
| mrr_delivery | Deliver MRR children as completed vs. hold for all | `<as-completed>` | |
| business_day_calendar | Holiday calendar + business-day rules for all day-math | `<state calendar>` | |

---

## Part 6 - The criteria-transparency principle (and automation readiness)

A core functional-design principle for the visualization / simulator tool: **at every decision node, wherever possible, the user can reveal the exact criteria the system used to decide** - hover or click the node to "show the work." It does two jobs at once: it removes the black box (trust), and it teaches the user what one-time configuration would *automate* that step for every similar request afterward.

### Worked example: "Manual estimate or automated estimate?"

This is the clumsiest, highest-friction decision in real open-records work, which is why it is the model case. The conundrum: to estimate search and redaction labor you normally have to do most of the search and redaction first - so for small, high-volume requests, *building the estimate can cost nearly as much labor as fulfilling the request.* The whole point of automating it is to spend the labor once per record type, then reuse it.

**Where it sits:** immediately after the fee-waiver determination. If there is no waiver, the system asks - can this request be auto-estimated, or does it need a human?

**Decided by:** CODE (profile lookup + variance / confidence gate) + POLICY (size and dollar bounds). Routes to HUMAN only on exception.

**The criteria the node checks, cheapest first (the estimate-automation ladder):**
1. Does the matched **record type have an estimation profile?** - seeded from historical actuals of completed requests, from sampling at taxonomy discovery, or from a one-time human-expert seed.
2. Is the profile **reliable** - low variance and a sufficient sample size? (a type that is 1 page sometimes and 20 other times is not safe to auto-average)
3. Is the request **within normal bounds** - not unusually large, not high-dollar, not a novel type?

All yes -> **AUTOMATED** estimate, zero human effort. Any no -> route to a **MANUAL** estimate (or trigger a scoping search: matching-item count x average pages per item).

**What the "show criteria" panel displays at this node:**
- When automated - the exact basis: *"Record type 'Building permit' has a profile seeded from 14 completed requests; page-count variance +/- 2 (low); within normal size and dollar bounds -> auto-estimated at $X. Basis: historical actuals."*
- When manual - the teaching moment: *"No reliable estimation profile exists for this record type yet, so this request needs a human estimate. Seed the profile - enter typical values on the record type, sample during discovery, or simply complete a few of these - and every future request of this type will auto-estimate."*

That second message is the configuration payoff made concrete: the user sees that the manual step in front of them is optional *for the next one*, if they invest once.

### The same pattern everywhere (automation readiness)

The estimate is the showcase, but the principle generalizes: most "manual" nodes are manual only because a piece of reusable configuration has not been created yet. At any such node the tool can show *why it was manual* and *what converts it to automatic*:

| Node | Manual today because... | Configure this once -> automatic next time |
|---|---|---|
| Estimate | no reliable profile for this record type | seed the record-type estimate profile (historical / sampling / expert seed) |
| Redaction | no template for this record type / exemption pattern | build a mass-redaction template or redaction profile |
| Routing to a team | low match confidence or no owning team | enrich the taxonomy (record types, owning teams) |
| Routing to a person | no specialization captured | add specialization text to the person / team |
| Public-readiness / bypass | type not marked releasable-as-is | add the type to the known-clean registry |
| Deadlines / tolling / deposit gates | jurisdiction values blank | fill the Jurisdiction Profile (Part 5) |

This is the onboarding and sales story made visible: a prospect or a new clerk walks a real-looking request, sees which steps ran automatically and which needed a person, and sees exactly what one-time setup turns the manual ones into automatic ones for every similar request after. "Effort spent once per type, then reused" - the same philosophy behind reusable redaction templates and seeded estimate profiles.

---

## Part 7 - How this powers the Process Flow Simulator

The simulator (functional spec 15.9) walks a hypothetical request through this tree. Each row in Parts 1-2 becomes a **node**, and the *Decided by* column tells the simulator how to handle it:

- **HUMAN** node -> asks you the question and waits for a click (e.g., "Are there responsive records? Yes / No").
- **CODE** node -> auto-resolves and shows the rule or math that fired (e.g., "cost $312 > approved $250 -> pause + revise").
- **AI** node -> shows what the model proposed and at what confidence, and lets you accept or override.
- **Criteria panel (every node)** -> hover or click reveals the exact criteria the node used and, where it was manual, the one-time configuration that would automate it next time (see Part 6).
- **POLICY** values -> appear as the simulator's toggle/number panel (the same knobs from Part 5), so changing "deposit % = 50" and re-walking shows a different path.
- **Time-driven** nodes -> the simulator lets you "advance the clock N days" to watch reminders fire and terminal states trigger - the only way to *see* the stall/exit branches.

Walking forward = answering nodes in order. **Backtracking = re-answering one node and recomputing everything downstream** - which is exactly your "move back and change a decision to go down a different path." The engine already produces the decision trail for the routing nodes, so the simulator is not starting from zero; it is a visualization layer over this inventory plus the engine.

---

*Living document. Update the Status column as nodes are built. Owner: Kevin. Last structural update: workflow-decision inventory (happy path + stall/exception/exit model).*
