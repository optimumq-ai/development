# Onboarding / Go-Live Gating tied to Taxonomy Completeness

Status: STRATEGY CAPTURED (not built). Origin: Kevin, 2026-06-25, end of an 18hr session.
Problem it solves: an incomplete taxonomy is NOT a software defect, but it silently degrades
portal search quality. We need customers to finish taxonomy build-out BEFORE go-live, and to
make the gap visible + enforceable rather than a silent failure Optimum Q gets blamed for.

## The two-key strategy (Kevin)
- Setup key (provisioning): lets the customer build configuration/rules, run mass redaction,
  connect sources, run auto-discovery, and build the taxonomy. Public search NOT yet live.
- Production key: turns on public portal search. Withheld until connectors are live AND
  taxonomy is >= 90% complete.
- Contract states plainly that search is not functional until connectors are live and the
  taxonomy reaches the threshold. Honest framing: the production key is withheld because search
  genuinely fails without a robust taxonomy - not an artificial gate. (True per the routing/
  judge architecture: thin taxonomy -> no routing benefit -> degraded relevance.)
- This is the ENFORCEMENT arm of the readiness work already built (jurisdiction profile /
  attestation / dev_mode gate). Readiness dashboard shows completeness; production key enforces.
  Natural fit - reuse, don't reinvent.

## Completeness dial (the metric)
- Numerator (easy, data we have): # record types created AND linked to a source.
- Denominator (hard part): estimate of how many record types SHOULD exist.

### Recommended denominator: auto-discovery IS the census
Rather than a separate file-naming census, use auto-discovery as the denominator generator:
- Run discovery across EVERY connected source; it proposes candidate record types from real content.
- Completeness = (discovered types reviewed/approved AND linked to a source) / (total proposed).
- Plus coverage check: every connected source has had discovery run at least once.
Ties the dial to the exact work the customer must do (connect -> discover -> review -> link) and
is computable from data the system already produces. Better-grounded than an external guess.

### Kevin's file-census idea -> keep as a cross-check (guards against gaming)
A single % misleads if discovery UNDER-proposes (sparse/ambiguous file naming -> few proposed
types -> "90% of a small number" looks complete but isn't). Kevin's idea - group files in a
network directory by naming convention / name content and count the groups - is a good
INDEPENDENT sanity estimate to flag "discovery probably under-counted this source." So:
discovery-based completeness = primary dial; file-grouping census = cross-check/alarm.
Other denominator signals: peer-city taxonomy-size baselines; weight by record VOLUME per type
(a type with thousands of files not yet linked is a big gap), not just raw type count.

## Build pieces (future, when prioritized)
1. Taxonomy-health signal on readiness dashboard: # types, % linked, % of sources with discovery
   run, computed completeness %, with a "Run auto-discovery" CTA.
2. Completeness formula service (numerator/denominator above) + the cross-check alarm.
3. Two-key provisioning: setup vs production key; production key gated on completeness >=
   threshold (default 90%) AND all connectors live. Likely an extension of the dev_mode/
   enforcement gate.
4. Setup wizard step: source "census" - connect each source, run discovery, review/link.

## Open questions
- Threshold (90%?) and per-source vs global.
- Weight completeness by record VOLUME vs raw type count.
- How "linked to a source" treats legitimately manual/paper types (no connector).
