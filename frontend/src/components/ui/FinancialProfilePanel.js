import React, { useEffect, useState } from 'react';
import api from '../../lib/api';

var NAVY = '#1F4E79';
function money(n) { var v = Number(n) || 0; return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2); }
function dstr(s) { return (s || '').slice(0, 10); }
var PILL = {
  applied: { label: 'Applied', bg: '#DEF7EC', fg: '#03543F' },
  considered: { label: 'Considered', bg: '#F3F4F6', fg: '#6B7280' },
  none: { label: 'Not configured', bg: '#F9FAFB', fg: '#9CA3AF' }
};
function pillFor(t) { return t.applied ? PILL.applied : (t.configured ? PILL.considered : PILL.none); }
var card = { background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '18px 20px', marginBottom: '16px' };
var h = { fontSize: '14px', fontWeight: 700, color: '#111', marginBottom: '12px' };
var lbl = { display: 'block', fontSize: '11px', color: '#6B7280', marginBottom: '3px', fontWeight: 600 };
var inp = { width: '100%', padding: '7px 9px', border: '1px solid #D1D5DB', borderRadius: '7px', fontSize: '13px', boxSizing: 'border-box' };

function lineRows(RL) {
  var rows = [];
  (RL.labor || []).forEach(function (i) { rows.push(i); });
  (RL.duplication || []).forEach(function (i) { rows.push(i); });
  (RL.media || []).forEach(function (i) { rows.push(i); });
  (RL.av || []).forEach(function (i) { rows.push(i); });
  if (RL.delivery) rows.push(RL.delivery);
  if (RL.certification) rows.push(RL.certification);
  if (RL.other) rows.push(RL.other);
  return rows;
}

var EVENT_LABEL = {
  estimate_issued: 'Estimate issued', estimate_accepted: 'Estimate accepted', payment: 'Payment received',
  credit: 'Credit applied', refund: 'Refund issued', reconciliation: 'Reconciled to actuals',
  notice_sent: 'Notice sent', released: 'Records released', closed: 'Closed', withdrawn: 'Withdrawn'
};

