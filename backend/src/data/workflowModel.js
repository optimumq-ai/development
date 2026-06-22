'use strict';
// Machine-readable Workflow Decision Model - the executable form of docs/WORKFLOW_DECISIONS.md.
// Consumed by the Process Map now, and the interactive Simulator + config views later.
var legend = {
  deciders: {
    ai:    { label:'AI proposes',        color:'#6D28D9', bg:'#F3E8FF' },
    code:  { label:'Code (rule / math)', color:'#1F4E79', bg:'#EFF6FF' },
    human: { label:'Human judgment',     color:'#03543F', bg:'#DEF7EC' },
    policy:{ label:'Policy value',       color:'#92400E', bg:'#FEF3C7' },
    hybrid:{ label:'Hybrid',             color:'#9A3412', bg:'#FFEDD5' }
  },
  statuses: { built:{label:'Built',color:'#03543F'}, partial:{label:'Partial',color:'#92400E'}, planned:{label:'Planned',color:'#6B7280'} },
  triggers: { event:'Fires when something happens', time:'Time-driven: fires when nothing happens for N days (the tickler)' }
};
var phases = [
  { id:'intake',    name:'Intake & classification' },
  { id:'routing',   name:'Routing (the engine)' },
  { id:'scoping',   name:'Scoping / multi-record' },
  { id:'fees',      name:'Fees, estimate & deposit' },
  { id:'search',    name:'Record search & responsiveness' },
  { id:'readiness', name:'Public-readiness & exemptions' },
  { id:'redaction', name:'Redaction' },
  { id:'review',    name:'Review, delivery & compliance' },
  { id:'stalls',    name:'Stalls, exceptions & exits' },
  { id:'cross',     name:'Cross-cutting' }
];
var nodes = {};
function N(o){ if(!o.trigger)o.trigger='event'; if(!o.criteria)o.criteria=[]; if(!o.outcomes)o.outcomes=[]; if(o.automatedBy===undefined)o.automatedBy=null; nodes[o.id]=o; }

// ---- intake ----
N({id:'intake-channel',phase:'intake',label:'Which channel did it arrive on?',decider:'code',status:'built',outcomes:[{label:'Portal form'},{label:'Chat agent'},{label:'Staff-created'}]});
N({id:'verify-email',phase:'intake',label:'Is the requestor email verified?',decider:'code',status:'built'});
N({id:'classify-type',phase:'intake',label:'What record type is this, and how confident?',decider:'ai',status:'built',criteria:['Semantic + AI match of the request text against the taxonomy','Returns a record type and a 0-100 confidence score'],outcomes:[{label:'Confident match',to:'route-confident'},{label:'No confident match',to:'route-uncertain'}],automatedBy:'enrich the taxonomy (record types, synonyms, keywords)'});
N({id:'complexity',phase:'intake',label:'How complex is it (simple / standard / complex / redaction)?',decider:'ai',status:'built'});
N({id:'redaction-flag',phase:'intake',label:'Does it likely need redaction?',decider:'ai',status:'built'});
N({id:'mrr-flag',phase:'intake',label:'Is it a multi-record request?',decider:'ai',status:'partial',note:'Flag is set; splitting not yet built.'});
N({id:'sensitivity',phase:'intake',label:'Any sensitivity flags (legal hold / investigation / sensitive)?',decider:'ai',status:'built',outcomes:[{label:'Flagged',to:'route-sensitive'},{label:'Clean'}]});
N({id:'dept-confidence',phase:'intake',label:'Can the AI determine the department confidently?',decider:'hybrid',status:'built',criteria:['AI proposes a department','Code applies the 70% confidence threshold'],outcomes:[{label:'>= 70%'},{label:'< 70%'}]});

