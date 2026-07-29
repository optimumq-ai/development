'use strict';
// PHASE 7 / BW4 — THE DE-MINIMIS THRESHOLD KNOB (Kevin, 2026-07-29, answering Draft 2 §5 open question 3).
//
// The question the draft left open was "threshold config per city, or pure judgment?" — and the answer is
// BOTH, in that order. The waive-and-advance action shipped as pure judgment with a required note because
// inventing a number would have been this build answering a question that was asked of Kevin. Now there is
// a number, and it is a CITY POLICY knob, not law: no statute anywhere sets a de-minimis floor for a public
// records fee. A city decides what is not worth billing a citizen for.
//
// ══ RULE (d) CONVENTIONS, FOLLOWED EXACTLY ══
//
// The knob arrives UNCONFIRMED with a SUGGESTION, in the shape jurisdictionProfile.pendingCityKnobs already
// scans for (`knobs.<name>.city_config` with `confirmed: false`), so the confirm surface Draft 6 / BW9
// builds finds it without a special case. Defaults are supplied at READ time and never written into the
// stored config — the WS1/WS2/WS4 convention — so an install that has never been configured needs no
// migration and a stored row cannot go stale against a new field.
//
//   $25 IS A SUGGESTION, AND IS MARKED AS ONE. It is not researched, not cited and not derived from any
//   state's law, because there is nothing to derive it from. It sits in the same relation to a city's
//   answer as WS1's SUGGESTED_DEFAULTS do: a starting point, never an answer.
//
// ══ THE SEMANTICS, AND WHY UNCONFIRMED PRESERVES TODAY ══
//
//   unconfirmed   the action offers itself regardless of the total, exactly as it does today, and the note
//                 is still required. Behaviour-preserving: a city that has not answered has not chosen a
//                 ceiling, and inventing one for them would silently withdraw an action staff already have.
//   confirmed $X  the action offers itself only at or below $X. Above it, the action does not render and
//                 the route refuses — a threshold that the screen honoured but the endpoint did not would
//                 be a policy anyone could step around with one request.
//
// The note stays required either way. A threshold says the amount is small; it does not say why this
// particular request was not worth billing, and that is what a later reader needs.
var JR = require('./jurisdictionRules');

var DOMAIN = 'fee_de_minimis';
var KNOB = 'de_minimis_threshold';
var SUGGESTED_DEFAULT_USD = 25;
var NOTE = 'The dollar amount at or below which staff may waive an estimate outright and skip the notice ' +
  'cycle. Pure city policy — no state law sets a de-minimis floor for a records fee, so nothing here is ' +
  'derived from statute. The suggestion is a starting point, not an answer.';

// null / undefined / '' are ABSENCE, not zero. `Number(null)` is 0 and `isFinite(0)` is true, so the
// obvious one-liner turns "no value supplied" into a threshold of $0.00 — which reads as confirmed and
// refuses every waive. Absence has to survive the parse.
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

// The knob's state for a jurisdiction. Never throws — an unreadable config answers "unconfirmed", which is
// the permissive direction and therefore the one that cannot silently remove an action from staff.
async function read(jid) {
  var out = {
    domain: DOMAIN, knob: KNOB,
    confirmed: false, thresholdUsd: null,
    suggestedDefault: SUGGESTED_DEFAULT_USD, note: NOTE,
    configNotLaw: true
  };
  try {
    if (!jid) jid = await JR.activeJid();
    var raw = jid ? await JR.read(jid, DOMAIN) : null;
    var cc = raw && raw.knobs && raw.knobs[KNOB] && raw.knobs[KNOB].city_config;
    if (cc) {
      var v = num(cc.value);
      // CONFIRMED MEANS CONFIRMED WITH A NUMBER. A knob marked confirmed with no value is not a decision,
      // and treating it as one would gate the action on a ceiling nobody set.
      out.confirmed = cc.confirmed === true && v != null && v >= 0;
      out.thresholdUsd = out.confirmed ? v : null;
      if (cc.suggested_default != null) out.suggestedDefault = num(cc.suggested_default);
    }
  } catch (e) { console.error('[deMinimisPolicy read]', e && e.message); }
  return out;
}

// Write the knob. `confirmed` is the city's act of deciding; the value travels with it.
async function write(jid, patch, actor) {
  if (!jid) jid = await JR.activeJid();
  var raw = null;
  try { raw = await JR.read(jid, DOMAIN); } catch (e) { raw = null; }
  raw = raw || {};
  raw.knobs = raw.knobs || {};
  var v = num((patch || {}).value);
  raw.knobs[KNOB] = {
    city_config: {
      note: NOTE,
      confirmed: (patch || {}).confirmed === true,
      value: v,
      suggested_key: KNOB,
      suggested_default: SUGGESTED_DEFAULT_USD
    }
  };
  await JR.write(jid, DOMAIN, raw, actor || 'staff');
  return await read(jid);
}

// May the de-minimis waive be OFFERED for this estimate total? One function, two consumers — the rail
// decides whether to render on it and the route refuses on it, the same "one gate, two readers" rule the
// proceed gate and the record-search Found gate follow.
async function offerFor(total, jid) {
  var st = await read(jid);
  var t = num(total);
  if (!st.confirmed) {
    return Object.assign({ offered: true, reason: 'unconfirmed',
      text: 'This city has not set a de-minimis threshold, so this is your judgment. A reason is required.' }, st);
  }
  if (t == null) {
    return Object.assign({ offered: false, reason: 'no_total',
      text: 'Calculate an estimate first — there is no total to compare against the threshold.' }, st);
  }
  if (t <= st.thresholdUsd) {
    return Object.assign({ offered: true, reason: 'within_threshold',
      text: 'At or below this city’s de-minimis threshold of $' + st.thresholdUsd.toFixed(2) + '. A reason is still ' +
            'required — the threshold says the amount is small, not why this request was not worth billing.' }, st);
  }
  return Object.assign({ offered: false, reason: 'above_threshold',
    text: 'This estimate of $' + t.toFixed(2) + ' is above this city’s de-minimis threshold of $' +
          st.thresholdUsd.toFixed(2) + ', so it cannot be waived as de minimis. Send the estimate, or grant a ' +
          'fee waiver — which communicates the decision to the requester.' }, st);
}

module.exports = {
  DOMAIN: DOMAIN, KNOB: KNOB, SUGGESTED_DEFAULT_USD: SUGGESTED_DEFAULT_USD, NOTE: NOTE,
  read: read, write: write, offerFor: offerFor
};
