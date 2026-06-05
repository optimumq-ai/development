# Feature idea: Context-aware redaction assistance (police records)
Status: PARKED for future discussion. Logged 2026-06-05 from Kevin.

## Problem
Established principle: AI can redact CONTENT-detectable items (SSN, DOB, phone, address) but CANNOT judge CONTEXT-dependent exemptions from the document alone - open investigation, victim identity, juvenile, informant, undercover officer, a 911 call tied to an open case. Today this review is manual and often involves multiple people (records clerk + detective + legal).

## Idea
The missing context is not in the document - it lives in the agency's CASE MANAGEMENT SYSTEM (police RMS / CAD). Cross-reference the requested record against that system to SURFACE the context AI can't otherwise see, delivered as SUGGESTIONS to a human reviewer. Objective: reduce effort vs. a manual multi-person process.

## How it would work
- Read-only connector to the PD RMS/CAD (case status, person roles, protection flags).
- Extract entities from the document (names, incident/case #, dates, addresses).
- Cross-reference:
  - incident/case # -> case OPEN or closed? (law-enforcement investigatory-records exemption)
  - person name -> role match? victim / juvenile / witness / informant / undercover (identity exemptions)
  - 911 / CAD record -> linked to an open case?
- Output SUGGESTIONS WITH EVIDENCE, e.g.: "References case 2024-0456 = OPEN -> consider withholding pending investigation"; "Name 'J. Doe' matches a victim in 2024-0456 -> consider redacting"; or the clearance signal "no match found in open-case records."

## Design principles (carry over from the model)
- SUGGEST, never decide. Human reviewer remains the legal authority. Collapses a multi-person manual hunt into "here are the flags + evidence, confirm them."
- Evidence-cited: every flag shows which case / person / status so the reviewer can verify, not just trust.
- Negative results are valuable: "no open-case match, no protected-person match" speeds clean releases.
- Asymmetric risk -> bias toward FLAGGING on uncertainty. A missed victim is far worse than a false flag. Fuzzy name matches = flag for human check, never assert/auto-act.

## Key considerations for future discussion
- CJIS COMPLIANCE is the gating prerequisite: touching criminal-justice info demands least-privilege, encrypted, fully audited read-only access. PDs guard this access closely.
- RMS integration feasibility varies by vendor (Axon, Mark43, Tyler/New World, CentralSquare, Niche...); some lack APIs; PD systems often siloed from city IT.
- Name disambiguation (common names) + false-positive/negative tradeoff.
- Liability framing: decision SUPPORT only, named human is the authority -> defensibility.
- The PATTERN generalizes: cross-ref document entities against an authoritative source system to surface context-dependent exemptions (HR -> personnel system; litigation hold -> legal). Police = first / highest-value case.

## Value / positioning
Attacks the hardest, most labor-intensive, highest-risk part of police records fulfillment - the context review that needs multiple people today. Natural completion of the auto-release-eligibility principle: expands what AI can ASSIST by IMPORTING context instead of guessing it. Deeper live-system integration than typical PII detection.
