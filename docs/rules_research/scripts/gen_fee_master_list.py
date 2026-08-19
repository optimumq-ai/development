#!/usr/bin/env python3
"""Fee & estimate MASTER LIST generator (step 1 of the fee-library plan, 2026-08-19).

Inputs (read-only): the master concept dictionary, the pruned discovery corpus (+ supplements), the engine's
profile schema (hand-encoded below from feeEngine.js / FeeConfigPage DEFAULT_CONFIG) and the two policy
modules' field catalogs. Output: fee_master_list.json + FEE_MASTER_LIST.md + fee_master_matrix.csv.

Per-state status is AUTO-DERIVED from rule text (heuristics) and is a STARTING POINT for the step-2 gap pass —
every cell carries its rule ids and a snippet so a human can verify it. Confidence is 'auto' everywhere.
"""
import json, re, glob, collections, datetime, csv, os

RR = '/opt/optimumq/docs/rules_research'
D = json.load(open(f'{RR}/alignment/master_concept_dictionary.json'))
rules = {}
def walk(o):
    if isinstance(o, dict):
        rid = o.get('rule_id')
        if isinstance(rid, str) and re.match(r'^[A-Z]{2}-\d+', rid): rules[rid] = o
        else:
            for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(json.load(open(f'{RR}/pruned/pruned_discovery.json')))
for f in glob.glob(f'{RR}/supplements/*.json'):
    try: walk(json.load(open(f)))
    except Exception: pass
byck = {c['canonical_key']: c for c in D}
STATES = sorted(set(s for c in D for s in c['states']))

