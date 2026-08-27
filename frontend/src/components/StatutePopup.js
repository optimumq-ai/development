import React, { useEffect, useState } from 'react';
import api from '../lib/api';

// The research-text drill-down shared by the setup screens (fee-law, request-rules): every rule behind
// a cited authority, with the statute language, read from /jurisdiction-profile/rules-research/:id.
// Render with info = { title, authority, ruleIds } (null = closed).

var C = { ink: '#12232E', mute: '#5C6F7C', faint: '#8296A4', ph: '#A9B7C2', line: '#D2DCE3', edge: '#BECAD3', wash: '#F2F6F9', pri: '#1E6091', navy: '#0E3A5C' };
var hint = { fontSize: '11.5px', color: C.faint, lineHeight: '1.4' };
function errText(e, fb) { return (e && e.response && e.response.data && e.response.data.error) || fb; }

export default function StatutePopup(props) {
  var [recs, setRecs] = useState(null);
  var info = props.info;
  useEffect(function () {
    if (!info) return undefined;
    var alive = true; setRecs(null);
    var ids = info.ruleIds || [];
    Promise.all(ids.map(function (id) { return api.get('/jurisdiction-profile/rules-research/' + id).then(function (r) { return { id: id, rule: r.data.rule }; }).catch(function (e) { return { id: id, error: errText(e, 'not available') }; }); }))
      .then(function (out) { if (alive) setRecs(out); });
    return function () { alive = false; };
  }, [info]);
  if (!info) return null;
  return (
    <div onClick={props.onClose} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(18,35,46,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div onClick={function (e) { e.stopPropagation(); }} style={{ background: 'white', borderRadius: '12px', padding: '20px 22px', width: '680px', maxWidth: '94%', maxHeight: '84vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ fontSize: '15px', fontWeight: '700', color: C.ink }}>{info.title}</div>
        <div style={{ fontSize: '12px', color: C.mute, marginTop: '3px' }}>{info.authority}</div>
        {!recs ? <div style={{ fontSize: '12.5px', color: C.ph, marginTop: '12px' }}>Reading the research record…</div> : null}
        {recs && !recs.some(function (x) { return x.rule; }) ? <div style={{ fontSize: '12.5px', color: C.mute, marginTop: '12px' }}>No research record is attached to this item beyond its citation.</div> : null}
        {recs && recs.some(function (x) { return !x.rule; }) ? <div style={Object.assign({}, hint, { marginTop: '10px' })}>Also cited: {recs.filter(function (x) { return !x.rule; }).map(function (x) { return x.id; }).join(', ')} — verified rows whose citation and figure are all the research record carries.</div> : null}
        {(recs || []).filter(function (x) { return x.rule; }).map(function (x) {
          var rec = x.rule;
          return <div key={x.id} style={{ borderTop: '1px solid ' + C.line, marginTop: '12px', paddingTop: '10px', fontSize: '12.5px', color: C.ink }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ fontSize: '10.5px', fontWeight: '700', color: C.navy, background: '#E8EEF4', border: '1px solid #C5D3DF', borderRadius: '3px', padding: '1px 6px' }}>{x.id}</span>{rec ? <span style={{ fontWeight: '700', color: C.navy }}>{rec.legal_concept}</span> : <span style={{ color: C.mute }}>{x.error || 'not available'}</span>}</div>
            {rec ? <div style={{ margin: '6px 0' }}><b>The rule:</b> {rec.atomic_rule}</div> : null}
            {rec && rec.source_language ? <div style={{ borderLeft: '4px solid ' + C.navy, background: C.wash, borderRadius: '4px', padding: '7px 10px', margin: '8px 0' }}>
              <div style={{ fontSize: '10.5px', fontWeight: '800', letterSpacing: '.05em', textTransform: 'uppercase', color: C.mute, marginBottom: '3px' }}>Statute language{rec.is_paraphrase ? ' (paraphrase)' : ' (verbatim)'}</div>
              <div style={{ fontStyle: 'italic' }}>{rec.source_language}</div></div> : null}
            {rec && rec.source_authority ? <div style={hint}>{rec.source_authority}{rec.official_link ? <span> · <a href={rec.official_link} target="_blank" rel="noreferrer" style={{ color: C.pri }}>official source</a></span> : null}</div> : null}
          </div>;
        })}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
          <button type="button" onClick={props.onClose} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '36px', padding: '0 14px', borderRadius: '7px', fontSize: '13px', fontWeight: '600', fontFamily: 'inherit', cursor: 'pointer', background: 'white', color: C.ink, border: '1px solid ' + C.edge }}>Close</button>
        </div>
      </div>
    </div>
  );
}
