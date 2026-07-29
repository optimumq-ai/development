import React, { useEffect, useState } from 'react';
import api from '../../lib/api';

var NAVY = '#1F4E79';
var inp = { width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #E5E7EB', fontSize: '13px', boxSizing: 'border-box' };
var lbl = { fontSize: '10.5px', fontWeight: 600, color: '#9CA3AF', display: 'block', marginBottom: '3px' };
function money(n) { return '$' + (Number(n) || 0).toFixed(2); }
function num(x) { x = Number(x); return isFinite(x) ? x : 0; }
var GATE_LABELS = { invoice_on_completion: 'Invoice on completion', estimate_acceptance: 'Estimate acceptance (no money up front)', deposit_before_work: 'Deposit before work begins', pay_in_full_before_release: 'Pay in full before release' };
var DELIVERY_LABELS = { invoice_on_completion: 'Records released, then invoiced', estimate_acceptance: 'Released after estimate accepted and work done', deposit_before_work: 'Work gated on deposit; final release per policy', pay_in_full_before_release: 'Released only after fee paid in full' };

export default function FeeEstimatePanel(props) {
  var requestId = props.requestId;
  var [ctx, setCtx] = useState(null);
  var [qty, setQty] = useState({});
  var [delivery, setDelivery] = useState('email');
  var [purpose, setPurpose] = useState('standard');
  var [rateOverrides, setRateOverrides] = useState({});
  var [actualRateDrivers, setActualRateDrivers] = useState([]);
  var [result, setResult] = useState(null);
  var [calc, setCalc] = useState(false);
  var [err, setErr] = useState('');
  var [other, setOther] = useState({ amount: 0, description: '' });
  var [certification, setCertification] = useState({ requested: false, count: 0, rate: null, unit: 'per_record' });
  var [prefilled, setPrefilled] = useState({});
  var [resp, setResp] = useState({ busy: false, msg: '' });
  var [declineReason, setDeclineReason] = useState('');
  var [reconResult, setReconResult] = useState(null);
  var [reconBusy, setReconBusy] = useState(false);
  var [noticeTo, setNoticeTo] = useState('');
  var [noticeSubject, setNoticeSubject] = useState('');
  var [noticeText, setNoticeText] = useState('');
  var [noticeNotifiedAt, setNoticeNotifiedAt] = useState(null);
  var [noticeNotifyTriggered, setNoticeNotifyTriggered] = useState(false);
  var [waiverGate, setWaiverGate] = useState({ blocked: false });   // BW4: 409 WAIVER_UNDECIDED, pre-rendered
  var [sending, setSending] = useState(false);
  var [sendMsg, setSendMsg] = useState('');
  var [payMethod, setPayMethod] = useState('cash');
  var [payAmount, setPayAmount] = useState('');
  var [payTendered, setPayTendered] = useState('');
  var [payReference, setPayReference] = useState('');
  var [payBusy, setPayBusy] = useState(false);
  var [payMsg, setPayMsg] = useState('');
  var [erpCharges, setErpCharges] = useState([]);
  var [erpBusy, setErpBusy] = useState(false);
  var [erpMsg, setErpMsg] = useState('');
  var [adjNotice, setAdjNotice] = useState(null);
  var [adjBusy, setAdjBusy] = useState(false);
  var [adjMsg, setAdjMsg] = useState('');

  useEffect(function () { load(); }, [requestId]);
  async function load() {
    try {
      var r = await api.get('/fee-estimates/request/' + requestId);
      setCtx(r.data);
      if (r.data.paymentMode === 'erp') loadErpCharges();
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
        init[c.id] = { searchHours: pq.searchHours || 0, reviewHours: pq.reviewHours || 0, bwPages: (hasSource ? (pq.bwPages || 0) : ((c.suggested && c.suggested.hasKnown) ? c.suggested.knownPages : 0)), colorPages: pq.colorPages || 0, oversizedPages: pq.oversizedPages || 0, mediaType: m.type || 'cd', mediaCount: m.count || 0, avRecordings: (pq.av && pq.av.recordings) || 0, avMinutes: (pq.av && pq.av.minutes) || 0 };
      });
      setQty(init);
      setPrefilled(pf);
      if (r.data.latest && r.data.latest.feeContext) setResult(r.data.latest.feeContext);
      if (r.data.latest && r.data.latest.input && r.data.latest.input.delivery) setDelivery(r.data.latest.input.delivery.method || 'email');
      if (r.data.request && r.data.request.purpose) setPurpose(r.data.request.purpose);
      var ard = r.data.actualRateDrivers || []; setActualRateDrivers(ard); if (ard.length) { var ro = {}; ard.forEach(function (k) { ro[k] = (r.data.laborRates || {})[k] || 0; }); setRateOverrides(ro); }
      if (r.data.latest && r.data.latest.input && r.data.latest.input.other) setOther({ amount: r.data.latest.input.other.amount || 0, description: r.data.latest.input.other.description || '' });
      var certCtx = r.data.certification || {};
      var latestCert = r.data.latest && r.data.latest.input && r.data.latest.input.certification;
      setCertification({
        requested: latestCert ? (num(latestCert.count) > 0) : !!certCtx.requested,
        count: latestCert ? num(latestCert.count) : (certCtx.suggestedCount || 0),
        rate: certCtx.rate != null ? certCtx.rate : null,
        unit: certCtx.unit || 'per_record'
      });
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
        if (num(q.avRecordings) > 0 || num(q.avMinutes) > 0) quant.av = { recordings: num(q.avRecordings), minutes: num(q.avMinutes) };
        return { id: c.id, label: c.label, recordType: c.recordType, quantities: quant };
      });
      var otherPayload = (num(other.amount) !== 0 || (other.description || '').trim()) ? { amount: num(other.amount), description: other.description || 'Other' } : null;
      var certPayload = certification.requested ? { count: num(certification.count) || 1 } : { count: 0 };
      var r = await api.post('/fee-estimates/request/' + requestId, { components: comps, delivery: { method: delivery }, certification: certPayload, other: otherPayload, purpose: purpose, rateOverrides: rateOverrides });
      setResult(r.data.estimate.feeContext);
    } catch (e) { setErr((e.response && e.response.data && e.response.data.error) || 'Calculation failed.'); }
    setCalc(false);
  }

  async function loadNotice() {
    try {
      var r = await api.get('/fee-estimates/request/' + requestId + '/notice');
      setNoticeTo(r.data.to || ''); setNoticeSubject(r.data.subject || ''); setNoticeText(r.data.text || '');
      setNoticeNotifiedAt(r.data.notifiedAt || null); setNoticeNotifyTriggered(!!r.data.notifyTriggered);
      // BW4 — the send gate travels WITH the notice preview and is rendered in the server's words below.
      setWaiverGate(r.data.feeWaiverGate || { blocked: false });
    } catch (e) { /* no saved estimate yet */ }
  }
  useEffect(function () { if (result) loadNotice(); }, [result]);
  async function loadBalanceNotice() {
    try {
      var r = await api.get('/fee-estimates/request/' + requestId + '/balance-notice');
      setNoticeTo(r.data.to || ''); setNoticeSubject(r.data.subject || ''); setNoticeText(r.data.text || '');
      setSendMsg('Balance-due notice loaded into "Notify requestor" below \u2014 review and send.');
    } catch (e) { setSendMsg((e.response && e.response.data && e.response.data.error) || 'Could not load balance-due notice.'); }
  }

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
  async function takePayment(target, owed) {
    setPayBusy(true); setPayMsg('');
    try {
      var amt = payAmount === '' ? owed : Number(payAmount);
      var body = { target: target, method: payMethod, amount: amt, reference: payReference || null };
      if (payMethod === 'cash' && payTendered !== '') body.tendered = Number(payTendered);
      var r = await api.post('/fee-estimates/request/' + requestId + '/payment/record', body);
      var chg = r.data && r.data.changeGiven;
      setPayMsg('Recorded' + (chg > 0 ? ' \u00b7 change due ' + money(chg) : ''));
      setPayAmount(''); setPayTendered(''); setPayReference('');
      await load();
    } catch (e) { setPayMsg((e.response && e.response.data && e.response.data.error) || 'Could not record payment.'); }
    setPayBusy(false);
  }
  function loadErpCharges() { api.get('/settlement/request/' + requestId + '/charges').then(function (r) { setErpCharges(r.data.charges || []); }).catch(function () {}); }
  async function sendCharge(target, amount) {
    setErpBusy(true); setErpMsg('');
    try {
      var pp = ctx.paymentPlan || {};
      var gating = (pp.deliveryTrigger === 'pay_in_full_before_release') ? 'release_gated' : (target === 'deposit' ? 'work_gated' : 'net_terms');
      var dueDate = (pp.firstPayment && pp.firstPayment.dueWindow && target === 'deposit') ? 'window-end' : 'immediate';
      await api.post('/settlement/request/' + requestId + '/charge', { target: target, amount: amount, dueDate: dueDate, gatingSemantic: gating });
      setErpMsg('Sent to ERP.');
      load();
    } catch (e) { setErpMsg((e.response && e.response.data && e.response.data.error) || 'Could not send the charge.'); }
    setErpBusy(false);
  }
  function renderErpPanel() {
    var ps = ctx.paymentState, L = ctx.latest;
    var owed = 0, target = 'balance';
    if (ps && L) { var depOut = Math.max(0, (Number(L.deposit_due) || 0) - (ps.depositPaid || 0)); if (depOut > 0) { target = 'deposit'; owed = depOut; } else { owed = ps.balanceDue; } }
    var th = { textAlign: 'left', color: '#6B7280', padding: '4px 6px', fontWeight: 600 };
    return (
      <div style={{ marginTop: '14px', padding: '13px 15px', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '10px', maxWidth: '700px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#111', marginBottom: '4px' }}>External payment (ERP)</div>
        <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '10px' }}>Finance collects this payment in the ERP (online, mail, or walk-in). Hand off the charge; the balance updates automatically when the ERP reports the payment. Optimum Q sends no payment reminders in this mode.</div>
        {ps && !ps.paidInFull && owed > 0 && L && L.accepted_at ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: erpCharges.length ? '12px' : 0, flexWrap: 'wrap' }}>
            <button onClick={function () { sendCharge(target, owed); }} disabled={erpBusy} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: erpBusy ? '#9CB4CC' : NAVY, color: 'white', fontSize: '13px', fontWeight: 700, cursor: erpBusy ? 'default' : 'pointer' }}>{erpBusy ? 'Sending...' : 'Send ' + target + ' charge to ERP (' + money(owed) + ')'}</button>
            {erpMsg ? <span style={{ fontSize: '12px', color: erpMsg.indexOf('Sent') === 0 ? '#03543F' : '#9B1C1C' }}>{erpMsg}</span> : null}
          </div>
        ) : null}
        {erpCharges.length ? (
          <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Charge</th><th style={th}>Target</th><th style={Object.assign({}, th, { textAlign: 'right' })}>Amount</th><th style={Object.assign({}, th, { textAlign: 'right' })}>Paid</th><th style={th}>Status</th></tr></thead>
            <tbody>{erpCharges.map(function (c) { return <tr key={c.id}><td style={{ padding: '4px 6px', color: '#374151' }}>{c.erp_charge_id}</td><td style={{ padding: '4px 6px', color: '#374151' }}>{c.target}</td><td style={{ padding: '4px 6px', textAlign: 'right' }}>{money(c.amount)}</td><td style={{ padding: '4px 6px', textAlign: 'right' }}>{money(c.paid_amount)}</td><td style={{ padding: '4px 6px' }}><span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: c.status === 'paid' ? '#DEF7EC' : '#FEF3C7', color: c.status === 'paid' ? '#03543F' : '#92400E' }}>{c.status}</span></td></tr>; })}</tbody>
          </table>
        ) : null}
      </div>
    );
  }
  function renderTakePayment() {
    if (ctx.paymentMode === 'erp') return renderErpPanel();
    var ps = ctx.paymentState, L = ctx.latest;
    if (!ps || !L || !L.accepted_at || ps.paidInFull) return null;
    var depDue = Number(L.deposit_due) || 0;
    var depOut = Math.max(0, depDue - (ps.depositPaid || 0));
    var target = depOut > 0 ? 'deposit' : 'balance';
    var owed = depOut > 0 ? depOut : ps.balanceDue;
    if (!(owed > 0)) return null;
    var amt = payAmount === '' ? owed : Number(payAmount);
    var change = (payMethod === 'cash' && payTendered !== '') ? Math.max(0, Math.round((Number(payTendered) - amt) * 100) / 100) : null;
    return (
      <div style={{ marginTop: '14px', padding: '12px 14px', background: 'white', border: '1px solid #E5E7EB', borderRadius: '10px', maxWidth: '660px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#111', marginBottom: '8px' }}>Take a payment <span style={{ fontWeight: 400, color: '#6B7280' }}>({target} \u00b7 {money(owed)} owed)</span></div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><label style={lbl}>Method</label><select value={payMethod} onChange={function (e) { setPayMethod(e.target.value); }} style={Object.assign({}, inp, { width: 'auto' })}><option value="cash">Cash</option><option value="check">Check</option><option value="card">Card</option><option value="money_order">Money order</option><option value="other">Other</option></select></div>
          <div style={{ width: '110px' }}><label style={lbl}>Amount $</label><input type="number" step="any" value={payAmount} onChange={function (e) { setPayAmount(e.target.value); }} placeholder={owed.toFixed(2)} style={inp} /></div>
          <button onClick={function () { setPayAmount(String(owed)); }} style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid #1F4E79', background: 'white', color: '#1F4E79', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>Copy owed</button>
          {payMethod === 'cash' ? <div style={{ width: '120px' }}><label style={lbl}>Cash tendered $</label><input type="number" step="any" value={payTendered} onChange={function (e) { setPayTendered(e.target.value); }} style={inp} /></div> : null}
          {(payMethod === 'check' || payMethod === 'money_order' || payMethod === 'other') ? <div style={{ width: '150px' }}><label style={lbl}>Reference / #</label><input type="text" value={payReference} onChange={function (e) { setPayReference(e.target.value); }} style={inp} /></div> : null}
        </div>
        {change != null ? <div style={{ fontSize: '13px', fontWeight: 700, color: change > 0 ? '#92400E' : '#03543F', marginTop: '8px' }}>Change due: {money(change)}</div> : null}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
          <button onClick={function () { takePayment(target, owed); }} disabled={payBusy} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: payBusy ? '#9CB4CC' : NAVY, color: 'white', fontSize: '13px', fontWeight: 700, cursor: payBusy ? 'default' : 'pointer' }}>{payBusy ? 'Recording...' : 'Record payment'}</button>
          <button onClick={loadBalanceNotice} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Load balance-due notice</button>
          {payMsg ? <span style={{ fontSize: '12px', color: payMsg.indexOf('Recorded') === 0 ? '#03543F' : '#9B1C1C' }}>{payMsg}</span> : null}
        </div>
      </div>
    );
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

  async function loadAdjNotice() {
    setAdjBusy(true); setAdjMsg('');
    try { var r = await api.get('/fee-estimates/request/' + requestId + '/adjustment-notice'); setAdjNotice({ to: r.data.to || '', subject: r.data.subject || '', text: r.data.text || '' }); }
    catch (e) { setAdjMsg((e.response && e.response.data && e.response.data.error) || 'Could not load the adjustment notice.'); }
    setAdjBusy(false);
  }
  async function sendAdjNotice() {
    setAdjBusy(true); setAdjMsg('');
    try { var r = await api.post('/fee-estimates/request/' + requestId + '/adjustment-notice/send', adjNotice); if (r.data && r.data.sent) { setAdjMsg('Sent to ' + r.data.to); setAdjNotice(null); } else setAdjMsg('Could not send.'); }
    catch (e) { setAdjMsg((e.response && e.response.data && e.response.data.error) || 'Could not send.'); }
    setAdjBusy(false);
  }
  function renderAdjNotice() {
    var reconciled = (ctx.paymentState && ctx.paymentState.reconciled) || (reconResult && !reconResult.error);
    if (!reconciled) return null;
    return (
      <div style={{ marginTop: '14px', borderTop: '1px dashed #E5E7EB', paddingTop: '12px', maxWidth: '560px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#111', marginBottom: '6px' }}>Adjustment notice to requestor</div>
        {!adjNotice ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={loadAdjNotice} disabled={adjBusy} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>{adjBusy ? 'Loading...' : 'Load estimate-to-actual notice'}</button>
            {adjMsg ? <span style={{ fontSize: '12px', color: adjMsg.indexOf('Sent') === 0 ? '#03543F' : '#9B1C1C' }}>{adjMsg}</span> : null}
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '6px' }}><label style={lbl}>To</label><input type="text" value={adjNotice.to} onChange={function (e) { setAdjNotice(Object.assign({}, adjNotice, { to: e.target.value })); }} style={inp} /></div>
            <div style={{ marginBottom: '6px' }}><label style={lbl}>Subject</label><input type="text" value={adjNotice.subject} onChange={function (e) { setAdjNotice(Object.assign({}, adjNotice, { subject: e.target.value })); }} style={inp} /></div>
            <div style={{ marginBottom: '8px' }}><label style={lbl}>Message</label><textarea value={adjNotice.text} onChange={function (e) { setAdjNotice(Object.assign({}, adjNotice, { text: e.target.value })); }} rows={8} style={Object.assign({}, inp, { fontFamily: 'inherit', resize: 'vertical' })} /></div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button onClick={sendAdjNotice} disabled={adjBusy} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: adjBusy ? '#9CB4CC' : NAVY, color: 'white', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>{adjBusy ? 'Sending...' : 'Send to requestor'}</button>
              <button onClick={function () { setAdjNotice(null); setAdjMsg(''); }} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
              {adjMsg ? <span style={{ fontSize: '12px', color: adjMsg.indexOf('Sent') === 0 ? '#03543F' : '#9B1C1C' }}>{adjMsg}</span> : null}
            </div>
          </div>
        )}
      </div>
    );
  }
  async function reconcile() {
    setReconBusy(true);
    try {
      var comps = (ctx.components || []).map(function (c) {
        var q = qty[c.id] || {};
        var quant = { searchHours: num(q.searchHours), reviewHours: num(q.reviewHours), bwPages: num(q.bwPages), colorPages: num(q.colorPages), oversizedPages: num(q.oversizedPages) };
        if (num(q.mediaCount) > 0) quant.media = [{ type: q.mediaType, count: num(q.mediaCount) }];
        if (num(q.avRecordings) > 0 || num(q.avMinutes) > 0) quant.av = { recordings: num(q.avRecordings), minutes: num(q.avMinutes) };
        return { id: c.id, label: c.label, recordType: c.recordType, quantities: quant };
      });
      var certPayload = certification.requested ? { count: num(certification.count) || 1 } : { count: 0 };
      var r = await api.post('/fee-estimates/request/' + requestId + '/reconcile', { components: comps, delivery: { method: delivery }, certification: certPayload, purpose: purpose, rateOverrides: rateOverrides });
      setReconResult(r.data);
    } catch (e) { setReconResult({ error: (e.response && e.response.data && e.response.data.error) || 'Reconcile failed.' }); }
    setReconBusy(false);
  }
  // Slice E — drop the MEASURED labor hours (rolled up from finalized work tasks) into the reconcile inputs. Applied
  // request-level: all hours land on the first component (matching the server's aggregation), others zeroed. Staff
  // still review and press Reconcile — same accept/adjust ethos as the per-task timer.
  function useMeasuredHours() {
    var la = ctx.laborActuals; if (!la || !la.measured) return;
    var comps = ctx.components || []; if (!comps.length) return;
    var m = la.measured;
    setQty(function (p) {
      var n = Object.assign({}, p);
      comps.forEach(function (c, i) {
        n[c.id] = Object.assign({}, n[c.id]);
        n[c.id].searchHours = (i === 0) ? (m.searchHours || 0) : 0;
        n[c.id].reviewHours = (i === 0) ? (m.reviewHours || 0) : 0;
      });
      return n;
    });
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
                  <div><label style={lbl}>Recordings</label>
                    <input type="number" step="1" value={q.avRecordings} onChange={function (e) { setQ(c.id, 'avRecordings', e.target.value === '' ? 0 : parseInt(e.target.value, 10)); }} style={inp} />
                  </div>
                  <div><label style={lbl}>Rec. minutes</label>
                    <input type="number" step="1" value={q.avMinutes} onChange={function (e) { setQ(c.id, 'avMinutes', e.target.value === '' ? 0 : parseInt(e.target.value, 10)); }} style={inp} />
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
            <div><label style={lbl}>Purpose</label><select value={purpose} onChange={function (e) { setPurpose(e.target.value); }} style={Object.assign({}, inp, { width: 'auto' })}><option value="standard">Standard</option><option value="commercial">Commercial</option><option value="inspection">Inspection (on-site)</option></select></div>
            <div>
              <label style={lbl}>Certification{ctx.certification && ctx.certification.requested ? <span style={{ color: '#03543F' }}> &middot; requestor asked</span> : null}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '30px' }}>
                <input type="checkbox" checked={certification.requested} onChange={function (e) { var on = e.target.checked; setCertification(function (p) { return Object.assign({}, p, { requested: on, count: on ? (num(p.count) || (ctx.certification && ctx.certification.suggestedCount) || 1) : p.count }); }); }} />
                {certification.requested ? <input type="number" min="0" step="1" value={certification.count} onChange={function (e) { var v = e.target.value; setCertification(function (p) { return Object.assign({}, p, { count: v === '' ? 0 : parseInt(v, 10) }); }); }} style={Object.assign({}, inp, { width: '56px' })} /> : null}
                {certification.requested && certification.rate != null ? <span style={{ fontSize: '11px', color: '#9CA3AF' }}>@ {money(certification.rate)}</span> : null}
              </div>
            </div>
            {actualRateDrivers.map(function (k) { return <div key={k}><label style={lbl}>{k} $/hr (actual)</label><input type="number" step="any" value={rateOverrides[k] != null ? rateOverrides[k] : ''} onChange={function (e) { var v = e.target.value; setRateOverrides(function (pr) { var n = Object.assign({}, pr); n[k] = v === '' ? '' : parseFloat(v); return n; }); }} style={inp} /></div>; })}
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
                  {R.laborOverhead ? <Row k={"Labor overhead (" + R.laborOverheadPct + "%)"} v={money(R.laborOverhead)} /> : null}
                  {(R.labor && R.labor.some(function (l) { return l.nonBillable; })) ? <Row k="Labor not chargeable" muted v={((R.labor.filter(function (l) { return l.nonBillable && l.billabilityNote; })[0]) || {}).billabilityNote || "Per policy"} /> : null}
                  <Row k="Duplication" v={money(R.duplicationSubtotal)} />
                  {R.surcharge ? <Row k={(R.purpose === 'commercial' ? 'Commercial' : 'Purpose') + ' surcharge (' + R.surchargePct + '%)'} v={money(R.surcharge)} /> : null}
                  <Row k="Media" v={money(R.mediaSubtotal)} />
                  {R.avSubtotal ? <Row k="Audio/Video" v={money(R.avSubtotal)} /> : null}
                  {R.other ? <Row k={R.other.description} v={money(R.other.amount)} /> : null}
                  {R.certification ? <Row k={"Certification (" + R.certification.count + " " + (R.certification.unit === 'per_record' ? (R.certification.count === 1 ? 'record' : 'records') : 'request') + ")"} v={money(R.certificationSubtotal)} /> : null}
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
      {ctx.paymentPlan ? (
        <div style={{ marginTop: '18px', borderTop: '1px solid #E5E7EB', paddingTop: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', maxWidth: '700px' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#111' }}>Payment &amp; delivery plan</div>
            <span style={{ fontSize: '10.5px', fontWeight: 700, color: ctx.paymentTimingSource === 'profile' ? '#03543F' : '#92400E', background: ctx.paymentTimingSource === 'profile' ? '#DEF7EC' : '#FEF3C7', borderRadius: '999px', padding: '2px 9px' }}>{ctx.paymentTimingSource === 'profile' ? 'from jurisdiction config' : 'inferred from legacy config'}</span>
          </div>
          <div style={{ fontSize: '12.5px', color: '#374151', lineHeight: '1.5', marginBottom: '10px', maxWidth: '700px' }}>{ctx.paymentPlan.summary}</div>
          <div style={{ display: 'flex', gap: '26px', flexWrap: 'wrap', maxWidth: '700px' }}>
            <div style={{ fontSize: '12.5px', color: '#374151', lineHeight: '1.7' }}>
              <div><span style={{ color: '#6B7280' }}>Gate: </span>{GATE_LABELS[ctx.paymentPlan.gate] || ctx.paymentPlan.gate}</div>
              <div><span style={{ color: '#6B7280' }}>Delivery: </span>{DELIVERY_LABELS[ctx.paymentPlan.deliveryTrigger] || ctx.paymentPlan.deliveryTrigger}</div>
              <div><span style={{ color: '#6B7280' }}>First payment: </span>{ctx.paymentPlan.firstPayment && ctx.paymentPlan.firstPayment.required ? (ctx.paymentPlan.firstPayment.basisText + (ctx.paymentPlan.firstPayment.dueWindowText ? ' \u00b7 due ' + ctx.paymentPlan.firstPayment.dueWindowText : '')) : 'none required'}</div>
            </div>
            {ctx.paymentState ? (
              <div style={{ fontSize: '12.5px', color: '#374151', lineHeight: '1.7', minWidth: '230px' }}>
                <div><span style={{ color: '#6B7280' }}>Effective total: </span>{money(ctx.paymentState.effectiveTotal)}{ctx.paymentState.reconciled ? ' (reconciled)' : ''}</div>
                <div><span style={{ color: '#6B7280' }}>Paid: </span>{money(ctx.paymentState.paid)} <span style={{ color: '#9CA3AF' }}>({money(ctx.paymentState.depositPaid)} deposit + {money(ctx.paymentState.finalPaid)} final)</span></div>
                <div style={{ fontWeight: 700 }}><span style={{ color: '#6B7280', fontWeight: 400 }}>Balance due: </span>{ctx.paymentState.paidInFull ? <span style={{ color: '#03543F' }}>paid in full</span> : <span style={{ color: NAVY }}>{money(ctx.paymentState.balanceDue)}</span>}</div>
              </div>
            ) : null}
          </div>
          {renderTakePayment()}
        </div>
      ) : null}
      {result ? (
        <div style={{ marginTop: '18px', borderTop: '1px solid #E5E7EB', paddingTop: '16px' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#111', marginBottom: '4px' }}>Notify requestor</div>
          <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '10px' }}>This is what the requestor sees - plain language, no internal worksheet detail. Review and edit if needed, then send.{noticeNotifyTriggered ? ' This estimate exceeds the notification threshold.' : ''}</div>
          {noticeNotifiedAt ? <div style={{ fontSize: '12px', color: '#03543F', background: '#DEF7EC', padding: '8px 10px', borderRadius: '6px', marginBottom: '10px' }}>Sent to {noticeTo} on {noticeNotifiedAt}. Sending again delivers an updated notice.</div> : null}
          <div style={{ maxWidth: '640px' }}>
            <div style={{ marginBottom: '8px' }}><label style={lbl}>To</label><input type="text" value={noticeTo} onChange={function (e) { setNoticeTo(e.target.value); }} style={inp} /></div>
            <div style={{ marginBottom: '8px' }}><label style={lbl}>Subject</label><input type="text" value={noticeSubject} onChange={function (e) { setNoticeSubject(e.target.value); }} style={inp} /></div>
            <div style={{ marginBottom: '8px' }}><label style={lbl}>Message</label><textarea value={noticeText} onChange={function (e) { setNoticeText(e.target.value); }} rows={14} style={Object.assign({}, inp, { fontFamily: 'inherit', resize: 'vertical', lineHeight: '1.5' })} /></div>
            {/* PHASE 7 / BW4 — THE SEND GATE, IN WORDS. `feeWaiverGate` comes from the same
                approvalModules.estimateCommunicationGate the send route refuses on (409 WAIVER_UNDECIDED),
                so the greyed button and the refusal are one sentence. A waiver changes the amount, and a
                requester must not receive one figure and then another. */}
            {waiverGate.blocked ? (
              <div style={{ fontSize: '12.5px', color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '8px', padding: '9px 12px', marginBottom: '9px' }}>
                <b>Cannot send yet.</b> {waiverGate.reason}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button onClick={sendNotice} disabled={sending || !noticeTo || waiverGate.blocked} style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: (sending || !noticeTo || waiverGate.blocked) ? '#9CB4CC' : NAVY, color: 'white', fontSize: '13px', fontWeight: 700, cursor: (sending || !noticeTo || waiverGate.blocked) ? 'not-allowed' : 'pointer' }}>{sending ? 'Sending...' : (noticeNotifiedAt ? 'Resend to requestor' : 'Send to requestor')}</button>
              {sendMsg ? <span style={{ fontSize: '12.5px', color: sendMsg.indexOf('Sent') === 0 ? '#03543F' : '#9B1C1C' }}>{sendMsg}</span> : null}
            </div>
          </div>
        </div>
      ) : null}
              {ctx.latest && ctx.latest.accepted_at ? (
                <div style={{ marginTop: '18px', borderTop: '1px solid #E5E7EB', paddingTop: '16px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#111', marginBottom: '4px' }}>Reconcile actuals</div>
                  <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '10px' }}>After the work is done, set the quantities above to the ACTUAL amounts, then record the reconciliation. This compares actuals to the estimate, flags whether a revised notice is required, and sharpens future auto-estimates for this record type.</div>
                  {ctx.laborActuals ? (
                    <div style={{ border: '1px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px', marginBottom: '12px', background: '#F9FAFB', maxWidth: '520px' }}>
                      <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#111', marginBottom: '8px' }}>Measured labor <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(from the work timer)</span></div>
                      {ctx.laborActuals.autoDraft ? (
                        <div style={{ fontSize: '11.5px', color: '#1F4E79', background: '#EFF6FF', border: '1px solid #DBEAFE', borderRadius: '6px', padding: '6px 10px', marginBottom: '9px' }}>
                          A draft reconciliation was auto-computed from measured labor{ctx.laborActuals.autoDraft.variancePct != null ? ' (' + (ctx.laborActuals.autoDraft.variancePct >= 0 ? '+' : '') + ctx.laborActuals.autoDraft.variancePct + '% vs estimate)' : ''} and is awaiting your review{ctx.laborActuals.autoDraft.reNotifyRequired ? ' — a revised notice is required before delivery' : ''}. Confirm or adjust the quantities, then record it below.
                        </div>
                      ) : null}
                      {[['searchHours', 'Search'], ['reviewHours', 'Review/redaction'], ['programmingHours', 'Programming']].map(function (d) {
                        var est = (ctx.laborActuals.estimated || {})[d[0]] || 0;
                        var act = (ctx.laborActuals.measured || {})[d[0]] || 0;
                        if (!est && !act) return null;
                        var delta = Math.round((act - est) * 100) / 100;
                        return (
                          <div key={d[0]} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: '6px', fontSize: '12px', color: '#374151', padding: '2px 0' }}>
                            <span style={{ color: '#6B7280' }}>{d[1]}</span>
                            <span style={{ textAlign: 'right' }}>est {est} h</span>
                            <span style={{ textAlign: 'right', fontWeight: 700 }}>actual {act} h</span>
                            <span style={{ textAlign: 'right', color: delta > 0 ? '#9B1C1C' : (delta < 0 ? '#03543F' : '#9CA3AF') }}>{delta > 0 ? '+' : ''}{delta} h</span>
                          </div>
                        );
                      })}
                      <div style={{ marginTop: '9px' }}>
                        {ctx.laborActuals.hasActuals
                          ? <button onClick={useMeasuredHours} style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #1F4E79', background: 'white', color: '#1F4E79', fontSize: '11.5px', fontWeight: 700, cursor: 'pointer' }}>Use measured hours</button>
                          : <span style={{ fontSize: '11.5px', color: '#9CA3AF' }}>No measured labor captured (timer off or skipped) &mdash; enter actual hours manually.</span>}
                        {ctx.laborActuals.excluded && ctx.laborActuals.excluded.length ? <span style={{ fontSize: '11px', color: '#9CA3AF', marginLeft: '10px' }}>{ctx.laborActuals.excluded.length} task(s) not counted</span> : null}
                      </div>
                    </div>
                  ) : null}
                  <button onClick={reconcile} disabled={reconBusy} style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: reconBusy ? '#9CB4CC' : NAVY, color: 'white', fontSize: '13px', fontWeight: 700, cursor: reconBusy ? 'default' : 'pointer' }}>{reconBusy ? 'Recording...' : 'Record actuals & reconcile'}</button>
                  {reconResult && reconResult.error ? <div style={{ marginTop: '10px', fontSize: '12.5px', color: '#9B1C1C' }}>{reconResult.error}</div> : null}
                  {reconResult && !reconResult.error ? (
                    <div style={{ marginTop: '12px', maxWidth: '520px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#374151', padding: '2px 0' }}><span>Estimated</span><span>{money(reconResult.estimateTotal)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#374151', padding: '2px 0' }}><span>Actual</span><span>{money(reconResult.actualTotal)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 800, color: NAVY, padding: '4px 0', borderTop: '1px solid #E5E7EB' }}><span>Variance</span><span>{reconResult.variancePct == null ? 'n/a' : ((reconResult.variancePct >= 0 ? '+' : '') + reconResult.variancePct + '%')}</span></div>
                      {reconResult.reNotifyRequired ? (
                        <div style={{ marginTop: '8px', fontSize: '12.5px', color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '8px', padding: '9px 12px' }}>Actual cost exceeds the estimate by more than {reconResult.reNotifyThreshold}% &mdash; a revised notice to the requestor is required before delivery.</div>
                      ) : (
                        <div style={{ marginTop: '8px', fontSize: '12.5px', color: '#03543F', background: '#DEF7EC', border: '1px solid #BCF0DA', borderRadius: '8px', padding: '9px 12px' }}>Within the {reconResult.reNotifyThreshold}% notification threshold &mdash; no revised notice required. Actuals recorded to the estimate profile.</div>
                      )}
                    </div>
                  ) : null}
                  {renderAdjNotice()}
                </div>
              ) : null}
    </div>
  );
}
function Row(props) { return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0', color: props.amber ? '#92400E' : (props.muted ? '#9CA3AF' : '#374151') }}><span>{props.k}</span><span>{props.v}</span></div>; }
