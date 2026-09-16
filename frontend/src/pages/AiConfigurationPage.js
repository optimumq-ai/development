import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import SetupScreen, { lbl, inp, hint, field, Msg, PrimaryButton, BLUE } from '../components/setup/SetupScreen';
import PortalSecurityInfo from '../components/setup/PortalSecurityInfo';

// AI CONFIGURATION — the hub's `ai_config` row (C12, Kevin 2026-08-30: the "AI Service Keys" and
// "AI Data Flow and Compliance" items become ONE row and ONE screen with three tabs). Tab 1 "AI Service
// Keys" is the retired IntegrationsPage; tab 2 "Deployment Model" is the AI Data Flow page's deployment
// profile section under its new name; tab 3 "AI Touchpoints Information" is that page's touchpoint
// inspector. The hidden Integrations tab and the AI Data Flow admin tab are retired; /integrations,
// /ai-data-flow, ?tab=integrations and ?tab=ai-data land here. Data: GET/POST /api/integrations ·
// POST /api/integrations/test/:service · GET /api/integrations/touchpoint-code/:id. Tab 4 "AI Portal
// Security Information" (C13) is the retired Portal Agent Security admin page — static reference content.

var TABS = [['keys', 'AI Service Keys'], ['deployment', 'Deployment Model'], ['touchpoints', 'AI Touchpoints Information'], ['usage', 'AI Usage'], ['security', 'AI Portal Security Information']];
var TOUCHPOINTS = [
  { id: 'zone-discovery', feature: 'Redaction zone discovery', fn: 'services/zoneDiscovery.js → discoverZones()', data: 'Full unredacted page text of the document', sensitive: true, core: false, kind: 'llm' },
  { id: 'intake-extract', feature: 'Intake document extraction', fn: 'routes/extract.js', data: 'Raw uploaded request letter (PDF / image)', sensitive: true, core: false, kind: 'llm' },
  { id: 'schema-discovery', feature: 'Census grouping naming / association suggestion', fn: 'services/censusAssociate.js · services/schemaDiscovery.js', data: 'Two first-page excerpts + the field labels of one identical grouping (never a sample of the whole source)', sensitive: true, core: false, kind: 'llm' },
  { id: 'search-judge', feature: 'Search relevance judge', fn: 'services/recordSearch.js → judgeResults()', data: 'Titles + summaries of candidate records', sensitive: true, core: true, kind: 'llm' },
  { id: 'classify', feature: 'Request classification & routing', fn: 'services/classifier.js', data: 'The requestor’s own request description', sensitive: true, core: true, kind: 'llm', low: true },
  { id: 'connector-catalog', feature: 'Connector catalog (Laserfiche / Axon / Tyler)', fn: 'services/connectors/*.js', data: 'Record metadata (titles, series)', sensitive: true, core: true, kind: 'llm', low: true },
  { id: 'doc-embeddings', feature: 'Document-page embeddings', fn: 'services/embedIndex.js', data: 'Document page text (may be unredacted)', sensitive: true, core: true, kind: 'embed' },
  { id: 'meta-extract', feature: 'Record metadata extraction', fn: 'services/recordMetaExtract.js', data: 'CLEARED (already-redacted, public) record text', sensitive: false, core: true, kind: 'llm' },
  { id: 'report-agent', feature: 'AI reporting', fn: 'services/reportAgent.js', data: 'Only the user’s question — numbers computed in code', sensitive: false, core: false, kind: 'llm' },
  { id: 'help-agent', feature: 'AI help assistant', fn: 'services/helpAgent.js', data: 'User’s question + a curated app description', sensitive: false, core: false, kind: 'llm' },
  { id: 'fee-policy', feature: 'Fee / rule / policy configuration', fn: 'services/feePolicyExtract.js', data: 'Policy / statute / fee-schedule text', sensitive: false, core: false, kind: 'llm' },
  { id: 'public-portal', feature: 'Public portal assistant', fn: 'routes/publicChat.js', data: 'Citizen query + published record metadata', sensitive: false, core: true, kind: 'llm' }
];
var PROFILES = [
  { key: 'standard', name: 'Standard', desc: 'Commercial Claude + Voyage. For jurisdictions whose requirement is where data is stored (satisfied by on-premise hosting).' },
  { key: 'government', name: 'Government / FedRAMP', desc: 'Sensitive tasks routed to Claude via AWS Bedrock GovCloud (FedRAMP High) + Amazon Titan embeddings. For jurisdictions that require FedRAMP-authorized AI.' },
  { key: 'airgapped', name: 'Air-gapped', desc: 'Self-hosted open-weight model + local embeddings. For jurisdictions that permit no data to leave their network.' }
];
function routesTo(tp, profile) {
  if (profile === 'airgapped') return tp.kind === 'embed' ? 'Local embedding model' : 'Local open-weight model';
  if (profile === 'government') {
    if (tp.sensitive) return tp.kind === 'embed' ? 'Amazon Titan · Bedrock GovCloud' : 'Claude · Bedrock GovCloud (FedRAMP High)';
    return tp.kind === 'embed' ? 'Voyage (published data only)' : 'Claude commercial (no records seen)';
  }
  return tp.kind === 'embed' ? 'Voyage AI' : 'Claude (commercial API)';
}
function Flag(props) { return props.set ? <span style={{ color: 'var(--oq-fg-03543f)', fontWeight: 700 }}>&middot; configured{props.fromSaved != null ? (props.fromSaved ? ' — saved on this screen' : ' — from the server environment') : ''}</span> : <span style={{ color: 'var(--oq-fg-9b1c1c)', fontWeight: 700 }}>&middot; not set</span>; }

