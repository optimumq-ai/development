'use strict';
// Enforcement gate with a master "developer / pre-production" switch.
// While dev_mode is ON (the default), every gate returns ok=true (bypassed) so the demo and existing
// test data behave exactly as before. Turning dev_mode OFF activates real enforcement. The gate is
// FAIL-OPEN: any error, missing section, or missing jurisdiction also returns ok=true, so enforcement
// can only ever ADD a block when it is confident (dev_mode off AND the section is genuinely unattested).
var { get, run } = require('../db');
var JP = require('./jurisdictionProfile');

async function cfg(key) { try { var r = await get("SELECT value FROM system_config WHERE key = ?", [key]); return r ? r.value : null; } catch (e) { return null; } }
async function setCfg(key, val) { await run("INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, String(val)]); }

// Master switch. Default ON (true) when unset.
async function devMode() { var v = await cfg('dev_mode'); if (v === null || v === undefined) return true; return v === '1' || v === 'true'; }
async function setDevMode(on) { await setCfg('dev_mode', on ? '1' : '0'); return await devMode(); }

async function activeJid() { return await cfg('jurisdiction_profile'); }

// Attestation gate for one profile section. ok=true => the action may proceed.
async function checkSection(jid, section) {
  try {
    if (await devMode()) return { ok: true, bypassed: true, mode: 'dev_mode', section: section };
    jid = jid || await activeJid();
    if (!jid) return { ok: true, bypassed: true, mode: 'no_jurisdiction', section: section };
    var st = await JP.sectionState(jid, section);
    if (!st) return { ok: true, bypassed: true, mode: 'no_section', section: section };
    var attested = !!st.attested && !st.drift;
    var reason = attested ? null
      : st.drift
        ? ('The ' + st.label + " configuration changed since it was signed off (approved v" + st.attestedVersion + ', now v' + st.version + "). An authorized official must re-attest it in the Jurisdiction Profile before this action can proceed.")
        : ('The ' + st.label + " configuration for this jurisdiction has not been signed off. An authorized official must attest it in the Jurisdiction Profile before this action can proceed.");
    return { ok: attested, bypassed: false, attested: attested, drift: !!st.drift, version: st.version, attestedVersion: st.attestedVersion, label: st.label, section: section, reason: reason };
  } catch (e) { return { ok: true, bypassed: true, mode: 'error', section: section }; }
}

module.exports = { devMode: devMode, setDevMode: setDevMode, checkSection: checkSection, cfg: cfg, setCfg: setCfg };