export default function FinancialProfilePanel(props) {
  var requestId = props.requestId;
  var [p, setP] = useState(null);
  var [err, setErr] = useState('');
  var [loading, setLoading] = useState(true);
  var [showAdj, setShowAdj] = useState(false);
  var [adjType, setAdjType] = useState('credit');
  var [adjAmount, setAdjAmount] = useState('');
  var [adjReason, setAdjReason] = useState('');
  var [adjBusy, setAdjBusy] = useState(false);
  var [adjMsg, setAdjMsg] = useState('');

  function load() {
    api.get('/fee-estimates/request/' + requestId + '/financial-profile')
      .then(function (r) { setP(r.data); setLoading(false); })
      .catch(function (e) { setErr((e.response && e.response.data && e.response.data.error) || 'Could not load the financial profile.'); setLoading(false); });
  }
  useEffect(function () { load(); }, [requestId]);

  async function submitAdj() {
    if (!(Number(adjAmount) > 0)) { setAdjMsg('Enter an amount greater than zero.'); return; }
    if (!adjReason.trim()) { setAdjMsg('Enter a reason.'); return; }
    setAdjBusy(true); setAdjMsg('');
    try {
      await api.post('/fee-estimates/request/' + requestId + '/adjustment', { type: adjType, amount: Number(adjAmount), reason: adjReason.trim() });
      setAdjAmount(''); setAdjReason(''); setShowAdj(false); setAdjMsg('');
      load();
    } catch (e) { setAdjMsg((e.response && e.response.data && e.response.data.error) || 'Could not record the adjustment.'); }
    setAdjBusy(false);
  }

  if (loading) return <div style={{ padding: '20px', color: '#9CA3AF' }}>Loading financial profile\u2026</div>;
  if (err) return <div style={{ padding: '16px', color: '#9B1C1C', background: '#FDE8E8', borderRadius: '8px' }}>{err}</div>;
  if (!p) return null;

  var est = p.estimate, R = est && est.computation && est.computation.requestLevel;
  var ps = p.paymentState;
  var waived = !!(p.feeWaiver && p.feeWaiver.status === 'granted');
  var cm = p.computationMethod || { code: 'standard', label: 'Standard' };
  var mColor = cm.code === 'fee_waiver' ? { bg: '#DEF7EC', fg: '#03543F' } : (cm.code === 'standard' ? { bg: '#F3F4F6', fg: '#6B7280' } : { bg: '#FEF3C7', fg: '#92400E' });

  // reconciling ledger lines
  var base = p.actual ? p.actual.total : (est ? est.total : 0);
  var creditLines = (p.objectionCredits || []).map(function (c) { return { date: c.resolved_at, label: 'Credit \u2014 objection ' + String(c.resolution_type).replace('_', ' '), sub: c.resolution_detail, amount: -(Number(c.resolution_amount) || 0) }; })
    .concat((p.adjustments || []).filter(function (a) { return a.type === 'credit'; }).map(function (a) { return { date: a.created_at, label: 'Credit \u2014 ' + a.reason, amount: -(Number(a.amount) || 0) }; }));
  var paymentLines = (p.ledger || []).map(function (l) { return { date: l.created_at, label: 'Payment \u2014 ' + l.target + (l.method ? ' (' + l.method + ')' : ''), sub: l.reference, amount: -(Number(l.amount) || 0) }; });
  var refundLines = (p.adjustments || []).filter(function (a) { return a.type === 'refund'; }).map(function (a) { return { date: a.created_at, label: 'Refund \u2014 ' + a.reason, amount: (Number(a.amount) || 0) }; });

  function ledgerRow(x, i) {
    return (
      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0', fontSize: '12.5px' }}>
        <span style={{ color: '#374151' }}>{x.date ? <span style={{ color: '#9CA3AF' }}>{dstr(x.date)}&nbsp;&middot;&nbsp;</span> : null}{x.label}{x.sub ? <span style={{ color: '#9CA3AF' }}> ({x.sub})</span> : null}</span>
        <span style={{ fontWeight: 600, color: x.amount < 0 ? '#03543F' : '#9B1C1C', whiteSpace: 'nowrap' }}>{money(x.amount)}</span>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '820px' }}>
      {/* status header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <div style={{ fontSize: '12px', color: '#6B7280' }}>Payment status</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: NAVY }}>{p.paymentStatus.label}{p.paymentStatus.reason ? <span style={{ fontSize: '13px', fontWeight: 500, color: '#6B7280' }}> &middot; {p.paymentStatus.reason}</span> : null}</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, padding: '4px 12px', borderRadius: '20px', background: mColor.bg, color: mColor.fg }}>Method: {cm.label}</span>
          <span style={{ fontSize: '11px', fontWeight: 700, padding: '4px 12px', borderRadius: '20px', background: p.paymentMode === 'erp' ? '#EDE9FE' : '#E0F2FE', color: p.paymentMode === 'erp' ? '#5B21B6' : '#075985' }}>{p.paymentMode === 'erp' ? 'External / ERP payments' : 'Self-contained payments'}</span>
        </div>
      </div>

      {waived ? (
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '12px', padding: '14px 18px', marginBottom: '16px' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#166534', marginBottom: '2px' }}>Fees waived for this request</div>
          <div style={{ fontSize: '12.5px', color: '#374151' }}>The computed cost below is shown for the record; the requestor owes $0.00.{p.feeWaiver.decidedBy ? (' Granted by ' + p.feeWaiver.decidedBy + '.') : ''}</div>
        </div>
      ) : null}

      {!est ? <div style={card}>No estimate has been created for this request yet.</div> : (
        <div>
          {/* reconciling ledger - balance never moves without a dated, reasoned line */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={h}>Balance</div>
              {!waived ? <button onClick={function () { setShowAdj(!showAdj); setAdjMsg(''); }} style={{ padding: '5px 12px', borderRadius: '7px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>{showAdj ? 'Cancel' : 'Record adjustment'}</button> : null}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '13px' }}><span style={{ color: '#374151', fontWeight: 600 }}>{p.actual ? 'Actual total' : 'Estimated total'}</span><span style={{ fontWeight: 700 }}>{money(base)}</span></div>
            {creditLines.map(ledgerRow)}
            {creditLines.length ? <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '12.5px', borderTop: '1px dashed #E5E7EB', color: '#6B7280' }}><span>Effective total</span><span style={{ fontWeight: 600 }}>{money(ps.effectiveTotal)}</span></div> : null}
            {paymentLines.map(ledgerRow)}
            {refundLines.map(ledgerRow)}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', paddingTop: '8px', borderTop: '2px solid #EEF2F7' }}>
              <span style={{ fontWeight: 800, color: '#111' }}>{waived ? 'Payable (fees waived)' : (ps.paidInFull ? 'Paid in full' : 'Balance due')}</span>
              <span style={{ fontSize: '18px', fontWeight: 800, color: (waived || ps.paidInFull) ? '#03543F' : NAVY }}>{waived ? money(0) : (ps.paidInFull ? money(0) : money(ps.balanceDue))}</span>
            </div>

            {showAdj ? (
              <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px dashed #E5E7EB' }}>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ width: '130px' }}><label style={lbl}>Type</label>
                    <select value={adjType} onChange={function (e) { setAdjType(e.target.value); }} style={inp}>
                      <option value="credit">Credit (reduce)</option>
                      <option value="refund">Refund (cash back)</option>
                    </select>
                  </div>
                  <div style={{ width: '120px' }}><label style={lbl}>Amount</label><input type="number" step="any" value={adjAmount} onChange={function (e) { setAdjAmount(e.target.value); }} style={inp} /></div>
                  <div style={{ flex: 1, minWidth: '180px' }}><label style={lbl}>Reason</label><input type="text" value={adjReason} onChange={function (e) { setAdjReason(e.target.value); }} placeholder="e.g. objection settlement" style={inp} /></div>
                  <button onClick={submitAdj} disabled={adjBusy} style={{ padding: '8px 16px', borderRadius: '7px', border: 'none', background: adjBusy ? '#9CB4CC' : NAVY, color: 'white', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>{adjBusy ? 'Saving\u2026' : 'Apply'}</button>
                </div>
                <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '6px' }}>A credit reduces the receivable (recomputes the plan and gates); a refund returns cash on an overpayment. For an estimate that was wrong, correct the estimate instead.</div>
                {adjMsg ? <div style={{ fontSize: '12px', color: '#9B1C1C', marginTop: '5px' }}>{adjMsg}</div> : null}
              </div>
            ) : null}
          </div>

          {/* computation receipt */}
          <div style={card}>
            <div style={h}>Fee computation</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <tbody>
                {lineRows(R).map(function (it, i) {
                  return (
                    <tr key={i}>
                      <td style={{ padding: '5px 0', color: '#374151' }}>{it.description}{it.quantity ? (' \u00b7 ' + it.quantity + (it.unit ? ' ' + it.unit + (it.quantity === 1 ? '' : 's') : '') + (typeof it.rate === 'number' ? ' @ ' + money(it.rate) : '')) : ''}</td>
                      <td style={{ padding: '5px 0', textAlign: 'right', color: '#111', fontWeight: 600, whiteSpace: 'nowrap' }}>{money(it.amount)}</td>
                    </tr>
                  );
                })}
                {R.laborOverhead > 0 ? <tr><td style={{ padding: '5px 0', color: '#374151' }}>Labor overhead ({R.laborOverheadPct}%)</td><td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 600 }}>{money(R.laborOverhead)}</td></tr> : null}
                {R.surcharge > 0 ? <tr><td style={{ padding: '5px 0', color: '#374151' }}>Surcharge ({R.surchargePct}%)</td><td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 600 }}>{money(R.surcharge)}</td></tr> : null}
                <tr><td style={{ padding: '8px 0 5px', color: '#6B7280', borderTop: '1px solid #F3F4F6' }}>Subtotal</td><td style={{ padding: '8px 0 5px', textAlign: 'right', fontWeight: 700, borderTop: '1px solid #F3F4F6' }}>{money(R.surchargedSubtotal)}</td></tr>
              </tbody>
            </table>
            <div style={{ marginTop: '14px', borderTop: '1px dashed #E5E7EB', paddingTop: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '8px' }}>How the total was determined</div>
              {(R.rulesTrace || []).map(function (t, i) {
                var pill = pillFor(t);
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '5px 0' }}>
                    <span style={{ flexShrink: 0, fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: pill.bg, color: pill.fg, minWidth: '92px', textAlign: 'center' }}>{pill.label}</span>
                    <span style={{ fontSize: '12.5px', color: t.applied ? '#111' : '#6B7280' }}>{t.plainLine}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px', paddingTop: '12px', borderTop: '2px solid #EEF2F7' }}>
              <span style={{ fontSize: '15px', fontWeight: 800, color: '#111' }}>{p.actual ? 'Actual total' : 'Estimated total'}</span>
              <span style={{ fontSize: '20px', fontWeight: 800, color: NAVY }}>{money(base)}</span>
            </div>
          </div>

          {p.actual ? (
            <div style={card}>
              <div style={h}>Estimate &rarr; actual adjustment</div>
              <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap' }}>
                <div><div style={{ fontSize: '12px', color: '#6B7280' }}>Estimated</div><div style={{ fontSize: '17px', fontWeight: 700 }}>{money(est.total)}</div></div>
                <div><div style={{ fontSize: '12px', color: '#6B7280' }}>Actual</div><div style={{ fontSize: '17px', fontWeight: 700 }}>{money(p.actual.total)}</div></div>
                <div><div style={{ fontSize: '12px', color: '#6B7280' }}>Adjustment</div><div style={{ fontSize: '17px', fontWeight: 800, color: p.actual.delta > 0 ? '#9B1C1C' : (p.actual.delta < 0 ? '#03543F' : '#374151') }}>{(p.actual.delta > 0 ? '+' : '') + money(p.actual.delta)}</div></div>
              </div>
            </div>
          ) : null}

          {/* payment-status timeline (the film) */}
          {(p.paymentTimeline || []).length ? (
            <div style={card}>
              <div style={h}>Payment timeline</div>
              {(p.paymentTimeline || []).map(function (e, i) {
                return (
                  <div key={e.id || i} style={{ display: 'flex', gap: '12px', padding: '6px 0', borderTop: i ? '1px solid #F7F8FA' : 'none' }}>
                    <span style={{ fontSize: '11.5px', color: '#9CA3AF', width: '84px', flexShrink: 0, paddingTop: '1px' }}>{(e.created_at || '').slice(0, 16).replace('T', ' ')}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', color: '#111' }}>{EVENT_LABEL[e.type] || e.type}{e.amount != null ? <span style={{ fontWeight: 700 }}> &middot; {money(e.amount)}</span> : null}{e.reason ? <span style={{ color: '#9CA3AF' }}> &middot; {e.reason}</span> : null}</div>
                      <div style={{ fontSize: '11.5px', color: NAVY, fontWeight: 600 }}>&rarr; {e.status_label}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      )}
      <div style={{ fontSize: '11px', color: '#9CA3AF', textAlign: 'right' }}>Generated {(p.generatedAt || '').slice(0, 19).replace('T', ' ')}</div>
    </div>
  );
}
