import React, { useState, useEffect } from 'react';
import api from '../../lib/api';

function btn(color, bg){ return { padding:'8px 16px', border:'1px solid ' + color, borderRadius:'8px', background:bg, color:color, fontSize:'13px', fontWeight:'600', cursor:'pointer' }; }

export default function FeeWaiverDecisionPanel(props){
  var request = props.request;
  var [reasons, setReasons] = useState([]);
  var [mode, setMode] = useState(null);
  var [reasonId, setReasonId] = useState('');
  var [newReason, setNewReason] = useState('');
  var [busy, setBusy] = useState(false);
  var [msg, setMsg] = useState('');

  useEffect(function(){ api.get('/decision-reasons?category=fee_waiver_denial').then(function(r){ setReasons(r.data.reasons || []); }).catch(function(){}); }, []);

  if (!request.fee_waiver_requested) return null;
  var status = request.fee_waiver_status;

  if (status === 'granted' || status === 'denied'){
    var denied = status === 'denied';
    return (
      <div style={{ border:'1px solid ' + (denied ? '#FDE68A' : '#A7F3D0'), borderRadius:'10px', padding:'16px', marginBottom:'18px', background: denied ? '#FFFBEB' : '#F0FDF4' }}>
        <div style={{ fontSize:'14px', fontWeight:'700', color: denied ? '#92400E' : '#166534', marginBottom:'4px' }}>Fee waiver {denied ? 'denied' : 'granted'}</div>
        {denied ? <div style={{ fontSize:'13px', color:'#374151', lineHeight:'1.5' }}><b>Reason:</b> {request.fee_waiver_reason}</div> : null}
        <div style={{ fontSize:'12px', color:'#6B7280', marginTop:'6px', lineHeight:'1.5' }}>{denied ? 'A denial notice was sent to the requestor. The request remains open and continues through the normal fee process.' : 'Fees are waived for this request.'}{request.fee_waiver_decided_by ? ' \u2014 by ' + request.fee_waiver_decided_by : ''}</div>
      </div>
    );
  }

  async function decide(decision){
    setBusy(true); setMsg('');
    var body = { decision: decision };
    if (decision === 'deny'){
      if (newReason.trim()) body.reasonText = newReason.trim();
      else if (reasonId) body.reasonId = reasonId;
      else { setBusy(false); setMsg('Choose a reason or type a new one.'); return; }
    }
    try {
      var r = await api.post('/requests/' + request.id + '/fee-waiver-decision', body);
      if (decision === 'deny' && r.data && r.data.emailed === false) setMsg('Decision saved, but the denial email could not be sent (email is not fully configured yet).');
      if (props.onChange) props.onChange();
    } catch (e) { setMsg('Could not save the decision.'); setBusy(false); }
  }

  return (
    <div style={{ border:'1px solid #FDE68A', borderRadius:'10px', padding:'16px', marginBottom:'18px', background:'#FFFBEB' }}>
      <div style={{ fontSize:'14px', fontWeight:'700', color:'#92400E', marginBottom:'2px' }}>Fee waiver requested &mdash; decision needed</div>
      <div style={{ fontSize:'12px', color:'#6B7280', marginBottom:'12px', lineHeight:'1.5' }}>Granting waives the fees. Denying sends the requestor a denial notice; the request then continues through the normal fee process (it is not closed).</div>
      {mode !== 'deny' ? (
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={function(){ decide('grant'); }} disabled={busy} style={btn('#03543F', '#DEF7EC')}>{busy ? 'Saving...' : 'Grant waiver'}</button>
          <button onClick={function(){ setMode('deny'); }} disabled={busy} style={btn('#9B1C1C', '#FDE8E8')}>Deny waiver</button>
        </div>
      ) : (
        <div>
          <div style={{ fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'6px' }}>Reason for denial</div>
          <select value={reasonId} onChange={function(e){ setReasonId(e.target.value); setNewReason(''); }} disabled={!!newReason.trim()} style={{ width:'100%', padding:'8px 10px', border:'1px solid #E5E7EB', borderRadius:'8px', fontSize:'13px', marginBottom:'8px', boxSizing:'border-box', background: newReason.trim() ? '#F3F4F6' : 'white' }}>
            <option value="">&mdash; Select a saved reason &mdash;</option>
            {reasons.map(function(r){ return <option key={r.id} value={r.id}>{r.text}</option>; })}
          </select>
          <div style={{ fontSize:'12px', color:'#6B7280', margin:'2px 0 4px' }}>or add a new reason (it is saved to the list for next time):</div>
          <textarea value={newReason} onChange={function(e){ setNewReason(e.target.value); if (e.target.value.trim()) setReasonId(''); }} rows={2} placeholder="Type a new denial reason..." style={{ width:'100%', padding:'8px 10px', border:'1px solid #E5E7EB', borderRadius:'8px', fontSize:'13px', boxSizing:'border-box', resize:'vertical', fontFamily:'inherit' }} />
          <div style={{ display:'flex', gap:'8px', marginTop:'10px' }}>
            <button onClick={function(){ decide('deny'); }} disabled={busy} style={btn('#9B1C1C', '#FDE8E8')}>{busy ? 'Saving...' : 'Confirm denial & notify'}</button>
            <button onClick={function(){ setMode(null); setMsg(''); }} disabled={busy} style={{ padding:'8px 14px', border:'1px solid #E5E7EB', borderRadius:'8px', background:'white', color:'#6B7280', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
      {msg ? <div style={{ fontSize:'12px', color:'#92400E', marginTop:'10px' }}>{msg}</div> : null}
    </div>
  );
}
