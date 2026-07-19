# DESIGN — Go-live readiness, the setup wizard, and configuration gating

**Status: CAPTURED THINKING — `[BUILD LATER, DELIBERATELY]`.** Written 2026-07-19 from Kevin's requirements plus
a full inventory of what already exists (docs + code + live DB). **This is not a work item.** Kevin's own
reasoning for deferring it:

> *"It needs to be something built when the product is near completion otherwise it will likely need to be
> rebuilt to some extent at that point anyway."*

That is right for the **wizard**. §4 argues it is *not* right for the **gates**, which is the one substantive
disagreement in this document.

---

## 1. The requirement (Kevin, 2026-07-19)

1. A **go-live checklist** — all items must be complete before the system can go live.
2. The **setup/configuration wizard** (partially built, on the main nav) gets revisited near product completion.
3. It should do two jobs: **help** the customer through setup, and **mandate** completion — specifically
   review/attestation sign-off of **fee configuration**, **redaction rule configuration**, and the
   **MRR configuration table** (§15 of `SPEC_parent_child_lifecycle.md`).
4. **Email reminders increasing in frequency** as the go-live date approaches.
5. **~2 weeks out the message changes** to something like *"your key will deactivate if mandatory configuration
   is not complete as of the go-live date."*
6. **Contract reference** — believed already noted; possibly a **separate release/disclaimer for signature**,
   perhaps as an attachment.

---

## 2. What already exists — verified 2026-07-19

