# SPEC — Setup & Configuration Hub (binding)

**Status:** design CLOSED 2026-08-24 (Kevin; canvas https://claude.ai/code/artifact/1c473eef-a5f6-47bd-a766-1003e9393060,
artboards in `docs/mockups/setup_hub/`, inventory in `WORKING_setup_inventory.md`). **H1 BUILT 2026-08-25.**
**Prerequisite:** `SPEC_user_type_model.md` (S1–S6 built) — the hub gates on permission groups and the `go_live`
authority and on nothing else (Kevin 2026-08-24: no stopgap).

## 1. What it is
One page — Administration → Setup — that replaces the seven-phase wizard as the front door. Everything the city
has to decide before it can answer records requests for real, as **five lanes of plain-language items**. Each
item opens the screen that sets it (the row is the button); its **state is counted from what is actually
configured**, never from a checkbox; a person may additionally **mark it done** (sign-off Option A).

## 2. Lanes and owners (Kevin's names, 2026-08-24)
| lane | title | owner = permission group(s) |
|---|---|---|
| 1 | Compliance and Policies Setup | `compliance_policy`; Legal sections `legal_rules` (Senior Legal owns; Director may) |
| 2a | Request Fulfillment Process Setup — Fees, Estimates and Routing | `operations_config` (fee items also `fee_configuration`) |
| 2b | Request Fulfillment Process Setup — Redaction and Release | `operations_config` |
| 3 | Organization Departments, Teams, and Staff Setup | `operations_config` |
| 4 | Technical Setup | `system_admin` |
The **agency identity** card sits above the lanes ("Start here"; `operations_config` or `system_admin`). **Go-live**
is the last row of lane 1; it is flipped on the Jurisdiction Configuration page by the `go_live` authority
(ORO System Administrator **or** ORO Director) and is never "marked done".

## 3. Items
The 36 items and their doors, dependencies and readers are the catalog in `services/setupHub.js` (`ITEMS`) —
the inventory's numbering maps 1:1 (1.1–1.12, 2.1–2.8, 2.9–2.13, 3.1–3.5, 4.1–4.7). Six items have **no
screen yet** (1.7 clarification, 2.9 redaction automation, 2.10 release switches, 2.12 decision reasons, 2.13
bulk schedule, 4.7 settlement): their rows render with a counted state and "no screen yet" and no door.
Building those screens is later hub slices (H2+), decided item by item.

## 4. States (counted)
`ready` · `in_progress` · `not_started` · `needs_attention` (was finished, came undone: drift, pending
proposal, rate above a limit, failing connection) · `waiting` (a prerequisite is not ready). Rules:
- The evidence line names the gap ("17 of 23 answered", "provider set · no test message sent").
- Running on shipped defaults is a real answer and says so.
- **Dependencies are open with warning, never a lock**: a waiting row keeps its door, is dimmed, and its
  "Why" explains what it waits on with a button to the prerequisite. An item's own counted progress wins
  over "waiting" (work done by hand is real).
- **Mark it done** (Option A): a member of the lane's group records the item ready; shown by name and
  date; reversible; it does not override `needs_attention` or `waiting`. Kevin may later make Ready
  conditional on validation per item (`signoffRequired` hook).

## 5. API
`GET /api/setup-hub` (any signed-in user) → `{counts, top:[agency], lanes:[{key,title,ownerLabel,groups,ready,total,canEdit,items:[…]}]}`;
each item `{key,name,door,noScreen,legal,goLive,deps,state,evidence,waitingOn?,why?,signoff?,canEdit}`.
`POST|DELETE /api/setup-hub/:key/done` — lane group (`legal_rules` for legal sections); go-live 400.
Sign-offs live in `setup_hub_signoffs(item_key PK, marked_by, marked_by_name, marked_at)`.

## 6. Verification
`verify_setup_hub`: catalog shape and lane counts; every dep real; owners are groups only (no role names in the
service); evidence is counted (an unserved department flips Teams; a pending proposal flips Law updates);
waiting rows keep their door; go-live not markable; marks gated per lane / legal; reversible; the page builds
even when a reader throws.

## 7. Slices
| # | Slice | Status |
|---|---|---|
| H1 | Hub service + API + page (counted evidence for all 36, sign-offs, Why, lane gating); replaces the Setup tab | **BUILT 2026-08-25** |
| H2 | Screens for the no-door items (1.7, 2.9, 2.10, 2.12, 2.13, 4.7) — one at a time, design first | open |
| H3 | Auto-load the state rule profile when the agency state is saved (inventory 1.2) | open |
| H4 | Retire the collisions (deadline day-counts in Configuration; the second email editor; Org vs Departments page) | open |
| H5 | Per-item validation-conditional Ready (Kevin's reserved option) | open, on demand |
