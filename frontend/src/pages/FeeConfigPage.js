import React, { useEffect, useState, useCallback } from 'react';
import api from '../lib/api';

var NAVY = '#1F4E79';
var DEFAULT_CONFIG = {
  context: 'FR', version: 1,
  labor: { search: { rate: 0, increment: 0, rounding: 'up' }, review: { rate: 0, increment: 0, rounding: 'up' }, programming: { rate: 0, increment: 0, rounding: 'up' } },
  duplication: { bw: { rate: 0 }, color: { rate: 0 }, oversized: { rate: 0 }, specialty: { rate: 'actual' } },
  media: { cd: 1, dvd: 3, usb: 'actual' },
  delivery: { email: 0, pickup: 0, mail: 'actual', handling: 0 },
  certification: { rate: 0, unit: 'per_record' },
  requestRules: { freePageAllowance: 0, freeLaborHours: 0, deMinimis: 0, minFee: 0, maxFee: null, deposit: { threshold: null, percent: null }, estimateNotifyThreshold: null }
};
function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
function mergeDefaults(def, loaded) {
  if (!isObj(def)) return (loaded === undefined ? def : loaded);
  var out = {}; var k;
  for (k in def) { if (def.hasOwnProperty(k)) out[k] = mergeDefaults(def[k], loaded ? loaded[k] : undefined); }
  if (isObj(loaded)) { for (k in loaded) { if (loaded.hasOwnProperty(k) && !(k in out)) out[k] = loaded[k]; } }
  return out;
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function money(n) { return '$' + (Number(n) || 0).toFixed(2); }

var lbl = { fontSize: '11px', fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: '3px' };
var inp = { width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #E5E7EB', fontSize: '13px', boxSizing: 'border-box' };
var card = { background: 'white', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '14px 16px', marginBottom: '14px' };
var sectionTitle = { fontSize: '13px', fontWeight: 700, color: '#111', marginBottom: '10px' };

function Num(props) {
  return <input type="number" step={props.step || 'any'} value={props.value == null ? '' : props.value}
    onChange={function (e) { props.onChange(e.target.value === '' ? null : parseFloat(e.target.value)); }} style={inp} placeholder={props.placeholder || ''} />;
}
function RateField(props) {
  var actual = props.value === 'actual';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <input type="number" step="any" disabled={actual} value={actual || props.value == null ? '' : props.value}
        onChange={function (e) { props.onChange(e.target.value === '' ? 0 : parseFloat(e.target.value)); }}
        style={Object.assign({}, inp, { background: actual ? '#F3F4F6' : 'white' })} placeholder={actual ? 'actual cost' : '0.00'} />
      <label style={{ fontSize: '11px', color: '#6B7280', display: 'flex', alignItems: 'center', gap: '3px', whiteSpace: 'nowrap' }}>
        <input type="checkbox" checked={actual} onChange={function (e) { props.onChange(e.target.checked ? 'actual' : 0); }} /> actual
      </label>
    </div>
  );
}

export default function FeeConfigPage() {
  var [profiles, setProfiles] = useState([]);
  var [selectedId, setSelectedId] = useState('');
  var [config, setConfig] = useState(null);
  var [profileMeta, setProfileMeta] = useState(null);
  var [preview, setPreview] = useState(null);
  var [saving, setSaving] = useState(false);
  var [msg, setMsg] = useState('');
  var [sample, setSample] = useState({ searchHours: 1, reviewHours: 0, bwPages: 50, colorPages: 0, oversizedPages: 0, mediaType: 'cd', mediaCount: 0, delivery: 'email', components: 1 });

  useEffect(function () { loadList(); }, []);
  async function loadList() {
    try { var r = await api.get('/fee-profiles'); setProfiles(r.data.profiles || []); if ((r.data.profiles || []).length && !selectedId) loadProfile(r.data.profiles[0].id); } catch (e) { setMsg('Could not load fee profiles.'); }
  }
  async function loadProfile(id) {
    try { var r = await api.get('/fee-profiles/' + id); setSelectedId(id); setProfileMeta(r.data.profile); setConfig(mergeDefaults(DEFAULT_CONFIG, r.data.profile.config || {})); setMsg(''); } catch (e) { setMsg('Could not load that profile.'); }
  }

  function setCfg(mutator) { setConfig(function (prev) { var n = clone(prev || DEFAULT_CONFIG); mutator(n); return n; }); }

  // build a request from the sample inputs (supports 1 or 2 identical components to show aggregation)
  var buildRequest = useCallback(function () {
    var q = { searchHours: num(sample.searchHours), reviewHours: num(sample.reviewHours), bwPages: num(sample.bwPages), colorPages: num(sample.colorPages), oversizedPages: num(sample.oversizedPages) };
    if (num(sample.mediaCount) > 0) q.media = [{ type: sample.mediaType, count: num(sample.mediaCount) }];
    var comps = [];
    var n = sample.components === 2 ? 2 : 1;
    for (var i = 0; i < n; i++) comps.push({ label: 'Sample component ' + (i + 1), quantities: clone(q) });
    return { components: comps, delivery: { method: sample.delivery } };
  }, [sample]);

  // debounced live preview whenever config or sample changes
  useEffect(function () {
    if (!config) return;
    var t = setTimeout(async function () {
      try { var r = await api.post('/fee-profiles/preview', { config: config, request: buildRequest() }); setPreview(r.data.feeContext); } catch (e) { /* ignore transient */ }
    }, 350);
    return function () { clearTimeout(t); };
  }, [config, sample, buildRequest]);

  async function save() {
    if (!selectedId) return;
    setSaving(true); setMsg('');
    try { await api.put('/fee-profiles/' + selectedId, { config: config }); setMsg('Saved.'); loadList(); } catch (e) { setMsg('Save failed.'); }
    setSaving(false);
  }

  if (!config) return <div style={{ padding: '40px', color: '#9CA3AF' }}>Loading fee configuration...</div>;

  var R = preview && preview.requestLevel;

  return (
    <div style={{ padding: '22px 26px', maxWidth: '1180px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '6px', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#111', margin: 0 }}>Fee Configuration</h1>
        {profileMeta ? <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 9px', borderRadius: '999px', color: profileMeta.status === 'active' ? '#03543F' : '#92400E', background: profileMeta.status === 'active' ? '#DEF7EC' : '#FEF3C7' }}>{profileMeta.status}</span> : null}
      </div>
      <p style={{ fontSize: '12.5px', color: '#6B7280', margin: '0 0 16px' }}>Configure a jurisdiction's fee policy. The deterministic engine prices requests against it - edit any value and watch the itemized preview update on the right. Figures shown are illustrative until verified against the city's ordinance.</p>

      <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap' }}>
        <div>
          <label style={lbl}>Profile</label>
          <select value={selectedId} onChange={function (e) { loadProfile(e.target.value); }} style={Object.assign({}, inp, { width: 'auto', minWidth: '300px' })}>
            {profiles.map(function (p) { return <option key={p.id} value={p.id}>{p.name} [{p.context} v{p.version}]</option>; })}
          </select>
        </div>
        <button onClick={save} disabled={saving} style={{ alignSelf: 'flex-end', padding: '8px 18px', borderRadius: '8px', border: 'none', background: saving ? '#9CB4CC' : NAVY, color: 'white', fontSize: '13px', fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving...' : 'Save config'}</button>
        {msg ? <span style={{ alignSelf: 'flex-end', fontSize: '12.5px', color: msg === 'Saved.' ? '#03543F' : '#9B1C1C' }}>{msg}</span> : null}
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        {/* ---- config editor ---- */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={card}>
            <div style={sectionTitle}>Labor (per hour)</div>
            {['search', 'review', 'programming'].map(function (k) {
              return (
                <div key={k} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr 1fr', gap: '8px', alignItems: 'end', marginBottom: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#374151', textTransform: 'capitalize', paddingBottom: '7px' }}>{k}</div>
                  <div><label style={lbl}>Rate $/hr</label><Num value={config.labor[k].rate} onChange={function (v) { setCfg(function (c) { c.labor[k].rate = v || 0; }); }} /></div>
                  <div><label style={lbl}>Increment</label>
                    <select value={config.labor[k].increment} onChange={function (e) { setCfg(function (c) { c.labor[k].increment = parseFloat(e.target.value); }); }} style={inp}>
                      <option value={0}>actual</option><option value={0.25}>1/4 hr</option><option value={0.5}>1/2 hr</option><option value={1}>1 hr</option>
                    </select>
                  </div>
                  <div><label style={lbl}>Rounding</label>
                    <select value={config.labor[k].rounding} onChange={function (e) { setCfg(function (c) { c.labor[k].rounding = e.target.value; }); }} style={inp}>
                      <option value="up">up</option><option value="nearest">nearest</option><option value="down">down</option>
                    </select>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={card}>
            <div style={sectionTitle}>Duplication (per page)</div>
            {['bw', 'color', 'oversized', 'specialty'].map(function (k) {
              return (
                <div key={k} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#374151' }}>{k === 'bw' ? 'B&W' : k.charAt(0).toUpperCase() + k.slice(1)}</div>
                  <RateField value={config.duplication[k] ? config.duplication[k].rate : 0} onChange={function (v) { setCfg(function (c) { if (!c.duplication[k]) c.duplication[k] = {}; c.duplication[k].rate = v; }); }} />
                </div>
              );
            })}
          </div>

          <div style={card}>
            <div style={sectionTitle}>Physical media (per item)</div>
            {Object.keys(config.media).map(function (k) {
              return (
                <div key={k} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#374151', textTransform: 'uppercase' }}>{k}</div>
                  <RateField value={config.media[k]} onChange={function (v) { setCfg(function (c) { c.media[k] = v; }); }} />
                </div>
              );
            })}
          </div>

          <div style={card}>
            <div style={sectionTitle}>Delivery &amp; certification</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {['email', 'pickup', 'mail'].map(function (k) {
                return <div key={k}><label style={lbl}>{k} delivery</label><RateField value={config.delivery[k]} onChange={function (v) { setCfg(function (c) { c.delivery[k] = v; }); }} /></div>;
              })}
              <div><label style={lbl}>mail handling $</label><Num value={config.delivery.handling} onChange={function (v) { setCfg(function (c) { c.delivery.handling = v || 0; }); }} /></div>
              <div><label style={lbl}>certification $</label><Num value={config.certification.rate} onChange={function (v) { setCfg(function (c) { c.certification.rate = v || 0; }); }} /></div>
              <div><label style={lbl}>cert. unit</label>
                <select value={config.certification.unit} onChange={function (e) { setCfg(function (c) { c.certification.unit = e.target.value; }); }} style={inp}>
                  <option value="per_record">per record</option><option value="per_page">per page</option><option value="flat_per_request">flat per request</option>
                </select>
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={sectionTitle}>Request-level rules (applied once on the aggregated total)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
              <div><label style={lbl}>Free B&amp;W pages</label><Num value={config.requestRules.freePageAllowance} onChange={function (v) { setCfg(function (c) { c.requestRules.freePageAllowance = v || 0; }); }} /></div>
              <div><label style={lbl}>Free labor hours</label><Num value={config.requestRules.freeLaborHours} onChange={function (v) { setCfg(function (c) { c.requestRules.freeLaborHours = v || 0; }); }} /></div>
              <div><label style={lbl}>De minimis waive &lt;=</label><Num value={config.requestRules.deMinimis} onChange={function (v) { setCfg(function (c) { c.requestRules.deMinimis = v || 0; }); }} /></div>
              <div><label style={lbl}>Min fee (floor)</label><Num value={config.requestRules.minFee} onChange={function (v) { setCfg(function (c) { c.requestRules.minFee = v || 0; }); }} /></div>
              <div><label style={lbl}>Max fee (ceiling)</label><Num value={config.requestRules.maxFee} placeholder="none" onChange={function (v) { setCfg(function (c) { c.requestRules.maxFee = v; }); }} /></div>
              <div></div>
              <div><label style={lbl}>Notify if estimate &gt;</label><Num value={config.requestRules.estimateNotifyThreshold} placeholder="none" onChange={function (v) { setCfg(function (c) { c.requestRules.estimateNotifyThreshold = v; }); }} /></div>
              <div><label style={lbl}>Deposit if estimate &gt;</label><Num value={config.requestRules.deposit.threshold} placeholder="none" onChange={function (v) { setCfg(function (c) { c.requestRules.deposit.threshold = v; }); }} /></div>
              <div><label style={lbl}>Deposit percent %</label><Num value={config.requestRules.deposit.percent} placeholder="e.g. 50" onChange={function (v) { setCfg(function (c) { c.requestRules.deposit.percent = v; }); }} /></div>
            </div>
          </div>
        </div>

        {/* ---- live preview ---- */}
        <div style={{ width: '400px', flexShrink: 0, position: 'sticky', top: '16px' }}>
          <div style={Object.assign({}, card, { background: '#F9FAFB' })}>
            <div style={sectionTitle}>Live estimate preview</div>
            <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '10px' }}>Per component (applied to {sample.components === 2 ? '2 identical components' : '1 component'}):</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px', marginBottom: '8px' }}>
              {[['searchHours', 'Search hrs'], ['reviewHours', 'Review hrs'], ['bwPages', 'B&W pages'], ['colorPages', 'Color pages'], ['oversizedPages', 'Oversized pages']].map(function (f) {
                return <div key={f[0]}><label style={lbl}>{f[1]}</label><input type="number" step="any" value={sample[f[0]]} onChange={function (e) { var v = e.target.value === '' ? 0 : parseFloat(e.target.value); setSample(function (s) { var n = Object.assign({}, s); n[f[0]] = v; return n; }); }} style={inp} /></div>;
              })}
              <div><label style={lbl}># components</label>
                <select value={sample.components} onChange={function (e) { var v = parseInt(e.target.value, 10); setSample(function (s) { return Object.assign({}, s, { components: v }); }); }} style={inp}><option value={1}>1</option><option value={2}>2</option></select>
              </div>
            </div>

            {R ? (
              <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: '10px', marginTop: '4px' }}>
                {preview.components.map(function (c, ci) {
                  return (
                    <div key={ci} style={{ marginBottom: '8px' }}>
                      <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#374151' }}>{c.label} <span style={{ color: '#9CA3AF', fontWeight: 400 }}>gross {money(c.componentGross)}</span></div>
                      {c.lineItems.map(function (li, li2) { return <div key={li2} style={{ fontSize: '11px', color: '#6B7280', display: 'flex', justifyContent: 'space-between' }}><span>{li.description} ({li.quantity} {li.unit} @ {li.rate})</span><span>{li.needsActual ? 'actual TBD' : money(li.amount)}</span></div>; })}
                    </div>
                  );
                })}
                <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: '8px', fontSize: '12px', color: '#374151' }}>
                  <Row k="Gross subtotal" v={money(R.grossSubtotal)} />
                  <Row k="Labor" v={money(R.laborSubtotal)} />
                  <Row k="Duplication" v={money(R.duplicationSubtotal)} />
                  <Row k="Media" v={money(R.mediaSubtotal)} />
                  {R.deliverySubtotal ? <Row k="Delivery" v={money(R.deliverySubtotal)} /> : null}
                  {R.freeAllowances.freePageAllowance || R.freeAllowances.freeLaborHours ? <Row k="Free allowances" v={(R.freeAllowances.freePageAllowance || 0) + ' pg / ' + (R.freeAllowances.freeLaborHours || 0) + ' hr'} muted /> : null}
                  <Row k="Adjusted subtotal" v={money(R.adjustedSubtotal)} />
                  {R.floorApplied ? <Row k="Floor applied" v="" muted /> : null}
                  {R.ceilingApplied ? <Row k="Ceiling applied" v="" amber /> : null}
                  {R.deMinimisWaived ? <Row k="De minimis - waived" v="" amber /> : null}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 800, color: NAVY, marginTop: '6px', paddingTop: '6px', borderTop: '2px solid ' + NAVY }}><span>TOTAL</span><span>{money(R.total)}</span></div>
                  <Row k="Deposit due" v={money(R.depositDue)} />
                  <div style={{ fontSize: '11px', color: R.estimateNotifyTriggered ? '#92400E' : '#9CA3AF', marginTop: '4px' }}>{R.estimateNotifyTriggered ? 'Estimate notification to requestor required' : 'Below notification threshold'}</div>
                </div>
              </div>
            ) : <div style={{ fontSize: '12px', color: '#9CA3AF' }}>Calculating...</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row(props) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0', color: props.amber ? '#92400E' : (props.muted ? '#9CA3AF' : '#374151') }}><span>{props.k}</span><span>{props.v}</span></div>;
}
function num(x) { x = Number(x); return isFinite(x) ? x : 0; }