// ---- routing ----
N({id:'route-sensitive',phase:'routing',label:'Does a sensitivity flag force human intake?',decider:'code',status:'built',criteria:['Rule: flags contains LEGAL_HOLD / ONGOING_INVESTIGATION / SENSITIVE'],outcomes:[{label:'Yes -> hold at Intake (Open Records)'},{label:'No -> continue'}]});
N({id:'route-confident',phase:'routing',label:'Confident match AND owning team known?',decider:'code',status:'built',criteria:['Rule: confidence >= 70 AND has_owner_team is true'],outcomes:[{label:'Yes -> auto-advance to Record Search at the owning team'},{label:'No -> continue'}]});
N({id:'route-uncertain',phase:'routing',label:'Low match confidence?',decider:'code',status:'built',criteria:['Rule: confidence < 70'],outcomes:[{label:'Yes -> Open Records intake for triage'}]});
N({id:'route-fallback',phase:'routing',label:'Catch-all so nothing is unrouted',decider:'code',status:'built',outcomes:[{label:'-> Open Records intake'}]});
N({id:'route-person',phase:'routing',label:'Route to a specific person by specialization?',decider:'hybrid',status:'planned',automatedBy:'add specialization text to the person / team (matched via pgvector)'});
N({id:'route-workload',phase:'routing',label:'Balance across team members by workload?',decider:'code',status:'planned'});

// ---- scoping ----
N({id:'mrr-split',phase:'scoping',label:'Should this be split into child requests?',decider:'hybrid',status:'planned',criteria:['AI proposes the split','A human confirms']});
N({id:'mrr-child-type',phase:'scoping',label:'Record type & routing per child?',decider:'ai',status:'planned'});

// ---- fees ----
N({id:'fee-waiver-requested',phase:'fees',label:'Was a fee waiver requested?',decider:'code',status:'built',outcomes:[{label:'Yes -> waiver decision'},{label:'No -> estimate'}]});
N({id:'fee-waiver-grant',phase:'fees',label:'Should the fee waiver be granted?',decider:'human',status:'partial'});
N({id:'estimate-auto-manual',phase:'fees',label:'Manual or automated estimate?',decider:'code',status:'built',criteria:['Does the matched record type have an estimation profile? (expert seed / historical actuals / sampling)','Is the profile reliable - low variance and enough samples?','Is the request within normal size and dollar bounds?'],outcomes:[{label:'All yes -> AUTOMATED estimate (priced from the profile)'},{label:'Any no -> MANUAL estimate / scoping search'}],automatedBy:'seed the record-type estimate profile (Taxonomy -> Estimate automation)',note:'Showcase node for criteria transparency. Profile + variance gate BUILT; historical writeback PLANNED.'});
N({id:'estimate-cost',phase:'fees',label:'What is the estimated cost?',decider:'code',status:'built',criteria:['Fee engine prices the component quantities with the city rate config']});
N({id:'estimate-threshold',phase:'fees',label:'Does the estimate exceed the notify threshold?',decider:'code',status:'built',outcomes:[{label:'Yes -> notify / consent required'},{label:'No -> proceed'}]});
N({id:'deposit-required',phase:'fees',label:'Is a deposit required before work begins?',decider:'code',status:'partial',automatedBy:'fill the Jurisdiction Profile (deposit threshold + %)'});
N({id:'deposit-paid',phase:'fees',label:'Has the required deposit been paid?',decider:'code',status:'planned',trigger:'time',automatedBy:'the tickler (daily payment check)'});
N({id:'work-can-begin',phase:'fees',label:'Can work begin? (deposit paid OR none required OR waiver granted)',decider:'code',status:'planned',outcomes:[{label:'Yes -> Record Search'},{label:'No -> hold (Awaiting Deposit)',to:'await-deposit-reminder'}]});
N({id:'reconcile',phase:'fees',label:'Estimate vs. final reconciliation',decider:'code',status:'planned',note:'Natural hook to write ACTUAL quantities back into the estimate profile.'});

// ---- search ----
N({id:'responsiveness',phase:'search',label:'Which records are responsive?',decider:'human',status:'built',criteria:['Staff mark records responsive / not','AI suggests likely-responsive documents']});
N({id:'ai-suggest-docs',phase:'search',label:'AI-suggested responsive documents',decider:'ai',status:'built'});
N({id:'any-responsive',phase:'search',label:'Are there any responsive records at all?',decider:'human',status:'partial',outcomes:[{label:'Yes -> continue'},{label:'None -> no-records exit',to:'no-records-exit'}]});
N({id:'enough-to-advance',phase:'search',label:'Enough found to advance?',decider:'code',status:'built',criteria:['Gate: at least one record marked responsive']});

