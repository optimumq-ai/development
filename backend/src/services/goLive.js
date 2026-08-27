'use strict';
// BW9a — THE GO-LIVE CHECKLIST'S DATA LAYER (Draft 6, residuals decided 2026-08-11).
//
// Three jobs, all read-mostly:
//
//   settings(jid)  — every LOCAL POLICY SETTING in the install, grouped by profile section: the
//                    city_config edges the template importer wrote, the eligibility dimensions'
//                    confirm flags, and the two CODE-DEFINED knob domains (de-minimis, the
//                    release-pipeline pair) whose rows may not exist until a city answers
//                    (rule-(d): defaults at read time — a row sweep cannot see them, so we ask
//                    each service's reader, exactly as configIntegrity check 8b does).
//   confirm(...)   — the one genuinely missing piece of plumbing Draft 6 §4.1 named: attest()
//                    reads `confirmed`, the importer writes it false, and until this nothing set
//                    it true. Confirming records WHO and WHEN on the setting itself — confirming
//                    the suggested default is still a decision, and now it is recorded as one.
//                    This endpoint never CREATES a setting: a policy setting is born from the
//                    template (or a code-defined service), and an unknown path is refused.
//   summary(jid)   — the gate summary, computed and never asserted: the same truths attest()
//                    and the integrity invariants enforce, made visible before someone hits the
//                    wall. Cheap enough for the Director's dashboard banner.
//
// Ownership labels are DISPLAY METADATA, not enforcement (Draft 6 §4.3) — the enforcement that
// exists is the attest-role scoping in the route (Legal sections: Senior Legal, decided
// 2026-08-11) and the SYSTEM_ADMIN-only enforcement flip.
var { get, all } = require('../db');
var JR = require('./jurisdictionRules');
var JP = require('./jurisdictionProfile');
var DMP = require('./deMinimisPolicy');
var ARL = require('./autoRelease');

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

// Section → owner display metadata, per the permission-group mapping Kevin ratified 2026-08-11
// (Draft 10 §5 q1: Legal Rules owns the statutory-timing domains too). Labels are what a reader
// sees on the checklist row; they gate nothing here.
var OWNERS = {
  identity:       { group: 'System Administration', label: 'Sys Admin (System Administration)' },
  taxonomy:       { group: 'Workflow & Taxonomy',   label: 'Director (Workflow & Taxonomy)' },
  intake:         { group: 'Workflow & Taxonomy',   label: 'Director (Workflow & Taxonomy)' },
  branches:       { group: 'Workflow & Taxonomy',   label: 'Director (Workflow & Taxonomy)' },
  disposition:    { group: 'Workflow & Taxonomy',   label: 'Director (Workflow & Taxonomy)' },
  clarification:  { group: 'Workflow & Taxonomy',   label: 'Director (Workflow & Taxonomy)' },
  eligibility:    { group: 'Workflow & Taxonomy',   label: 'Director (Workflow & Taxonomy)' },
  fees:           { group: 'Fee Configuration',     label: 'Director (Fee Configuration)' },
  payment:        { group: 'Fee Configuration',     label: 'Director (Fee Configuration)' },
  fee_waiver:     { group: 'Fee Configuration',     label: 'Director (Fee Configuration)' },
  ledger:         { group: 'Fee Configuration',     label: 'Director (Fee Configuration)' },
  exemption:      { group: 'Legal Rules',           label: 'Senior Legal (Legal Rules)' },
  redaction:      { group: 'Legal Rules',           label: 'Senior Legal (Legal Rules)' },
  deadlines:      { group: 'Legal Rules',           label: 'Senior Legal (Legal Rules)' },
  template_import:{ group: 'System Administration', label: 'read-only manifest (Sys Admin view)' }
};

// The sections Senior Legal (function role ATTORNEY_REVIEWER) may attest, per Kevin 2026-08-11.
// Everything else stays Director | System Admin. clock_matrix is a Legal-owned DOMAIN but has no
// profile section of its own — it rides the deadline machinery and the (BW9b) editors.
var LEGAL_SECTIONS = { exemption: 1, redaction: 1, deadlines: 1 };