# ── THE ITEMS: engine field ← canonical concepts. value_type: rate_usd | rate_usd_per_hour | usd | pct | hours | pages | int | enum | bool | tiers | actual_or_usd
ITEMS = [
 # duplication
 dict(id='dup.bw.rate', label='Copy rate — B&W page', home='fee_profiles:duplication.bw.rate', type='rate_usd', concepts=['fee.copy_rate_per_page','fee.actual_cost_basis','fee.schedule_and_authority']),
 dict(id='dup.color.rate', label='Copy rate — color page', home='fee_profiles:duplication.color.rate', type='rate_usd', concepts=['fee.copy_rate_per_page','fee.nonstandard_rate']),
 dict(id='dup.oversized.rate', label='Copy rate — oversized / nonstandard page', home='fee_profiles:duplication.oversized.rate', type='rate_usd', concepts=['fee.nonstandard_rate']),
 dict(id='dup.specialty.rate', label='Specialty reproduction (photos, maps, transcripts)', home='fee_profiles:duplication.specialty.rate', type='actual_or_usd', concepts=['fee.nonstandard_rate','fee.special_service_charge']),
 dict(id='dup.tiers', label='Graduated page bands (per-page rate by volume)', home='fee_profiles:duplication.*.tiers', type='tiers', concepts=['fee.copy_rate_per_page','fee.free_allowance']),
 dict(id='rules.freePages', label='Free page allowance per request', home='fee_profiles:requestRules.freePageAllowance', type='pages', concepts=['fee.free_allowance','fee.no_charge_categories']),
 # labor
 dict(id='labor.search.rate', label='Labor rate — search / retrieval ($/hr)', home='fee_profiles:labor.search.rate', type='rate_usd_per_hour', concepts=['fee.labor_charge','fee.actual_cost_basis']),
 dict(id='labor.review.rate', label='Labor rate — review / redaction ($/hr)', home='fee_profiles:labor.review.rate', type='rate_usd_per_hour', concepts=['fee.labor_charge','fee.no_charge_categories']),
 dict(id='labor.programming.rate', label='Labor rate — programming / data extraction ($/hr)', home='fee_profiles:labor.programming.rate', type='rate_usd_per_hour', concepts=['fee.labor_charge','fee.special_service_charge']),
 dict(id='labor.billableWhen', label='When labor is chargeable at all (never / always / only over N pages or N hours; paper-only scope)', home='fee_profiles:labor.*.billable / billableWhen{trigger,threshold,paperOnly}', type='enum+threshold', concepts=['fee.free_allowance','fee.labor_charge','fee.no_charge_categories']),
 dict(id='labor.overheadPct', label='Overhead / fringe surcharge on labor (%)', home='fee_profiles:labor.overheadPct', type='pct', concepts=['fee.labor_charge','fee.actual_cost_basis']),
 dict(id='labor.increment', label='Labor time increment + rounding', home='fee_profiles:labor.*.increment / rounding', type='hours', concepts=['fee.labor_charge']),
 dict(id='rules.freeLaborHours', label='Free labor hours per request', home='fee_profiles:requestRules.freeLaborHours', type='hours', concepts=['fee.free_allowance','fee.labor_charge']),
 dict(id='labor.periodicFreeHours', label='Free personnel time per requestor per month/year (TX § 552.275 pattern)', home='NOT IN ENGINE (fee_profiles gap — requestor-ledger counter)', type='hours', concepts=['fee.free_allowance','fee.aggregation']),
 # estimates
 dict(id='rules.estimateNotifyThreshold', label='Itemized estimate / cost notice required above ($ or hours)', home='fee_profiles:requestRules.estimateNotifyThreshold  (DUPLICATE: jurisdiction_rules fee_waiver.estimate_required_above)', type='usd', concepts=['fee.estimate_and_notice']),
 dict(id='estimate.requesterResponseDays', label='Requester must respond to an estimate within N days (else withdrawn)', home='fee_profiles:estimatePolicy.requesterResponseDays  (also fee_waiver.response_window_*)', type='int', concepts=['fee.estimate_and_notice','payment.nonpayment_consequence']),
 dict(id='estimate.revisionNotifyPercent', label='Revised estimate required when actual exceeds estimate by N%', home='fee_profiles:estimatePolicy.revisionNotifyPercent  (also payment.reissue_required_on_variance)', type='pct', concepts=['fee.estimate_and_notice']),
 dict(id='estimate.validityDays', label='Estimate validity period (days)', home='fee_profiles:estimatePolicy.estimateValidityDays', type='int', concepts=['fee.estimate_and_notice']),
 # deposits / payment
 dict(id='rules.deposit.threshold', label='Deposit / prepayment may be required above ($)', home='fee_profiles:requestRules.deposit.threshold  (DUPLICATE: fee_waiver.deposit_allowed_above)', type='usd', concepts=['payment.deposit_threshold','payment.deposit','payment.advance_payment']),
 dict(id='rules.deposit.percent', label='Deposit capped at (% of estimate)', home='fee_profiles:requestRules.deposit.percent  (DUPLICATE: fee_waiver.deposit_cap_pct)', type='pct', concepts=['payment.deposit_ceiling','payment.deposit']),
 dict(id='payment.productionGate', label='Production may be conditioned on payment (pay before copies / pay in full before release)', home='paymentTiming gates + fee_profiles bands', type='enum', concepts=['payment.production_conditioned_on_payment','payment.advance_payment']),
 dict(id='payment.nonpayment', label='Nonpayment consequence (withdrawn after N days; prior-debt prepayment)', home='feeNonpayment + estimatePolicy + jurisdiction_rules payment.deposit_lapse_action', type='enum+int', concepts=['payment.nonpayment_consequence']),
 dict(id='payment.depositClock', label='Statutory clock effect while a deposit is unpaid; grace; lapse action', home='jurisdiction_rules:payment.{deposit_clock_effect,deposit_grace_days,deposit_lapse_action}', type='enum', concepts=['payment.deposit','payment.advance_payment']),
 dict(id='payment.reissue', label='Overrun re-issue rules (revised estimate required / blocks collection / restarts window)', home='jurisdiction_rules:payment.reissue_*', type='bool', concepts=['fee.estimate_and_notice']),
 dict(id='payment.method', label='Electronic payment method offered', home='fee_profiles:payment_mode (operational; not law-driven except VA)', type='enum', concepts=['payment.method']),
 # ceilings / floors
 dict(id='rules.maxFee', label='Request-level ceiling (actual cost cap / statutory max)', home='fee_profiles:requestRules.maxFee', type='usd_or_rule', concepts=['fee.actual_cost_basis','fee.schedule_and_authority']),
 dict(id='rules.deMinimis', label='De-minimis: no charge below ($)', home='fee_profiles:requestRules.deMinimis (+ de-minimis knob)', type='usd', concepts=['fee.waiver','fee.no_charge_categories']),
 dict(id='rules.minFee', label='Minimum fee', home='fee_profiles:requestRules.minFee', type='usd', concepts=[]),
 # media / delivery / certification / av / commercial
 dict(id='media', label='Electronic media (CD/DVD/USB) charge', home='fee_profiles:media.{cd,dvd,usb}', type='actual_or_usd', concepts=['fee.electronic_media_charge']),
 dict(id='delivery', label='Delivery: mail / handling / email / pickup', home='fee_profiles:delivery.*', type='actual_or_usd', concepts=['fee.delivery_charge','fee.electronic_media_charge']),
 dict(id='certification', label='Certification / certified-copy charge', home='fee_profiles:certification.{rate,unit}', type='rate_usd', concepts=['fee.certified_copy_charge']),
 dict(id='av', label='Audio/video: per recording, per minute, free minutes', home='fee_profiles:av.{perRecording,perMinute,freeMinutes}', type='rate_usd', concepts=['fee.special_service_charge','fee.nonstandard_rate']),
 dict(id='commercial', label='Commercial-purpose schedule (surcharge %, labor becomes chargeable)', home='fee_profiles:purposeOverrides.commercial', type='pct+bool', concepts=['fee.commercial_charge']),
 # waiver
 dict(id='waiver', label='Fee waiver: grounds, mandatory vs discretionary, purpose statement, written denial, appeal', home='jurisdiction_rules:fee_waiver.*', type='enum_list+bool', concepts=['fee.waiver']),
 dict(id='waiver.forfeiture', label='Late response forfeits the fee', home='jurisdiction_rules:fee_waiver.fee_forfeiture_on_late_response', type='bool', concepts=['fee.waiver','payment.nonpayment_consequence']),
 dict(id='repeat', label='Repeat / aggregated requests (carry-forward, aggregation threshold)', home='NOT IN ENGINE (requestor-ledger)', type='structural', concepts=['fee.repeat_request_carryforward','fee.aggregation']),
]

