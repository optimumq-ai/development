import React, { useState } from 'react';
import api from '../lib/api';

const PRESETS = [
  { label: 'Small request', q: { bwPages: 10 } },
  { label: 'Large (triggers deposit)', q: { bwPages: 3000, searchHours: 20 } },
  { label: 'With extra cost', q: { bwPages: 200, searchHours: 3 }, other: { amount: 25, description: 'Certified mail' } },
  { label: 'Fee waived', q: { bwPages: 3000, searchHours: 20 }, waived: true },
  { label: 'Over-payment (70%)', q: { bwPages: 3000, searchHours: 20 }, payment: 420 },
];

const QFIELDS = [
  ['bwPages', 'B&W pages'], ['colorPages', 'Color pages'], ['oversizedPages', 'Oversized pages'],
  ['searchHours', 'Search hrs'], ['reviewHours', 'Review hrs'], ['programmingHours', 'Programming hrs'],
];

function money(n) { return '$' + (Number(n) || 0).toFixed(2); }
const inp = { width: '100%', padding: '6px 8px', border: '1px solid #E5E7EB', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' };
const lbl = { fontSize: '11px', color: '#6B7280', marginBottom: '3px', display: 'block' };
const GATE_LABELS = {
  invoice_on_completion: 'Invoice on completion',
  estimate_acceptance: 'Estimate acceptance (no money up front)',
  deposit_before_work: 'Deposit before work begins',
  pay_in_full_before_release: 'Pay in full before release',
};
const DELIVERY_LABELS = {
  invoice_on_completion: 'Records released, then invoiced',
  estimate_acceptance: 'Released after estimate accepted and work done',
  deposit_before_work: 'Work gated on deposit; final release per policy',
  pay_in_full_before_release: 'Released only after fee paid in full',
};


export default function FeeSandboxPanel({ onTested }) {
  const [q, setQ] = useState({});
  const [other, setOther] = useState({ amount: '', description: '' });
  const [waived, setWaived] = useState(false);
  const [payment, setPayment] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [issueNote, setIssueNote] = useState('');
  const [showIssue, setShowIssue] = useState(false);

  function applyPreset(p) {
    setQ(p.q || {});
    setOther(p.other || { amount: '', description: '' });
    setWaived(!!p.waived);
    setPayment(p.payment != null ? String(p.payment) : '');
    setResult(null); setErr('');
  }

  async function runTest() {
    setBusy(true); setErr(''); setResult(null);
    try {
      const body = {
        quantities: q,
        other: (Number(other.amount) ? { amount: Number(other.amount), description: other.description || 'Extra cost' } : null),
        waived: waived,
        payment: Number(payment) || 0,
      };
      const r = await api.post('/fee-sandbox/preview', body);
      setResult(r.data);
    } catch (e) {
      setErr((e.response && e.response.data && e.response.data.error) || 'Could not run the test.');
    }
    setBusy(false);
  }

  async function record(outcome) {
    setBusy(true);
    try {
      await api.post('/onboarding/fees/test-result', { outcome: outcome, notes: outcome === 'issues' ? issueNote : null });
      if (onTested) onTested();
    } catch (e) { setErr((e.response && e.response.data && e.response.data.error) || 'Failed to record outcome.'); }
    setBusy(false);
  }

  return (
    <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '14px 16px', marginBottom: '10px' }}>
      <div style={{ fontSize: '13px', fontWeight: '700', color: '#111', marginBottom: '4px' }}>Fee &amp; estimate test sandbox</div>
      <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '10px' }}>Runs your live fee configuration on hypothetical inputs. Nothing is saved. Try the presets or enter your own, then confirm the behavior is correct.</div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {PRESETS.map(function (p) { return <button key={p.label} onClick={function () { applyPreset(p); }} style={{ padding: '5px 10px', background: 'white', border: '1px solid #C7D9EB', color: '#1F4E79', borderRadius: '999px', fontSize: '12px', cursor: 'pointer', fontWeight: '500' }}>{p.label}</button>; })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '8px', marginBottom: '10px' }}>
        {QFIELDS.map(function (f) {
          return <div key={f[0]}><label style={lbl}>{f[1]}</label><input type="number" min="0" value={q[f[0]] != null ? q[f[0]] : ''} onChange={function (e) { const v = e.target.value; setQ(function (prev) { const n = Object.assign({}, prev); if (v === '') delete n[f[0]]; else n[f[0]] = Number(v); return n; }); }} style={inp} /></div>;
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.8fr', gap: '8px', marginBottom: '10px' }}>
        <div><label style={lbl}>Extra cost label</label><input type="text" value={other.description} onChange={function (e) { setOther(Object.assign({}, other, { description: e.target.value })); }} style={inp} placeholder="e.g. certified mail" /></div>
        <div><label style={lbl}>Extra cost $</label><input type="number" min="0" step="0.01" value={other.amount} onChange={function (e) { setOther(Object.assign({}, other, { amount: e.target.value })); }} style={inp} /></div>
        <div><label style={lbl}>First payment $</label><input type="number" min="0" step="0.01" value={payment} onChange={function (e) { setPayment(e.target.value); }} style={inp} /></div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#374151', marginBottom: '12px', cursor: 'pointer' }}>
        <input type="checkbox" checked={waived} onChange={function (e) { setWaived(e.target.checked); }} /> Fee waived
      </label>

      <button onClick={runTest} disabled={busy} style={{ padding: '8px 18px', background: '#1F4E79', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>{busy ? 'Running...' : 'Run test'}</button>

      {err ? <div style={{ marginTop: '10px', fontSize: '12px', color: '#B91C1C', background: '#FEE2E2', borderRadius: '6px', padding: '8px 10px' }}>{err}</div> : null}

      {result ? (
        <div style={{ marginTop: '12px', background: 'white', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '12px 14px' }}>
          <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
            <tbody>
              <tr><td style={{ color: '#6B7280', padding: '3px 0' }}>Computed total</td><td style={{ textAlign: 'right', fontWeight: '600' }}>{money(result.computedTotal)}</td></tr>
              {result.flags && result.flags.floorApplied ? <tr><td style={{ color: '#92400E', padding: '3px 0' }}>Minimum fee applied (floor)</td><td style={{ textAlign: 'right', color: '#92400E' }}>yes</td></tr> : null}
              {result.flags && result.flags.ceilingApplied ? <tr><td style={{ color: '#92400E', padding: '3px 0' }}>Maximum fee applied (ceiling)</td><td style={{ textAlign: 'right', color: '#92400E' }}>yes</td></tr> : null}
              {result.flags && result.flags.deMinimisWaived ? <tr><td style={{ color: '#065F46', padding: '3px 0' }}>Waived as de minimis</td><td style={{ textAlign: 'right', color: '#065F46' }}>yes</td></tr> : null}
              {result.waived ? <tr><td style={{ color: '#065F46', padding: '3px 0' }}>Fee waived</td><td style={{ textAlign: 'right', color: '#065F46', fontWeight: '600' }}>effective {money(result.effectiveTotal)}</td></tr> : null}
              {result.deposit && result.deposit.required > 0 ? <tr><td style={{ color: '#6B7280', padding: '3px 0' }}>Deposit required{result.deposit.basis ? ' — ' + result.deposit.basis : ''}</td><td style={{ textAlign: 'right', fontWeight: '600' }}>{money(result.deposit.required)}</td></tr> : null}
              {Number(result.payment && result.payment.entered) > 0 ? <tr><td style={{ color: '#6B7280', padding: '3px 0' }}>First payment {result.deposit && result.deposit.satisfiedByPayment ? '(deposit satisfied)' : '(below deposit)'}</td><td style={{ textAlign: 'right' }}>{money(result.payment.entered)}</td></tr> : null}
              <tr style={{ borderTop: '1px solid #E5E7EB' }}><td style={{ padding: '6px 0 0', fontWeight: '700' }}>Balance due</td><td style={{ textAlign: 'right', padding: '6px 0 0', fontWeight: '700', color: '#1F4E79' }}>{money(result.payment ? result.payment.balanceDue : result.effectiveTotal)}</td></tr>
            </tbody>
          </table>

          {result.paymentPlan ? (
            <div style={{ marginTop: '14px', borderTop: '1px solid #F0F0F0', paddingTop: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#111' }}>Payment &amp; delivery plan</div>
                <span style={{ fontSize: '10px', fontWeight: '600', color: result.paymentTimingSource === 'profile' ? '#065F46' : '#92400E', background: result.paymentTimingSource === 'profile' ? '#D1FAE5' : '#FEF3C7', borderRadius: '999px', padding: '2px 8px' }}>{result.paymentTimingSource === 'profile' ? 'from jurisdiction config' : 'inferred from legacy config'}</span>
              </div>
              <div style={{ fontSize: '12px', color: '#374151', lineHeight: '1.5', marginBottom: '8px' }}>{result.paymentPlan.summary}</div>
              <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr><td style={{ color: '#6B7280', padding: '3px 0', width: '42%' }}>Estimate required</td><td style={{ textAlign: 'right' }}>{result.paymentPlan.estimateRequired ? 'yes' : 'no'}</td></tr>
                  <tr><td style={{ color: '#6B7280', padding: '3px 0' }}>Gate</td><td style={{ textAlign: 'right' }}>{GATE_LABELS[result.paymentPlan.gate] || result.paymentPlan.gate}</td></tr>
                  <tr><td style={{ color: '#6B7280', padding: '3px 0' }}>First payment</td><td style={{ textAlign: 'right' }}>{result.paymentPlan.firstPayment && result.paymentPlan.firstPayment.required ? (result.paymentPlan.firstPayment.basisText || 'required') : 'none required'}</td></tr>
                  {result.paymentPlan.firstPayment && result.paymentPlan.firstPayment.required && result.paymentPlan.firstPayment.dueWindowText ? <tr><td style={{ color: '#6B7280', padding: '3px 0' }}>Payment due</td><td style={{ textAlign: 'right' }}>{result.paymentPlan.firstPayment.dueWindowText}</td></tr> : null}
                  <tr><td style={{ color: '#6B7280', padding: '3px 0' }}>Delivery trigger</td><td style={{ textAlign: 'right' }}>{DELIVERY_LABELS[result.paymentPlan.deliveryTrigger] || result.paymentPlan.deliveryTrigger}</td></tr>
                  <tr><td style={{ color: '#6B7280', padding: '3px 0' }}>Second payment</td><td style={{ textAlign: 'right' }}>{result.paymentPlan.secondPayment && result.paymentPlan.secondPayment.terms ? ('final actual — ' + String(result.paymentPlan.secondPayment.terms).replace(/_/g, ' ')) : 'final actual'}</td></tr>
                </tbody>
              </table>
              {result.paymentPlan.notes && result.paymentPlan.notes.length ? <ul style={{ margin: '8px 0 0', paddingLeft: '16px', fontSize: '11px', color: '#92400E' }}>{result.paymentPlan.notes.map(function (n, i) { return <li key={i}>{n}</li>; })}</ul> : null}
            </div>
          ) : null}
          {result.requestorNotice ? (
            <div style={{ marginTop: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#111', marginBottom: '6px' }}>Requestor sees</div>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '11px', color: '#374151', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '10px 12px', margin: 0 }}>{result.requestorNotice.text}</pre>
            </div>
          ) : null}
          <div style={{ marginTop: '14px', borderTop: '1px solid #F0F0F0', paddingTop: '12px' }}>
            <div style={{ fontSize: '12px', color: '#374151', marginBottom: '8px' }}>Does this behave correctly?</div>
            {!showIssue ? (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={function () { record('confirmed'); }} disabled={busy} style={{ padding: '8px 16px', background: '#065F46', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Confirmed — behaves correctly</button>
                <button onClick={function () { setShowIssue(true); }} disabled={busy} style={{ padding: '8px 16px', background: 'white', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Issues found</button>
              </div>
            ) : (
              <div>
                <textarea value={issueNote} onChange={function (e) { setIssueNote(e.target.value); }} placeholder="Describe what was wrong (this note is recorded and the phase returns to editing)." style={{ width: '100%', minHeight: '54px', padding: '8px', border: '1px solid #E5E7EB', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button onClick={function () { record('issues'); }} disabled={busy || !issueNote.trim()} style={{ padding: '8px 16px', background: '#B91C1C', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: issueNote.trim() ? 'pointer' : 'not-allowed' }}>Record issue &amp; return to editing</button>
                  <button onClick={function () { setShowIssue(false); }} style={{ padding: '8px 16px', background: 'white', color: '#6B7280', border: '1px solid #E5E7EB', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
