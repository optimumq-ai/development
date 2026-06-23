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
N({id:'verify-email',phase:'intake',label:'Is the requestor email verified?',decider:'code',status:'built',outcomes:[{label:'Yes',note:'Verified - notices and deliveries can proceed by email.'},{label:'No',note:'Attempt outreach (a phone call or an alternate contact) to confirm a valid email before relying on email delivery.'}]});
N({id:'classify-type',phase:'intake',label:'What record type is this, and how confident?',decider:'ai',status:'built',criteria:['Semantic + AI match of the request text against the taxonomy','Returns a record type and a 0-100 confidence score'],outcomes:[{label:'Confident match',to:'route-confident'},{label:'No confident match',to:'route-confident'}],automatedBy:'enrich the taxonomy (record types, synonyms, keywords)'});
N({id:'complexity',phase:'intake',label:'How complex is it (simple / standard / complex / redaction)?',decider:'ai',status:'built'});
N({id:'redaction-flag',phase:'intake',label:'Does it likely need redaction?',decider:'ai',status:'built'});
N({id:'mrr-flag',phase:'intake',label:'Is it a multi-record request?',decider:'ai',status:'partial',note:'Flag is set; splitting not yet built.'});
N({id:'sensitivity',phase:'intake',label:'Any sensitivity flags (legal hold / investigation / sensitive)?',decider:'ai',status:'built',outcomes:[{label:'Flagged',to:'route-sensitive'},{label:'Clean'}]});
N({id:'dept-confidence',phase:'intake',label:'Can the AI determine the department confidently?',decider:'hybrid',status:'built',criteria:['AI proposes a department','Code applies the 70% confidence threshold'],outcomes:[{label:'>= 70%'},{label:'< 70%'}]});

// ---- routing ----
N({id:'route-sensitive',phase:'routing',label:'Does a sensitivity flag force human intake?',decider:'code',status:'built',criteria:['Rule: flags contains LEGAL_HOLD / ONGOING_INVESTIGATION / SENSITIVE'],outcomes:[{label:'Yes -> hold at Intake (Open Records)'},{label:'No -> continue'}]});
N({id:'route-confident',phase:'routing',label:'Can we confidently assign a team?',decider:'code',status:'partial',criteria:['Rule: confidence >= 70 AND a team is known','Team source today: the record type owning team. Team/User Smart Routing is a planned addition.'],outcomes:[{label:'Yes -> auto-advance to Record Search at the assigned team',to:'fee-waiver-requested',note:'Assignment uses the record type owning team today; Team/User Smart Routing is a planned additional source.'},{label:'No -> route to Open Records for manual team assignment',to:'route-fallback'}]});
N({id:'route-fallback',phase:'routing',label:'Catch-all so nothing is unrouted',decider:'code',status:'built',outcomes:[{label:'-> Open Records intake'}]});
N({id:'route-person',phase:'routing',label:'Route to a specific person by specialization?',decider:'hybrid',status:'planned',automatedBy:'add specialization text to the person / team (matched via pgvector)'});
N({id:'route-workload',phase:'routing',label:'Balance across team members by workload?',decider:'code',status:'planned'});

// ---- scoping ----
N({id:'mrr-split',phase:'scoping',label:'Should this be split into child requests?',decider:'hybrid',status:'planned',criteria:['AI proposes the split','A human confirms']});
N({id:'mrr-child-type',phase:'scoping',label:'Record type & routing per child?',decider:'ai',status:'planned'});

// ---- fees ----
N({id:'fee-waiver-requested',phase:'fees',label:'Was a fee waiver requested?',decider:'code',status:'built',outcomes:[{label:'Yes -> waiver decision'},{label:'No -> estimate'}]});
N({id:'fee-waiver-grant',phase:'fees',label:'Should the fee waiver be granted?',decider:'human',status:'built',outcomes:[{label:'Granted -> fees waived, request continues'},{label:'Denied -> denial notice sent, request continues as normal'}]});
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