Considerably more than expected. Two things Kevin could not place are the load-bearing ones:
**`AUTO_CONFIG_DESIGN.md`** (the trust model, 2026-06-24) and **`ONBOARDING_TAXONOMY_GATING.md`** (the two-key
licensing strategy, 2026-06-25 — which already anticipates requirement #5).

| Piece | Status |
|---|---|
| **Setup wizard** | **BUILT.** 7 phases, on the main nav for elevated roles, with **live readiness signals computed from real DB state** — not checkboxes. `SetupPage.js` → `GET /api/onboarding` → `onboarding_progress` |
| **Reviewer + approval flow** | **BUILT.** Assign a reviewer, send a branded review-request email, `/approve` restricted to that reviewer or an admin |
| **Fee sandbox gate** | **BUILT and it genuinely bites.** Approving the `fees` phase requires `test_status='confirmed'` **and** a `test_config_ref` matching the current active fee-profile version — so the confirmation auto-invalidates when the config changes |
| **Attestation mechanism** | **BUILT, full cycle verified.** `jurisdiction_profile_sections` carries `attested_by/at/version/hash`; drift is detected by comparing `attested_hash` to a recomputed `content_hash`, so a stale sign-off cannot persist |
| **Redaction rule approval** | **BUILT and genuinely enforced** — but by a different mechanism than attestation. Rules are created `pending_review` + inactive by *every* path (manual, AI discovery, config extraction), and `zoneDiscovery` selects only `approval_status='approved' AND is_active=1`. An unapproved rule cannot influence redaction |
| **Go-live gate** | **DECIDED HARD, BUILT SOFT.** `AUTO_CONFIG_DESIGN.md` §11 decided un-attested = safe/manual, no automated action, and "cannot be flagged fully live until all REQUIRED areas are attested" |
| **Automation double-gate** | **BUILT.** `automationActive(policy, attested) = policy.enabled && attested` guards clarification timeout, deposit action, fee forfeiture. Un-attested degrades to **manual**, never errors — the right failure direction |
| **Contract checklist** | **CAPTURED for counsel**, not drafted — `BUSINESS_LEGAL_IP_LOG.md` |
| **Two-key licensing** | **DESIGNED, NOT BUILT** — `ONBOARDING_TAXONOMY_GATING.md` |
| **Escalating reminders** | **NOTHING.** Greenfield |

### 2.1 …and none of it actually gates go-live today

- **The wizard gates nothing outside itself.** `onboarding_progress` is read by exactly one route and two
  frontend files. No redirect, no route guard, no service consults phase completion. **An agency can run the
  entire system with all 7 phases `not_started`** — which is exactly the live state.
- **There is ONE hard enforcement point in the whole codebase**: sending a fee-estimate notice returns 409
  `{needsAttestation}`. That is it.
- **`dev_mode = '1'` in the live DB**, and `dev_mode` bypasses `checkSection` entirely — so even that one gate
  is currently off.
- **Zero attestations exist: 0 of 180 `jurisdiction_profile_sections` rows are attested.** The mechanism has
  never fired in production.

**This was deliberate, and the reasoning is worth preserving** (`JURISDICTION_PROFILE_DESIGN.md`):

> *"We intentionally did NOT hard-gate live request processing (fees/routing/redaction) on attestation now:
> with nothing yet attested that would flip the whole demo to manual and break working flows. That hard-gate
> becomes meaningful only once cities actually sign off in production."*

So the retreat was a demo-stage decision, not an oversight — but it means **the gating exists as a mechanism
with no teeth, and turning it on is a distinct, deliberate act** that has never been performed.

---

## 3. ⚠️ Two defects found while inventorying — these are not "build later"

**(a) ~~A fresh install does not reproduce the live wizard.~~ FIXED 2026-07-19 (`9c0cfbc`).** `schema.postgres.sql` seeds **6** phases and no
`fees` row; `requires_review` is added with `DEFAULT false` and **nothing in the codebase ever writes it**.
Live has **7** phases with `requires_review = true` on `jurisdiction`, `fees` and `redaction` — applied by
hand. **A new city install would therefore get a wizard with no Fees phase and no gated phases at all**, which
is precisely the opposite of the intended posture. This is the same class as the 2026-07-14 (xr) finding, where
a fresh install was missing the onboarding review/test columns entirely.

> **Fixed:** all seven phases are now seeded (redaction moved to order 6), plus a convergence block that repairs databases seeded from the older six-phase list. Both statements are `IS DISTINCT FROM`-guarded, so they are genuine no-ops on an existing install — verified, live is unchanged. New harness `verify_fresh_install` (26 assertions) asserts the wizard the schema ALONE produces, and additionally that `SetupPage`'s `PHASE_META` can render every seeded phase, catching drift in either direction. Break-tested: reverting the schema fails 8 assertions.
>
> **The rule it now enforces: THE LIVE DATABASE IS NOT THE SPECIFICATION.** Anything a city needs on day one must come from the schema, not from someone remembering to run an UPDATE. The suite is the only place a fresh install is ever exercised, since `reset_test_db.js` builds from empty.

**(b) `dev_mode = '1'` in live.** Correct for a demo; **must be part of the go-live checklist itself**, or the
first real customer runs with enforcement disabled and nobody notices. Note the flag's default is ON (bypass) —
fail-open — so this cannot be caught by omission.

---

## 4. The one architectural disagreement: gates and wizard have OPPOSITE timing

Kevin's instinct — build it near completion or it gets rebuilt — is **right about the wizard and wrong about
the gates**, and conflating them is what would cause the rebuild he is trying to avoid.

- **A readiness gate is DOMAIN-LOCAL.** Only the fee domain knows what "fee config is complete" means. Only
  the MRR matrix knows its rows are answered. Only redaction knows an unapproved rule is inert. These rules
  should be written **as each domain lands**, while the knowledge is fresh — which is exactly what already
  happened for fees (the sandbox gate) and for redaction (the approval gate). Both are good, and both were
  written by the people building those domains.
- **The wizard is a SHELL over those gates.** It enumerates domains, renders status, sequences them, and nags.
  It owns **no domain knowledge of its own**.

If gates accumulate as domains land, the wizard at the end is genuinely thin — it reads a registry and renders
it. If they do not, then at go-live someone reverse-engineers completeness rules for a dozen domains nobody
remembers. **That is the rebuild.**

**Concrete implication:** every domain landing from here should register its own readiness rule at build time.
**The MRR Rule Matrix (§15) is the first test of this** — it already specifies its own completion gate
("MRR does not unlock until the matrix is complete"), which is exactly the right shape. It should register that
rule when it is built, not wait for a wizard.

---

## 5. Requirement #5 — "the key will deactivate" ⚠️ RECONSIDER

**This is the requirement I would push back on hardest, and there is already a better design in the repo.**

**The risk.** Deactivating a records system a city depends on for **statutory compliance** is legally fraught in
a way ordinary SaaS deactivation is not. If a city cannot respond to public-records requests because the vendor
switched off their key, the resulting missed statutory deadlines are a harm the vendor plausibly caused. That is
close to the opposite of the liability posture in `BUSINESS_LEGAL_IP_LOG.md` §1 ("the agency is the
decision-maker of record; Optimum Q is the tool"). A tool that disables the agency's ability to comply is no
longer merely a tool.

**The better design already exists** — `ONBOARDING_TAXONOMY_GATING.md`, Kevin, 2026-06-25:

> - **Setup key** (provisioning): build configuration/rules, run mass redaction, connect sources, build the
>   taxonomy. Public search NOT yet live.
> - **Production key**: turns on public portal search. Withheld until connectors are live AND taxonomy ≥ 90%.
> - *"Contract states plainly that search is not functional until connectors are live and the taxonomy reaches
>   the threshold. Honest framing: the production key is withheld because search genuinely fails without a
>   robust taxonomy — not an artificial gate."*

**The distinction that matters: WITHHOLD ACTIVATION, never REVOKE IT.** Gating a capability that was never
turned on is a delivery milestone. Turning off a capability a city is actively relying on is a service
interruption with statutory consequences. The two-key model is the first; "your key will deactivate" is the
second.

**Suggested reframing of requirement #5**, preserving the commercial intent:
- Mandatory configuration incomplete at go-live ⇒ **the production key is not issued** and go-live does not
  occur. Nothing is taken away, because nothing was live.
- Escalating reminders say *"go-live cannot proceed until X, Y, Z are complete"* — accurate, and it creates the
  same urgency without a threat the vendor may not want to be able to execute.
- If a hard stop after go-live is genuinely wanted, scope it to the **discretionary** surface (public portal
  search) and never to statutory-duty surfaces (intake, deadline clocks, request processing).

**This is Kevin's call, not mine** — but the wording should be settled with counsel *before* it goes in a
contract, because the contract language and the enforcement mechanism have to say the same thing.

---

## 6. Legal / contract — what exists

`BUSINESS_LEGAL_IP_LOG.md` already carries the checklist, marked `[FOR COUNSEL]`: platform implements
agency-directed policy and does not verify compliance or give legal advice · agency **solely responsible** for
compliance of its configured policies · **indemnification** · **limitation of liability** cap · explicit
"not legal advice" disclaimer · consider E&O · **surface a short version of the responsibility allocation at
the configuration/approval point in the product, not just buried in ToS**.

**The in-product disclaimer modal is BUILT** (attest and config-freshness-apply both present a disclaimer plus
a required "I have reviewed and authorize" checkbox). **Attorney review of the final wording has not
happened** — still flagged open in `AUTO_CONFIG_DESIGN.md`.

**On the separate signature document Kevin asked about:** none is currently designed. The only signature
artifacts designed are a click-through NDA for the gated demo site and a security attestation letter for
prospects. **The configuration sign-off today lives entirely in-product, per section.** Whether that is
sufficient or wants a countersigned attachment is a question for counsel — and it interacts with §5, since a
deactivation right in particular would want to be explicit and signed.

**Two patent candidates are already logged against this architecture**: (a) AI-pre-populated,
human-approval-gated jurisdiction configuration with per-phase designated-reviewer sign-off and audit trail;
(b) the mandatory interactive fee/estimate **test-sandbox gate**, where configuration cannot be approved until a
reviewer runs scenarios against the live engine and the confirmation is version-bound. Both are *built*.

---

## 7. Gaps against the requirement

| # | Requirement | Gap |
|---|---|---|
| 1 | Go-live checklist, all complete | Mechanism exists per-domain; **no aggregate "are we ready" concept**, and `AUTO_CONFIG_DESIGN.md` §11's open item — *"'Required areas' definition for the go-live gate — finalize the default set"* — is still unresolved. That definition IS the checklist |
| 2 | Revisit the wizard | Wizard is real and better than remembered. Needs: the fresh-install defect fixed (§3a), a domain registry instead of a hardcoded phase list, and MRR added |
| 3 | Mandate fee / redaction / MRR sign-off | Fees ✅ (sandbox + attestation). Redaction ✅ *for rules*, ❌ for **templates** and **redaction thresholds/master switch**, which have no gate at all. MRR ❌ — not built, but §15 already specifies its own gate |
| 4 | Escalating reminders | **Nothing.** One flat-cadence pattern exists to copy (`feeNonpayment`: timestamp column + daily sweep + threshold), but it fires **one** reminder then a terminal action. Recurring/escalating needs a counter or last-sent column |
| 5 | Key deactivation | Two-key strategy designed, not built. **See §5 — recommend withhold-not-revoke** |
| 6 | Contract + signature doc | Checklist captured; **nothing drafted**; attorney review outstanding; no separate signature artifact designed |

---

## 8. Open questions

1. **What is the "required areas" set?** This is the actual go-live checklist and it has been open since
   2026-06-24. Candidates: jurisdiction identity, deadlines, fees, redaction, exemption, taxonomy, MRR matrix,
   departments/teams, repositories.
2. **Does go-live flip `dev_mode` off, and who verifies it?** (§3b)
3. **Withhold or revoke?** (§5) — needs settling with counsel before contract language.
4. **Do redaction templates and the redaction master switch need a gate?** Rules are protected; these are not.
5. **Is in-product per-section attestation sufficient, or is a countersigned document wanted?**
6. **Attorney review of the disclaimer wording** — open since 2026-06-24, and it blocks first customer.
7. **Remove the "Check for updates" button** and any language implying the platform maintains legal currency —
   logged three times as due *"after the onboarding wizard is built."*