// Which jurisdiction_rules DOMAIN a section's settings live in. Core sections whose signature
// comes from a configExtractors adapter still carry their template knobs in the domain row of the
// same name (fee/exemption/redaction) — those knobs gate the template_import roll-up, and this is
// where a person confirms them.
var SECTION_DOMAIN = {
  fees: 'fee', exemption: 'exemption', redaction: 'redaction', deadlines: 'deadline',
  clarification: 'clarification', payment: 'payment', fee_waiver: 'fee_waiver',
  intake: 'intake', eligibility: 'eligibility', branches: 'branches',
  disposition: 'disposition', ledger: 'ledger', template_import: 'template_import'
};

function ccSetting(domain, path, node) {
  var cc = node && node.city_config;
  if (!cc || typeof cc !== 'object') return null;
  return {
    domain: domain, path: path, kind: 'template',
    label: (node.label || (path.indexOf('/') >= 0 ? path.slice(path.indexOf('/') + 1) : path)),
    note: cc.note || null, value: cc.value != null ? cc.value : null,
    confirmed: cc.confirmed === true,
    confirmedBy: cc.confirmed_by || null, confirmedAt: cc.confirmed_at || null,
    suggestedDefault: cc.suggested_default != null ? cc.suggested_default : null
  };
}

// Every local policy setting in one domain's stored config, in the shapes pendingCityKnobs scans.
function settingsInConfig(domain, cfg) {
  var out = [];
  if (!cfg || typeof cfg !== 'object') return out;
  ['knobs', 'branches'].forEach(function (sec) {
    Object.keys(cfg[sec] || {}).forEach(function (k) {
      var s = ccSetting(domain, sec + '/' + k, cfg[sec][k]);
      if (s) out.push(s);
    });
  });
  Object.keys(cfg.dimensions || {}).forEach(function (k) {
    var d = cfg.dimensions[k];
    if (!d || typeof d !== 'object' || !('confirmed' in d)) return;
    out.push({
      domain: domain, path: 'dimensions/' + k, kind: 'dimension', label: k,
      note: 'Eligibility dimension — gated means the engine may act on it; confirming records that ' +
            'the city has decided its posture. Unconfirmed and gated blocks attestation.',
      value: d.gated === true ? 'gated' : 'not gated',
      confirmed: d.confirmed === true,
      confirmedBy: d.confirmed_by || null, confirmedAt: d.confirmed_at || null,
      suggestedDefault: null, gated: d.gated === true
    });
  });
  ['hold', 'caps_branch'].forEach(function (k) {
    var s = cfg[k] && ccSetting(domain, k, cfg[k]);
    if (s) out.push(s);
  });
  if (cfg.city_config) { var r = ccSetting(domain, 'city_config', cfg); if (r) out.push(r); }
  return out;
}

function codeSetting(st, path) {
  return {
    domain: st.domain, path: path, kind: 'code',
    label: st.knob, note: st.note || null,
    value: st.domain === DMP.DOMAIN ? (st.thresholdUsd != null ? st.thresholdUsd : null) : st.value,
    confirmed: st.confirmed === true, confirmedBy: st.confirmedBy || null, confirmedAt: st.confirmedAt || null,
    suggestedDefault: st.suggestedDefault != null ? st.suggestedDefault : null
  };
}

// The code-defined knobs, read from their services (the rows may not exist), keyed by the profile
// section whose detail screen hosts them: de-minimis rides with the fee schedule, the
// release-pipeline pair with delivery & release hold.
async function codeSettingsFor(section, jid) {
  var out = [];
  if (section === 'fees') {
    var dm = await DMP.read(jid);
    out.push(codeSetting(dm, 'knobs/' + DMP.KNOB));
  }
  if (section === 'disposition') {
    var names = Object.keys(ARL.KNOBS);
    for (var i = 0; i < names.length; i++) out.push(codeSetting(await ARL.knob(names[i], jid), 'knobs/' + names[i]));
  }
  return out;
}