// ---- readiness ----
N({id:'public-ready',phase:'readiness',label:'Is the record releasable as-is (public-ready)?',decider:'hybrid',status:'partial',criteria:['Code reads public_availability + redaction flag','Human confirms']});
N({id:'exemptions',phase:'readiness',label:'Which exemptions / statutes apply?',decider:'human',status:'planned',automatedBy:'an exemption / citation framework (e.g. TX Gov Code Ch. 552)'});
N({id:'known-clean',phase:'readiness',label:'Known-clean type that bypasses redaction?',decider:'code',status:'planned',automatedBy:'add the type to the known-clean registry'});

// ---- redaction ----
N({id:'redaction-where',phase:'redaction',label:'In-department vs. central redaction?',decider:'code',status:'planned',automatedBy:'a config toggle per department'});
N({id:'redaction-autostart',phase:'redaction',label:'Fire auto-redaction on ENTERING the redaction stage?',decider:'code',status:'planned',note:'State-transition hook - confident routing can skip the step where a human would click it.'});
N({id:'redaction-zones',phase:'redaction',label:'Draw / auto-detect redaction zones',decider:'hybrid',status:'partial',note:'Workbench built (parked).',automatedBy:'build a mass-redaction template or redaction profile'});
N({id:'redaction-approval-required',phase:'redaction',label:'Is separate redaction approval required?',decider:'code',status:'planned',automatedBy:'a config toggle'});
N({id:'redaction-adequate',phase:'redaction',label:'Is the redaction adequate / approved?',decider:'human',status:'partial'});
N({id:'vaughn',phase:'redaction',label:'Generate a Vaughn index from the zones',decider:'code',status:'planned',criteria:['Needs redaction rules to carry an exemption / statute citation']});

// ---- review ----
N({id:'review-before-delivery',phase:'review',label:'Always review before delivery?',decider:'code',status:'planned',automatedBy:'a config toggle'});
N({id:'final-approval',phase:'review',label:'Final approval to release',decider:'human',status:'partial'});
N({id:'delivery-method',phase:'review',label:'Delivery method (email / download / mail)?',decider:'code',status:'built'});
N({id:'deadline',phase:'review',label:'What is the statutory deadline?',decider:'code',status:'built',criteria:['Classification -> days, per the Jurisdiction Profile']});
N({id:'tolling',phase:'review',label:'Is the clock tolled (awaiting deposit / clarification)?',decider:'code',status:'planned',trigger:'time'});
N({id:'overdue',phase:'review',label:'Overdue / at-risk?',decider:'code',status:'partial',trigger:'time',automatedBy:'the tickler (daily deadline scan)'});
N({id:'response-category',phase:'review',label:'Response category (granted / partial / denied / no records)?',decider:'hybrid',status:'planned'});

