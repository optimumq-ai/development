import React, { useEffect, useState } from 'react';
import api from '../../lib/api';

var NAVY = '#1F4E79';
function money(n) { return '$' + (Number(n) || 0).toFixed(2); }
var PILL = {
  applied: { label: 'Applied', bg: '#DEF7EC', fg: '#03543F' },
  considered: { label: 'Considered', bg: '#F3F4F6', fg: '#6B7280' },
  none: { label: 'Not configured', bg: '#F9FAFB', fg: '#9CA3AF' }
};
function pillFor(t) { return t.applied ? PILL.applied : (t.configured ? PILL.considered : PILL.none); }
var card = { background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '18px 20px', marginBottom: '16px' };
var h = { fontSize: '14px', fontWeight: 700, color: '#111', marginBottom: '12px' };

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

export default function FinancialProfilePanel(props) {
  var requestId = props.requestId;
  var [p, setP] = useState(null);
  var [err, setErr] = useState('');
  var [loading, setLoading] = useState(true);
  useEffect(function () {
    api.get('/fee-estimates/request/' + requestId + '/financial-profile')
      .then(function (r) { setP(r.data); setLoading(false); })
      .catch(function (e) { setErr((e.response && e.response.data && e.response.data.error) || 'Could not load the financial profile.'); setLoading(false); });
  }, [requestId]);

  if (loading) return <div style={{ padding: '20px', color: '#9CA3AF' }}>Loading financial profile\u2026</div>;
  if (err) return <div style={{ padding: '16px', color: '#9B1C1C', background: '#FDE8E8', borderRadius: '8px' }}>{err}</div>;
  if (!p) return null;

  var est = p.estimate, R = est && est.computation && est.computation.requestLevel;
  var ps = p.paymentState;
  var waived = !!(p.feeWaiver && p.feeWaiver.status === 'granted');
  var cm = p.computationMethod || { code: 'standard', label: 'Standard' };
  var mColor = cm.code === 'fee_waiver' ? { bg: '#DEF7EC', fg: '#03543F' } : (cm.code === 'standard' ? { bg: '#F3F4F6', fg: '#6B7280' } : { bg: '#FEF3C7', fg: '#92400E' });

  return (
    <div style={{ maxWidth: '820px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <div style={{ fontSize: '12px', color: '#6B7280' }}>Payment status</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: NAVY }}>{p.paymentStatus.label}</div>
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
              <span style={{ fontSize: '15px', fontWeight: 800, color: '#111' }}>Estimated total</span>
              <span style={{ fontSize: '20px', fontWeight: 800, color: NAVY }}>{money(est.total)}</span>
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

          <div style={card}>
            <div style={h}>Balance</div>
            {(p.objectionCredits || []).length ? (
              <div style={{ marginBottom: '10px' }}>
                {p.objectionCredits.map(function (c) { return <div key={c.id} style={{ fontSize: '12.5px', color: '#03543F', display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Adjustment &mdash; {String(c.resolution_type).replace('_', ' ')}{c.resolution_detail ? (' (' + c.resolution_detail + ')') : ''}</span><span>&minus;{money(c.resolution_amount)}</span></div>; })}
              </div>
            ) : null}
            {ps ? (
              <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}><tbody>
                <tr><td style={{ padding: '4px 0', color: '#6B7280' }}>Effective total{ps.adjustments ? (' (after ' + money(ps.adjustments) + ' adjustments)') : ''}</td><td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600 }}>{money(ps.effectiveTotal)}</td></tr>
                <tr><td style={{ padding: '4px 0', color: '#6B7280' }}>Deposit paid</td><td style={{ padding: '4px 0', textAlign: 'right' }}>{money(ps.depositPaid)}</td></tr>
                <tr><td style={{ padding: '4px 0', color: '#6B7280' }}>Final paid</td><td style={{ padding: '4px 0', textAlign: 'right' }}>{money(ps.finalPaid)}</td></tr>
                {waived
                  ? <tr><td style={{ padding: '6px 0 0', fontWeight: 700, borderTop: '1px solid #F3F4F6' }}>Payable (fees waived)</td><td style={{ padding: '6px 0 0', textAlign: 'right', fontWeight: 800, color: '#03543F', borderTop: '1px solid #F3F4F6' }}>{money(0)}</td></tr>
                  : <tr><td style={{ padding: '6px 0 0', fontWeight: 700, borderTop: '1px solid #F3F4F6' }}>{ps.paidInFull ? 'Paid in full' : 'Balance due'}</td><td style={{ padding: '6px 0 0', textAlign: 'right', fontWeight: 800, color: ps.paidInFull ? '#03543F' : NAVY, borderTop: '1px solid #F3F4F6' }}>{ps.paidInFull ? money(ps.paid) : money(ps.balanceDue)}</td></tr>}
              </tbody></table>
            ) : null}
          </div>

          {((p.ledger || []).length || (p.erpCharges || []).length) ? (
            <div style={card}>
              <div style={h}>Payment activity</div>
              {(p.ledger || []).map(function (l) { return <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', padding: '3px 0', color: '#374151' }}><span>{(l.created_at || '').slice(0, 10)} &middot; {l.target} &middot; {l.method}{l.reference ? (' &middot; ' + l.reference) : ''}</span><span style={{ fontWeight: 600 }}>{money(l.amount)}</span></div>; })}
              {(p.erpCharges || []).map(function (c) { return <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', padding: '3px 0', color: '#374151' }}><span>ERP charge {c.erp_charge_id} &middot; {c.target}</span><span>{money(c.paid_amount)} / {money(c.amount)} &middot; {c.status}</span></div>; })}
            </div>
          ) : null}
        </div>
      )}
      <div style={{ fontSize: '11px', color: '#9CA3AF', textAlign: 'right' }}>Generated {(p.generatedAt || '').slice(0, 19).replace('T', ' ')}</div>
    </div>
  );
}