NUM = re.compile(r'(\$\s?\d[\d,]*(?:\.\d+)?|\d+(?:\.\d+)?\s?cents?|\bten cents|\bfifteen cents|\btwenty(?:-five)? cents|\bfive cents|\bone dollar|\bfive dollars|\d+(?:\.\d+)?\s?%|\d+\s?(?:hours?|pages?|days?|minutes?))', re.I)
DELEG = re.compile(r'(attorney general|by rule|regulation|promulgat|schedule adopted|fee schedule (?:established|adopted|set|approved)|uniform fee schedule|as established by|established by the (?:agency|custodian|body|department|county|municipality|governing)|set by the (?:agency|custodian|public body|governing)|fiscal body|ordinance|resolution)', re.I)
ACTUAL = re.compile(r'(actual cost|reasonable (?:fee|charge|cost)|not exceed(?:ing)? (?:the |its )?(?:actual|reasonable) cost|direct cost|at cost)', re.I)
DEFERS = re.compile(r'(governing body|ordinance|resolution|municipalit|political subdivision|local (?:public )?body|each agency|the agency may (?:establish|set|adopt)|custodian may (?:establish|set))', re.I)

def rules_for(st, cks):
    out = []
    for ck in cks:
        c = byck.get(ck)
        if not c: continue
        for rid in (c.get('members_by_state', {}) or {}).get(st, []) or []:
            r = rules.get(rid)
            if r and r not in out: out.append(r)
    return out