// Who/when for code-defined settings: the services' readers do not surface confirmed_by/at, so
// fill them from the stored row when it exists (display only — confirmed-ness comes from the reader).
async function stampCodeSettings(jid, list) {
  var byDomain = {};
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    if (s.kind !== 'code' || s.confirmedBy) continue;
    if (!byDomain[s.domain]) { try { byDomain[s.domain] = await JR.read(jid, s.domain); } catch (e) { byDomain[s.domain] = null; } }
    var raw = byDomain[s.domain];
    var cc = raw && raw.knobs && raw.knobs[s.label] && raw.knobs[s.label].city_config;
    if (cc) { s.confirmedBy = cc.confirmed_by || null; s.confirmedAt = cc.confirmed_at || null; }
  }
}

// All local policy settings, grouped by profile section. template_import gets a COUNT of the
// whole-template roll-up rather than its own cards — its settings are confirmed where they live.
async function settings(jid) {
  var rows = await JP.getProfile(jid);
  var out = [];
  for (var i = 0; i < rows.sections.length; i++) {
    var sec = rows.sections[i];
    var list = [];
    if (sec.section !== 'template_import') {
      var domain = SECTION_DOMAIN[sec.section];
      if (domain) {
        var cfg = null;
        try { cfg = await JR.read(jid, domain); } catch (e) {}
        list = settingsInConfig(domain, cfg);
      }
      // The request-rules screen's clarification choices live in their OWN domain (the policy domain's
      // schema is policed as exactly the 7 fields) but belong to the clarification SECTION here, so the
      // hub counts them and confirm-by-path finds them.
      if (sec.section === 'clarification') {
        var scr = null;
        try { scr = await JR.read(jid, 'clarification_screen'); } catch (e) {}
        if (scr) list = list.concat(settingsInConfig('clarification_screen', scr));
      }
      list = list.concat(await codeSettingsFor(sec.section, jid));
      await stampCodeSettings(jid, list);
    }
    out.push(Object.assign({}, sec, {
      owner: OWNERS[sec.section] || { group: null, label: null },
      settings: list,
      unconfirmed: list.filter(function (s) {
        return s.kind === 'dimension' ? (s.gated && !s.confirmed) : !s.confirmed;
      }).length
    }));
  }
  return { jurisdiction: rows.jurisdiction, sections: out, summary: rows.summary };
}

