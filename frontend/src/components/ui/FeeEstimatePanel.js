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

  useEffect(function () { load(); }, [requestId]);
  async function load() {
    try {
      var r = await api.get('/fee-estimates/request/' + requestId);
      setCtx(r.data);
      var init = {};
      var li = r.data.latest && r.data.latest.input && r.data.latest.input.components;
      (r.data.components || []).forEach(function (c) {
        var prev = li && li.filter(function (x) { return x.id === c.id; })[0];
        var pq = (prev && prev.quantities) || {};
        var m = (pq.media && pq.media[0]) || {};
        init[c.id] = { searchHours: pq.searchHours || 0, reviewHours: pq.reviewHours || 0, bwPages: pq.bwPages || 0, colorPages: pq.colorPages || 0, oversizedPages: pq.oversizedPages || 0, mediaType: m.type || 'cd', mediaCount: m.count || 0 };
      });
      setQty(init);
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

  if (!ctx) return <div style={{ color: '#9CA3AF', fontSize: '13px' }}>{err || 'Loading...'}</div>;
  if (!ctx.configProfile) return <div style={{ fontSize: '13px', color: '#92400E', background: '#FEF3C7', padding: '14px', borderRadius: '8px' }}>No fee configuration exists for the active jurisdiction yet. Set one up under <strong>Fee Configuration</strong> in the sidebar, then return here.</div>;

  var R = result && result.requestLevel;
  return (
    <div>
      <div style={{ fontSize: '12.5px', color: '#6B7280', marginBottom: '14px' }}>Priced against <strong>{ctx.configProfile.name}</strong>{ctx.configProfile.status !== 'active' ? ' (' + ctx.configProfile.status + ')' : ''}. Enter the quantities for each component; the engine itemizes the estimate and saves it to the request.</div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '320px' }}>
          {(ctx.components || []).map(function (c) {
            var q = qty[c.id] || {};
            return (
              <div key={c.id} style={{ border: '1px solid #E5E7EB', borderRadius: '10px', padding: '14px', marginBottom: '12px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#111', marginBottom: '10px' }}>{c.label}{c.recordTypeName ? <span style={{ fontWeight: 400, color: '#9CA3AF' }}> &middot; {c.recordTypeName}</span> : null}</div>
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
    </div>
  );
}
function Row(props) { return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0', color: props.amber ? '#92400E' : (props.muted ? '#9CA3AF' : '#374151') }}><span>{props.k}</span><span>{props.v}</span></div>; }
