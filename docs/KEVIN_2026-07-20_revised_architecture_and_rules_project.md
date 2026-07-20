# Kevin, 2026-07-20 — Revised architecture + the rules-data project

**Source:** `uploads/post parent child schema deploytment process flow and rules data project.pdf` in the
`optimumq-ai/development` repo. This is the write-up reconstructing the conversation **lost to a dropped
connection on 2026-07-19** (see HANDOFF (ae)). Kevin's wording is preserved below where it rules on something;
paraphrase is marked as such.

> ⚠️ **This document carries a STOP.** See §1.6.

---

## 1. Revised architecture (parent/child processing)

### 1.1 The complaint that prompts it
> *"It appears from what I see when I click into request queue and open a record, (noting the progress bar at
> the top labelled processing pipeline) that the design was created in a way that combined processing of tasks
> and status of events not associated with actual work done in processing tasks, and the bar applies to the
> failed model of the prior data schema."*

Two defects named in one sentence: the pipeline bar **mixes work with non-work status**, and it is drawn
against the **pre-parent/child schema**. This is `TARGET_process_model.md`'s D1 and D5 seen from the UI.

### 1.2 The parent is not processed
> *"Keep in mind that a parent record is conceptually not processed, with execption of estimate/payment and a
> few other items….Any processing of a request is at the child level where the description exists."*

Consistent with the ratified parent/child model and with CLAUDE.md's "read parent facts THROUGH the parent."
**New and sharper:** estimate/payment is explicitly named as parent-level *processing*, not merely a parent
*fact*.

### 1.3 Driven by task completion — D1 ANSWERED
> *"The workflow for processing child request items is to be driven by task completion."*

**D1 is literal.** Not "stage remains as a derived readable position" — the driver is task completion.

**Scope fence for now:** *"Exclude MRR for the moment and consider only single item request processing."*