// ---- stalls, exceptions & exits (mostly time-driven) ----
N({id:'await-deposit-reminder',phase:'stalls',label:'Deposit unpaid past a reminder offset?',decider:'code',status:'planned',trigger:'time',criteria:['Tickler compares days-in-state to the reminder offsets'],outcomes:[{label:'Yes -> send reminder (clock tolled)'}],automatedBy:'the tickler + Jurisdiction Profile reminder offsets'});
N({id:'await-deposit-close',phase:'stalls',label:'Deposit unpaid past the closure threshold?',decider:'code',status:'planned',trigger:'time',outcomes:[{label:'Yes -> close: WITHDRAWN (non-payment) + notice',to:'t-withdrawn-nonpayment'}]});
N({id:'overrun-pause',phase:'stalls',label:'Costs exceed the approved estimate beyond tolerance?',decider:'code',status:'planned',criteria:['Math: projected/actual vs. approved + overrun tolerance %'],outcomes:[{label:'Yes -> pause, revise estimate, await approval + added deposit',to:'await-approval-timeout'}]});
N({id:'await-approval-timeout',phase:'stalls',label:'Requestor silent on a revised estimate past threshold?',decider:'code',status:'planned',trigger:'time',outcomes:[{label:'Yes -> constructive withdrawal',to:'t-withdrawn-noresponse'}]});
N({id:'requestor-refuses',phase:'stalls',label:'Requestor refuses the increase?',decider:'human',status:'planned',outcomes:[{label:'Deliver what the deposit covers (partial)',to:'t-partial'},{label:'Narrow scope -> re-estimate'},{label:'Withdraw',to:'t-withdrawn-requestor'}]});
N({id:'clarification-timeout',phase:'stalls',label:'Requestor does not clarify a vague request past threshold?',decider:'code',status:'planned',trigger:'time',outcomes:[{label:'Yes -> close: withdrawn (no clarification)'}]});
N({id:'custodian-escalate',phase:'stalls',label:'Internal custodian has not returned records in time?',decider:'code',status:'planned',trigger:'time',outcomes:[{label:'Nudge -> escalate to manager'}]});
N({id:'no-records-exit',phase:'stalls',label:'Zero responsive records found?',decider:'hybrid',status:'partial',outcomes:[{label:'-> NO RESPONSIVE RECORDS + notice',to:'t-norecords'}]});
N({id:'mrr-partial',phase:'stalls',label:'Some children empty / withheld?',decider:'hybrid',status:'planned',outcomes:[{label:'-> roll up to PARTIALLY GRANTED',to:'t-partial'}]});

// ---- cross-cutting ----
N({id:'permissions',phase:'cross',label:'Can this user act here / see this queue?',decider:'code',status:'built'});
N({id:'assignment',phase:'cross',label:'Who is it assigned to?',decider:'hybrid',status:'partial',note:'Manual assign built; claim / auto-assign not.'});

var terminalStates = [
  { id:'t-granted',              name:'Granted',                  notice:'Release / delivery notice' },
  { id:'t-partial',             name:'Partially granted',        notice:'Partial-release notice + basis for any withholding' },
  { id:'t-denied',              name:'Denied',                   notice:'Denial notice with statutory citation(s)' },
  { id:'t-norecords',           name:'No responsive records',    notice:'No-records notice' },
  { id:'t-withdrawn-requestor', name:'Withdrawn by requestor',   notice:'Acknowledgement of withdrawal' },
  { id:'t-withdrawn-nonpayment',name:'Withdrawn (non-payment)',  notice:'Closure-for-non-payment notice' },
  { id:'t-withdrawn-noresponse',name:'Withdrawn (no response)',  notice:'Constructive-withdrawal notice' }
];

var policyKnobs = [
  { key:'estimate_threshold',              controls:'Cost above which an estimate / consent is required' },
  { key:'deposit_required_threshold',      controls:'Cost above which a deposit is required before work' },
  { key:'deposit_percent',                 controls:'Deposit as % of the estimate' },
  { key:'overrun_tolerance_percent',       controls:'How far actual may exceed the approved estimate before a pause' },
  { key:'deposit_reminder_offsets',        controls:'Days at which deposit reminders fire' },
  { key:'deposit_close_threshold',         controls:'Days unpaid after which the request auto-closes' },
  { key:'approval_response_threshold',     controls:'Days to respond to a (revised) estimate before withdrawal' },
  { key:'clarification_response_threshold',controls:'Days to clarify before withdrawal' },
  { key:'clock_tolls_when_awaiting_requestor', controls:'Whether the statutory clock pauses while waiting on the requestor' },
  { key:'min_sample_size',                 controls:'Completed requests before a profile average is trusted (default 3)' },
  { key:'max_variance_cv',                 controls:'Variance cutoff for auto-estimating (default 0.5)' },
  { key:'high_dollar_review',              controls:'Estimate above which a human always confirms (default $200)' }
];

module.exports = { version:'1.0', legend:legend, phases:phases, nodes:nodes, terminalStates:terminalStates, policyKnobs:policyKnobs };
