import React, { useEffect, useState } from 'react';
import api from '../../lib/api';

var NAVY = 'var(--oq-x-1f4e79)';
var inp = { width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--oq-ln-e5e7eb)', fontSize: '13px', boxSizing: 'border-box' };
var lbl = { fontSize: '10.5px', fontWeight: 600, color: 'var(--oq-fg-9ca3af)', display: 'block', marginBottom: '3px' };
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
  var [actualAmounts, setActualAmounts] = useState({});   // staff-entered $ for 'actual'-rated lines (dup_bw, media:<type>, delivery)
  var [result, setResult] = useState(null);
  var [ledger, setLedger] = useState(null);   // WS5 requestor-ledger gate result (prior balance · personnel-time cap · same-day siblings)
  var [calc, setCalc] = useState(false);
  var [err, setErr] = useState('');
  var [other, setOther] = useState([{ amount: '', description: '' }]);   // extra costs: description + amount each, as many as needed (Kevin 2026-09-13)
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
  // Legal-hours ask (DESIGN_legal_hours_estimate.md slice 1). Display + ask only in this slice: the
  // engine's "Legal review" line and Accept-pre-fill arrive with slice 2, so until then the answer is
  // shown for the estimator's judgment, not auto-applied.
  var [legalAsk, setLegalAsk] = useState(null);
  var [askOpen, setAskOpen] = useState(false);
  var [askNote, setAskNote] = useState('');
  var [askAssignee, setAskAssignee] = useState('');
  var [askBusy, setAskBusy] = useState(false);
  var [askMsg, setAskMsg] = useState('');
  var [legalStaff, setLegalStaff] = useState(null);

  useEffect(function () { load(); }, [requestId]);
  async function loadLegalAsk() {
    try { var la = await api.get('/legal-estimate/request/' + requestId); setLegalAsk(la.data); } catch (e) { setLegalAsk(null); }
  }
  function openAsk() {
    setAskMsg(''); setAskNote(''); setAskAssignee(''); setAskOpen(true);
    if (legalStaff === null) {
      api.get('/staff').then(function (r) {
        setLegalStaff((r.data.staff || []).filter(function (u) { return (u.taskTypes || []).indexOf('legal_review') >= 0 && u.status !== 'inactive'; }));
      }).catch(function () { setLegalStaff([]); });
    }
  }
  async function submitAsk() {
    if (!askAssignee) { setAskMsg('Name the person to ask.'); return; }
    if (!askNote.trim()) { setAskMsg('Say what legal should look at.'); return; }
    setAskBusy(true); setAskMsg('');
    try {
      await api.post('/legal-estimate/request/' + requestId + '/ask', { assignee_id: askAssignee, note: askNote.trim() });
      setAskOpen(false); loadLegalAsk();
    } catch (e) { setAskMsg((e.response && e.response.data && e.response.data.error) || 'Could not send the ask.'); }
    setAskBusy(false);
  }
  async function load() {
    loadLegalAsk();
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
        init[c.id] = { searchHours: pq.searchHours || 0, reviewHours: pq.reviewHours || 0, legalHours: pq.legalHours || 0, bwPages: (hasSource ? (pq.bwPages || 0) : ((c.suggested && c.suggested.hasKnown) ? c.suggested.knownPages : 0)), colorPages: pq.colorPages || 0, oversizedPages: pq.oversizedPages || 0, mediaType: m.type || 'cd', mediaCount: m.count || 0, avRecordings: (pq.av && pq.av.recordings) || 0, avMinutes: (pq.av && pq.av.minutes) || 0 };
      });
      setQty(init);
      setPrefilled(pf);
      if (r.data.latest && r.data.latest.feeContext) setResult(r.data.latest.feeContext);
      if (r.data.ledger) setLedger(r.data.ledger);
      if (r.data.latest && r.data.latest.input && r.data.latest.input.delivery) setDelivery(r.data.latest.input.delivery.method || 'email');
      if (r.data.request && r.data.request.purpose) setPurpose(r.data.request.purpose);
      var ard = r.data.actualRateDrivers || []; setActualRateDrivers(ard); if (ard.length) { var ro = {}; ard.forEach(function (k) { ro[k] = (r.data.laborRates || {})[k] || 0; }); setRateOverrides(ro); }
      if (r.data.latest && r.data.latest.input && r.data.latest.input.actualAmounts) setActualAmounts(r.data.latest.input.actualAmounts);
      if (r.data.latest && r.data.latest.input && r.data.latest.input.other) {
        var prevOther = r.data.latest.input.other;   // a list since 2026-09-14; earlier estimates saved one object
        var lst = (Array.isArray(prevOther) ? prevOther : [prevOther]).map(function (o) { return { amount: o.amount || 0, description: o.description || '' }; });
        setOther(lst.length ? lst : [{ amount: '', description: '' }]);
      }
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
        var quant = { searchHours: num(q.searchHours), reviewHours: num(q.reviewHours), legalHours: num(q.legalHours), bwPages: num(q.bwPages), colorPages: num(q.colorPages), oversizedPages: num(q.oversizedPages) };
        if (num(q.mediaCount) > 0) quant.media = [{ type: q.mediaType, count: num(q.mediaCount) }];
        if (num(q.avRecordings) > 0 || num(q.avMinutes) > 0) quant.av = { recordings: num(q.avRecordings), minutes: num(q.avMinutes) };
        return { id: c.id, label: c.label, recordType: c.recordType, quantities: quant };
      });
      var otherPayload = other.filter(function (o) { return num(o.amount) !== 0; }).map(function (o) { return { amount: num(o.amount), description: (o.description || '').trim() || 'Other' }; });
      var certPayload = certification.requested ? { count: num(certification.count) || 1 } : { count: 0 };
      var r = await api.post('/fee-estimates/request/' + requestId, { components: comps, delivery: { method: delivery }, certification: certPayload, other: otherPayload, purpose: purpose, rateOverrides: rateOverrides, actualAmounts: actualAmounts });
      setResult(r.data.estimate.feeContext);
      if (r.data.ledger) setLedger(r.data.ledger);
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

  if (!ctx) return <div style={{ color: 'var(--oq-fg-9ca3af)', fontSize: '13px' }}>{err || 'Loading...'}</div>;
  if (!ctx.configProfile) return <div style={{ fontSize: '13px', color: 'var(--oq-fg-92400e)', background: 'var(--oq-bg-fef3c7)', padding: '14px', borderRadius: '8px' }}>No fee configuration exists for the active jurisdiction yet. Set one up under <strong>Fee Configuration</strong> in the sidebar, then return here.</div>;

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
    var th = { textAlign: 'left', color: 'var(--oq-fg-6b7280)', padding: '4px 6px', fontWeight: 600 };
    return (
      <div style={{ marginTop: '14px', padding: '13px 15px', background: 'var(--oq-bg-f9fafb)', border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '10px', maxWidth: '700px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--oq-fg-111111)', marginBottom: '4px' }}>External payment (ERP)</div>
        <div style={{ fontSize: '12px', color: 'var(--oq-fg-6b7280)', marginBottom: '10px' }}>Finance collects this payment in the ERP (online, mail, or walk-in). Hand off the charge; the balance updates automatically when the ERP reports the payment. Optimum Q sends no payment reminders in this mode.</div>
        {ps && !ps.paidInFull && owed > 0 && L && L.accepted_at ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: erpCharges.length ? '12px' : 0, flexWrap: 'wrap' }}>
            <button onClick={function () { sendCharge(target, owed); }} disabled={erpBusy} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: erpBusy ? 'var(--oq-bg-9cb4cc)' : NAVY, color: 'var(--oq-fg-ffffff)', fontSize: '13px', fontWeight: 700, cursor: erpBusy ? 'default' : 'pointer' }}>{erpBusy ? 'Sending...' : 'Send ' + target + ' charge to ERP (' + money(owed) + ')'}</button>
            {erpMsg ? <span style={{ fontSize: '12px', color: erpMsg.indexOf('Sent') === 0 ? 'var(--oq-fg-03543f)' : 'var(--oq-fg-9b1c1c)' }}>{erpMsg}</span> : null}
          </div>
        ) : null}
        {erpCharges.length ? (
          <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Charge</th><th style={th}>Target</th><th style={Object.assign({}, th, { textAlign: 'right' })}>Amount</th><th style={Object.assign({}, th, { textAlign: 'right' })}>Paid</th><th style={th}>Status</th></tr></thead>
            <tbody>{erpCharges.map(function (c) { return <tr key={c.id}><td style={{ padding: '4px 6px', color: 'var(--oq-fg-374151)' }}>{c.erp_charge_id}</td><td style={{ padding: '4px 6px', color: 'var(--oq-fg-374151)' }}>{c.target}</td><td style={{ padding: '4px 6px', textAlign: 'right' }}>{money(c.amount)}</td><td style={{ padding: '4px 6px', textAlign: 'right' }}>{money(c.paid_amount)}</td><td style={{ padding: '4px 6px' }}><span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: c.status === 'paid' ? 'var(--oq-bg-def7ec)' : 'var(--oq-bg-fef3c7)', color: c.status === 'paid' ? 'var(--oq-fg-03543f)' : 'var(--oq-fg-92400e)' }}>{c.status}</span></td></tr>; })}</tbody>
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
      <div style={{ marginTop: '14px', padding: '12px 14px', background: 'var(--oq-bg-ffffff)', border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '10px', maxWidth: '660px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--oq-fg-111111)', marginBottom: '8px' }}>Take a payment <span style={{ fontWeight: 400, color: 'var(--oq-fg-6b7280)' }}>({target} · {money(owed)} owed)</span></div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><label style={lbl}>Method</label><select value={payMethod} onChange={function (e) { setPayMethod(e.target.value); }} style={Object.assign({}, inp, { width: 'auto' })}><option value="cash">Cash</option><option value="check">Check</option><option value="card">Card</option><option value="money_order">Money order</option><option value="other">Other</option></select></div>
          <div style={{ width: '110px' }}><label style={lbl}>Amount $</label><input type="number" step="any" value={payAmount} onChange={function (e) { setPayAmount(e.target.value); }} placeholder={owed.toFixed(2)} style={inp} /></div>
          <button onClick={function () { setPayAmount(String(owed)); }} style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--oq-ln-1f4e79)', background: 'var(--oq-bg-ffffff)', color: 'var(--oq-fg-1f4e79)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>Copy owed</button>
          {payMethod === 'cash' ? <div style={{ width: '120px' }}><label style={lbl}>Cash tendered $</label><input type="number" step="any" value={payTendered} onChange={function (e) { setPayTendered(e.target.value); }} style={inp} /></div> : null}
          {(payMethod === 'check' || payMethod === 'money_order' || payMethod === 'other') ? <div style={{ width: '150px' }}><label style={lbl}>Reference / #</label><input type="text" value={payReference} onChange={function (e) { setPayReference(e.target.value); }} style={inp} /></div> : null}
        </div>
        {change != null ? <div style={{ fontSize: '13px', fontWeight: 700, color: change > 0 ? 'var(--oq-fg-92400e)' : 'var(--oq-fg-03543f)', marginTop: '8px' }}>Change due: {money(change)}</div> : null}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
          <button onClick={function () { takePayment(target, owed); }} disabled={payBusy} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: payBusy ? 'var(--oq-bg-9cb4cc)' : NAVY, color: 'var(--oq-fg-ffffff)', fontSize: '13px', fontWeight: 700, cursor: payBusy ? 'default' : 'pointer' }}>{payBusy ? 'Recording...' : 'Record payment'}</button>
          <button onClick={loadBalanceNotice} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--oq-ln-e5e7eb)', background: 'var(--oq-bg-ffffff)', color: 'var(--oq-fg-374151)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Load balance-due notice</button>
          {payMsg ? <span style={{ fontSize: '12px', color: payMsg.indexOf('Recorded') === 0 ? 'var(--oq-fg-03543f)' : 'var(--oq-fg-9b1c1c)' }}>{payMsg}</span> : null}
        </div>
      </div>
    );
  }
  function rBtn(label, onClick, primary) {
    return <button onClick={onClick} disabled={resp.busy} style={{ padding: '7px 14px', borderRadius: '8px', border: primary ? 'none' : '1px solid var(--oq-ln-e5e7eb)', background: primary ? NAVY : 'var(--oq-bg-ffffff)', color: primary ? 'var(--oq-fg-ffffff)' : 'var(--oq-fg-374151)', fontSize: '13px', fontWeight: 700, cursor: resp.busy ? 'default' : 'pointer', opacity: resp.busy ? 0.6 : 1 }}>{label}</button>;
  }
  function renderResponse() {
    var L = ctx.latest;
    if (!L || !L.notified_at) return null;
    var box = function (bg, bd, col, children) { return <div style={{ background: bg, border: '1px solid ' + bd, borderRadius: '10px', padding: '13px 15px', marginBottom: '16px', fontSize: '13px', color: col }}>{children}</div>; };
    if (L.declined_at) return box('var(--oq-bg-fde8e8)', 'var(--oq-ln-fbd5d5)', 'var(--oq-fg-9b1c1c)', <span>Requestor <strong>declined</strong> the estimate on {L.declined_at}{L.declined_reason ? ' \u2014 ' + L.declined_reason : ''}.</span>);
    if (L.accepted_at) {
      var depDue = Number(L.deposit_due) || 0;
      if (depDue > 0 && !L.deposit_paid_at) {
        return box('var(--oq-bg-fef3c7)', 'var(--oq-ln-fde68a)', 'var(--oq-fg-92400e)', <div><div style={{ marginBottom: '9px' }}>Accepted on {L.accepted_at}. A deposit of <strong>{money(depDue)}</strong> is required before record search begins.</div><div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>{rBtn('Record deposit received', function () { respond('deposit/record', {}); }, true)}{resp.msg ? <span style={{ color: 'var(--oq-fg-9b1c1c)', fontSize: '12px' }}>{resp.msg}</span> : null}</div></div>);
      }
      return box('var(--oq-bg-def7ec)', 'var(--oq-ln-bcf0da)', 'var(--oq-fg-03543f)', <span>Estimate <strong>accepted</strong> on {L.accepted_at}{L.deposit_paid_at ? ' \u00b7 deposit ' + money(L.deposit_paid_amount || depDue) + ' recorded' : ''} \u2014 record search underway.</span>);
    }
    return box('var(--oq-bg-eff6ff)', 'var(--oq-ln-dbeafe)', 'var(--oq-fg-1f4e79)', <div>
      <div style={{ marginBottom: '9px' }}><strong>Estimate sent</strong> on {L.notified_at} · total {money(L.total)}{Number(L.deposit_due) > 0 ? ' \u00b7 deposit ' + money(L.deposit_due) : ''}. Record the requestor's response:</div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        {rBtn('Mark accepted', function () { respond('estimate/accept', {}); }, true)}
        {rBtn('Mark declined', function () { respond('estimate/decline', { reason: declineReason }); }, false)}
        <input type="text" value={declineReason} onChange={function (e) { setDeclineReason(e.target.value); }} placeholder="decline reason (optional)" style={{ flex: 1, minWidth: '160px', padding: '7px 10px', border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '8px', fontSize: '12.5px' }} />
        {resp.msg ? <span style={{ color: 'var(--oq-fg-9b1c1c)', fontSize: '12px' }}>{resp.msg}</span> : null}
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
      <div style={{ marginTop: '14px', borderTop: '1px dashed var(--oq-ln-e5e7eb)', paddingTop: '12px', maxWidth: '560px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--oq-fg-111111)', marginBottom: '6px' }}>Adjustment notice to requestor</div>
        {!adjNotice ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={loadAdjNotice} disabled={adjBusy} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--oq-ln-e5e7eb)', background: 'var(--oq-bg-ffffff)', color: 'var(--oq-fg-374151)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>{adjBusy ? 'Loading...' : 'Load estimate-to-actual notice'}</button>
            {adjMsg ? <span style={{ fontSize: '12px', color: adjMsg.indexOf('Sent') === 0 ? 'var(--oq-fg-03543f)' : 'var(--oq-fg-9b1c1c)' }}>{adjMsg}</span> : null}
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '6px' }}><label style={lbl}>To</label><input type="text" value={adjNotice.to} onChange={function (e) { setAdjNotice(Object.assign({}, adjNotice, { to: e.target.value })); }} style={inp} /></div>
            <div style={{ marginBottom: '6px' }}><label style={lbl}>Subject</label><input type="text" value={adjNotice.subject} onChange={function (e) { setAdjNotice(Object.assign({}, adjNotice, { subject: e.target.value })); }} style={inp} /></div>
            <div style={{ marginBottom: '8px' }}><label style={lbl}>Message</label><textarea value={adjNotice.text} onChange={function (e) { setAdjNotice(Object.assign({}, adjNotice, { text: e.target.value })); }} rows={8} style={Object.assign({}, inp, { fontFamily: 'inherit', resize: 'vertical' })} /></div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button onClick={sendAdjNotice} disabled={adjBusy} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: adjBusy ? 'var(--oq-bg-9cb4cc)' : NAVY, color: 'var(--oq-fg-ffffff)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>{adjBusy ? 'Sending...' : 'Send to requestor'}</button>
              <button onClick={function () { setAdjNotice(null); setAdjMsg(''); }} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--oq-ln-e5e7eb)', background: 'var(--oq-bg-ffffff)', color: 'var(--oq-fg-374151)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
              {adjMsg ? <span style={{ fontSize: '12px', color: adjMsg.indexOf('Sent') === 0 ? 'var(--oq-fg-03543f)' : 'var(--oq-fg-9b1c1c)' }}>{adjMsg}</span> : null}
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
        var quant = { searchHours: num(q.searchHours), reviewHours: num(q.reviewHours), legalHours: num(q.legalHours), bwPages: num(q.bwPages), colorPages: num(q.colorPages), oversizedPages: num(q.oversizedPages) };
        if (num(q.mediaCount) > 0) quant.media = [{ type: q.mediaType, count: num(q.mediaCount) }];
        if (num(q.avRecordings) > 0 || num(q.avMinutes) > 0) quant.av = { recordings: num(q.avRecordings), minutes: num(q.avMinutes) };
        return { id: c.id, label: c.label, recordType: c.recordType, quantities: quant };
      });
      var certPayload = certification.requested ? { count: num(certification.count) || 1 } : { count: 0 };
      var r = await api.post('/fee-estimates/request/' + requestId + '/reconcile', { components: comps, delivery: { method: delivery }, certification: certPayload, purpose: purpose, rateOverrides: rateOverrides, actualAmounts: actualAmounts });
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
  // BW4 — chargeability lookups. `kinds` is keyed by the builder's own field names, so the filter below is
  // a direct question ("may this state charge for this box?") rather than a mapping table to keep in sync.
  var chKinds = (ctx.chargeability && ctx.chargeability.kinds) || [];
  function kindFor(field) { return chKinds.filter(function (k) { return k.field === field; })[0] || null; }
  // Unknown field (or an unreadable config) => chargeable. The builder must never LOSE a box because a
  // config could not be read; it loses one only on a declared prohibition.
  function chargeable(field) { var k = kindFor(field); return !k || k.permitted !== false; }
  var forbidden = (ctx.chargeability && ctx.chargeability.forbidden) || [];

  var R = result && result.requestLevel;
  // ACROSS THIS REQUESTOR'S REQUESTS (WS5, 2026-09-08). What the ledger found for the person behind this
  // request: the free personnel-time meter (TX § 552.275, counted from the schedule — the tracker the estimate
  // page used to note as NOT BUILT), the cap trigger when it bites, and same-day siblings a person may aggregate.
  // An anonymous requestor gets the honest sentence, never an empty box.
  function renderLedger() {
    if (!ledger) return null;
    var al = ledger.allowance;
    var cap = (ledger.triggers || []).filter(function (t) { return t.action === 'all_time_chargeable'; })[0];
    var agg = (ledger.advisories || []).filter(function (a) { return a.action === 'may_aggregate'; })[0];
    if (ledger.anonymous && !al) return null;
    if (!al && !cap && !agg) return null;
    var pct = al && al.hoursPerYear ? Math.min(100, Math.round(al.usedYear / al.hoursPerYear * 100)) : 0;
    return (
      <div style={{ marginTop: '18px', borderTop: '1px solid var(--oq-ln-e5e7eb)', paddingTop: '16px' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--oq-fg-111111)', marginBottom: '4px' }}>Across this requestor's requests</div>
        <div style={{ fontSize: '12px', color: 'var(--oq-fg-6b7280)', marginBottom: '10px' }}>Counted by the requestor ledger from this person's other requests. Identity: {String(ledger.identityBasis || '').replace(/_/g, ' ') || 'anchored'}.</div>
        {al && al.exempt ? <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-374151)' }}>Free personnel time is not metered for this requestor — {al.exemptReason}.</div> : null}
        {al && al.metered ? (
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--oq-fg-111111)' }}>Free personnel time <span style={{ color: 'var(--oq-fg-6b7280)', fontWeight: 400 }}>· {al.usedYear} of {al.hoursPerYear} hours used in the last 12 months{al.hoursPerMonth != null ? ' · ' + al.usedMonth + ' of ' + al.hoursPerMonth + ' this month' : ''} · this request not counted yet</span></div>
            <div style={{ height: '6px', background: 'var(--oq-bg-f3f4f6)', borderRadius: '3px', marginTop: '5px', maxWidth: '420px' }}><div style={{ height: '6px', width: pct + '%', background: al.over ? 'var(--oq-bg-b02a37)' : 'var(--oq-bg-1f4e79)', borderRadius: '3px' }}></div></div>
          </div>
        ) : null}
        {cap ? <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-7f1d1d)', background: 'var(--oq-bg-fef2f2)', border: '1px solid var(--oq-ln-fecaca)', padding: '8px 10px', borderRadius: '6px', marginBottom: '8px' }}><b>All staff time is chargeable on this request.</b> {cap.summary} <span style={{ color: 'var(--oq-fg-9ca3af)' }}>({cap.citation})</span></div> : null}
        {agg ? <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-78350f)', background: 'var(--oq-bg-fffbeb)', border: '1px solid var(--oq-ln-fde68a)', padding: '8px 10px', borderRadius: '6px' }}><b>Same-day requests.</b> {agg.summary} <span style={{ color: 'var(--oq-fg-9ca3af)' }}>({agg.citation})</span></div> : null}
      </div>
    );
  }
  return (
    <div>
      {renderResponse()}
      <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-6b7280)', marginBottom: '14px' }}>Priced against <strong>{ctx.configProfile.name}</strong>{ctx.configProfile.status !== 'active' ? ' (' + ctx.configProfile.status + ')' : ''}. Enter the quantities for each component; the engine itemizes the estimate and saves it to the request.</div>

      {legalAsk && legalAsk.open ? (
        <div style={{ background: 'var(--oq-bg-fffbeb)', border: '1px solid var(--oq-ln-fde68a)', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '12.5px', color: 'var(--oq-fg-92400e)', lineHeight: 1.5 }}>
          <strong>Legal hours pending</strong>{legalAsk.open.assignee_name ? ' — asked of ' + legalAsk.open.assignee_name : ''}{legalAsk.open.asked_at ? ' ' + (legalAsk.open.asked_at || '').slice(0, 10) : ''}: &ldquo;{legalAsk.open.ask_note}&rdquo;.
          You can still send the estimate; if legal&rsquo;s answer changes the price, a revised estimate goes out through the normal renotify rules.
        </div>
      ) : null}
      {legalAsk && legalAsk.answer ? (
        <div style={{ background: 'var(--oq-bg-f0fdf4)', border: '1px solid var(--oq-ln-86efac)', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '12.5px', color: 'var(--oq-fg-166534)', lineHeight: 1.5, display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: '240px' }}>
            <strong>Legal&rsquo;s answer: {legalAsk.answer.hours} hour{legalAsk.answer.hours === 1 ? '' : 's'}</strong>
            {legalAsk.answer.entered_by_name ? ' (from ' + legalAsk.answer.entered_by_name + ')' : ''} &mdash; &ldquo;{legalAsk.answer.note}&rdquo;.
          </span>
          <button onClick={function () {
            // Accepting is an act, not an automatic merge (the estimator stays the author). The hours
            // land on the FIRST component — legal review is request-level work, and this mirrors where
            // measured labor lands at reconciliation (laborActuals.applyMeasuredLabor).
            var first = (ctx.components || [])[0];
            if (first) { setQ(first.id, 'legalHours', legalAsk.answer.hours); setResult(null); }
          }} style={{ flexShrink: 0, padding: '7px 14px', borderRadius: '8px', border: 'none', background: 'var(--oq-bg-166534)', color: 'var(--oq-fg-ffffff)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
            Accept into Legal review hrs
          </button>
        </div>
      ) : null}
      <div style={{ marginBottom: '14px' }}>
        <button onClick={openAsk} style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid ' + NAVY, background: 'var(--oq-bg-ffffff)', color: NAVY, fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}>
          {legalAsk && (legalAsk.open || legalAsk.answer) ? 'Ask legal again' : 'Ask legal for hours'}
        </button>
      </div>

      {askOpen ? (
        <div onClick={function () { if (!askBusy) setAskOpen(false); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '20px' }}>
          <div onClick={function (e) { e.stopPropagation(); }} style={{ background: 'var(--oq-bg-ffffff)', borderRadius: '14px', width: '480px', maxWidth: '100%', padding: '24px' }}>
            <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '6px' }}>Ask legal for hours</div>
            <div style={{ fontSize: '13px', color: 'var(--oq-fg-374151)', lineHeight: 1.5, marginBottom: '14px' }}>
              A named person on the legal staff answers with the hours of legal work this request should be
              expected to need. Their answer lands here as an input for you &mdash; the estimate stays yours.
            </div>
            <label style={lbl}>Who to ask (legal staff)</label>
            <select value={askAssignee} onChange={function (e) { setAskAssignee(e.target.value); }} style={Object.assign({}, inp, { marginBottom: '10px' })}>
              <option value="">{legalStaff === null ? 'Loading…' : legalStaff.length ? 'Choose a person' : 'Nobody holds the Legal Review task type'}</option>
              {(legalStaff || []).map(function (u) { return <option key={u.id} value={u.id}>{u.display_name}{u.title ? ' — ' + u.title : ''}</option>; })}
            </select>
            <label style={lbl}>What should legal look at? (required)</label>
            <textarea value={askNote} onChange={function (e) { setAskNote(e.target.value); }} rows={3} style={Object.assign({}, inp, { resize: 'vertical', fontFamily: 'inherit' })} />
            {askMsg ? <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-dc2626)', marginTop: '8px' }}>{askMsg}</div> : null}
            <div style={{ marginTop: '14px' }}>
              <button onClick={submitAsk} disabled={askBusy} style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: askBusy ? 'var(--oq-bg-9cb4cc)' : NAVY, color: 'var(--oq-fg-ffffff)', fontSize: '13px', fontWeight: 700, cursor: askBusy ? 'default' : 'pointer' }}>{askBusy ? 'Sending…' : 'Send the ask'}</button>
              <button onClick={function () { if (!askBusy) setAskOpen(false); }} style={{ marginLeft: '10px', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--oq-ln-e5e7eb)', background: 'var(--oq-bg-ffffff)', color: 'var(--oq-fg-374151)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '320px' }}>
          {(ctx.components || []).map(function (c) {
            var q = qty[c.id] || {};
            return (
              <div key={c.id} style={{ border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '10px', padding: '14px', marginBottom: '12px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--oq-fg-111111)', marginBottom: '10px' }}>{c.label}{c.recordTypeName ? <span style={{ fontWeight: 400, color: 'var(--oq-fg-9ca3af)' }}> &middot; {c.recordTypeName}</span> : null}</div>
                {prefilled[c.id] ? <div style={{ fontSize: '11px', color: 'var(--oq-fg-92400e)', background: 'var(--oq-bg-fef3c7)', border: '1px solid var(--oq-ln-fde68a)', borderRadius: '6px', padding: '5px 9px', marginBottom: '10px' }}>Pre-filled from the estimate profile &mdash; review &amp; adjust before sending.</div> : null}
                {forbidden.length ? (
                  <div style={{ fontSize: '11px', color: 'var(--oq-fg-03543f)', background: 'var(--oq-bg-eaf4ef)', border: '1px solid var(--oq-ln-2f6b4f)', borderRadius: '6px', padding: '6px 9px', marginBottom: '10px' }}>
                    Not chargeable here, so not offered: {forbidden.map(function (k) { return k.label + (k.citation ? ' (' + k.citation + ')' : ''); }).join(' · ')}.
                    {forbidden[0].text ? ' ' + forbidden[0].text : ''}
                  </div>
                ) : null}
                {c.suggested && c.suggested.hasKnown ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', background: 'var(--oq-bg-eff6ff)', border: '1px solid var(--oq-ln-dbeafe)', borderRadius: '8px', padding: '7px 10px', marginBottom: '10px', fontSize: '11.5px', color: 'var(--oq-fg-1f4e79)' }}>
                    <span>Known page count: <strong>{c.suggested.knownPages}</strong> &middot; {c.suggested.basis}</span>
                    <button onClick={function () { setQ(c.id, 'bwPages', c.suggested.knownPages); }} style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--oq-ln-1f4e79)', background: 'var(--oq-bg-ffffff)', color: 'var(--oq-fg-1f4e79)', fontSize: '11px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>Use</button>
                  </div>
                ) : null}
                {/* PHASE 7 / BW4 — CHARGEABILITY-AWARE. A line kind this state FORBIDS is not offered: in
                    Ohio the engine has always zeroed labor (R.C. 149.43(B)(1) — actual cost of the medium
                    only), but the box was still there to type into, so a clerk entered hours the estimate
                    then silently dropped. What is removed is replaced by the prohibition and its citation,
                    because a vanished field reads as a bug. Only an EXPLICIT prohibition filters — an
                    unconfigured rate still renders (see services/chargeability.js). */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                  {[['searchHours', 'Search hrs'], ['reviewHours', 'Review/redaction hrs'], ['legalHours', 'Legal review hrs'], ['bwPages', 'B&W pages'], ['colorPages', 'Color pages'], ['oversizedPages', 'Oversized pages']].filter(function (f) { return chargeable(f[0]); }).map(function (f) {
                    var ck = kindFor(f[0]);
                    return <div key={f[0]}><label style={lbl}>{f[1]}</label><input type="number" step="any" value={q[f[0]]} onChange={function (e) { setQ(c.id, f[0], e.target.value === '' ? 0 : parseFloat(e.target.value)); }} style={inp} />{ck && ck.reason === 'conditional' ? <div style={{ fontSize: '10px', color: 'var(--oq-fg-92400e)', marginTop: '2px' }}>{ck.text}{ck.citation ? ' (' + ck.citation + ')' : ''}</div> : null}</div>;
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
                  <div><label style={lbl}>Rec. minutes (total)</label>
                    <input type="number" step="1" value={q.avMinutes} onChange={function (e) { setQ(c.id, 'avMinutes', e.target.value === '' ? 0 : parseInt(e.target.value, 10)); }} style={inp} />
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{ border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '10px', padding: '14px', marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--oq-fg-111111)', marginBottom: '4px' }}>Extra costs <span style={{ fontWeight: 400, color: 'var(--oq-fg-9ca3af)' }}>(optional &middot; one-off costs not covered above &middot; each is its own line on the requestor's estimate)</span></div>
            {other.map(function (o, i) {
              return <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '6px' }}>
                <div style={{ flex: 1 }}><label style={lbl}>Description</label><input type="text" value={o.description} onChange={function (e) { var v = e.target.value; setOther(function (l) { return l.map(function (x, j) { return j === i ? Object.assign({}, x, { description: v }) : x; }); }); }} placeholder="e.g. third-party retrieval fee, special postage" style={inp} /></div>
                <div style={{ width: '120px' }}><label style={lbl}>Amount $</label><input type="number" step="any" value={o.amount} onChange={function (e) { var v = e.target.value; setOther(function (l) { return l.map(function (x, j) { return j === i ? Object.assign({}, x, { amount: v }) : x; }); }); }} style={inp} /></div>
                <button type="button" title="Remove this extra cost" onClick={function () { setOther(function (l) { var n = l.filter(function (x, j) { return j !== i; }); return n.length ? n : [{ amount: '', description: '' }]; }); }} style={{ height: '34px', padding: '0 10px', border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '8px', background: 'var(--oq-bg-ffffff)', fontSize: '12px', cursor: 'pointer' }}>Remove</button>
              </div>;
            })}
            <button type="button" onClick={function () { setOther(function (l) { return l.concat([{ amount: '', description: '' }]); }); }} style={{ height: '28px', padding: '0 10px', border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '8px', background: 'var(--oq-bg-ffffff)', fontSize: '12px', cursor: 'pointer' }}>Add another extra cost</button>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
            <div><label style={lbl}>Delivery</label><select value={delivery} onChange={function (e) { setDelivery(e.target.value); }} style={Object.assign({}, inp, { width: 'auto' })}><option value="email">Email</option><option value="pickup">Pickup</option><option value="mail">Mail</option></select></div>
            <div><label style={lbl}>Purpose</label><select value={purpose} onChange={function (e) { setPurpose(e.target.value); }} style={Object.assign({}, inp, { width: 'auto' })}><option value="standard">Standard</option><option value="commercial">Commercial</option></select></div>
            <div>
              <label style={lbl}>Certification{ctx.certification && ctx.certification.requested ? <span style={{ color: 'var(--oq-fg-03543f)' }}> &middot; requestor asked</span> : null}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '30px' }}>
                <input type="checkbox" checked={certification.requested} onChange={function (e) { var on = e.target.checked; setCertification(function (p) { return Object.assign({}, p, { requested: on, count: on ? (num(p.count) || (ctx.certification && ctx.certification.suggestedCount) || 1) : p.count }); }); }} />
                {certification.requested ? <input type="number" min="0" step="1" value={certification.count} onChange={function (e) { var v = e.target.value; setCertification(function (p) { return Object.assign({}, p, { count: v === '' ? 0 : parseInt(v, 10) }); }); }} style={Object.assign({}, inp, { width: '56px' })} /> : null}
                {certification.requested && certification.rate != null ? <span style={{ fontSize: '11px', color: 'var(--oq-fg-9ca3af)' }}>@ {money(certification.rate)}</span> : null}
              </div>
            </div>
            {actualRateDrivers.map(function (k) { return <div key={k}><label style={lbl}>{k} $/hr (actual)</label><input type="number" step="any" value={rateOverrides[k] != null ? rateOverrides[k] : ''} onChange={function (e) { var v = e.target.value; setRateOverrides(function (pr) { var n = Object.assign({}, pr); n[k] = v === '' ? '' : parseFloat(v); return n; }); }} style={inp} /></div>; })}
            <button onClick={calculate} disabled={calc} style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: calc ? 'var(--oq-bg-9cb4cc)' : NAVY, color: 'var(--oq-fg-ffffff)', fontSize: '13px', fontWeight: 700, cursor: calc ? 'default' : 'pointer' }}>{calc ? 'Calculating...' : 'Calculate estimate'}</button>
            {err ? <span style={{ fontSize: '12px', color: 'var(--oq-fg-9b1c1c)' }}>{err}</span> : null}
          </div>
        </div>

        <div style={{ width: '360px', flexShrink: 0 }}>
          <div style={{ border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '10px', padding: '14px', background: 'var(--oq-bg-f9fafb)' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--oq-fg-111111)', marginBottom: '10px' }}>Itemized estimate</div>
            {R ? (
              <div>
                {result.components.map(function (c, ci) {
                  return (
                    <div key={ci} style={{ marginBottom: '8px' }}>
                      <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--oq-fg-374151)' }}>{c.label} <span style={{ color: 'var(--oq-fg-9ca3af)', fontWeight: 400 }}>gross {money(c.componentGross)}</span></div>
                      {c.lineItems.map(function (li, k) { return <div key={k} style={{ fontSize: '11px', color: 'var(--oq-fg-6b7280)', display: 'flex', justifyContent: 'space-between' }}><span>{li.description} ({li.quantity} {li.unit} @ {li.rate})</span><span>{li.needsActual ? 'actual TBD' : money(li.amount)}</span></div>; })}
                    </div>
                  );
                })}
                {(function () {
                  var lines = [];
                  (R.duplication || []).forEach(function (d) { if (d.needsActual || d.actualEntered) lines.push({ key: d.kind, label: (d.kind === 'dup_bw' ? 'B&W copies' : d.kind === 'dup_color' ? 'Color copies' : 'Oversized copies') + ' — ' + (d.billablePages != null ? d.billablePages : d.pages) + ' pages at actual cost' }); });
                  (R.media || []).forEach(function (m) { if (m.needsActual || m.actualEntered) lines.push({ key: 'media:' + m.type, label: 'Media: ' + m.type + ' — ' + m.count + ' at actual cost' }); });
                  if (R.delivery && (R.delivery.needsActual || R.delivery.actualEntered)) lines.push({ key: 'delivery', label: 'Delivery by ' + R.delivery.method + ' at actual cost (postage)' });
                  if (!lines.length) return null;
                  return <div style={{ border: '1px solid var(--oq-ln-fde68a)', background: 'var(--oq-bg-fffbeb)', borderRadius: '8px', padding: '8px 10px', margin: '6px 0 8px' }}>
                    <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--oq-fg-92400e)', marginBottom: '4px' }}>Actual-cost items — enter the amount, then Calculate</div>
                    <div style={{ fontSize: '11px', color: 'var(--oq-fg-78350f)', marginBottom: '6px' }}>The fee schedule prices these at actual cost. Enter your best figure for the estimate; correct it to the true actual when you reconcile for final billing. Left blank, the line reads "actual TBD" and the record cannot be released as fully priced.</div>
                    {lines.map(function (l) { return <div key={l.key} style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: '8px', alignItems: 'center', marginBottom: '4px', fontSize: '11.5px', color: 'var(--oq-fg-374151)' }}><span>{l.label}</span><input type="number" step="0.01" min="0" placeholder="$ actual" value={actualAmounts[l.key] == null ? '' : actualAmounts[l.key]} onChange={function (e) { var v = e.target.value; setActualAmounts(function (p) { var n = Object.assign({}, p); if (v === '') delete n[l.key]; else n[l.key] = parseFloat(v); return n; }); }} style={inp} /></div>; })}
                  </div>;
                })()}
                <div style={{ borderTop: '1px solid var(--oq-ln-e5e7eb)', paddingTop: '8px', fontSize: '12px', color: 'var(--oq-fg-374151)' }}>
                  <Row k="Labor" v={money(R.laborSubtotal)} />
                  {R.laborOverhead ? <Row k={"Labor overhead (" + R.laborOverheadPct + "%)"} v={money(R.laborOverhead)} /> : null}
                  {(R.labor && R.labor.some(function (l) { return l.nonBillable; })) ? <Row k="Labor not chargeable" muted v={((R.labor.filter(function (l) { return l.nonBillable && l.billabilityNote; })[0]) || {}).billabilityNote || "Per policy"} /> : null}
                  <Row k="Duplication" v={money(R.duplicationSubtotal)} />
                  {R.surcharge ? <Row k={(R.purpose === 'commercial' ? 'Commercial' : 'Purpose') + ' surcharge (' + R.surchargePct + '%)'} v={money(R.surcharge)} /> : null}
                  <Row k="Media" v={money(R.mediaSubtotal)} />
                  {R.avSubtotal ? <Row k="Audio/Video" v={money(R.avSubtotal)} /> : null}
                  {(Array.isArray(R.other) ? R.other : (R.other ? [R.other] : [])).map(function (o, i) { return <Row key={'other' + i} k={o.description} v={money(o.amount)} />; })}
                  {R.certification ? <Row k={"Certification (" + R.certification.count + " " + (R.certification.unit === 'per_record' ? (R.certification.count === 1 ? 'record' : 'records') : 'request') + ")"} v={money(R.certificationSubtotal)} /> : null}
                  {R.deliverySubtotal ? <Row k="Delivery" v={money(R.deliverySubtotal)} /> : null}
                  {(R.freeAllowances.freePageAllowance || R.freeAllowances.freeLaborHours) ? <Row k="Free allowances" muted v={(R.freeAllowances.freePageAllowance || 0) + ' pg / ' + (R.freeAllowances.freeLaborHours || 0) + ' hr'} /> : null}
                  {R.ceilingApplied ? <Row k="Ceiling applied" amber v="" /> : null}
                  {R.floorApplied ? <Row k="Floor applied" muted v="" /> : null}
                  {R.deMinimisWaived ? <Row k="De minimis - waived" amber v="" /> : null}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 800, color: NAVY, marginTop: '6px', paddingTop: '6px', borderTop: '2px solid ' + NAVY }}><span>TOTAL</span><span>{money(R.total)}</span></div>
                  <Row k="Deposit due" v={money(R.depositDue)} />
                  <div style={{ fontSize: '11px', color: R.estimateNotifyTriggered ? 'var(--oq-fg-92400e)' : 'var(--oq-fg-9ca3af)', marginTop: '4px' }}>{R.estimateNotifyTriggered ? 'Estimate notification to requestor required' : 'Below notification threshold'}</div>
                  <div style={{ fontSize: '10.5px', color: 'var(--oq-fg-9ca3af)', marginTop: '8px' }}>Saved to this request. Recalculating creates a new snapshot.</div>
                </div>
              </div>
            ) : <div style={{ fontSize: '12px', color: 'var(--oq-fg-9ca3af)' }}>Enter quantities and click Calculate.</div>}
          </div>
        </div>
      </div>
      {ctx.paymentPlan ? (
        <div style={{ marginTop: '18px', borderTop: '1px solid var(--oq-ln-e5e7eb)', paddingTop: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', maxWidth: '700px' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--oq-fg-111111)' }}>Payment &amp; delivery plan</div>
            <span style={{ fontSize: '10.5px', fontWeight: 700, color: ctx.paymentTimingSource === 'profile' ? 'var(--oq-fg-03543f)' : 'var(--oq-fg-92400e)', background: ctx.paymentTimingSource === 'profile' ? 'var(--oq-bg-def7ec)' : 'var(--oq-bg-fef3c7)', borderRadius: '999px', padding: '2px 9px' }}>{ctx.paymentTimingSource === 'profile' ? 'from jurisdiction config' : 'inferred from legacy config'}</span>
          </div>
          <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-374151)', lineHeight: '1.5', marginBottom: '10px', maxWidth: '700px' }}>{ctx.paymentPlan.summary}</div>
          <div style={{ display: 'flex', gap: '26px', flexWrap: 'wrap', maxWidth: '700px' }}>
            <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-374151)', lineHeight: '1.7' }}>
              <div><span style={{ color: 'var(--oq-fg-6b7280)' }}>Gate: </span>{GATE_LABELS[ctx.paymentPlan.gate] || ctx.paymentPlan.gate}</div>
              <div><span style={{ color: 'var(--oq-fg-6b7280)' }}>Delivery: </span>{DELIVERY_LABELS[ctx.paymentPlan.deliveryTrigger] || ctx.paymentPlan.deliveryTrigger}</div>
              <div><span style={{ color: 'var(--oq-fg-6b7280)' }}>First payment: </span>{ctx.paymentPlan.firstPayment && ctx.paymentPlan.firstPayment.required ? (ctx.paymentPlan.firstPayment.basisText + (ctx.paymentPlan.firstPayment.dueWindowText ? ' \u00b7 due ' + ctx.paymentPlan.firstPayment.dueWindowText : '')) : 'none required'}</div>
            </div>
            {ctx.paymentState ? (
              <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-374151)', lineHeight: '1.7', minWidth: '230px' }}>
                <div><span style={{ color: 'var(--oq-fg-6b7280)' }}>Effective total: </span>{money(ctx.paymentState.effectiveTotal)}{ctx.paymentState.reconciled ? ' (reconciled)' : ''}</div>
                <div><span style={{ color: 'var(--oq-fg-6b7280)' }}>Paid: </span>{money(ctx.paymentState.paid)} <span style={{ color: 'var(--oq-fg-9ca3af)' }}>({money(ctx.paymentState.depositPaid)} deposit + {money(ctx.paymentState.finalPaid)} final)</span></div>
                <div style={{ fontWeight: 700 }}><span style={{ color: 'var(--oq-fg-6b7280)', fontWeight: 400 }}>Balance due: </span>{ctx.paymentState.paidInFull ? <span style={{ color: 'var(--oq-fg-03543f)' }}>paid in full</span> : <span style={{ color: NAVY }}>{money(ctx.paymentState.balanceDue)}</span>}</div>
              </div>
            ) : null}
          </div>
          {renderTakePayment()}
        </div>
      ) : null}
      {renderLedger()}
      {result ? (
        <div style={{ marginTop: '18px', borderTop: '1px solid var(--oq-ln-e5e7eb)', paddingTop: '16px' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--oq-fg-111111)', marginBottom: '4px' }}>Notify requestor</div>
          <div style={{ fontSize: '12px', color: 'var(--oq-fg-6b7280)', marginBottom: '10px' }}>This is what the requestor sees - plain language, no internal worksheet detail. Review and edit if needed, then send.{noticeNotifyTriggered ? ' This estimate exceeds the notification threshold.' : ''}</div>
          {noticeNotifiedAt ? <div style={{ fontSize: '12px', color: 'var(--oq-fg-03543f)', background: 'var(--oq-bg-def7ec)', padding: '8px 10px', borderRadius: '6px', marginBottom: '10px' }}>Sent to {noticeTo} on {noticeNotifiedAt}. Sending again delivers an updated notice.</div> : null}
          <div style={{ maxWidth: '640px' }}>
            <div style={{ marginBottom: '8px' }}><label style={lbl}>To</label><input type="text" value={noticeTo} onChange={function (e) { setNoticeTo(e.target.value); }} style={inp} /></div>
            <div style={{ marginBottom: '8px' }}><label style={lbl}>Subject</label><input type="text" value={noticeSubject} onChange={function (e) { setNoticeSubject(e.target.value); }} style={inp} /></div>
            <div style={{ marginBottom: '8px' }}><label style={lbl}>Message</label><textarea value={noticeText} onChange={function (e) { setNoticeText(e.target.value); }} rows={14} style={Object.assign({}, inp, { fontFamily: 'inherit', resize: 'vertical', lineHeight: '1.5' })} /></div>
            {/* PHASE 7 / BW4 — THE SEND GATE, IN WORDS. `feeWaiverGate` comes from the same
                approvalModules.estimateCommunicationGate the send route refuses on (409 WAIVER_UNDECIDED),
                so the greyed button and the refusal are one sentence. A waiver changes the amount, and a
                requester must not receive one figure and then another. */}
            {waiverGate.blocked ? (
              <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-92400e)', background: 'var(--oq-bg-fef3c7)', border: '1px solid var(--oq-ln-fde68a)', borderRadius: '8px', padding: '9px 12px', marginBottom: '9px' }}>
                <b>Cannot send yet.</b> {waiverGate.reason}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button onClick={sendNotice} disabled={sending || !noticeTo || waiverGate.blocked} style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: (sending || !noticeTo || waiverGate.blocked) ? 'var(--oq-bg-9cb4cc)' : NAVY, color: 'var(--oq-fg-ffffff)', fontSize: '13px', fontWeight: 700, cursor: (sending || !noticeTo || waiverGate.blocked) ? 'not-allowed' : 'pointer' }}>{sending ? 'Sending...' : (noticeNotifiedAt ? 'Resend to requestor' : 'Send to requestor')}</button>
              {sendMsg ? <span style={{ fontSize: '12.5px', color: sendMsg.indexOf('Sent') === 0 ? 'var(--oq-fg-03543f)' : 'var(--oq-fg-9b1c1c)' }}>{sendMsg}</span> : null}
            </div>
          </div>
        </div>
      ) : null}
              {ctx.latest && ctx.latest.accepted_at ? (
                <div style={{ marginTop: '18px', borderTop: '1px solid var(--oq-ln-e5e7eb)', paddingTop: '16px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--oq-fg-111111)', marginBottom: '4px' }}>Reconcile actuals</div>
                  <div style={{ fontSize: '12px', color: 'var(--oq-fg-6b7280)', marginBottom: '10px' }}>After the work is done, set the quantities above to the ACTUAL amounts, then record the reconciliation. This compares actuals to the estimate, flags whether a revised notice is required, and sharpens future auto-estimates for this record type.</div>
                  {ctx.laborActuals ? (
                    <div style={{ border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '10px', padding: '12px 14px', marginBottom: '12px', background: 'var(--oq-bg-f9fafb)', maxWidth: '520px' }}>
                      <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--oq-fg-111111)', marginBottom: '8px' }}>Measured labor <span style={{ fontWeight: 400, color: 'var(--oq-fg-9ca3af)' }}>(from the work timer)</span></div>
                      {ctx.laborActuals.autoDraft ? (
                        <div style={{ fontSize: '11.5px', color: 'var(--oq-fg-1f4e79)', background: 'var(--oq-bg-eff6ff)', border: '1px solid var(--oq-ln-dbeafe)', borderRadius: '6px', padding: '6px 10px', marginBottom: '9px' }}>
                          A draft reconciliation was auto-computed from measured labor{ctx.laborActuals.autoDraft.variancePct != null ? ' (' + (ctx.laborActuals.autoDraft.variancePct >= 0 ? '+' : '') + ctx.laborActuals.autoDraft.variancePct + '% vs estimate)' : ''} and is awaiting your review{ctx.laborActuals.autoDraft.reNotifyRequired ? ' — a revised notice is required before delivery' : ''}. Confirm or adjust the quantities, then record it below.
                        </div>
                      ) : null}
                      {[['searchHours', 'Search'], ['reviewHours', 'Review/redaction'], ['programmingHours', 'Programming']].map(function (d) {
                        var est = (ctx.laborActuals.estimated || {})[d[0]] || 0;
                        var act = (ctx.laborActuals.measured || {})[d[0]] || 0;
                        if (!est && !act) return null;
                        var delta = Math.round((act - est) * 100) / 100;
                        return (
                          <div key={d[0]} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: '6px', fontSize: '12px', color: 'var(--oq-fg-374151)', padding: '2px 0' }}>
                            <span style={{ color: 'var(--oq-fg-6b7280)' }}>{d[1]}</span>
                            <span style={{ textAlign: 'right' }}>est {est} h</span>
                            <span style={{ textAlign: 'right', fontWeight: 700 }}>actual {act} h</span>
                            <span style={{ textAlign: 'right', color: delta > 0 ? 'var(--oq-fg-9b1c1c)' : (delta < 0 ? 'var(--oq-fg-03543f)' : 'var(--oq-fg-9ca3af)') }}>{delta > 0 ? '+' : ''}{delta} h</span>
                          </div>
                        );
                      })}
                      <div style={{ marginTop: '9px' }}>
                        {ctx.laborActuals.hasActuals
                          ? <button onClick={useMeasuredHours} style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid var(--oq-ln-1f4e79)', background: 'var(--oq-bg-ffffff)', color: 'var(--oq-fg-1f4e79)', fontSize: '11.5px', fontWeight: 700, cursor: 'pointer' }}>Use measured hours</button>
                          : <span style={{ fontSize: '11.5px', color: 'var(--oq-fg-9ca3af)' }}>No measured labor captured (timer off or skipped) &mdash; enter actual hours manually.</span>}
                        {ctx.laborActuals.excluded && ctx.laborActuals.excluded.length ? <span style={{ fontSize: '11px', color: 'var(--oq-fg-9ca3af)', marginLeft: '10px' }}>{ctx.laborActuals.excluded.length} task(s) not counted</span> : null}
                      </div>
                    </div>
                  ) : null}
                  <button onClick={reconcile} disabled={reconBusy} style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: reconBusy ? 'var(--oq-bg-9cb4cc)' : NAVY, color: 'var(--oq-fg-ffffff)', fontSize: '13px', fontWeight: 700, cursor: reconBusy ? 'default' : 'pointer' }}>{reconBusy ? 'Recording...' : 'Record actuals & reconcile'}</button>
                  {reconResult && reconResult.error ? <div style={{ marginTop: '10px', fontSize: '12.5px', color: 'var(--oq-fg-9b1c1c)' }}>{reconResult.error}</div> : null}
                  {reconResult && !reconResult.error ? (
                    <div style={{ marginTop: '12px', maxWidth: '520px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--oq-fg-374151)', padding: '2px 0' }}><span>Estimated</span><span>{money(reconResult.estimateTotal)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--oq-fg-374151)', padding: '2px 0' }}><span>Actual</span><span>{money(reconResult.actualTotal)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 800, color: NAVY, padding: '4px 0', borderTop: '1px solid var(--oq-ln-e5e7eb)' }}><span>Variance</span><span>{reconResult.variancePct == null ? 'n/a' : ((reconResult.variancePct >= 0 ? '+' : '') + reconResult.variancePct + '%')}</span></div>
                      {reconResult.reNotifyRequired ? (
                        <div style={{ marginTop: '8px', fontSize: '12.5px', color: 'var(--oq-fg-92400e)', background: 'var(--oq-bg-fef3c7)', border: '1px solid var(--oq-ln-fde68a)', borderRadius: '8px', padding: '9px 12px' }}>Actual cost exceeds the estimate by more than {reconResult.reNotifyThreshold}% &mdash; a revised notice to the requestor is required before delivery.</div>
                      ) : (
                        <div style={{ marginTop: '8px', fontSize: '12.5px', color: 'var(--oq-fg-03543f)', background: 'var(--oq-bg-def7ec)', border: '1px solid var(--oq-ln-bcf0da)', borderRadius: '8px', padding: '9px 12px' }}>Within the {reconResult.reNotifyThreshold}% notification threshold &mdash; no revised notice required. Actuals recorded to the estimate profile.</div>
                      )}
                    </div>
                  ) : null}
                  {renderAdjNotice()}
                </div>
              ) : null}
    </div>
  );
}
function Row(props) { return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0', color: props.amber ? 'var(--oq-fg-92400e)' : (props.muted ? 'var(--oq-fg-9ca3af)' : 'var(--oq-fg-374151)') }}><span>{props.k}</span><span>{props.v}</span></div>; }
