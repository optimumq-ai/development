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

## Q2 — Update Configuration: is the reminder cadence really the city's decision?
Built as required-and-saved (the Authentication precedent: a shipped default is not a decision). It is the
weakest of the required sets so far — 182 days is a courtesy reminder, not a legal posture. If Kevin would
rather the row went yellow on an empty queue alone, drop the two settings from `required` and keep them as
evidence.
