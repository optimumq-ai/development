# Design note — engine architecture: unified + state profiles vs per-state engines

> Discussion captured 2026-07-21 (Kevin + Claude). **Status: OPEN — DEFERRED.** A leaning is recorded,
> but the decision is **explicitly parked until the rules exercise (gather + consolidate all relevant
> rules for the target states) is complete.** Relates to `DESIGN_master_list_and_city_config.md` (the
> two-layer state/city model) and `AUTO_CONFIG_DESIGN.md`.
>
> **Update 2026-07-21 (Kevin):** a second, stronger motivation for per-state segregation has been
> added — **fault isolation / update blast radius** (see §5b). This is independent of the
> customer-clarity motivation and is *not* dissolved by the view-layer reframe; it materially shifts
> the balance toward per-state segregation and is now the primary driver to weigh. Near-term work
> pauses the wave run and focuses on improving the gather/consolidate pipeline; the engine-architecture
> decision is to be planned **after** the rules exercise finishes.

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
| **Fault isolation / update blast radius** (§5b) | A regression in shared logic can reach **every** state on update | **Contained** — a state's logic change touches only that state's customers |

The mechanics of calendars, tolling, and fee estimation are **largely identical** across states — only
the parameters (5 days vs 10; 15¢ vs 25¢) and **which stages are active** differ. Forking by state
copies the shared machinery; that is the core cost of path B. The core cost of path A is the last row —
a shared fault surface. **These are the two forces in tension**; the rest of the table mostly favors A.

## §5b — Fault isolation / update blast radius (the decisive new driver)

The strongest reason for per-state segregation is **operational, not UX**: with one all-encompassing
configurator, a fix for a bug reported in *one* state — written under pressure, with a regression that
testing doesn't catch — can ship to and break customers in *other* states when they next update. A
**library whose configuration code/logic files are segregated by state** lets an update ship for only
that state's files, so the blast radius of a bad fix is bounded to that state's customers.

Important scope note (Kevin): this is about the **code/logic files** — the calendar/tolling/estimate
*logic* — **not** the configuration *data* a customer produces during setup. The data is per-city
regardless; the question is whether the *logic that consumes it* is shared or per-state.

The consequence: estimate, tolling, deadline, etc. logic may need to live (to some extent) **inside
each state's files** rather than as one universal implementation — accepting some duplication as the
price of isolation. This directly opposes path A's "implement each mechanic once," which is exactly why
the decision is now genuinely balanced.

**A spectrum, not a binary.** Full duplication is not the only way to get isolation. Options, from most
shared to most isolated:
1. **Unified engine + profiles** — max reuse, shared fault surface (path A).
2. **Shared core + per-state override modules** — common mechanics in a core lib; each state has an
   override file that can replace any piece. A state-only fix edits that state's override; the shared
   core is touched only for genuinely universal changes. Partial isolation.
3. **Per-state logic modules, independently versioned + staged rollout** — each state's logic is its own
   deployable unit with its own test suite; updates roll out per state. Strong isolation, more duplication.
4. **Fully separate per-state engines** — max isolation, max duplication (path B).

Where on this spectrum to land is exactly what the rules data + a hands-on spike should decide: how much
of the calendar/tolling/estimate logic is *truly* shared vs state-specific determines how much isolation
costs. If most logic is shared, (2) buys most of the isolation cheaply; if states diverge structurally,
(3)/(4) get more attractive.

## Where the per-state instinct is genuinely right

States differ **structurally**, not only by value — a large share of concepts are `structural`, not
`parameter` (e.g. TX AG pre-clearance, judicial-vs-administrative appeal forks, eligibility gates).
These can't be handled by "same code path, different number."

The fix is to modularize the engine by **stage / capability, not by state**: implement each stage once
(intake, response-clock, fee-estimate, tolling, appeal-fork, AG-review, …) and let a **state profile
compose the subset of stages that state needs**. One implementation per stage; arbitrary per-state
composition; the customer sees only the stages their profile activates. This delivers what the
per-state idea reached for, without the ~50× maintenance.

## Recommendation — no lean yet; decide after the rules exercise

With only the customer-clarity motivation, the balance favored a single engine + profiles. The
fault-isolation driver (§5b) changes that: there are now **two strong, opposing forces** —
maintenance economy (favors shared logic) vs update blast-radius containment (favors per-state
segregation) — and they can't be traded off honestly without knowing **how much of the
calendar/tolling/estimate logic is actually shared vs state-specific.** That is precisely what the
rules exercise will reveal.

So the recommendation is **to decide later**, and in the meantime treat the design space as the §5b
spectrum (unified → shared-core+overrides → per-state modules → separate engines) rather than a binary.
Whatever the outcome, two things hold on every path and can be built now without prejudging it:
- the **comprehensive per-state relevant-rule master list** (required substrate — see below), and
- **modularization by stage/capability** (structural forks composed, not branched) — this is
  orthogonal to the shared-vs-segregated axis and helps under any option.

## §7 — The experiment / spike (after the rules exercise)

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
   - **Blast-radius test:** make a *state-specific* fix under each option — does it force a shared-core
     change (putting other states at risk on update), or stay contained to that state's files? (§5b.)
   - Could the unified profile's state-scoped config view be made as clean as a bespoke per-state UI?

Outcome: enough real information to close this note with a decision.

## Open questions to resolve during the spike

- **Structural : parameter ratio.** The 8-state pivot showed **125 structural vs 48 parameter** —
  structural-heavy, but partly the fragmentation bug (e.g. `eligibility.any_person` mislabeled
  structural). The lever-not-value + one-home-per-concept fixes should pull this toward parameter;
  re-check the ratio on the clean 10-state run before sizing the stage-composition machinery.
- **How many distinct stages** the engine really needs (bounds the composition complexity of A).
- **Routing/versioning** of profiles as state law changes over time (a shipped-asset update problem).
