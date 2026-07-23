// Complete cross-state alignment: cluster every remaining family into canonical concepts,
// route cross-family leakers, resolve config_home, assemble the master dictionary. First-pass draft.
const fs = require('fs');
const RESEARCH = '/opt/optimumq/docs/rules_research';
const pr = require(RESEARCH + '/pruned/pruned_discovery.json');
const norm = k => String(k||'').toLowerCase().trim().replace(/__\d+$/,'');
const famOf = k => { const f=k.split('.')[0];
  return ({deadlines:'deadline',denials:'denial',communications:'communication',special:'special_records',fees:'fee',routing:'custody'})[f]||f; };

// families already aligned in their own slices (loaded at assembly)
const DONE = new Set(['eligibility','deadline','response','extension']); // timing handled separately

// ordered [regex-on-key, canonical] per family; first match wins. '→fam' = route to another family.
const R = {
  fee: [
    [/nonpayment|denial_for_unpaid|unpaid_denial|forfeited_if_late|late_response|mandatory_prepayment|search_fee_conditional|search_fee_unreasonable_cost_gate/, '→payment'],
    [/repeat_request|carryforward|carry_forward/, 'fee.repeat_request_carryforward'],
    [/tax/, 'fee.tax_treatment'],
    [/waiver|indigent|crime_victim|public_interest|welfare|legislator_no_charge|veterans|scholastic|_exemption|no_discouragement/, 'fee.waiver'],
    [/estimate|itemi|advance_fee_notice|advance_estimate|pre_search_charge_notice|cost_mitigation|cost_estimate|pre_charge_review|review_objection|fee_review/, 'fee.estimate_and_notice'],
    [/no_charge|no_search_or|no_email_transmission|no_recharge|redaction_no_charge|no_fee_without|no_overhead|no_profit|reused_electronic_no_fee|electronic_copy_no_charge|electronic_records_free|no_charge_to_examine|statutory_free_copy|free_copies_allotment|statutory_price_exemption/, 'fee.no_charge_categories'],
    [/first_|free_labor|free_threshold|labor_free|free_hour|personnel_time_free|_free$|quarter_hour|time_increment_free|small_request_labor_bar/, 'fee.free_allowance'],
    [/commercial/, 'fee.commercial_charge'],
    [/special_service|customized_service|extensive|it_resource|enhanced_access_charge|enhanced_electronic|expedite_charge|voluminous_electronic_data_tiers|voluntary_creation/, 'fee.special_service_charge'],
    [/labor|search|retrieval|review_redaction|redaction_labor|redaction.*charge|review.*charge|staff_time|hourly_staff|personnel_time|research_retrieval|fringe_benefit|overtime|two_hour_threshold|threshold_hours|time_increment|attorney_review|after_hours|supervisor_petition|separation_cost|av_redaction/, 'fee.labor_charge'],
    [/electronic|media|disk|flash|download|digital|data_extraction|reprogram|conversion_medium|map_charge|gis|nonpaper|storage_material|format_conversion_charge/, 'fee.electronic_media_charge'],
    [/certif/, 'fee.certified_copy_charge'],
    [/postage|mailing|shipping/, 'fee.delivery_charge'],
    [/schedule|published_fee|procedures_guideline|custodian_reasonable_costs|rate_ceiling_ag|political_subdivision_fee|state_agency_uniform|fiscal_body|specific_statutory_fee|copy_uniformity|flat_fee|statutory_per_record|research_policy|reasonable_fee_standard|set_by|authority/, 'fee.schedule_and_authority'],
    [/nonstandard|non_standard|oversize|color|photograph|transcription|admin_transcript|video_production|larger|other_than_standard|law_library/, 'fee.nonstandard_rate'],
    [/actual_cost|direct_cost|cost_of_duplication|duplication_actual|excluded_cost|supply_actual|location_cost|contractor|outside_service|compilation_cost|lowest_possible_cost|lowest_cost|most_economical|economical_means|other_facilities/, 'fee.actual_cost_basis'],
    [/per_page|copy_rate|page_rate|rate_per|copy_charge|copy_cost|standard_copy|duplication_rate|two_sided|media_differential|nonpaper_media|website_physical_copy/, 'fee.copy_rate_per_page'],
    [/.*/, 'fee.other_fee'],
  ],
  production: [
    [/economic_development_withhold|commercial_list_restriction|subscription_future|immediate_access_categ|published_for_sale|statutory_use_restrict|third_party_nonpublic|commercial_expedite|protective_rules|fragile_record|substantial_disruption|noncopyable_record|law_enforce/, '→special_records'],
    [/vendor/, '→custody'],
    [/most_economical/, '→fee'],
    [/compliance_after_order/, '→appeal'],
    [/furnish_deadline|convert_to_paper_window|format_conversion_extension|partial_production_within_window|record_retrieval_window|record_retrieval/, 'production.installment_partial'],
    [/website|online_access|online_availab|database_online/, 'production.website_satisfies'],
    [/no_duty|creation_not_required|no_format_conversion|no_encryption|reduce_to_written_form|no_refusal_for_query|no_new_record|new_records|no_research|not_obligated/, 'production.no_duty_to_create_or_convert'],
    [/audio_recording|video_recording|_av_media|transcript_to_avoid|recording_copy/, 'production.av_media_specific'],
    [/certif|delay_certification|certify_no_record/, 'production.certified_copy'],
    [/installment|partial|segmented|omitted_records_cure/, 'production.installment_partial'],
    [/self_copy|access_during_office|business_hours|onsite_copying|comparable_facilities|immediate_present|immediate_access|active_use|weekly_access|advance_notice_no_regular|physical_form|no_requester_device|copies_in_lieu|copies_under_custodian|enhanced_access_permission|onsite/, 'production.inspection_access'],
    [/medium_denial_prohibited|no_refusal|medium_requested/, 'production.no_medium_refusal'],
    [/electronic|format|native|_medium|requested_|preferred_format|tangible_medium|requester_format|physical_form|metadata|digital|copy_type|copy_method|electronic_retrieval|electronic_preferred/, 'production.format_and_medium'],
    [/delivery|prompt_copy|entity_prepares|copy_duty|completion_duty|prompt_compliance|response_promptness|promptly|reasonable_time|readily|unclaimed/, 'production.delivery_and_completion'],
    [/.*/, 'production.other_production'],
  ],
  intake: [
    [/foia_officer_designation|designated_address|address_to_records_officer|custodian_duty_access|custodian_rulemaking/, '→custody'],
    [/acknowledg|receipt_date|receipt_determin|receipt_comput|due_date_comput/, '→response'],
    [/residency_attest|resident_attest|proof_of_resident/, 'intake.residency_attestation'],
    [/duplicate_pending|identical_unchanged|identical_no_change|unreasonable_duplicate|bot_request|single_agency_per|single_entity_per/, 'intake.duplicate_request_denial'],
    [/commercial_purpose|legal_proceeding|litigation_party|civil_litigant|litigant/, 'intake.purpose_and_certification'],
    [/procedures_publication|procedures_required|public_procedures_notice|written_procedure_published|submission_per_written_procedures|request_form_adoption|custodian_rulemaking/, 'intake.procedures_publication'],
    [/identit|identif(?!iable)|proof_of_id|photo_id|register|conditional_id/, 'intake.identity_requirement'],
    [/anonymous_request_permitted|anonymous_not_incomplete/, 'intake.identity_requirement'],
    [/technicality|incomplete_letter_denial|incomplete_request|noncompliant_request_no_obligation|overbreadth_not_sole|good_faith_response|no_statutory_citation/, 'intake.no_technicality_denial'],
    [/no_.*form|no_standard_form|no_particular_form|no_required_form|form_optional|not_require_form|no_written_form/, 'intake.no_required_form'],
    [/form_required_time_intensive|prescribed_form|standard_form_permitted|request_form_available|copies_request_form|written_or_form_agency|agency_may_require_written|submission_form_and_channel|request_form|form_adoption/, 'intake.form_permitted'],
    [/written_request_required|written_request_may|written_request_optional|written_required_for_relief|database_written_request|copies_written_request/, 'intake.written_request_required'],
    [/oral|verbal|telephone_request|informal_provision|request_method_any|any_manner/, 'intake.oral_request_permitted'],
    [/reasonabl.*describ|reasonable_description|reasonable_specificity|reasonably_describes|request_description_specificity|specificity_required|clearly_indicate|identifiable_record|possession_custody_control|reasonable_time_place|correspondence_scope|scope_specificity/, 'intake.reasonably_describes'],
    [/required_field|required_request_fields|accurate_contact|info_required_limited|requester_identification_required/, 'intake.required_fields'],
    [/channel|electronic_submission|electronic_request|email|mail_request|request_channels|request_methods|submission_channels|submission_methods|default_delivery|appointment_by_agreement|limited_hours_notice|mail_copy_website|letter_or_email/, 'intake.submission_channels'],
    [/.*/, 'intake.other_intake'],
  ],
  denial: [
    [/duplicate_pending|identical_no_change|incomplete_request|anonymous_not_incomplete/, '→intake'],
    [/attorney_fee/, '→appeal'],
    [/legal_proceeding_bar|law_enforcement_discretion|nondisclosure_agreement|disaster_or_fragile|substantial_disruption|storage_archived_deadline|shared_record_referral/, '→special_records'],
    [/deem|constructive|exemptions_not_waived/, 'denial.deemed_denial_on_nonresponse'],
    [/neither_confirm_nor_deny|glomar/, 'denial.neither_confirm_nor_deny'],
    [/log_maintain|denial_log|signature_required/, 'denial.denial_form_and_log'],
    [/statement_window|denial_window|denial_deadline|denial_notice_window|expedited_denial_notice/, 'denial.denial_deadline'],
    [/responsible_person|name.*title|identify.*person|who_denied|person_responsible/, 'denial.identify_responsible_person'],
    [/not_exist|no_record|does_not_have|no_responsive|record_not_found|not_maintained|not_in_custody|nonexistent|not_custodian_or_nonexistent|certificate/, 'denial.no_responsive_records'],
    [/partial|redact_and_release|segregab|withhold_part|volume_subject_matter|full_withholding|redaction_description/, 'denial.partial_withholding_notice'],
    [/burden|justif|prove|presumption|specific_demonstration/, 'denial.agency_burden'],
    [/vague|overbroad|ambiguous|unreasonable|unduly|not_reasonably_describ|improper|excessive_information|no_category_basis|index_agency_scope/, 'denial.improper_request_denial'],
    [/exemption|cite|statutory|legal_authority|factual_basis|specific_reason|reasons?_stated|reasons?_required|grounds?|reason_for_denial|explain|specificity|itemize_withheld|notice_contents|notice_and_statutory|statement_of_reasons|withholding_index|index_privileged|ground_exemption|privilege_log|attorney_client/, 'denial.reasons_and_citation_required'],
    [/written|in_writing|notice_required|form_of_denial/, 'denial.written_notice_required'],
    [/appeal|review/, '→appeal'],
    [/.*/, 'denial.other_denial'],
  ],
  payment: [
    [/cost_estimate_notice_threshold|after_hours_compensation/, '→fee'],
    [/deposit_ceiling|deposit_cap|deposit_max|percent/, 'payment.deposit_ceiling'],
    [/deposit_threshold|deposit_trigger|deposit_when|deposit_required_if/, 'payment.deposit_threshold'],
    [/deposit/, 'payment.deposit'],
    [/nonpayment|failure_to_pay|unpaid|withdrawal|forfeited_if_late|late_response_reduction|installment_nonclaim|requester_opt_out|search_fee_conditional|search_fee_unreasonable|denial_for_unpaid/, 'payment.nonpayment_consequence'],
    [/before_copy|before_produc|before_search|precondition|before_release|release_on_payment|upon_payment|fee_before_copies|fee_suspends_response|fee_tender|full_payment_at_production|suspends|deferral_pending|collection_of_agreed|commercial_fee_precondition|withhold_until_payment|withhold.*payment/, 'payment.production_conditioned_on_payment'],
    [/advance|prepay|prior_to/, 'payment.advance_payment'],
    [/method|form_of_payment|cash|card|accepted/, 'payment.method'],
    [/.*/, 'payment.other_payment'],
  ],
  redaction: [
    [/election_records_limit/, '→special_records'],
    [/separation_cost|cost_allocation/, '→fee'],
    [/segregab|reasonably_segregable|redact_and_release|nonexempt.*portion|separable|segregate_and_release|separate_exempt|redact_and_produce|commingled_no_denial|design_for_separation|redaction_is_denial|not_new_record/, 'redaction.segregability'],
    [/ssn|social_security|account|credit_card|financial|personal_identif|pii|dob|birth|mandatory_identifiers|confidential_information|privacy_deletion/, 'redaction.mandatory_pii'],
    [/personnel|employee|medical|privacy_notice|objection|record_subject|augmentation|public_official_record/, 'redaction.personnel_privacy_process'],
    [/protected_address|confidential_address|covered_person_address|protected_officer_address|victim|informant|security|critical_infrastructure/, 'redaction.protected_person'],
    [/business_confidentiality|trade_secret|third_party.*claim|owner_notice/, 'redaction.third_party_claim'],
    [/mark|indicate|explain_redaction|note_redaction|notice_of_redaction|basis_notice|state_basis|log/, 'redaction.marking_and_explanation'],
    [/.*/, 'redaction.other_redaction'],
  ],
  custody: [
    [/civil_litigant|litigant/, '→intake'],
    [/receipt_by_custodian_starts|receipt.*request/, '→response'],
    [/contractor|vendor|it_custodian_passthrough|les_records_management|no_contractual_delegation/, 'custody.contractor_and_thirdparty_custody'],
    [/tracking/, 'custody.request_tracking'],
    [/not_custodian_statement|not_in_custody|record_not_in_custody|refer|forward|redirect|other_agency|proper_custodian|designee_disclosure|record_not_maintained_referral|records_not_found_referral|wrong_recipient|wrong_department|record_type_originating/, 'custody.referral_to_proper_custodian'],
    [/designat|foia_officer|records_officer|coordinator|public_records_officer|point_of_contact|identify_custodian|municipal_clerk_default_rao|compliance_official/, 'custody.records_officer_designation'],
    [/custodian_defin|who_is_custodian|custodian_means|public_officer_definition|functional_custodian|responsible_authority|default_officer|default_custodian|deputy_custodian|delegation|duty_access|duty_to_permit|rulemaking|assistance_standard|release_agent/, 'custody.custodian_definition_and_role'],
    [/respond|responds|responsible_for_response/, 'custody.custodian_responds'],
    [/location|kept_at|maintained_at|where_records/, 'custody.records_location'],
    [/transfer|inmate_review|security_review|notify_before|pre_disclosure|civil_litigant_copy/, 'custody.pre_disclosure_review'],
    [/.*/, 'custody.other_custody'],
  ],
  routing: [
    [/designat|officer|coordinator|point_of_contact/, 'custody.records_officer_designation'],
    [/refer|forward|redirect|other_agency|proper/, 'custody.referral_to_proper_custodian'],
    [/review|inmate|security|notify_before/, 'custody.pre_disclosure_review'],
    [/.*/, 'custody.other_custody'],
  ],
  clarification: [
    [/ambiguous_overbroad_denial|excessive_information_denial|specificity_requir/, '→denial'],
    [/withdraw|nonresponse|no_response|abandon/, 'clarification.nonresponse_withdrawal'],
    [/assist|help_identify|duty_to_assist|reasonable_effort|elicit/, 'clarification.duty_to_assist'],
    [/confer|opportunity_to_narrow|opportunity_to_revise|narrow|reduce_scope|burden|substantial_disruption_resolution/, 'clarification.confer_to_narrow'],
    [/toll|pause|restart|reset|new_request|revised|suspends_response|cost_review_window/, 'clarification.toll_on_clarification'],
    [/deemed_satisfied|satisfied_after|reasonable_effort_satisfies/, 'clarification.duty_satisfied'],
    [/request_permitted|permission|consequences_notice|partial_response_required/, 'clarification.clarification_process'],
    [/.*/, 'clarification.other_clarification'],
  ],
  classification: [
    [/incarcerated/, '→eligibility'],
    [/presumption|openness|open_by_default|public_by_default|public_unless/, 'classification.presumption_of_openness'],
    [/recurrent/, 'classification.recurrent_requester'],
    [/voluminous/, 'classification.voluminous_request'],
    [/commercial/, 'classification.commercial_purpose'],
    [/standard_request|time_intensive|track|threshold_hours|simple_complex/, 'classification.processing_track'],
    [/two_record_classes|determined_at_request|discretionary_release|on_access_request_timing|record_classification|classification_scheme/, 'classification.record_classification_scheme'],
    [/.*/, 'classification.other_classification'],
  ],
  communication: [
    [/appeal_rights/, '→appeal'],
    [/fee_itemization|fee_review_objection/, '→fee'],
    [/substantive_response_definition/, '→response'],
    [/third_party_notice/, '→special_records'],
    [/acknowledg/, '→response'],
    [/delay|date_certain|additional_time_notice|availability_reexplanation|inability_basis|storage_advisement|estimate|timeline|availability_date|when_available/, '→response'],
    [/determination|decision_notice|reasons|disclose_agency_info/, 'communication.determination_notice'],
    [/extension/, '→response'],
    [/.*/, 'communication.other_communication'],
  ],
  notice: [
    [/record_subject|public_official_record|augmentation/, '→redaction'],
    [/extension/, '→response'],
    [/determination|decision|reasons/, 'communication.determination_notice'],
    [/estimate|availability|timeline/, '→response'],
    [/.*/, 'communication.other_notice'],
  ],
  search: [
    [/no_research|no_duty_to_create|new_records|electronic_retrieval|electronic_preferred/, '→production'],
    [/correspondence_scope|scope_specificity/, '→intake'],
    [/reasonable_search|adequate_search|good_faith_search|diligent|organize|maintain_for_retrieval/, 'search.reasonable_search_duty'],
    [/burden|unduly|overbroad|categorical/, 'search.burden_limit'],
    [/economical|efficient|most_economical|method/, 'search.economical_method'],
    [/segregat|identif/, 'search.identify_responsive'],
    [/.*/, 'search.other_search'],
  ],
  data_subject: [ [/.*/, 'data_subject.accuracy_challenge'] ],
  special_records: [
    [/election/, 'special_records.election_records'],
    [/criminal|investigation|law_enforce|police|arrest|incident|bodycam|body_cam|disaster_or_fragile/, 'special_records.law_enforcement'],
    [/trade_secret|proprietary|third_party_notice|third_party_nonpublic|business_confidential|nondisclosure_agreement/, 'special_records.third_party_proprietary'],
    [/personnel/, 'special_records.personnel'],
    [/economic_development|qualifying_site|sports|record_type_extended|storage_archived_deadline/, 'special_records.special_record_window'],
    [/security|building_plan|critical_infrastructure/, 'special_records.security_records'],
    [/transcript|court|legal_proceeding_bar/, 'special_records.court_records'],
    [/commercial_expedite|commercial_list|subscription_future|immediate_access_categ|published_for_sale|statutory_use_restrict|protective_rules|fragile_record|substantial_disruption|noncopyable_record|law_enforcement_discretion|shared_record_referral/, 'special_records.special_production_constraint'],
    [/.*/, 'special_records.other_special'],
  ],
  delivery: [ [/.*/, 'production.delivery_method'] ],
  aggregation: [ [/.*/, 'fee.aggregation'] ],
  appeal: [ [/.*/, 'appeal.retained_optional'] ], // held items (NY-0037, MI-0081, OR-0034, TN-0041 notice)
  withdrawal: [ [/.*/, 'payment.nonpayment_consequence'] ],
  tracking: [ [/.*/, 'custody.request_tracking'] ],
  certification: [ [/.*/, 'production.certified_copy'] ],
  procedure: [ [/.*/, 'intake.submission_channels'] ],
  scope: [ [/.*/, 'intake.reasonably_describes'] ],
  access: [ [/.*/, 'eligibility.any_person'] ],
  policy: [ [/.*/, 'classification.written_policy_required'] ],
  definition: [ [/commercial/, 'classification.commercial_purpose'], [/.*/, 'classification.definition_misc'] ],
  eligibility: [ [/incarcerated/, 'eligibility.incarcerated_requester_exclusion'], [/.*/, 'eligibility.any_person'] ],
  handling: [ [/.*/, 'classification.other_classification'] ],
  coverage: [ [/.*/, 'classification.coverage_misc'] ],
  // safety fallbacks for keys routed INTO timing families from elsewhere
  response: [
    [/acknowledg/, 'response.acknowledgment_window'],
    [/receipt/, 'response.clock_computation'],
    [/substantive_response_definition/, 'response.valid_response_forms'],
    [/extension/, 'response.extension_notice'],
    [/delay|date_certain|additional_time|availability|inability|storage_advisement|estimate|timeline/, 'response.time_estimate_notice'],
    [/.*/, 'response.initial_decision_window'],
  ],
  deadline: [ [/.*/, 'response.initial_decision_window'] ],
  extension: [ [/.*/, 'response.extension_grounds'] ],
  external: [ [/.*/, 'external.court_dependent'] ],
};