export default function AiConfigurationPage() {
  var nav = useNavigate();
  var [params, setParams] = useSearchParams();
  var tab = TABS.some(function (t) { return t[0] === params.get('tab'); }) ? params.get('tab') : 'keys';
  var [status, setStatus] = useState(null);
  var [msg, setMsg] = useState(null);
  // tab 1
  var [form, setForm] = useState({ anthropic_api_key: '', voyage_api_key: '' });
  var [saving, setSaving] = useState(false);
  var [test, setTest] = useState({});
  // tab 2
  var [profile, setProfile] = useState('standard');
  var [conn, setConn] = useState({ aws_region: '', titan_model: '', bedrock_access_key_id: '', bedrock_secret_key: '' });
  // tab 3
  var [openCode, setOpenCode] = useState(null);
  var [codeCache, setCodeCache] = useState({});

  function load() {
    return api.get('/integrations').then(function (r) {
      var d = r.data; setStatus(d);
      if (d.deployment) { setProfile(d.deployment.profile || 'standard'); setConn(function (c) { return Object.assign({}, c, { aws_region: d.deployment.aws_region || '', titan_model: d.deployment.titan_model || '' }); }); }
    }).catch(function () { setStatus({ ai: { anthropic: {}, voyage: {} }, deployment: {} }); setMsg({ ok: false, text: 'The current settings could not be read.' }); });
  }
  useEffect(function () { load(); }, []);
  function goTab(k) { setMsg(null); setParams({ tab: k }); }
  function set(k, v) { setForm(function (f) { var n = Object.assign({}, f); n[k] = v; return n; }); }
  function failMsg(e) { setMsg({ ok: false, text: (e.response && e.response.data && e.response.data.error) || 'Could not save.' }); }
  async function saveKeys(reload) {
    setSaving(true); setMsg(null);
    try { await api.post('/integrations', { ai: { anthropic_api_key: form.anthropic_api_key, voyage_api_key: form.voyage_api_key } }); setMsg({ ok: true, text: 'Keys saved.' }); setForm({ anthropic_api_key: '', voyage_api_key: '' }); await load(); await reload(); }
    catch (e) { failMsg(e); }
    setSaving(false);
  }
  async function saveDeployment(reload) {
    setSaving(true); setMsg(null);
    try {
      await api.post('/integrations', { deployment: { profile: profile, aws_region: conn.aws_region, titan_model: conn.titan_model, bedrock_access_key_id: conn.bedrock_access_key_id, bedrock_secret_key: conn.bedrock_secret_key } });
      setMsg({ ok: true, text: 'Deployment model saved.' }); setConn(function (c) { return Object.assign({}, c, { bedrock_access_key_id: '', bedrock_secret_key: '' }); }); await load(); await reload();
    } catch (e) { failMsg(e); }
    setSaving(false);
  }
  async function runTest(which, payload) {
    setTest(function (t) { var n = Object.assign({}, t); n[which] = { busy: true }; return n; });
    try { var r = await api.post('/integrations/test/' + which, payload || {}); setTest(function (t) { var n = Object.assign({}, t); n[which] = { busy: false, ok: r.data.ok, message: r.data.message }; return n; }); }
    catch (e) { setTest(function (t) { var n = Object.assign({}, t); n[which] = { busy: false, ok: false, message: 'Test failed.' }; return n; }); }
  }
  async function toggleCode(id) {
    if (openCode === id) { setOpenCode(null); return; }
    setOpenCode(id);
    if (!codeCache[id]) {
      try { var r = await api.get('/integrations/touchpoint-code/' + id); setCodeCache(function (c) { var n = Object.assign({}, c); n[id] = r.data; return n; }); }
      catch (e) { setCodeCache(function (c) { var n = Object.assign({}, c); n[id] = { error: true }; return n; }); }
    }
  }
  function TestBtn(props) {
    var st = test[props.which] || {};
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
        <button type="button" onClick={props.onClick} disabled={st.busy || props.disabled} style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid ' + BLUE, background: 'var(--oq-bg-ffffff)', color: BLUE, fontSize: '12.5px', fontWeight: 700, fontFamily: 'inherit', cursor: st.busy ? 'default' : 'pointer', opacity: props.disabled ? 0.5 : 1 }}>{st.busy ? 'Testing…' : 'Test'}</button>
        {st.message ? <span style={{ fontSize: '12.5px', fontWeight: 600, color: st.ok ? 'var(--oq-fg-03543f)' : 'var(--oq-fg-9b1c1c)' }}>{st.ok ? '✓ ' : '✗ '}{st.message}</span> : null}
      </span>
    );
  }
  function placeholder(isSet, h) { return isSet ? ('Saved (' + (h || '••••') + ') — enter a new value to replace it') : 'Not set'; }

  // Tab marks (Kevin 2026-08-31): each configurable tab carries the colour of its own required set; the strip's
  // pill is the worst tab and one approval covers the screen. Informational tabs carry no mark.
  var TABCOL = { red: 'var(--oq-x-dc2626)', yellow: 'var(--oq-x-d97706)', green: 'var(--oq-x-16a34a)' };
  function tabBar(row) {
    var marks = (row && row.tabs) || {};
    return (
      <div style={{ display: 'flex', gap: '2px', borderBottom: '1px solid var(--oq-ln-d2dce3)', marginBottom: '18px' }}>
        {TABS.map(function (t) {
          var on = tab === t[0]; var mk = marks[t[0]];
          return <button key={t[0]} type="button" onClick={function () { goTab(t[0]); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '9px 16px', background: 'none', border: 'none', borderBottom: '2px solid ' + (on ? BLUE : 'transparent'), marginBottom: '-1px', fontSize: '13.5px', fontWeight: on ? 700 : 500, color: on ? BLUE : 'var(--oq-fg-5c6f7c)', cursor: 'pointer', fontFamily: 'inherit' }}>{mk ? <span title={mk === 'red' ? 'Required items missing on this tab' : (mk === 'yellow' ? 'Complete — awaiting approval' : 'Approved')} style={{ width: '9px', height: '9px', borderRadius: '50%', background: TABCOL[mk] || 'var(--oq-bg-c7d0d8)', flexShrink: 0 }} /> : null}{t[1]}</button>;
        })}
      </div>
    );
  }

  return (
    <SetupScreen hubKey="ai_config" laneLabel="Technical Setup" title="AI configuration"
      intro="Everything about how this installation uses AI: the service keys it signs in with, the deployment model that decides where AI processing runs, a plain inventory of every place the software calls an AI service and what it sends, and how the public portal assistant is kept away from sensitive data.">
      {function (s) {
        if (!status) return <div style={{ color: 'var(--oq-fg-9ca3af)' }}>Loading…</div>;
        var a = (status.ai && status.ai.anthropic) || {}, v = (status.ai && status.ai.voyage) || {}, dep = status.deployment || {};
        var sensitiveCount = TOUCHPOINTS.filter(function (t) { return t.sensitive; }).length;
        return (
          <div>
            {tabBar(s.row)}
            {msg ? <Msg text={msg.text} ok={msg.ok} /> : null}

            {tab === 'keys' ? (
              <div>
                <div style={Object.assign({}, hint, { marginTop: 0, marginBottom: '16px' })}>Used for request classification, redaction assistance, semantic search and reporting. Create accounts at Anthropic and Voyage AI and paste the keys here; values are stored on this server and never shown again after saving. Email sending has its own screen: <button type="button" onClick={function () { nav('/setup/email'); }} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: BLUE, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline dotted' }}>Email configuration</button>.</div>
                <div style={field}>
                  <label style={lbl}>Anthropic API key <span style={{ color: 'var(--oq-fg-dc2626)' }}>*</span> <Flag set={a.set} fromSaved={a.fromSaved} /></label>
                  <input type="password" value={form.anthropic_api_key} disabled={!s.can} onChange={function (e) { set('anthropic_api_key', e.target.value); }} placeholder={placeholder(a.set, a.hint)} style={Object.assign({}, inp, { marginBottom: '8px' }, (!a.set && !form.anthropic_api_key) ? { border: '2px solid var(--oq-ln-dc2626)' } : {})} autoComplete="new-password" />
                  {(!a.set && !form.anthropic_api_key) ? <div style={{ fontSize: '11.5px', color: 'var(--oq-fg-dc2626)', fontWeight: 600, marginBottom: '6px' }}>Required — enter the key and save</div> : null}
                  <TestBtn which="anthropic" disabled={!s.can} onClick={function () { runTest('anthropic', { key: form.anthropic_api_key }); }} />
                  <div style={hint}>Test uses the value typed above, or the saved key when the field is empty.</div>
                </div>
                <div style={field}>
                  <label style={lbl}>Voyage AI API key <span style={{ color: 'var(--oq-fg-dc2626)' }}>*</span> <Flag set={v.set} fromSaved={v.fromSaved} /></label>
                  <input type="password" value={form.voyage_api_key} disabled={!s.can} onChange={function (e) { set('voyage_api_key', e.target.value); }} placeholder={placeholder(v.set, v.hint)} style={Object.assign({}, inp, { marginBottom: '8px' }, (!v.set && !form.voyage_api_key) ? { border: '2px solid var(--oq-ln-dc2626)' } : {})} autoComplete="new-password" />
                  {(!v.set && !form.voyage_api_key) ? <div style={{ fontSize: '11.5px', color: 'var(--oq-fg-dc2626)', fontWeight: 600, marginBottom: '6px' }}>Required — enter the key and save</div> : null}
                  <TestBtn which="voyage" disabled={!s.can} onClick={function () { runTest('voyage', { key: form.voyage_api_key }); }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}><PrimaryButton disabled={!s.can || saving || (!form.anthropic_api_key && !form.voyage_api_key)} onClick={function () { saveKeys(s.reload); }}>{saving ? 'Saving…' : 'Save keys'}</PrimaryButton></div>
              </div>
            ) : null}

            {tab === 'deployment' ? (
              <div>
                {(s.row && s.row.tabs && s.row.tabs.deployment === 'red') ? <div style={{ fontSize: '11.5px', color: 'var(--oq-fg-dc2626)', fontWeight: 600, marginBottom: '8px' }}>Required — {(s.row.approvalWhy || '').indexOf('not chosen') >= 0 ? 'choose a deployment model and save (Standard applies until you do)' : 'complete the GovCloud connection and save'}</div> : null}
                <div style={Object.assign({}, hint, { marginTop: 0, marginBottom: '14px' })}>Where AI processing happens. The Government and Air-gapped routing targets are the <strong>configured targets</strong>; activating live routing to Bedrock GovCloud is a validated deployment step performed with the city's cloud environment.</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: '10px', marginBottom: '16px' }}>
                  {PROFILES.map(function (p) {
                    var on = profile === p.key;
                    return (
                      <div key={p.key} onClick={function () { if (s.can) setProfile(p.key); }} style={{ cursor: s.can ? 'pointer' : 'default', border: '2px solid ' + (on ? BLUE : 'var(--oq-ln-d2dce3)'), background: on ? 'var(--oq-bg-ebf3fb)' : 'var(--oq-bg-ffffff)', borderRadius: '10px', padding: '14px 16px' }}>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: on ? BLUE : 'var(--oq-fg-12232e)', marginBottom: '4px' }}>{p.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--oq-fg-5c6f7c)', lineHeight: 1.45 }}>{p.desc}</div>
                      </div>
                    );
                  })}
                </div>
                {profile === 'government' ? (
                  <div style={{ border: '1px solid var(--oq-ln-d2dce3)', borderRadius: '10px', padding: '16px 18px', marginBottom: '16px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '12px' }}>AWS Bedrock GovCloud connection <span style={{ color: 'var(--oq-fg-b45309)', fontWeight: 600 }}>· configured, activation pending validation</span></div>
                    <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: '180px' }}><label style={lbl}>GovCloud region</label><input value={conn.aws_region} disabled={!s.can} onChange={function (e) { setConn(Object.assign({}, conn, { aws_region: e.target.value })); }} placeholder="us-gov-west-1" style={inp} /></div>
                      <div style={{ flex: 1, minWidth: '180px' }}><label style={lbl}>Titan embedding model</label><input value={conn.titan_model} disabled={!s.can} onChange={function (e) { setConn(Object.assign({}, conn, { titan_model: e.target.value })); }} placeholder="amazon.titan-embed-text-v2:0" style={inp} /></div>
                    </div>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: '180px' }}><label style={lbl}>Bedrock access key ID {dep.bedrock_key_set ? <span style={{ color: 'var(--oq-fg-03543f)' }}>· set</span> : null}</label><input type="password" value={conn.bedrock_access_key_id} disabled={!s.can} onChange={function (e) { setConn(Object.assign({}, conn, { bedrock_access_key_id: e.target.value })); }} placeholder={dep.bedrock_key_set ? 'Saved — enter to replace' : 'AKIA…'} style={inp} autoComplete="new-password" /></div>
                      <div style={{ flex: 1, minWidth: '180px' }}><label style={lbl}>Bedrock secret key {dep.bedrock_secret_set ? <span style={{ color: 'var(--oq-fg-03543f)' }}>· set</span> : null}</label><input type="password" value={conn.bedrock_secret_key} disabled={!s.can} onChange={function (e) { setConn(Object.assign({}, conn, { bedrock_secret_key: e.target.value })); }} placeholder={dep.bedrock_secret_set ? 'Saved — enter to replace' : '••••'} style={inp} autoComplete="new-password" /></div>
                    </div>
                  </div>
                ) : null}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}><PrimaryButton disabled={!s.can || saving} onClick={function () { saveDeployment(s.reload); }}>{saving ? 'Saving…' : 'Save deployment model'}</PrimaryButton></div>
              </div>
            ) : null}

            {tab === 'touchpoints' ? (
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--oq-fg-374151)', marginBottom: '4px' }}>AI touchpoints ({TOUCHPOINTS.length}) · {sensitiveCount} see record content · routed under the <em>{(PROFILES.filter(function (p) { return p.key === profile; })[0] || PROFILES[0]).name}</em> deployment model</div>
                <div style={Object.assign({}, hint, { marginTop: 0, marginBottom: '12px' })}>Every place this software calls an AI service, exactly what data is sent, whether it can contain private record content, and how each is routed. Core redaction (mass redaction / field-map / manual) uses no AI; sensitive AI touchpoints are mostly optional assists. Code references are read live from the running codebase.</div>
                <div style={{ border: '1px solid var(--oq-ln-d2dce3)', borderRadius: '10px', overflow: 'hidden', background: 'var(--oq-bg-ffffff)' }}>
                  {TOUCHPOINTS.map(function (t, i) {
                    var open = openCode === t.id; var cc = codeCache[t.id];
                    return (
                      <div key={t.id} style={{ borderTop: i ? '1px solid var(--oq-ln-eef2f5)' : 'none' }}>
                        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                          <div style={{ flex: '2 1 260px', minWidth: '220px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '13.5px', fontWeight: 700 }}>{t.feature}</span>
                              <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 7px', borderRadius: '999px', color: t.sensitive ? 'var(--oq-fg-9b1c1c)' : 'var(--oq-fg-03543f)', background: t.sensitive ? 'var(--oq-bg-fde8e8)' : 'var(--oq-bg-def7ec)' }}>{t.sensitive ? (t.low ? 'SEES DATA (LOW)' : 'SEES RECORD DATA') : 'NO RECORDS'}</span>
                              <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 7px', borderRadius: '999px', color: 'var(--oq-fg-374151)', background: 'var(--oq-bg-f3f4f6)' }}>{t.core ? 'CORE' : 'OPTIONAL'}</span>
                            </div>
                            <div style={{ fontSize: '11.5px', color: 'var(--oq-fg-8296a4)', fontFamily: 'monospace', marginTop: '3px' }}>{t.fn}</div>
                          </div>
                          <div style={{ flex: '2 1 220px', fontSize: '12.5px', color: 'var(--oq-fg-374151)' }}>{t.data}</div>
                          <div style={{ flex: '1 1 180px', fontSize: '12px', fontWeight: 600, color: BLUE }}>{routesTo(t, profile)}</div>
                          <button type="button" onClick={function () { toggleCode(t.id); }} style={{ flexShrink: 0, padding: '5px 11px', borderRadius: '7px', border: '1px solid var(--oq-ln-d1d5db)', background: open ? 'var(--oq-bg-ebf3fb)' : 'var(--oq-bg-ffffff)', color: BLUE, fontSize: '11.5px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{open ? 'Hide code' : 'View code'}</button>
                        </div>
                        {open ? (
                          <div style={{ background: 'var(--oq-bg-0f172a)', padding: '12px 16px', overflowX: 'auto' }}>
                            {!cc ? <div style={{ color: 'var(--oq-fg-94a3b8)', fontSize: '12px' }}>Reading source…</div> : cc.error ? <div style={{ color: 'var(--oq-fg-fca5a5)', fontSize: '12px' }}>Could not read source.</div> : (
                              <div>
                                <div style={{ fontSize: '11px', color: 'var(--oq-fg-94a3b8)', fontFamily: 'monospace', marginBottom: '8px' }}>{cc.file} : lines {cc.lines}</div>
                                <pre style={{ margin: 0, fontSize: '11.5px', lineHeight: 1.55, color: 'var(--oq-fg-e2e8f0)', fontFamily: 'ui-monospace, Menlo, monospace', whiteSpace: 'pre' }}>{cc.code}</pre>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {tab === 'usage' ? <AiUsage /> : null}
            {tab === 'security' ? <PortalSecurityInfo /> : null}
          </div>
        );
      }}
    </SetupScreen>
  );
}


// AI USAGE (2026-09-16): what this installation's own model calls cost, by feature and by day, from the `ai_calls` log
// every call writes. This is the app's half of the platform usage report — the Claude Code sessions are the other half.
function AiUsage() {
  var [days, setDays] = useState(30);
  var [data, setData] = useState(null);
  var [err, setErr] = useState('');
  useEffect(function () { var alive = true; api.get('/ai-usage', { params: { days: days } }).then(function (r) { if (alive) setData(r.data); }).catch(function (e) { if (alive) setErr((e.response && e.response.data && e.response.data.error) || 'Could not load usage.'); }); return function () { alive = false; }; }, [days]);
  function k(n) { n = Number(n || 0); return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n); }
  var th = { textAlign: 'right', fontSize: '11px', fontWeight: '700', color: 'var(--oq-fg-8296a4)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '6px 10px' };
  var td = { textAlign: 'right', fontSize: '12.5px', padding: '8px 10px', borderTop: '1px solid var(--oq-ln-eef2f5)', fontVariantNumeric: 'tabular-nums', color: 'var(--oq-fg-12232e)' };
  if (err) return <div style={{ color: 'var(--oq-fg-991b1b)', fontSize: '13px' }}>{err}</div>;
  if (!data) return <div style={{ color: 'var(--oq-fg-9ca3af)', fontSize: '13px' }}>Loading usage…</div>;
  var t = data.totals;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', color: 'var(--oq-fg-5c6f7c)', flex: 1 }}>Every model call the application makes is logged — who called, which model, the tokens the API reported, and failures. Never the prompt or the answer. Use this next to the platform usage report: the report's <b>application key</b> should match these totals; anything above them is Claude Code.</div>
        <select value={days} onChange={function (e) { setDays(Number(e.target.value)); }} style={{ fontSize: '12.5px', border: '1px solid var(--oq-ln-becad3)', borderRadius: '7px', padding: '5px 8px', background: 'var(--oq-bg-ffffff)' }}>
          {[7, 30, 90].map(function (d) { return <option key={d} value={d}>last {d} days</option>; })}
        </select>
      </div>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
        {[['Calls', t.calls, t.errors ? t.errors + ' failed' : 'no failures'], ['Fresh input', k(t.input_tokens), 'tokens paid at full price'], ['Cache write', k(t.cache_write), 'written to the prompt cache'], ['Cache read', k(t.cache_read), t.cache_hit_share + '% of input served from cache'], ['Output', k(t.output_tokens), 'tokens generated']].map(function (s) {
          return <div key={s[0]} style={{ flex: 1, padding: '12px 14px', border: '1px solid var(--oq-ln-d2dce3)', borderRadius: '9px', background: 'var(--oq-bg-ffffff)' }}><div style={{ fontSize: '22px', fontWeight: '800', color: 'var(--oq-fg-12232e)', fontVariantNumeric: 'tabular-nums' }}>{s[1]}</div><div style={{ fontSize: '12px', color: 'var(--oq-fg-5c6f7c)', marginTop: '2px' }}>{s[0]} · {s[2]}</div></div>;
        })}
      </div>
      <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--oq-fg-12232e)', marginBottom: '4px' }}>By feature</div>
      <div style={{ fontSize: '11.5px', color: 'var(--oq-fg-8296a4)', marginBottom: '8px' }}>The caller is the service and function that made the call. "Cache read" is the proof a prompt cache works — the classifier's record-type catalog (about 8k tokens) is cached, so repeat classifications within the cache window read it instead of paying for it again.</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '18px' }}>
        <thead><tr><th style={Object.assign({}, th, { textAlign: 'left' })}>Caller</th><th style={Object.assign({}, th, { textAlign: 'left' })}>Model</th><th style={th}>Calls</th><th style={th}>Fresh input</th><th style={th}>Cache write</th><th style={th}>Cache read</th><th style={th}>Output</th><th style={th}>Errors</th><th style={th}>Avg ms</th><th style={Object.assign({}, th, { textAlign: 'left' })}>Last</th></tr></thead>
        <tbody>{data.by_caller.length ? data.by_caller.map(function (r) {
          return <tr key={r.caller + r.model}><td style={Object.assign({}, td, { textAlign: 'left', fontWeight: '600' })}>{r.caller}</td><td style={Object.assign({}, td, { textAlign: 'left', color: 'var(--oq-fg-5c6f7c)' })}>{r.model}</td><td style={td}>{r.calls}</td><td style={td}>{k(r.input_tokens)}</td><td style={td}>{k(r.cache_write)}</td><td style={Object.assign({}, td, { color: r.cache_read ? 'var(--oq-fg-1b8a5a)' : 'var(--oq-fg-9ca3af)' })}>{k(r.cache_read)}</td><td style={td}>{k(r.output_tokens)}</td><td style={Object.assign({}, td, { color: r.errors ? 'var(--oq-fg-991b1b)' : 'var(--oq-fg-9ca3af)' })}>{r.errors}</td><td style={td}>{r.avg_ms}</td><td style={Object.assign({}, td, { textAlign: 'left', color: 'var(--oq-fg-8296a4)' })}>{String(r.last_at || '').slice(0, 16)}</td></tr>;
        }) : <tr><td colSpan={10} style={Object.assign({}, td, { textAlign: 'left', color: 'var(--oq-fg-9ca3af)' })}>No model calls logged in this window.</td></tr>}</tbody>
      </table>
      <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--oq-fg-12232e)', marginBottom: '8px' }}>By day</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={Object.assign({}, th, { textAlign: 'left' })}>Day (UTC)</th><th style={Object.assign({}, th, { textAlign: 'left' })}>Model</th><th style={th}>Calls</th><th style={th}>Fresh input</th><th style={th}>Cache write</th><th style={th}>Cache read</th><th style={th}>Output</th></tr></thead>
        <tbody>{data.by_day.map(function (r) { return <tr key={r.day + r.model}><td style={Object.assign({}, td, { textAlign: 'left' })}>{r.day}</td><td style={Object.assign({}, td, { textAlign: 'left', color: 'var(--oq-fg-5c6f7c)' })}>{r.model}</td><td style={td}>{r.calls}</td><td style={td}>{k(r.input_tokens)}</td><td style={td}>{k(r.cache_write)}</td><td style={td}>{k(r.cache_read)}</td><td style={td}>{k(r.output_tokens)}</td></tr>; })}</tbody>
      </table>
    </div>
  );
}
