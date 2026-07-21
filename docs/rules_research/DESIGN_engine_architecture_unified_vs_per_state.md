# Design note — engine architecture: unified + state profiles vs per-state engines

> Discussion captured 2026-07-21 (Kevin + Claude). **Status: OPEN** — a recommendation is recorded
> below, but the decision is deferred to a hands-on spike (see §7). Relates to
> `DESIGN_master_list_and_city_config.md` (the two-layer state/city model) and `AUTO_CONFIG_DESIGN.md`.

## The question

Do we build **one** configurable engine per capability (a single calendar/tolling/due-date engine, a
single fee/estimate engine, …) that expresses every state's model and is parameterized per state — or
do we build a **separate engine per state** using only that state's rules, with the code routing a city
to its state's module?

The motivation for the per-state idea: a city's configuration interface would show only the items its
own state recognizes, instead of potentially confusing them with knobs that don't apply.

## Reframe: two questions were conflated

**Q1 — customer clarity** (a city sees only what applies to it) and **Q2 — engine architecture** (one
engine vs many) are separable. The customer never touches the engine; they touch the **config UI**,
which is driven by their state's config profile *regardless of how the engine is built*. So customer
clarity is a **view-layer** property, achievable under either architecture. It should not, by itself,
drive an engine fork.

## What does NOT change on either path

**We still need a comprehensive list of every relevant rule for every state.** The completeness
guarantee from `DESIGN_master_list_and_city_config.md` — "every configuration item a city could need
under its state's law actually exists on the screen" — is required whether the engine is unified or
forked. A per-state engine still has to be built from that state's complete rule set, and there is no
cross-checkable completeness surface without the master list. **The gather/reconcile/master-list work
is substrate for both paths, not a bet on one.** (Exclusions of out-of-scope rule types, per
`EXCLUSION_review.md`, apply equally either way.)

Because the two-layer model already scopes the **state layer** per state (a city is in exactly one
state and pre-loads only that state's active fields + constraints), the "only what they recognize"
benefit is *already available* — it is a matter of rendering the state-scoped profile, not of forking
the engine.

## The real, narrower choice

Not "one engine vs fifty engines," but:

- **A — Unified engine + per-state config profiles (data).** One implementation of each capability;
  each state is a data profile selecting active levers, enabled stages, and constraints.
- **B — Per-state engines (code).** A hand-built engine per state, code routes the city to its module.

### Trade-offs

| | A — Unified + profiles | B — Per-state engines |
|---|---|---|
| Shared mechanics (business-day/holiday math, tolling state machine, ceiling/floor application) | Implemented **once** | Duplicated **~50×** |
| Cross-cutting change (new tolling variant, bug in date math) | 1 change | ~50 changes |
| Adding state N+1 | Author a profile (data) | Build + test an engine (code) |
| Completeness / coverage tooling | Master list gives one surface to verify | No cross-checkable surface across 50 engines |
| Customer config surface | State-scoped view of the profile → clean | Clean (but no cleaner) |
| Genuinely different **shapes** across states (structural forks) | Handled by composing stages (see below) | Handled naturally, but by duplicating shared parts too |

The mechanics of calendars, tolling, and fee estimation are **largely identical** across states — only
the parameters (5 days vs 10; 15¢ vs 25¢) and **which stages are active** differ. Forking by state
copies the shared machinery; that is the core cost of path B.

## Where the per-state instinct is genuinely right

States differ **structurally**, not only by value — a large share of concepts are `structural`, not
`parameter` (e.g. TX AG pre-clearance, judicial-vs-administrative appeal forks, eligibility gates).
These can't be handled by "same code path, different number."

The fix is to modularize the engine by **stage / capability, not by state**: implement each stage once
(intake, response-clock, fee-estimate, tolling, appeal-fork, AG-review, …) and let a **state profile
compose the subset of stages that state needs**. One implementation per stage; arbitrary per-state
composition; the customer sees only the stages their profile activates. This delivers what the
per-state idea reached for, without the ~50× maintenance.

## Recommendation (leaning, pending the spike)

Single engine, with:
1. **Pluggable stages** — modularize by capability, so structural forks are *composed*, not branched.
2. **State profiles** — each selects active levers + enabled stages + constraints; the config UI
   renders strictly from the profile, so the customer's surface is state-clean.

This is essentially the design already recorded in `DESIGN_master_list_and_city_config.md`. The new
customer-clarity concern becomes an explicit **UI-scoping requirement** on top of it, not a reason to
fork the engine.

## §7 — The experiment / spike (2026-07-22)

Decide from real build experience, not on paper. Plan:

1. **Pick a deliberately diverse set of states** — choose for *shape diversity*, not convenience, so
   the spike hits the hard cases. Good spread: a fixed short window (NY 5-day), a soft "reasonable"
   standard (OH), a ceiling-based window (GA 3 business days), a structural fork (TX AG pre-clearance),
   and a fee-heavy state. (The salvaged 10-state rule set is already on hand if we want to prototype
   against real rules immediately, with no new discovery spend.)
2. **Gather the relevant rules per state** (reusing the master-list pipeline + exclusions).
3. **Prototype the capabilities both ways** for those states — the **calendar/due-date**, **tolling**,
   and **fee/estimate calculator** — once as unified-engine-with-profiles, once as per-state modules.
4. **Compare on real signals**, e.g.:
   - How much of each capability's logic was truly state-specific vs shared? (High shared → A.)
   - How many genuinely distinct *stages* appeared? (Drives how much composition machinery A needs.)
   - Effort to add the *next* state under each.
   - Cost of a cross-cutting change (introduce a new tolling rule and apply it everywhere).
   - Could the unified profile's state-scoped config view be made as clean as a bespoke per-state UI?

Outcome: enough real information to close this note with a decision.

## Open questions to resolve during the spike

- **Structural : parameter ratio.** The 8-state pivot showed **125 structural vs 48 parameter** —
  structural-heavy, but partly the fragmentation bug (e.g. `eligibility.any_person` mislabeled
  structural). The lever-not-value + one-home-per-concept fixes should pull this toward parameter;
  re-check the ratio on the clean 10-state run before sizing the stage-composition machinery.
- **How many distinct stages** the engine really needs (bounds the composition complexity of A).
- **Routing/versioning** of profiles as state law changes over time (a shipped-asset update problem).