function canonOf(fam, key){
  const rules = R[fam]; if(!rules) return [null, 'UNMAPPED:'+fam];
  for(const [re,c] of rules){ if(re.test(key)){ if(c.startsWith('→')) return [c.slice(1), null]; return [null, c]; } }
  return [null, fam+'.other'];
}

// slice lookups: KEYMAP (source key -> canonical, from eligibility/timing slices), CROSSMAP (source key -> target family)
const KEYMAP={}, CROSSMAP={};
for(const f of ['eligibility','timing']){ const slice=JSON.parse(fs.readFileSync(RESEARCH+'/alignment/families/'+f+'.json','utf8'));
  const arr=Array.isArray(slice)?slice:slice.canonical_concepts;
  for(const e of arr) for(const k of (e.merged_from||[])) KEYMAP[k]=e.canonical_key;
  const cfm=(!Array.isArray(slice)&&slice.cross_family_moves)||{};
  for(const tf in cfm) for(const item of cfm[tf]) CROSSMAP[item.source_key]=tf;
}
function resolve(fam,key){ const [t,c]=canonOf(fam,key); if(t){ let tf=t==='production_format'?'production':t; const [t2,c2]=canonOf(tf,key); return c2||(tf+'.other'); } return c; }

const CAN={}, unmapped=[];
function add(store, can, code, r){ store[can]=store[can]||{members:{},keys:new Set(),homes:{},defs:[]};
  (store[can].members[code]=store[can].members[code]||[]).push(r.rule_id);
  store[can].keys.add(norm(r.concept_key)); const h=r.config_home||'?'; store[can].homes[h]=(store[can].homes[h]||0)+1;
  if(r.atomic_rule) store[can].defs.push(r.atomic_rule); }