var descriptions = {
"intake-channel":"Records where the request came from - the public form, the AI chat agent, or a staff member entering it by hand. This sets how much the system already knows and which confirmations are needed.",
"verify-email":"Confirms the requestor's email is real before work proceeds, so notices and deliveries actually reach them and the request is traceable. If the requestor chose postal mail for delivery, verifying the email is less critical.",
"classify-type":"The AI reads the request and matches it to a record type in your taxonomy, with a confidence score. This single match drives routing, fee estimation, and redaction expectations downstream.",
"complexity":"The AI gauges how involved the request is (simple, standard, complex, or redaction-heavy), which sets the statutory deadline and signals how much labor to expect.",
"redaction-flag":"An early read on whether the records will need redaction (e.g., body-cam video, personnel files), so the request can be routed and resourced accordingly.",
"mrr-flag":"Detects a request that really contains several distinct record asks bundled together, which may need to be split into child requests so each can be tracked and billed properly.",
"sensitivity":"Looks for signals that a request touches a legal hold, an active investigation, or otherwise sensitive matter - cases that should always pause for a human even when everything else looks routine.",
"dept-confidence":"Decides whether the AI is confident enough about which department owns the records to route automatically, or whether a person should triage it. The 70% line is the cutoff.",
"route-sensitive":"The first routing rule: if anything flagged the request as sensitive, it is held at intake for a person - this rule outranks the confident-match shortcut so sensitive matters never auto-advance.",
"route-confident":"Decides whether the system can confidently assign a fulfillment team. Today that means a high-confidence record-type match whose type has a known owning team; a planned enhancement also matches Team/User Smart Routing descriptions. If yes, the request auto-advances to that team to begin searching. If no, it goes to Open Records for a person to assign the team, rather than guessing.",
"route-fallback":"A safety net: if no other rule applies, the request still lands somewhere (Open Records intake) so nothing is ever left unrouted.",
"route-person":"Beyond routing to a team, this would send the request to a specific person whose stated specialty best matches it - matched by meaning, not just keywords.",
"route-workload":"Spreads incoming work across the people on a team based on current load, so no one is overwhelmed while others sit idle.",
"mrr-split":"For a bundled multi-record request, the AI proposes how to break it into separate child requests and a person confirms - so each piece gets its own routing, estimate, and deadline.",
"mrr-child-type":"Each child of a split request is classified and routed on its own, exactly like a standalone request.",
"fee-waiver-requested":"Notes whether the requestor asked for the fees to be waived (e.g., a journalist or a public-interest request), which branches the flow toward a waiver decision.",
"fee-waiver-grant":"A person decides whether the fee waiver is justified under policy - a judgment call, not automated. Denying it sends the requestor a denial notice (reason picked from a reusable library or typed fresh, which is then saved for reuse) and the request continues through the normal fee process; it is not closed.",
"estimate-auto-manual":"The pivotal cost decision: can the system estimate this request's labor and copies automatically from what it already knows about this record type, or does a person have to work it up by hand? Automating it is the single biggest time-saver for small, high-volume requests.",
"estimate-cost":"Turns the expected quantities (search hours, pages, media) into a dollar figure using the city's current rate schedule.",
"estimate-threshold":"Checks whether the estimate is high enough that the requestor must be notified and agree before work continues, per local policy.",
"deposit-required":"Determines whether a prepayment is required before staff start work, based on the estimate and the city's deposit policy.",
"deposit-paid":"Watches for the deposit to actually arrive. Because it depends on the requestor doing something, it is checked over time rather than at a single moment.",
"work-can-begin":"The gate that lets fulfillment start - satisfied when the deposit is paid, or no deposit was required, or a waiver was granted. Until then the request waits.",
"reconcile":"At the end, compares the final actual cost to the estimate and applies the city's over/under policy (refund, bill the difference, or absorb it). This is also where real actuals get fed back to make future estimates smarter.",
"responsiveness":"Staff decide which located records actually answer the request (responsive) versus those that do not. The AI surfaces likely matches, but the call is a human's.",
"ai-suggest-docs":"The AI searches inside the gathered documents by meaning and suggests which pages are likely responsive, to speed up the human review.",
"any-responsive":"Determines whether any responsive records exist at all. If none do, the request branches to a formal no-records response.",
"enough-to-advance":"A simple gate that only lets the request move forward once at least one responsive record has been identified.",
"public-ready":"Decides whether a record can be released exactly as-is, or whether something must be withheld or redacted first. The system reads the record type's flags; a person confirms.",
"exemptions":"Identifies which legal exemptions justify withholding or redacting specific content, with the statute citations that will appear in the response.",
"known-clean":"Recognizes record types that are reliably safe to release without redaction, letting them skip the redaction stage entirely.",
"redaction-where":"Whether redaction is done inside the originating department or by a central redaction team - a configurable choice per department.",
"redaction-autostart":"Whether the system kicks off automated redaction the moment a request enters the redaction stage, instead of waiting for someone to click - important because confident routing can skip the step where a person would have started it.",
"redaction-zones":"The actual work of marking what to hide in documents or video - drawn by a person, with AI assistance to detect faces and likely-sensitive areas.",
"redaction-approval-required":"Whether a second person must approve the redactions before release, per policy - a check on sensitive productions.",
"redaction-adequate":"A reviewer confirms the redactions are complete and correct before the record can go out. A judgment call that stays with a person.",
"vaughn":"Produces a Vaughn index - the itemized log of what was withheld and the legal basis for each - generated from the redaction marks and their cited exemptions.",
"review-before-delivery":"Whether every response gets a final review before it is sent, or whether routine ones can go directly - a policy toggle.",
"final-approval":"The last sign-off before records are released to the requestor.",
"delivery-method":"How the records are delivered - secure download, email, or physical mail - based on the request and the record format.",
"deadline":"Calculates the statutory due date from the request's complexity and the jurisdiction's rules, so the compliance clock is set correctly from day one.",
"tolling":"Whether the legal clock is paused while the city is waiting on the requestor (for payment or clarification), so delays outside the city's control do not count against it.",
"overdue":"Flags requests that are overdue or approaching their deadline so they can be escalated before they breach.",
"response-category":"Classifies how the request was ultimately answered - granted, partially granted, denied, or no records - which determines the closing notice and the compliance record.",
"await-deposit-reminder":"While a request waits on an unpaid deposit, the system sends reminders on a policy-set schedule. This fires on elapsed time, not on an event.",
"await-deposit-close":"If the deposit stays unpaid past the policy limit, the request is automatically closed as withdrawn for non-payment, with notice to the requestor.",
"overrun-pause":"If costs climb past the approved estimate beyond the allowed tolerance, work pauses automatically and a revised estimate goes out - no quiet overspending.",
"await-approval-timeout":"If the requestor never responds to a revised estimate within the allowed window, the request is treated as withdrawn (a constructive withdrawal).",
"requestor-refuses":"If the requestor declines a cost increase, policy decides what happens - deliver only what their deposit already covers, narrow the request to fit, or withdraw it - and how any unused deposit is handled.",
"clarification-timeout":"If a vague request is sent back for clarification and the requestor goes silent past the limit, it is closed for lack of clarification.",
"custodian-escalate":"If an internal department sits on requested records too long, the system nudges and then escalates to a manager, so internal delays do not stall the response.",
"no-records-exit":"When a diligent search turns up nothing responsive, the request is closed with a formal no-records notice.",
"mrr-partial":"When a split request has some children fulfilled and others empty or withheld, the parent is closed as partially granted, with the basis spelled out.",
"permissions":"Continuously enforces who is allowed to see and act on a request at each stage, based on roles and assignments.",
"assignment":"Who is currently responsible for the request - set by hand today, with team-claim and auto-assignment planned."
};
Object.keys(descriptions).forEach(function(id){ if(nodes[id]) nodes[id].description = descriptions[id]; });

module.exports = { version:'1.0', legend:legend, phases:phases, nodes:nodes, terminalStates:terminalStates, policyKnobs:policyKnobs };
