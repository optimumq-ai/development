import React from 'react';
import { C } from '../../lib/theme';
import { G, DecidedByBadge } from '../primitives';

// THE COMMERCIAL-RATE PANEL (PHASE 7 / BW4) — ONE panel, TWO screens.
//
// The classification is one fact about the request with one home
// (`requests.commercial_classification`), so it gets one component rather than a copy on intake review and
// a divergent copy on the estimate screen. The intake reviewer classifies BEFORE a deadline is quoted (NJ
// 14 business days, IL recurrent/commercial track); the estimator sees the same fact because it is the
// estimator's invoice that carries the rate.
//
// RULE (c): a classification is never the system's. Every rendered state names the person or asks one.

var kv = { fontSize: 12.5, color: C.muted };

export default function CommercialRatePanel(props) {
  var cm = props.commercial || {};
  // Rule (b) is the CALLER's job (branch capabilities live on the screen); this renders when told to.
  if (!cm.enabled) return null;
  if (cm.outcome !== 'needs_decision' && cm.outcome !== 'classified') return null;
  var busy = !!props.busy, readOnly = !!props.readOnly;
  function btn(kind) {
    var base = { font: 'inherit', fontSize: 13, borderRadius: 5, padding: '6px 14px', cursor: busy ? 'default' : 'pointer', fontWeight: 600, opacity: busy ? 0.6 : 1 };
    if (kind === 'sec') return Object.assign({}, base, { background: C.surface, color: C.blue, border: '1px solid ' + C.blue });
    if (kind === 'quiet') return Object.assign({}, base, { background: C.surface2, color: C.ink, border: '1px solid ' + G.line, fontWeight: 500 });
    return Object.assign({}, base, { background: C.blue, color: '#fff', border: 'none' });
  }
  return (
    <div style={{ background: C.surface2, border: '1px solid ' + G.line, borderRadius: 6, padding: '11px 13px', marginBottom: 11 }}>
      <h3 style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: C.muted, marginBottom: 7, marginTop: 0 }}>
        Commercial-rate classification
      </h3>
      <div style={{ fontSize: 13 }}>
        The requester declared <b>{cm.declared}</b>. {cm.clockEffect ? cm.clockEffect + ' ' : ''}
      </div>
      {cm.recorded ? (
        <div style={{ marginTop: 7, fontSize: 13 }}>
          Classified as <b>{cm.classified}</b>{' '}
          <DecidedByBadge by="person">{cm.decidedBy ? 'Recorded by ' + cm.decidedBy : 'A person decided'}</DecidedByBadge>
          {cm.overridesDeclaration ? (
            <div style={Object.assign({}, kv, { marginTop: 4, color: G.amberInk })}>
              This OVERRIDES what the requester declared. It changes the invoice — communicate it; the estimate
              notice is where that lands.
            </div>
          ) : null}
          {readOnly ? null : (
            <div style={{ marginTop: 6 }}>
              <button type="button" disabled={busy} style={btn('quiet')}
                onClick={function () { props.onClassify(cm.classified === 'commercial' ? 'standard' : 'commercial'); }}>
                Change to {cm.classified === 'commercial' ? 'standard' : 'commercial'}
              </button>
            </div>
          )}
        </div>
      ) : readOnly ? (
        <div style={Object.assign({}, kv, { marginTop: 6 })}>
          Not yet classified. <DecidedByBadge by="person">A person decides</DecidedByBadge>
        </div>
      ) : (
        <div style={{ marginTop: 7 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" disabled={busy} style={btn()} onClick={function () { props.onClassify('commercial'); }}>Classify as commercial</button>
            <button type="button" disabled={busy} style={btn('sec')} onClick={function () { props.onClassify('standard'); }}>Classify as standard</button>
          </div>
          <div style={Object.assign({}, kv, { marginTop: 6 })}>
            Recorded against your name. The rate rides on the requester's declared purpose until a
            classification is recorded here — recording one that differs is an override, and an override is
            always communicated.
          </div>
        </div>
      )}
    </div>
  );
}