// Confirm ONE local policy setting: the city's decision, recorded by name and date.
async function confirm(jid, domain, path, value, actor) {
  if (!jid) throw new Error('No active jurisdiction.');
  if (!domain || !path) throw new Error('A setting is identified by its domain and path.');
  if (value === undefined || value === null || value === '') {
    throw new Error('Confirming records a decision — send the value the city chose (choosing the suggested default is a decision too).');
  }
  var actorName = actor || 'staff';

  // Code-defined domains own their write path — but validate BEFORE writing: their writers write
  // first and read back, and a refused value must not leave a half-filled confirm on the row.
  if (domain === DMP.DOMAIN) {
    var n = Number(value);
    if (!isFinite(n) || n < 0) throw new Error('The de-minimis threshold must be a dollar amount of $0 or more.');
    return await DMP.write(jid, { value: n, confirmed: true }, actorName);
  }
  if (domain === ARL.DOMAIN) {
    var name = path.indexOf('/') >= 0 ? path.slice(path.indexOf('/') + 1) : path;
    if (!ARL.KNOBS[name]) throw new Error('No such local policy setting: ' + domain + '/' + path + '. This endpoint confirms existing settings; it never creates one.');
    var v = (value === true || value === 'on' || value === '1' || value === 1) ? 'on'
          : (value === false || value === 'off' || value === '0' || value === 0) ? 'off' : null;
    if (v == null) throw new Error('This setting takes "on" or "off" — nothing else is a decision.');
    return await ARL.writeKnob(name, { value: v, confirmed: true }, jid, actorName);
  }

  var cfg = await JR.read(jid, domain);
  if (!cfg) throw new Error('No ' + domain + ' configuration exists for this jurisdiction — a policy setting is born from the state template, never from this endpoint.');

  var refuse = function () {
    throw new Error('No such local policy setting: ' + domain + '/' + path + '. This endpoint confirms existing settings; it never creates one.');
  };
  var seg = path.split('/');
  if (seg[0] === 'dimensions') {
    var dim = (cfg.dimensions || {})[seg[1]];
    if (!dim || typeof dim !== 'object' || !('confirmed' in dim)) refuse();
    dim.confirmed = true;
    dim.confirmed_by = actorName;
    dim.confirmed_at = nowStr();
  } else {
    var node = null;
    if (seg[0] === 'knobs' || seg[0] === 'branches') node = (cfg[seg[0]] || {})[seg[1]];
    else if (path === 'city_config') node = cfg;
    else if (seg.length === 1) node = cfg[seg[0]];
    var cc = node && node.city_config;
    if (!cc || typeof cc !== 'object') refuse();
    cc.value = value;
    cc.confirmed = true;
    cc.confirmed_by = actorName;
    cc.confirmed_at = nowStr();
  }
  await JR.write(jid, domain, cfg, actorName);
  // Re-index so the section's configured/pending state reflects the confirmation immediately.
  try { await JP.sync(jid, { source: 'policy-setting-confirm', actor: actorName }); } catch (e) {}
  return { domain: domain, path: path, confirmed: true, confirmedBy: actorName };
}

// The gate summary — cheap enough for a dashboard banner, honest enough to be the checklist's
// headline. Integrity findings are NOT computed here (the full invariant sweep is the rail's own
// fetch); the one integrity-shaped fact a summary must carry is the worst state on the board:
// an ACTIVE branch running on an unconfirmed parameter.
async function summary(jid) {
  var s = await settings(jid);
  var unconfirmed = 0, sectionsOpen = 0;
  s.sections.forEach(function (sec) { if (sec.unconfirmed > 0) { unconfirmed += sec.unconfirmed; sectionsOpen++; } });

  var activeBranchUnconfirmed = [];
  try {
    var bcfg = await JR.read(jid, 'branches');
    Object.keys((bcfg && bcfg.branches) || {}).forEach(function (k) {
      var b = bcfg.branches[k];
      if (b && b.active === true && b.city_config && b.city_config.confirmed !== true) activeBranchUnconfirmed.push(k);
    });
  } catch (e) {}

  var proposals = 0;
  try {
    var pr = await get("SELECT COUNT(*) n FROM config_proposals WHERE jurisdiction_id = ? AND status = 'pending'", [jid]);
    proposals = Number(pr && pr.n) || 0;
  } catch (e) {}

  var devMode = await require('./enforcement').devMode();
  var total = s.summary.total, attested = s.summary.attested, drifted = s.summary.drifted;
  // Ready = every pill except the enforcement one is green. Turning dev mode off is the go-live
  // act itself, not a precondition of readiness.
  var ready = unconfirmed === 0 && proposals === 0 && activeBranchUnconfirmed.length === 0 &&
              drifted === 0 && attested === total && total > 0;
  return {
    jurisdiction: s.jurisdiction, ready: ready, devMode: devMode, live: !devMode,
    unconfirmedSettings: unconfirmed, sectionsWithUnconfirmed: sectionsOpen,
    proposalsPending: proposals,
    activeBranchUnconfirmed: activeBranchUnconfirmed,
    sectionsAttested: attested, sectionsTotal: total, sectionsDrifted: drifted,
    notConfigured: s.summary.notConfigured
  };
}

module.exports = { OWNERS: OWNERS, LEGAL_SECTIONS: LEGAL_SECTIONS, SECTION_DOMAIN: SECTION_DOMAIN,
  settings: settings, confirm: confirm, summary: summary };
