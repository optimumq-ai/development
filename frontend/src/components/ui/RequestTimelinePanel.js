import React, { useEffect, useState } from 'react';
import api from '../../lib/api';

// B-breakdown: where a request's time went. A phase-typed, submit-anchored timeline (waiting vs working vs
// review vs hold) with the bottleneck called out. Colours are the dataviz-validated phase hues.
var PHASE = {
  queue: { c: '#EDA100', label: 'Waiting in queue' },
  process: { c: '#2A78D6', label: 'Working' },
  review: { c: '#4A3AA7', label: 'Awaiting / in review' },
  hold: { c: '#8A94A3', label: 'On hold (payment · tolled)', hatch: true },
  done: { c: '#17803D', label: 'Delivery' }
};
var HATCH = 'repeating-linear-gradient(135deg,transparent 0 5px,rgba(255,255,255,.3) 5px 7px)';
function hd(ms) {
  if (ms == null) return '';
  var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d >= 1) return d + 'd' + (h ? ' ' + h + 'h' : '');
  if (h >= 1) return h + 'h';
  if (m >= 1) return m + 'm';
  return '<1m';
}

export default function RequestTimelinePanel(props) {
  var requestId = props.requestId;
  var [tl, setTl] = useState(null);
  var [loading, setLoading] = useState(true);
  useEffect(function () {
    if (!requestId) return;
    var alive = true;
    api.get('/requests/' + requestId + '/timeline')
      .then(function (r) { if (alive) { setTl(r.data); setLoading(false); } })
      .catch(function () { if (alive) setLoading(false); });
    return function () { alive = false; };
  }, [requestId]);

  if (loading || !tl || !tl.segments || !tl.segments.length) return null;
  var total = tl.segments.reduce(function (a, s) { return a + s.durationMs; }, 0) || tl.totalMs || 1;
  // stage brackets = consecutive segments sharing a stage
  var groups = [];
  tl.segments.forEach(function (s) { var l = groups[groups.length - 1]; if (l && l.label === s.stageLabel) l.dur += s.durationMs; else groups.push({ label: s.stageLabel, dur: s.durationMs }); });
  // bottleneck = longest actionable segment (index)
  var bnIdx = -1, bnDur = -1;
  tl.segments.forEach(function (s, i) { if (s.phase !== 'hold' && s.phase !== 'done' && s.durationMs > bnDur) { bnDur = s.durationMs; bnIdx = i; } });
  var waitPct = tl.totalMs ? Math.round((tl.waitingMs / tl.totalMs) * 100) : 0;
  var bn = tl.bottleneck;

  var card = { background: 'white', border: '1px solid #E5E7EB', borderRadius: '14px', boxShadow: '0 1px 2px rgba(16,26,42,.04),0 1px 3px rgba(16,26,42,.06)', padding: '18px 20px', margin: '16px 0' };
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '15px', fontWeight: 800 }}>Where the time went</span>
        <span style={{ fontSize: '12.5px', color: '#66717F' }}><b style={{ color: '#1A2230' }}>{hd(tl.totalMs)}</b> since submitted · now in <b style={{ color: '#1A2230' }}>{tl.stage}</b>{waitPct ? <span> · <b style={{ color: '#1A2230' }}>{waitPct}%</b> waiting</span> : null}</span>
      </div>

      {/* stage brackets */}
      <div style={{ display: 'flex', height: '22px', gap: '2px', marginTop: '14px', marginBottom: '4px' }}>
        {groups.map(function (g, i) {
          return <div key={i} style={{ flex: g.dur, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '.03em', color: '#66717F', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 2px' }}>{g.label}</div>
            <div style={{ height: '4px', borderTop: '1.5px solid #D3DAE4', borderLeft: '1.5px solid #D3DAE4', borderRight: '1.5px solid #D3DAE4', borderRadius: '4px 4px 0 0', marginTop: '2px' }} />
          </div>;
        })}
      </div>

      {/* the bar */}
      <div style={{ display: 'flex', height: '40px', gap: '2px', borderRadius: '6px', overflow: 'hidden', background: '#FAFBFC' }}>
        {tl.segments.map(function (s, i) {
          var p = PHASE[s.phase] || { c: '#9CA3AF' };
          var st = { flex: Math.max(s.durationMs, 1), minWidth: '3px', background: p.c };
          if (p.hatch) st.backgroundImage = HATCH;
          if (i === bnIdx) { st.outline = '2.5px solid #C22B2B'; st.outlineOffset = '1px'; st.borderRadius = '3px'; st.zIndex = 2; st.position = 'relative'; }
          if (i === 0) st.borderRadius = st.borderRadius || '6px 0 0 6px';
          if (i === tl.segments.length - 1) st.borderRadius = '0 6px 6px 0';
          return <div key={i} style={st} title={s.stageLabel + ' · ' + (PHASE[s.phase] ? PHASE[s.phase].label.toLowerCase() : s.phase) + ' · ' + hd(s.durationMs)} />;
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px', fontSize: '10.5px', color: '#98A2B0' }}>
        <span>Submitted</span><span>Now</span>
      </div>

      {/* bottleneck callout */}
      {bn ? (
        <div style={{ display: 'flex', gap: '11px', alignItems: 'flex-start', marginTop: '16px', background: '#FBEBEB', border: '1px solid #C22B2B', borderLeft: '4px solid #C22B2B', borderRadius: '9px', padding: '11px 13px' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C22B2B" strokeWidth="2.3" style={{ flexShrink: 0, marginTop: '1px' }}><path d="M12 8v5M12 16h.01" /><circle cx="12" cy="12" r="9" /></svg>
          <div>
            <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#C22B2B' }}>Bottleneck: {hd(bn.durationMs)} — {(PHASE[bn.phase] ? PHASE[bn.phase].label.toLowerCase() : bn.phase)} in {bn.stageLabel}</div>
            <div style={{ fontSize: '12.5px', color: '#1A2230', marginTop: '2px' }}>The single longest actionable stretch.{(tl.byPhase && tl.byPhase.hold) ? ' On-hold time (' + hd(tl.byPhase.hold) + ', the requester’s payment — clock tolled) is excluded.' : ''}</div>
          </div>
        </div>
      ) : null}

      {/* legend */}
      <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', marginTop: '15px', fontSize: '11.5px', color: '#66717F' }}>
        {['process', 'queue', 'review', 'hold', 'done'].map(function (k) {
          var p = PHASE[k]; var sw = { width: '13px', height: '13px', borderRadius: '3px', background: p.c, flexShrink: 0 };
          if (p.hatch) sw.backgroundImage = HATCH;
          return <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={sw} />{p.label}</div>;
        })}
      </div>

      {/* breakdown table */}
      <div style={{ overflowX: 'auto', marginTop: '16px' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12.5px' }}>
          <thead><tr>{['Stage', 'Phase', 'Duration', 'Share'].map(function (h, i) { return <th key={h} style={{ textAlign: i > 1 ? 'right' : 'left', fontSize: '10px', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#98A2B0', padding: '0 10px 6px' }}>{h}</th>; })}</tr></thead>
          <tbody>
            {tl.segments.map(function (s, i) {
              var p = PHASE[s.phase] || { c: '#9CA3AF', label: s.phase };
              return <tr key={i}>
                <td style={{ padding: '7px 10px', borderTop: '1px solid #E5E7EB' }}>{s.stageLabel}</td>
                <td style={{ padding: '7px 10px', borderTop: '1px solid #E5E7EB' }}><span style={{ display: 'inline-block', width: '9px', height: '9px', borderRadius: '2px', background: p.c, marginRight: '7px', verticalAlign: 'middle', backgroundImage: p.hatch ? HATCH : 'none' }} />{p.label}{i === bnIdx ? <b style={{ color: '#C22B2B' }}> ◄ bottleneck</b> : null}</td>
                <td style={{ padding: '7px 10px', borderTop: '1px solid #E5E7EB', textAlign: 'right', fontFamily: 'monospace' }}>{hd(s.durationMs)}</td>
                <td style={{ padding: '7px 10px', borderTop: '1px solid #E5E7EB', textAlign: 'right', fontFamily: 'monospace' }}>{Math.round((s.durationMs / total) * 100)}%</td>
              </tr>;
            })}
            <tr><td style={{ padding: '8px 10px', borderTop: '2px solid #D3DAE4', fontWeight: 700 }}>Total since submit</td><td style={{ borderTop: '2px solid #D3DAE4' }} /><td style={{ padding: '8px 10px', borderTop: '2px solid #D3DAE4', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{hd(tl.totalMs)}</td><td style={{ padding: '8px 10px', borderTop: '2px solid #D3DAE4', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>100%</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
