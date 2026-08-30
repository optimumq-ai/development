// THE STAFF ALERT CATALOGUE (Kevin 2026-08-30, SPEC_setup_hub §3i). Every in-app alert — the bell at the top of
// the screen and the My Tasks notifications strip — is one `kind` here, described in plain words: what it is
// called, when it is sent, who receives it. The Staff Alerts screen's Alerts tab is rendered FROM this list, so
// an alert cannot be added to the code without a plain-words entry appearing there: notifications.emit()
// logs a warning for a kind that is not listed. No per-alert on/off (Kevin: not for now). `email` is reserved
// for the future "also send this one by email" option and is not surfaced yet.
var ALERTS = [
  { kind: 'setup_ready', title: 'Ready for approval', when: 'A setup screen is completed — every required item saved, or a list declared complete', who: 'The approvers for that part of setup', source: 'services/setupHub.js' },
  { kind: 'setup_reapproval', title: 'Re-approval needed', when: 'An approved setup screen is changed and saved', who: 'The approvers for that part of setup', source: 'services/setupHub.js' },
  { kind: 'work_returned', title: 'Your work was returned', when: 'A supervisor sends a task back for corrections, or a fee resolution you proposed is turned down', who: 'The person the work was assigned to', source: 'services/taskRouting.js · routes/objections.js' },
  { kind: 'hold_auto_lifted', title: 'Your release hold was lifted by statute', when: 'A release hold reaches the end of the time the law allows', who: 'The person who placed the hold', source: 'services/releaseHold.js' },
  { kind: 'import_template', title: 'Import source needs a redaction template', when: 'The nightly import finds a record source with no template linked', who: 'Redaction administrators', source: 'services/importIngest.js' },
  { kind: 'coverage_gap', title: 'Possible gap in redaction coverage', when: 'The redaction audit finds a pattern the rules do not cover', who: 'Redaction administrators', source: 'services/coverageGap.js' },
];
var BY_KIND = {}; ALERTS.forEach(function (a) { BY_KIND[a.kind] = a; });
function list() { return ALERTS.map(function (a) { return { kind: a.kind, title: a.title, when: a.when, who: a.who }; }); }
function known(kind) { return !!BY_KIND[kind]; }
module.exports = { ALERTS: ALERTS, list: list, known: known };