**The typical path** (Kevin's list, verbatim): *"intake review, estimate information collection, records
search, redaction/legal redaction/delivery (ignoring review tasks att the moment for simplicity)."*
Note this names **intake review** and **delivery** as steps — bearing on D7 — and splits **estimate
information collection** from calculation, which is D4's missing split.

**Still open, by Kevin's own statement:** *"I have not thought through the branch or an item request that
triggers legal review, and will do that asap."* The legal branch stays OPEN (as §3 already had it).

### 1.4 Parent status — D5's open question ANSWERED
> *"At the parent level, for simpicity, assume that the status of a parent is either active or closed, or hold
> awaiting payment."*

**The deposit pause is at the PARENT level — whole-request, not per-child.** That closes the question
`f67fda5` left as the top of §5.

⚠️ **Consequence to carry into the design session:** this makes the two payment gates *deliberately
asymmetric*, and that asymmetry should be stated rather than discovered later —
- **deposit** (pay before work) → **parent-level**, pauses the whole request;
- **release** (pay before delivery) → **per-child** by design (*"a child may never be withheld because a
  SIBLING is unpaid"*).

Coherent — an up-front deposit is collected for the request, a release gate withholds specific records — but
the code must not "simplify" them into one mechanism.

### 1.5 Closure is driven from the child
> *"Closed at the parent level would typically be driven by a terminal status event at the child level….no
> response to request for clarification within statutory timeline would be one. No matching records would be
> another."*

So terminal events fire at the **child**, and the **parent** closes as a consequence. This is D8 (terminal
events are three bespoke paths, not a modelled concept) — now with a required direction of travel.

### 1.6 ⚠️ THE OPEN MECHANISM, AND THE STOP
> *"However, in the parent should be able to pause processing of a child..example processing complete,
> delivery is next step, processing is paused by 'awaiting payment' at the parent level. Whether this is done
> by something executing was the parent level that is impacts the child level process or whether the child
> monitors for a status of awaiting payment might be different from an event such as a parent changing status
> to closed due to non-payment."*

**The undecided question:** does the parent **push** the pause down onto its children, or does each child
**pull** — monitoring parent status before it advances? Kevin notes the answer may legitimately **differ**
between a *pause* (awaiting payment) and an *event* (parent closes for non-payment).

> *"We need to have a detailed design session to address this before more development takes place as I believe
> we've been applying changes that might break when code is revised to enable this concept."*

**→ PIPELINE/STAGE DEVELOPMENT IS STOPPED pending that design session.** Not a preference — Kevin's stated
concern is that in-flight changes will break under the revision.

**Assessed still safe** (unchanged from the D1 assessment in `TARGET_process_model.md`): task **screens**,
whose three-part shape survives both models. **Not safe:** anything touching stage vocabulary, the pipeline
bar, or branch modelling.

---

## 2. The rules-data project ("big bang" 50-state research)

### 2.1 Why — the fragmentation being corrected
> *"there have been multiple iterations of gathering regulatory/statutory information specific to an ai driven
> configurability model starting with fee calculations… another iteration for estimate rules… a third
> iteration recently… the concept of a sample has resulted in complications and effort that might have been
> minimized had we completed a 'big bang' appproach to research, attempting to gather all rules from all 50
> states, and condensed down to a paramterized model."*

Confirms the existing prior art is exactly the fragmentation complained of: `JURISDICTION_RULES.md`
(2026-06-24, **5 states**) and the fee/estimate iterations. **This project supersedes the sampled approach.**

### 2.2 Categories
> *"rules for fees/estimates, redaction, communications, calendar/tolling, and whatever elses makes sense."*

Explicitly open-ended, and Kevin notes the set grows: *"expanding the categories with each pass so that AI
will be able to more cleanly assign with it determines to be a rule with generating output."*

### 2.3 Deliverable
A **parameterized list per category**, and — stated as a goal in its own right — *"This would allow a change
to the UI that is simpler to understand."*

### 2.4 The configuration UI
- Nav label: *"Statutory/Regulatory Rules Configuration (i'm sure we can come up with a better description)."*
- Category screen ← *"virtually the same content as the corresponding rules list, and this is the UI that
  would be used for configuration for that category."*
- A **library** per category: button to access, content in a window, **upload documents**, plus
  *"Some method of managing/deleting."*
- **Existing vs revised, side by side.** *"Existing is for reference, display only."*
- **AI populates on demand:** *"A button can be clicked to populate AI suggestions. Each individual item
  populated by AI could be accpted or manually corrected/modified."*
- **Two-tier rights:** a lesser-rights user may only *"save as proposed revision"*; **review/edit/submit**
  belongs to *"the individual person responsible for that category"*, named during setup —
  *"requiring no judgement or determination by the system. The user name/email would be the 'rights' rule."*
- **Attestation on submit:** *"an attestation window pops up explaining that the city is responsible for
  accurancy and legal compliance of the configuration, with a button to go back to review or a button to
  acknowledge and submit."*

✅ **This is `AUTO_CONFIG_DESIGN.md`'s trust model, independently restated** — AI drafts → city reviews →
city attests → live, per area. The two documents agree; the new material is the **per-category responsible
person as the rights rule** and the **document library per category**. Build on that spec, don't fork it.

### 2.5 Where Kevin is
> *"I am currently working through a refined prompt and legal information gathering passes for a few states
> using chapt gpt. I will upload the prompts and results later."*

Testing *"if limiting the scope resources to a defined type provides virtually the same results with less ai
proceesing effort."*

### 2.6 His questions to Claude (answered in chat 2026-07-20; summary)
1. Review/revise/test the prompt, then **spawn one agent per state** without his involvement — **yes**, this
   is what the Workflow tool does (one agent per state, fan-out with a verify stage).
2. **Review output, flag likely errors, relaunch those states** — yes; the durable form is a **per-value
   citation** requirement, verified mechanically, rather than a verifier asked "does this look right."
3. **Copy results to his GitHub** — mechanically possible (remote + stored credentials present); **pushing is
   outward-facing, so it gets explicit confirmation each time, not standing authorization.** He expects to
   create a separate repo for this data.

**Recommendation recorded for the session that runs this:** invert the order. Define the **candidate
parameter schema first**, have each state agent **fill it** under structured output, and route what does not
fit into an explicit *"doesn't fit"* bucket — that bucket is what legitimately grows the category list.
Free-writing 50 states and condensing afterward makes the condensing step the hard problem, which is the
failure this project exists to correct. This is `AUTO_CONFIG_DESIGN.md` §1 — *expressiveness precedes
automation* — applied to the research itself.
