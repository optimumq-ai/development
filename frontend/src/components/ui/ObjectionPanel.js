import React, { useEffect, useState } from 'react';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

var NAVY = 'var(--oq-x-1f4e79)';
function money(n) { return '$' + (Number(n) || 0).toFixed(2); }
var SOURCE_LABEL = { letter: 'Letter', email: 'Email', phone: 'Phone call', in_person: 'In person' };
var STATUS_STYLE = {
  open: { label: 'Open', bg: 'var(--oq-bg-fef3c7)', fg: 'var(--oq-fg-92400e)' },
  tentative: { label: 'Pending approval', bg: 'var(--oq-bg-fde8e8)', fg: 'var(--oq-fg-9b1c1c)' },
  resolved: { label: 'Resolved', bg: 'var(--oq-bg-def7ec)', fg: 'var(--oq-fg-03543f)' }
};
var RES_LABEL = { uphold: 'Fee upheld', new_due_date: 'New due date agreed', requestor_withdrew: 'Requestor withdrew', reduction: 'Fee reduced', waiver: 'Fee waived', write_off: 'Written off' };
var FINANCIAL = ['reduction', 'waiver', 'write_off'];
var inp = { width: '100%', padding: '7px 9px', border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' };
var lbl = { fontSize: '11px', color: 'var(--oq-fg-6b7280)', marginBottom: '3px', display: 'block', fontWeight: 600 };
var card = { background: 'var(--oq-bg-ffffff)', border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '10px', padding: '13px 15px', marginBottom: '10px' };
function btn(primary) { return { padding: '7px 13px', borderRadius: '8px', border: primary ? 'none' : '1px solid var(--oq-ln-e5e7eb)', background: primary ? NAVY : 'var(--oq-bg-ffffff)', color: primary ? 'var(--oq-fg-ffffff)' : 'var(--oq-fg-374151)', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }; }

export default function ObjectionPanel(props) {
  var requestId = props.requestId;
  var store = useAuthStore();
  var canApprove = store.hasAuthority('financial_approval');   // S4

  var [objs, setObjs] = useState([]);
  var [staff, setStaff] = useState([]);
  var [err, setErr] = useState('');
  var [showForm, setShowForm] = useState(false);
  var [sourceType, setSourceType] = useState('phone');
  var [recap, setRecap] = useState('');
  var [file, setFile] = useState(null);
  var [reason, setReason] = useState('');
  var [assigneeId, setAssigneeId] = useState('');
  var [escalate, setEscalate] = useState(false);
  var [busy, setBusy] = useState(false);
  var [msg, setMsg] = useState('');
  var [ra, setRa] = useState({});
  var [ro, setRo] = useState({});
  var [rd, setRd] = useState({});
  var [ramt, setRamt] = useState({});
  var [actBusy, setActBusy] = useState(null);

  function load() { api.get('/objections/request/' + requestId).then(function (r) { setObjs(r.data.objections || []); setErr(''); }).catch(function () { setErr('Could not load objections.'); }); }
  useEffect(function () { load(); api.get('/staff').then(function (r) { setStaff(r.data.staff || r.data || []); }).catch(function () {}); }, [requestId]);

  async function raise() {
    setBusy(true); setMsg('');
    try {
      var evidenceFileId = null;
      if (file) {
        var fd = new FormData(); fd.append('file', file);
        var up = await api.post('/files/upload/' + requestId, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        evidenceFileId = up.data && up.data.fileId;
      }
      var body = { sourceType: sourceType, recapText: recap, reason: reason, evidenceFileId: evidenceFileId };
      if (escalate) body.escalate = true; else if (assigneeId) body.assigneeId = assigneeId;
      await api.post('/objections/request/' + requestId, body);
      setShowForm(false); setRecap(''); setReason(''); setFile(null); setAssigneeId(''); setEscalate(false); setSourceType('phone');
      load();
    } catch (e) { setMsg((e.response && e.response.data && e.response.data.error) || 'Could not raise the objection.'); }
    setBusy(false);
  }
  async function act(id, path, body) {
    setActBusy(id + path);
    try { await api.post('/objections/' + id + '/' + path, body || {}); load(); }
    catch (e) { setErr((e.response && e.response.data && e.response.data.error) || 'Action failed.'); }
    setActBusy(null);
  }
  async function downloadEvidence(fileId) {
    try { var r = await api.get('/files/download/' + fileId, { responseType: 'blob' }); window.open(URL.createObjectURL(r.data), '_blank'); }
    catch (e) { setErr('Could not open the attachment.'); }
  }
  function badge(s) { var c = STATUS_STYLE[s] || { label: s, bg: 'var(--oq-bg-f3f4f6)', fg: 'var(--oq-fg-6b7280)' }; return <span style={{ background: c.bg, color: c.fg, fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px' }}>{c.label}</span>; }

  return (
    <div style={{ marginTop: '20px', borderTop: '2px solid var(--oq-ln-eef2f7)', paddingTop: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
        <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--oq-fg-111111)' }}>Fee estimate objections</div>
        {!showForm ? <button onClick={function () { setShowForm(true); }} style={btn(true)}>Raise an objection</button> : null}
      </div>
      <div style={{ fontSize: '12px', color: 'var(--oq-fg-6b7280)', marginBottom: '12px', maxWidth: '720px' }}>When a requestor disputes the estimate, record it here with how it arrived and what they said. It rides on the request without changing its stage; whoever it&apos;s assigned to works it and records the outcome.</div>

      {err ? <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-9b1c1c)', background: 'var(--oq-bg-fde8e8)', borderRadius: '8px', padding: '9px 12px', marginBottom: '12px' }}>{err}</div> : null}

      {showForm ? (
        <div style={Object.assign({}, card, { background: 'var(--oq-bg-f9fafb)' })}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--oq-fg-111111)', marginBottom: '10px' }}>New objection</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div><label style={lbl}>How was it received?</label><select value={sourceType} onChange={function (e) { setSourceType(e.target.value); }} style={inp}><option value="phone">Phone call</option><option value="email">Email</option><option value="letter">Letter</option><option value="in_person">In person</option></select></div>
            <div><label style={lbl}>Attach evidence (scan / photo / screenshot)</label><input type="file" onChange={function (e) { setFile(e.target.files && e.target.files[0]); }} style={{ fontSize: '12px' }} /></div>
          </div>
          <div style={{ marginBottom: '10px' }}><label style={lbl}>Or type a recap of what was said (required if no file)</label><textarea value={recap} onChange={function (e) { setRecap(e.target.value); }} rows={3} style={Object.assign({}, inp, { fontFamily: 'inherit', resize: 'vertical' })} placeholder="e.g. Caller said the $250 estimate is unreasonable for a 3-page report and asked us to reconsider." /></div>
          <div style={{ marginBottom: '10px' }}><label style={lbl}>Reason (short)</label><input type="text" value={reason} onChange={function (e) { setReason(e.target.value); }} style={inp} placeholder="e.g. Disputes copy-fee amount" /></div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '12px' }}>
            <div style={{ minWidth: '240px' }}><label style={lbl}>Assign to</label><select value={assigneeId} disabled={escalate} onChange={function (e) { setAssigneeId(e.target.value); }} style={Object.assign({}, inp, { opacity: escalate ? 0.5 : 1 })}><option value="">(assign to me)</option>{staff.map(function (u) { return <option key={u.id} value={u.id}>{u.display_name}</option>; })}</select></div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: 'var(--oq-fg-374151)', paddingBottom: '7px', cursor: 'pointer' }}><input type="checkbox" checked={escalate} onChange={function (e) { setEscalate(e.target.checked); }} /> Escalate to my supervisor</label>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={raise} disabled={busy} style={btn(true)}>{busy ? 'Saving...' : 'Raise objection'}</button>
            <button onClick={function () { setShowForm(false); setMsg(''); }} style={btn(false)}>Cancel</button>
            {msg ? <span style={{ fontSize: '12px', color: 'var(--oq-fg-9b1c1c)' }}>{msg}</span> : null}
          </div>
        </div>
      ) : null}

      {objs.length === 0 && !showForm ? <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-9ca3af)' }}>No objections on this request.</div> : null}

      {objs.map(function (o) {
        var isFin = FINANCIAL.indexOf(ro[o.id]) >= 0;
        return (
          <div key={o.id} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              {badge(o.status)}
              <span style={{ fontSize: '12px', color: 'var(--oq-fg-6b7280)' }}>{SOURCE_LABEL[o.sourceType] || o.sourceType} &middot; raised by {o.raisedByName} &middot; {(o.raisedAt || '').slice(0, 16)}</span>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--oq-fg-111111)', fontWeight: 600, marginBottom: '4px' }}>{o.reason}</div>
            {o.recapText ? <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-374151)', fontStyle: 'italic', marginBottom: '4px' }}>&ldquo;{o.recapText}&rdquo;</div> : null}
            {o.evidenceFileId ? <div style={{ fontSize: '12px', marginBottom: '4px' }}><button onClick={function () { downloadEvidence(o.evidenceFileId); }} style={{ background: 'none', border: 'none', color: NAVY, fontSize: '12px', fontWeight: 700, cursor: 'pointer', padding: 0 }}>View attached evidence</button></div> : null}
            <div style={{ fontSize: '12px', color: 'var(--oq-fg-6b7280)', marginBottom: o.status === 'resolved' ? 0 : '10px' }}>Assigned to <strong>{o.assigneeName || o.assigneeId}</strong>{o.clockFrozen ? ' \u00b7 clock frozen' : ''}</div>

            {o.status === 'resolved' ? (
              <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-03543f)', background: 'var(--oq-bg-def7ec)', borderRadius: '8px', padding: '8px 11px' }}>{RES_LABEL[o.resolutionType] || 'Resolved'}{o.resolutionAmount ? ' (' + money(o.resolutionAmount) + ')' : ''}{o.resolutionDetail ? ' \u2014 ' + o.resolutionDetail : ''}. By {o.resolvedBy} on {(o.resolvedAt || '').slice(0, 16)}{o.approvedBy ? '; approved by ' + o.approvedBy : ''}.</div>
            ) : null}

            {o.status === 'tentative' ? (
              <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-9b1c1c)', background: 'var(--oq-bg-fde8e8)', borderRadius: '8px', padding: '9px 11px' }}>
                <div style={{ marginBottom: canApprove ? '8px' : 0 }}>Proposed <strong>{RES_LABEL[o.resolutionType]}</strong> of {money(o.resolutionAmount)}{o.resolutionDetail ? ' \u2014 ' + o.resolutionDetail : ''}. Pending Fee Authorizer approval.</div>
                {canApprove ? <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={function () { act(o.id, 'approve', { decision: 'approve' }); }} disabled={actBusy === o.id + 'approve'} style={btn(true)}>Approve &amp; apply</button>
                  <button onClick={function () { act(o.id, 'approve', { decision: 'reject' }); }} disabled={actBusy === o.id + 'approve'} style={btn(false)}>Reject</button>
                </div> : null}
              </div>
            ) : null}

            {o.status === 'open' ? (
              <div style={{ borderTop: '1px solid var(--oq-ln-f3f4f6)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: '200px' }}><label style={lbl}>Reassign to</label><select value={ra[o.id] || ''} onChange={function (e) { setRa(Object.assign({}, ra, { [o.id]: e.target.value })); }} style={inp}><option value="">Choose a person...</option>{staff.map(function (u) { return <option key={u.id} value={u.id}>{u.display_name}</option>; })}</select></div>
                  <button onClick={function () { if (ra[o.id]) act(o.id, 'assign', { assigneeId: ra[o.id] }); }} disabled={!ra[o.id]} style={btn(false)}>Assign</button>
                  <button onClick={function () { act(o.id, 'assign', { escalate: true }); }} style={btn(false)}>Escalate to supervisor</button>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: '190px' }}><label style={lbl}>Resolve as</label><select value={ro[o.id] || ''} onChange={function (e) { setRo(Object.assign({}, ro, { [o.id]: e.target.value })); }} style={inp}><option value="">Choose an outcome...</option><option value="uphold">Uphold the fee</option><option value="new_due_date">Agree a new due date</option><option value="requestor_withdrew">Requestor withdrew</option><option value="reduction">Reduce the fee</option><option value="waiver">Waive the fee</option><option value="write_off">Write off</option></select></div>
                  {isFin ? <div style={{ width: '110px' }}><label style={lbl}>Amount $</label><input type="number" step="any" value={ramt[o.id] || ''} onChange={function (e) { setRamt(Object.assign({}, ramt, { [o.id]: e.target.value })); }} style={inp} /></div> : null}
                  <div style={{ flex: 1, minWidth: '180px' }}><label style={lbl}>Detail{isFin ? ' / supporting note' : ''}</label><input type="text" value={rd[o.id] || ''} onChange={function (e) { setRd(Object.assign({}, rd, { [o.id]: e.target.value })); }} style={inp} /></div>
                  <button onClick={function () { if (!ro[o.id]) return; act(o.id, 'resolve', { resolutionType: ro[o.id], detail: rd[o.id] || '', amount: Number(ramt[o.id]) || 0 }); }} disabled={!ro[o.id]} style={btn(true)}>{isFin ? 'Propose (needs approval)' : 'Record resolution'}</button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