for(const s of pr){ for(const r of (s.rules||[])){
  const key=norm(r.concept_key); let can;
  if(KEYMAP[key]) can=KEYMAP[key];
  else if(CROSSMAP[key]){ let tf=CROSSMAP[key]==='production_format'?'production':CROSSMAP[key]; can=resolve(tf,key); }
  else can=resolve(famOf(key), key);
  if(!can||/^UNMAPPED/.test(can)){ unmapped.push(key); continue; }
  add(CAN, can, s.code, r);
}}

const master=[];
for(const [can,v] of Object.entries(CAN)){ const states=Object.keys(v.members).sort(); const p=v.homes.parameter||0, st=v.homes.structural||0;
  const home=p&&st?`mixed(p:${p}/s:${st})`:(p?'parameter':(st?'structural':'structural'));
  const def=v.defs.slice().sort((a,b)=>a.length-b.length)[Math.floor(v.defs.length/2)]||'';
  master.push({canonical_key:can, family:can.split('.')[0], config_home:home, state_count:states.length, states,
    definition:String(def).slice(0,170), merged_from:[...v.keys].sort(), members_by_state:v.members}); }
master.sort((a,b)=> a.family<b.family?-1:a.family>b.family?1: b.state_count-a.state_count);

fs.writeFileSync(RESEARCH+'/alignment/master_concept_dictionary.json', JSON.stringify(master,null,2)+'\n');
// report
const byFam={}; for(const m of master){ byFam[m.family]=byFam[m.family]||{concepts:0}; byFam[m.family].concepts++; }
const otherHeavy=master.filter(m=>/\.(other|misc)/.test(m.canonical_key)).sort((a,b)=>b.state_count-a.state_count);
console.log('MASTER DICTIONARY:', master.length, 'canonical concepts across', Object.keys(byFam).length, 'families');
console.log('total member rules:', master.reduce((a,m)=>a+Object.values(m.members_by_state).reduce((x,y)=>x+y.length,0),0));
console.log('unmapped keys:', unmapped.length, unmapped.slice(0,10).join(', '));
console.log('\nconcepts per family:');
Object.entries(byFam).sort((a,b)=>b[1].concepts-a[1].concepts).forEach(([f,v])=>console.log('  '+f.padEnd(16)+v.concepts));
console.log('\ncatch-all buckets (review — high count = needs finer split):');
otherHeavy.slice(0,12).forEach(m=>console.log('  '+m.canonical_key.padEnd(34)+m.state_count+'st / '+Object.values(m.members_by_state).reduce((x,y)=>x+y.length,0)+' rules'));
