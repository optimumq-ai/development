import React, { useEffect, useState } from 'react';
import api from '../../lib/api';

var NAVY = '#1F4E79';
var inp = { width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #E5E7EB', fontSize: '13px', boxSizing: 'border-box' };
var lbl = { fontSize: '10.5px', fontWeight: 600, color: '#9CA3AF', display: 'block', marginBottom: '3px' };
function money(n) { return '$' + (Number(n) || 0).toFixed(2); }
function num(x) { x = Number(x); return isFinite(x) ? x : 0; }

export default function FeeEstimatePanel(props) {
  var requestId = props.requestId;
  var [ctx, setCtx] = useState(null);
  var [qty, setQty] = useState({});
  var [delivery, setDelivery] = useState('email');
  var [result, setResult] = useState(null);
  var [calc, setCalc] = useState(false);
  var [err, setErr] = useState('');
  var [other, setOther] = useState({ amount: 0, description: '' });
  var [prefilled, setPrefilled] = useState({});
  var [resp, setResp] = useState({ busy: false, msg: '' });
  var [declineReason, setDeclineReason] = useState('');
  var [noticeTo, setNoticeTo] = useState('');
  var [noticeSubject, setNoticeSubject] = useState('');
  var [noticeText, setNoticeText] = useState('');
  var [noticeNotifiedAt, setNoticeNotifiedAt] = useState(null);
  var [noticeNotifyTriggered, setNoticeNotifyTriggered] = useState(false);
  var [sending, setSending] = useState(false);
  var [sendMsg, setSendMsg] = useState('');

  useEffect(function () { load(); }, [requestId]);
  async function load() {
    try {
      var r = await api.get('/fee-estimates/request/' + requestId);
      setCtx(r.data);
      var init = {};
      var li = r.data.latest && r.data.latest.input && r.data.latest.input.components;
      var pf = {};
      (r.data.components || []).forEach(function (c) {
        var prev = li && li.filter(function (x) { return x.id === c.id; })[0];
        var ae = c.autoEstimate;
        var fromProfile = (!prev && ae && ae.decision === 'automated' && ae.quantities) ? ae.quantities : null;
        if (fromProfile) pf[c.id] = true;
        var pq = (prev && prev.quantities) || fromProfile || {};
        var m = (pq.media && pq.media[0]) || {};
        var hasSource = !!(prev || fromProfile);
        init[c.id] = { searchHours: pq.searchHours || 0, reviewHours: pq.reviewHours || 0, bwPages: (hasSource ? (pq.bwPages || 0) : ((c.suggested && c.suggested.hasKnown) ? c.suggested.knownPages : 0)), colorPages: pq.colorPages || 0, oversizedPages: pq.oversizedPages || 0, mediaType: m.type || 'cd', mediaCount: m.count || 0 };
      });
      setQty(init);
      setPrefilled(pf);
      if (r.data.latest && r.data.latest.feeContext) setResult(r.data.latest.feeContext);
      if (r.data.latest && r.data.latest.input && r.data.latest.input.delivery) setDelivery(r.data.latest.input.delivery.method || 'email');
      if (r.data.latest && r.data.latest.input && r.data.latest.input.other) setOther({ amount: r.data.latest.input.other.amount || 0, description: r.data.latest.input.other.description || '' });
    } catch (e) { setErr('Could not load fee estimate.'); }
  }
  function setQ(cid, field, val) { setQty(function (p) { var n = Object.assign({}, p); n[cid] = Object.assign({}, n[cid]); n[cid][field] = val; return n; }); }

  async function calculate() {
    setCalc(true); setErr('');
    try {
      var comps = (ctx.components || []).map(function (c) {
        var q = qty[c.id] || {};
        var quant = { searchHours: num(q.searchHours), reviewHours: num(q.reviewHours), bwPages: num(q.bwPages), colorPages: num(q.colorPages), oversizedPages: num(q.oversizedPages) };
        if (num(q.mediaCount) > 0) quant.media = [{ type: q.mediaType, count: num(q.mediaCount) }];
        return { id: c.id, label: c.label, recordType: c.recordType, quantities: quant };
      });
      var otherPayload = (num(other.amount) !== 0 || (other.description || '').trim()) ? { amount: num(other.amount), description: other.description || 'Other' } : null;
      var r = await api.post('/fee-estimates/request/' + requestId, { components: comps, delivery: { method: delivery }, other: otherPayload });
      setResult(r.data.estimate.feeContext);
    } catch (e) { setErr((e.response && e.response.data && e.response.data.error) || 'Calculation failed.'); }
    setCalc(false);
  }

  async function loadNotice() {
    try {
      var r = await api.get('/fee-estimates/request/' + requestId + '/notice');
      setNoticeTo(r.data.to || ''); setNoticeSubject(r.data.subject || ''); setNoticeText(r.data.text || '');
      setNoticeNotifiedAt(r.data.notifiedAt || null); setNoticeNotifyTriggered(!!r.data.notifyTriggered);
    } catch (e) { /* no saved estimate yet */ }
  }
  useEffect(function () { if (result) loadNotice(); }, [result]);

  async function sendNotice() {
    setSending(true); setSendMsg('');
    try {
      var r = await api.post('/fee-estimates/request/' + requestId + '/notice/send', { to: noticeTo, subject: noticeSubject, text: noticeText });
      if (r.data.sent) { setNoticeNotifiedAt(r.data.at); setSendMsg('Sent to ' + r.data.to + '.'); }
      else { setSendMsg('Not sent: ' + (r.data.note || 'provider error') + '.'); }
    } catch (e) { setSendMsg('Send failed. ' + ((e.response && e.response.data && e.response.data.error) || '')); }
    setSending(false);
  }

  if (!ctx) return <div style={{ color: '#9CA3AF', fontSize: '13px' }}>{err || 'Loading...'}</div>;
  if (!ctx.configProfile) return <div style={{ fontSize: '13px', color: '#92400E', background: '#FEF3C7', padding: '14px', borderRadius: '8px' }}>No fee configuration exists for the active jurisdiction yet. Set one up under <strong>Fee Configuration</strong> in the sidebar, then return here.</div>;

  async function respond(path, body) {
    setResp({ busy: true, msg: '' });
    try { await api.post('/fee-estimates/request/' + requestId + '/' + path, body || {}); await load(); setResp({ busy: false, msg: '' }); }
    catch (e) { setResp({ busy: false, msg: (e.response && e.response.data && e.response.data.error) || 'Action failed.' }); }
  }
  function rBtn(label, onClick, primary) {
    return <button onClick={onClick} disabled={resp.busy} style={{ padding: '7px 14px', borderRadius: '8px', border: primary ? 'none' : '1px solid #E5E7EB', background: primary ? NAVY : 'white', color: primary ? 'white' : '#374151', fontSize: '13px', fontWeight: 700, cursor: resp.busy ? 'default' : 'pointer', opacity: resp.busy ? 0.6 : 1 }}>{label}</button>;
  }
  function renderResponse() {
    var L = ctx.latest;
    if (!L || !L.notified_at) return null;
    var box = function (bg, bd, col, children) { return <div style={{ background: bg, border: '1px solid ' + bd, borderRadius: '10px', padding: '13px 15px', marginBottom: '16px', fontSize: '13px', color: col }}>{children}</div>; };
    if (L.declined_at) return box('#FDE8E8', '#FBD5D5', '#9B1C1C', <span>Requestor <strong>declined</strong> the estimate on {L.declined_at}{L.declined_reason ? ' \u2014 ' + L.declined_reason : ''}.</span>);
    if (L.accepted_at) {
      var depDue = Number(L.deposit_due) || 0;
      if (depDue > 0 && !L.deposit_paid_at) {
        return box('#FEF3C7', '#FDE68A', '#92400E', <div><div style={{ marginBottom: '9px' }}>Accepted on {L.accepted_at}. A deposit of <strong>{money(depDue)}</strong> is required before record search begins.</div><div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>{rBtn('Record deposit received', function () { respond('deposit/record', {}); }, true)}{resp.msg ? <span style={{ color: '#9B1C1C', fontSize: '12px' }}>{resp.msg}</span> : null}</div></div>);
      }
      return box('#DEF7EC', '#BCF0DA', '#03543F', <span>Estimate <strong>accepted</strong> on {L.accepted_at}{L.deposit_paid_at ? ' \u00b7 deposit ' + money(L.deposit_paid_amount || depDue) + ' recorded' : ''} \u2014 record search underway.</span>);
    }
    return box('#EFF6FF', '#DBEAFE', '#1F4E79', <div>
      <div style={{ marginBottom: '9px' }}><strong>Estimate sent</strong> on {L.notified_at} \u00b7 total {money(L.total)}{Number(L.deposit_due) > 0 ? ' \u00b7 deposit ' + money(L.deposit_due) : ''}. Record the requestor's response:</div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        {rBtn('Mark accepted', function () { respond('estimate/accept', {}); }, true)}
        {rBtn('Mark declined', function () { respond('estimate/decline', { reason: declineReason }); }, false)}
        <input type="text" value={declineReason} onChange={function (e) { setDeclineReason(e.target.value); }} placeholder="decline reason (optional)" style={{ flex: 1, minWidth: '160px', padding: '7px 10px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '12.5px' }} />
        {resp.msg ? <span style={{ color: '#9B1C1C', fontSize: '12px' }}>{resp.msg}</span> : null}
      </div>
    </div>);
  }

  var R = result && result.requestLevel;
  return (
    <div>
      {renderResponse()}
      <div style={{ fontSize: '12.5px', color: '#6B7280', marginBottom: '14px' }}>Priced against <strong>{ctx.configProfile.name}</strong>{ctx.configProfile.status !== 'active' ? ' (' + ctx.configProfile.status + ')' : ''}. Enter the quantities for each component; the engine itemizes the estimate and saves it to the request.</div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '320px' }}>
          {(ctx.components || []).map(function (c) {
            var q = qty[c.id] || {};
            return (
              <div key={c.id} style={{ border: '1px solid #E5E7EB', borderRadius: '10px', padding: '14px', marginBottom: '12px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#111', marginBottom: '10px' }}>{c.label}{c.recordTypeName ? <span style={{ fontWeight: 400, color: '#9CA3AF' }}> &middot; {c.recordTypeName}</span> : null}</div>
                {prefilled[c.id] ? <div style={{ fontSize: '11px', color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '6px', padding: '5px 9px', marginBottom: '10px' }}>Pre-filled from the estimate profile &mdash; review &amp; adjust before sending.</div> : null}
                {c.suggested && c.suggested.hasKnown ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', background: '#EFF6FF', border: '1px solid #DBEAFE', borderRadius: '8px', padding: '7px 10px', marginBottom: '10px', fontSize: '11.5px', color: '#1F4E79' }}>
                    <span>Known page count: <strong>{c.suggested.knownPages}</strong> &middot; {c.suggested.basis}</span>
                    <button onClick={function () { setQ(c.id, 'bwPages', c.suggested.knownPages); }} style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #1F4E79', background: 'white', color: '#1F4E79', fontSize: '11px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>Use</button>
                  </div>
                ) : null}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                  {[['searchHours', 'Search hrs'], ['reviewHours', 'Review/redaction hrs'], ['bwPages', 'B&W pages'], ['colorPages', 'Color pages'], ['oversizedPages', 'Oversized pages']].map(function (f) {
                    return <div key={f[0]}><label style={lbl}>{f[1]}</label><input type="number" step="any" value={q[f[0]]} onChange={function (e) { setQ(c.id, f[0], e.target.value === '' ? 0 : parseFloat(e.target.value)); }} style={inp} /></div>;
                  })}
                  <div><label style={lbl}>Media</label>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <select value={q.mediaType} onChange={function (e) { setQ(c.id, 'mediaType', e.target.value); }} style={Object.assign({}, inp, { width: 'auto' })}><option value="cd">CD</option><option value="dvd">DVD</option><option value="usb">USB</option></select>
                      <input type="number" step="1" value={q.mediaCount} onChange={function (e) { setQ(c.id, 'mediaCount', e.target.value === '' ? 0 : parseInt(e.target.value, 10)); }} style={inp} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{ border: '1px solid #E5E7EB', borderRadius: '10px', padding: '14px', marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#111', marginBottom: '4px' }}>Other charge <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(optional &middot; a one-off cost not covered above)</span></div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}><label style={lbl}>Description</label><input type="text" value={other.description} onChange={function (e) { setOther(function (o) { return Object.assign({}, o, { description: e.target.value }); }); }} placeholder="e.g. third-party retrieval fee, special postage" style={inp} /></div>
              <div style={{ width: '120px' }}><label style={lbl}>Amount $</label><input type="number" step="any" value={other.amount} onChange={function (e) { setOther(function (o) { return Object.assign({}, o, { amount: e.target.value === '' ? 0 : parseFloat(e.target.value) }); }); }} style={inp} /></div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
            <div><label style={lbl}>Delivery</label><select value={delivery} onChange={function (e) { setDelivery(e.target.value); }} style={Object.assign({}, inp, { width: 'auto' })}><option value="email">Email</option><option value="pickup">Pickup</option><option value="mail">Mail</option></select></div>
            <button onClick={calculate} disabled={calc} style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: calc ? '#9CB4CC' : NAVY, color: 'white', fontSize: '13px', fontWeight: 700, cursor: calc ? 'default' : 'pointer' }}>{calc ? 'Calculating...' : 'Calculate estimate'}</button>
            {err ? <span style={{ fontSize: '12px', color: '#9B1C1C' }}>{err}</span> : null}
          </div>
        </div>

        <div style={{ width: '360px', flexShrink: 0 }}>
          <div style={{ border: '1px solid #E5E7EB', borderRadius: '10px', padding: '14px', background: '#F9FAFB' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#111', marginBottom: '10px' }}>Itemized estimate</div>
            {R ? (
              <div>
                {result.components.map(function (c, ci) {
                  return (
                    <div key={ci} style={{ marginBottom: '8px' }}>
                      <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#374151' }}>{c.label} <span style={{ color: '#9CA3AF', fontWeight: 400 }}>gross {money(c.componentGross)}</span></div>
                      {c.lineItems.map(function (li, k) { return <div key={k} style={{ fontSize: '11px', color: '#6B7280', display: 'flex', justifyContent: 'space-between' }}><span>{li.description} ({li.quantity} {li.unit} @ {li.rate})</span><span>{li.needsActual ? 'actual TBD' : money(li.amount)}</span></div>; })}
                    </div>
                  );
                })}
                <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: '8px', fontSize: '12px', color: '#374151' }}>
                  <Row k="Labor" v={money(R.laborSubtotal)} />
                  <Row k="Duplication" v={money(R.duplicationSubtotal)} />
                  <Row k="Media" v={money(R.mediaSubtotal)} />
                  {R.other ? <Row k={R.other.description} v={money(R.other.amount)} /> : null}
                  {R.deliverySubtotal ? <Row k="Delivery" v={money(R.deliverySubtotal)} /> : null}
                  {(R.freeAllowances.freePageAllowance || R.freeAllowances.freeLaborHours) ? <Row k="Free allowances" muted v={(R.freeAllowances.freePageAllowance || 0) + ' pg / ' + (R.freeAllowances.freeLaborHours || 0) + ' hr'} /> : null}
                  {R.ceilingApplied ? <Row k="Ceiling applied" amber v="" /> : null}
                  {R.floorApplied ? <Row k="Floor applied" muted v="" /> : null}
                  {R.deMinimisWaived ? <Row k="De minimis - waived" amber v="" /> : null}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 800, color: NAVY, marginTop: '6px', paddingTop: '6px', borderTop: '2px solid ' + NAVY }}><span>TOTAL</span><span>{money(R.total)}</span></div>
                  <Row k="Deposit due" v={money(R.depositDue)} />
                  <div style={{ fontSize: '11px', color: R.estimateNotifyTriggered ? '#92400E' : '#9CA3AF', marginTop: '4px' }}>{R.estimateNotifyTriggered ? 'Estimate notification to requestor required' : 'Below notification threshold'}</div>
                  <div style={{ fontSize: '10.5px', color: '#9CA3AF', marginTop: '8px' }}>Saved to this request. Recalculating creates a new snapshot.</div>
                </div>
              </div>
            ) : <div style={{ fontSize: '12px', color: '#9CA3AF' }}>Enter quantities and click Calculate.</div>}
          </div>
        </div>
      </div>
      {result ? (
        <div style={{ marginTop: '18px', borderTop: '1px solid #E5E7EB', paddingTop: '16px' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#111', marginBottom: '4px' }}>Notify requestor</div>
          <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '10px' }}>This is what the requestor sees - plain language, no internal worksheet detail. Review and edit if needed, then send.{noticeNotifyTriggered ? ' This estimate exceeds the notification threshold.' : ''}</div>
          {noticeNotifiedAt ? <div style={{ fontSize: '12px', color: '#03543F', background: '#DEF7EC', padding: '8px 10px', borderRadius: '6px', marginBottom: '10px' }}>Sent to {noticeTo} on {noticeNotifiedAt}. Sending again delivers an updated notice.</div> : null}
          <div style={{ maxWidth: '640px' }}>
            <div style={{ marginBottom: '8px' }}><label style={lbl}>To</label><input type="text" value={noticeTo} onChange={function (e) { setNoticeTo(e.target.value); }} style={inp} /></div>
            <div style={{ marginBottom: '8px' }}><label style={lbl}>Subject</label><input type="text" value={noticeSubject} onChange={function (e) { setNoticeSubject(e.target.value); }} style={inp} /></div>
            <div style={{ marginBottom: '8px' }}><label style={lbl}>Message</label><textarea value={noticeText} onChange={function (e) { setNoticeText(e.target.value); }} rows={14} style={Object.assign({}, inp, { fontFamily: 'inherit', resize: 'vertical', lineHeight: '1.5' })} /></div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button onClick={sendNotice} disabled={sending || !noticeTo} style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: (sending || !noticeTo) ? '#9CB4CC' : NAVY, color: 'white', fontSize: '13px', fontWeight: 700, cursor: (sending || !noticeTo) ? 'default' : 'pointer' }}>{sending ? 'Sending...' : (noticeNotifiedAt ? 'Resend to requestor' : 'Send to requestor')}</button>
              {sendMsg ? <span style={{ fontSize: '12.5px', color: sendMsg.indexOf('Sent') === 0 ? '#03543F' : '#9B1C1C' }}>{sendMsg}</span> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
function Row(props) { return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0', color: props.amber ? '#92400E' : (props.muted ? '#9CA3AF' : '#374151') }}><span>{props.k}</span><span>{props.v}</span></div>; }
