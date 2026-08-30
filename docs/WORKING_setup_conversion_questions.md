# WORKING — open questions from the setup-screen approval conversions

Not a spec. Each entry is a product choice the conversion could not settle on its own: the conservative
reading was built and is recorded in `SPEC_setup_hub.md` §3g, and this file is the list for Kevin.

## Q1 — Update Configuration: a proposal the city did not create turns the row red silently
`law_updates` counts an unreviewed proposal as a missing required item, so a proposal that lands after the
row was approved re-opens it to RED. Screen-driven proposals (upload / paste / apply / discard) report
through `routes/configFreshness.js`'s finish hook, but a proposal minted by the **nightly freshness scan**
(`services/configFreshness.runScan`, no request, no actor) changes nothing that notifies — the row simply
goes red on the guide and waits to be noticed.
**Built (conservative):** no notification from the scan.
**The question:** should the scan tell the compliance lane ("a proposed change is waiting for review") the
way a saved change tells them re-approval is needed? It is the one setup row whose colour can move without
anybody in the city doing anything.

## Q3 — Process Map: is "approved" a meaningful act on a reference screen?
`process_map` sets nothing — it is the shipped decision inventory and how much of it is built. Built as an
ACKNOWLEDGEMENT (SPEC §3j): yellow until the lane owner approves, green after, yellow again if a release
changes the model. The alternative is to give the row no colour at all (informational, like the Alerts tab
of Staff Alerts, which counts nothing). The reason the conservative build gives it a colour: before the
approval model it read GREEN before anybody had opened it, and green-for-free is the one thing the model
must not do.

## Q4 — Mass Redaction is two things: the templates library (setup) and the job runner (work)
`layout_templates` doors to `/mass-redaction`, and that page is both the reusable-template library (its own
heading says so) and the screen where batch jobs are staged and run — plus the 911 incremental-pull demo.
Converting the row to the list model needed an approval home, and the row has no other door, so the page now
wears the shared setup strip (its heading and intro moved into the strip's card; the body is untouched).
Without it the row could never turn green, and Go Live could never turn green either.
**The question:** should the templates library get its own `/setup/redaction-templates` screen, leaving
`/mass-redaction` as a pure work screen? That is the C11 treatment and would keep setup chrome off a screen
redaction staff use daily.

## Q2 — Update Configuration: is the reminder cadence really the city's decision?
Built as required-and-saved (the Authentication precedent: a shipped default is not a decision). It is the
weakest of the required sets so far — 182 days is a courtesy reminder, not a legal posture. If Kevin would
rather the row went yellow on an empty queue alone, drop the two settings from `required` and keep them as
evidence.