def status_for(rs):
    if not rs: return dict(status='silent', rule_ids=[], values=[], citations=[], basis=None, rule_types=[], source_types=[], official_links=[], snippet=None)
    txt = ' '.join(((r.get('source_language') or '') + ' ' + (r.get('atomic_rule') or '')) for r in rs)
    nums = sorted(set(m.group(0).strip() for m in NUM.finditer(txt)))
    bases = [r.get('constraint_basis') for r in rs if r.get('constraint_basis') and r.get('constraint_basis') != 'n/a']
    basis = collections.Counter(bases).most_common(1)[0][0] if bases else None
    if nums: st = 'value_present'
    elif DELEG.search(txt) and not DEFERS.search(txt): st = 'delegated_to_regulation_or_schedule'
    elif DEFERS.search(txt): st = 'defers_to_city'
    elif ACTUAL.search(txt): st = 'actual_cost_or_reasonable'
    else: st = 'rule_without_value'
    if st == 'value_present' and (DELEG.search(txt) and not DEFERS.search(txt)): st = 'value_present+delegation'
    cites = sorted(set((r.get('source_authority') or r.get('authority') or '') for r in rs if (r.get('source_authority') or r.get('authority'))))
    snip = (rs[0].get('atomic_rule') or rs[0].get('source_language') or '')[:220]
    rtypes = sorted(set(r.get('rule_type') for r in rs if r.get('rule_type')))
    stypes = sorted(set(r.get('source_type') for r in rs if r.get('source_type')))
    links = sorted(set(r.get('official_link') for r in rs if r.get('official_link')))[:3]
    return dict(status=st, rule_ids=[r['rule_id'] for r in rs], values=nums[:8], citations=cites[:4], basis=basis, rule_types=rtypes, source_types=stypes, official_links=links, snippet=snip)

out = dict(
  generated=datetime.date.today().isoformat(),
  purpose='THE fee & estimate MASTER LIST — every configuration item the fee/estimate/payment engine can hold, mapped to the canonical rules-library concepts, with an AUTO-DERIVED per-state status to be verified/filled by the step-2 gap pass. Statuses: value_present · value_present+delegation · delegated_to_regulation_or_schedule · defers_to_city · actual_cost_or_reasonable · rule_without_value · silent.',
  sources=dict(concept_dictionary='docs/rules_research/alignment/master_concept_dictionary.json', corpus='docs/rules_research/pruned/pruned_discovery.json (+supplements)', engine='backend/src/services/feeEngine.js, frontend FeeConfigPage DEFAULT_CONFIG, paymentClockPolicy.FIELDS, feeWaiverPolicy.FIELDS'),
  states=STATES,
  known_holes=['NJ: dictionary lists NJ under several fee concepts but the pruned corpus holds ZERO NJ rules (chunked-discovery failure) — every NJ cell is "silent" here and must be re-researched.',
               'Delegations: where a statute delegates rate-setting to a regulation / AG rule / uniform schedule (TX 1 TAC §70.3 pattern), the regulation text is NOT in the corpus — the gap pass follows those.',
               'Duplicated homes: estimate threshold, deposit threshold and deposit cap live in BOTH fee_profiles.requestRules and jurisdiction_rules fee_waiver.* — one concept, two stores; a later step picks one home.',
               'Not in engine: per-requestor periodic free hours (TX §552.275), repeat/aggregation rules — recorded here so the field can exist before anyone populates it.'],
  items=[]
)
for it in ITEMS:
    row = dict(it); row['states'] = {}
    for st in STATES:
        row['states'][st] = status_for(rules_for(st, it['concepts']))
    out['items'].append(row)

os.makedirs(f'{RR}/alignment', exist_ok=True)
json.dump(out, open(f'{RR}/alignment/fee_master_list.json', 'w'), indent=1)

