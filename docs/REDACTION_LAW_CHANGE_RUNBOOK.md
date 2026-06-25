# Runbook: Handling a Redaction-Law Change

A short operating procedure for the rare case where a change to public-records law alters what must
be redacted. This is a deliberate MANUAL procedure, not automation — these changes are infrequent,
narrow, and benefit from human judgment about scope. Optimum Q never tracks the law; the agency brings
the approved change and follows this procedure.

## First: which direction is the change?

**A) Previously PUBLIC information must now be PROTECTED (withheld).**
In practice this case essentially never arises, because information already released to the public cannot
be un-released — a law cannot claw back what is already exposed. If you believe you face this case, treat
it as a legal question for your counsel before doing anything; do not assume the software should act.
Going forward only, update the rule/template (see the forward-looking steps below) so NEW redactions
withhold the information; existing public records are generally left as-is unless counsel directs otherwise.

**B) Previously PROTECTED information must now be DISCLOSED (released).**
This is the actionable case. Because the information is being opened up (not clawed back), correcting it
is low-risk. Use the procedure below.

## Which records are affected?

Distinguish two populations — they are handled differently:

1. **Requests still in progress** (not yet released). Governed by the law in effect for THAT request —
   generally anchored to the request's receipt date. Do NOT silently re-redact in-flight documents to the
   new rule. Instead, confirm with the records manager (and counsel if a request straddles the effective
   date) which rule applies to each, then process accordingly. A request that straddles the effective date
   is a human decision, not an automatic one.

2. **Already-released / public-facing records** (e.g. published via mass redaction). These are the records
   you may choose to re-process so the now-disclosable information is shown.

## Procedure for already-released records (direction B)

1. **Scope it.** Identify the public records affected by the rule change. Keep the scope as narrow as the
   change requires — recent law changes have trended toward smaller and smaller affected volumes.
2. **Update the rule and the template.** In the Redaction Rules library, adjust the rule so the information
   is no longer withheld. IMPORTANT: the redaction rules engine affects template creation and future
   document redaction ONLY — changing a rule does NOT alter documents already redacted. So you must also
   update any redaction TEMPLATE that encoded the old rule, since templates are what mass redaction applies.
3. **Remove the affected public records** from the public-facing set (take down the records that were
   redacted under the old template).
4. **Re-run mass redaction** on those records using the corrected template.
5. **Review and re-publish.** Confirm the output, then release the re-processed records.
6. **Record it.** Note the change, its effective date, and the scope handled (the redaction/release dates
   are already stamped on the records automatically).

## What the software does and does NOT do here

- DOES: stamp redaction and release dates on records; let you edit rules and templates; run mass redaction
  on a chosen set with a chosen template.
- DOES NOT: decide which law applies to a straddling request (a human/counsel decides); automatically find
  and re-process affected public records (you scope and trigger it); version-snapshot templates (only the
  template's current state is stored).

## Why this is intentionally manual
These changes are rare, often narrow, and trending narrower. Automating "find every record touched by rule X
and re-process it" would add error-prone machinery aimed at an uncommon, low-volume scenario, and would risk
the software taking a legal position. A documented human procedure is the lower-risk, lower-cost choice. If a
future change is ever large enough to warrant more tooling, revisit then.