# ── Markdown
ABBR = {'value_present':'V','value_present+delegation':'V*','delegated_to_regulation_or_schedule':'D','defers_to_city':'C','actual_cost_or_reasonable':'A','rule_without_value':'R','silent':'·'}
md = []
md.append('# Fee & Estimate MASTER LIST — step 1 (published %s)\n' % out['generated'])
md.append('**What this is.** The complete set of configuration items the fee / estimate / payment engine can hold, each mapped to the canonical concept(s) of the rules library, with a per-state status **auto-derived from the rule text** as the starting point for the step-2 gap pass. Every cell in `fee_master_list.json` carries the rule ids, citations, extracted numbers and a snippet so a person can verify it. Nothing here is a verified value yet.\n')
md.append('**Status legend.** `V` a number is present in the rule text (verify it belongs to this field) · `V*` a number AND a delegation ("may not exceed the AG-set amount by 25%") · `D` delegated to a regulation / AG rule / uniform schedule — the figure is outside the corpus · `C` statute defers to the city / governing body · `A` "actual cost" / "reasonable" standard (city sets, within the standard) · `R` a rule exists but carries no value (structural or qualitative) · `·` silent.\n')
md.append('**Known holes.**\n' + '\n'.join('- ' + h for h in out['known_holes']) + '\n')
md.append('## Items (engine field ← canonical concepts)\n')
md.append('| # | Item | Engine home | Type | Canonical concepts |\n|---|---|---|---|---|')
for i, it in enumerate(out['items'], 1):
    md.append(f"| {i} | {it['label']} | `{it['home']}` | {it['type']} | {', '.join('`'+c+'`' for c in it['concepts']) or '—'} |")
md.append('\n## Per-state matrix (auto-derived — see legend)\n')
hdr = '| Item | ' + ' | '.join(STATES) + ' |'
md.append(hdr); md.append('|' + '---|' * (len(STATES) + 1))
for it in out['items']:
    md.append('| ' + it['id'] + ' | ' + ' | '.join(ABBR[it['states'][s]['status']] for s in STATES) + ' |')
md.append('\n## Per-state summary\n')
md.append('| State | items with a number | delegated | defers/actual-cost | rule-no-value | silent |\n|---|---|---|---|---|---|')
for s in STATES:
    c = collections.Counter(it['states'][s]['status'] for it in out['items'])
    md.append(f"| {s} | {c['value_present']+c['value_present+delegation']} | {c['delegated_to_regulation_or_schedule']} | {c['defers_to_city']+c['actual_cost_or_reasonable']} | {c['rule_without_value']} | {c['silent']} |")
md.append('\n## How this is used next\n- **Step 2 (gap pass):** one research+verify run per state over exactly these items — follow every `D` into its regulation, confirm every `V`/`V*` belongs to the field it landed on, and turn `·`/`R` into either a value, an explicit "defers to city", or a confirmed "state silent".\n- **Step 3:** the state template `fee_schedule` gains `value / unit / basis / engine_field` per item.\n- **Step 4:** generator (template → proposed fee profile), local-policy validation against constraints, one-time auto-configure + lock.\n- **Acceptance:** for each state, every item is valued from the library or explicitly city-deferred; no state-specific code.\n')
open(f'{RR}/FEE_MASTER_LIST.md', 'w').write('\n'.join(md) + '\n')

# ── CSV matrix (one row per item×state)
with open(f'{RR}/alignment/fee_master_matrix.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['item_id','item','engine_home','state','status','basis','rule_types','source_types','values_found','rule_ids','citations','official_links','snippet'])
    for it in out['items']:
        for s in STATES:
            c = it['states'][s]
            w.writerow([it['id'], it['label'], it['home'], s, c['status'], c['basis'] or '', '/'.join(c['rule_types']), '/'.join(c['source_types']), ' | '.join(c['values']), ' '.join(c['rule_ids']), ' | '.join(c['citations']), ' '.join(c['official_links']), (c['snippet'] or '').replace('\n',' ')])
print('items', len(out['items']), 'states', len(STATES))
