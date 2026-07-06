import React, { useState, useEffect } from 'react';
import api from '../lib/api';

var BLUE = '#1F4E79';
var TOUCHPOINTS = [
  { id: 'zone-discovery', feature: 'Redaction zone discovery', fn: 'services/zoneDiscovery.js \u2192 discoverZones()', data: 'Full unredacted page text of the document', sensitive: true, core: false, kind: 'llm' },
  { id: 'intake-extract', feature: 'Intake document extraction', fn: 'routes/extract.js', data: 'Raw uploaded request letter (PDF / image)', sensitive: true, core: false, kind: 'llm' },
  { id: 'schema-discovery', feature: 'Source schema discovery', fn: 'services/schemaDiscovery.js', data: 'Sample rows / text from a source system', sensitive: true, core: false, kind: 'llm' },
  { id: 'search-judge', feature: 'Search relevance judge', fn: 'services/recordSearch.js \u2192 judgeResults()', data: 'Titles + summaries of candidate records', sensitive: true, core: true, kind: 'llm' },
  { id: 'classify', feature: 'Request classification & routing', fn: 'services/classifier.js', data: 'The requestor\u2019s own request description', sensitive: true, core: true, kind: 'llm', low: true },
  { id: 'connector-catalog', feature: 'Connector catalog (Laserfiche / Axon / Tyler)', fn: 'services/connectors/*.js', data: 'Record metadata (titles, series)', sensitive: true, core: true, kind: 'llm', low: true },
  { id: 'doc-embeddings', feature: 'Document-page embeddings', fn: 'services/embedIndex.js', data: 'Document page text (may be unredacted)', sensitive: true, core: true, kind: 'embed' },
  { id: 'meta-extract', feature: 'Record metadata extraction', fn: 'services/recordMetaExtract.js', data: 'CLEARED (already-redacted, public) record text', sensitive: false, core: true, kind: 'llm' },
  { id: 'report-agent', feature: 'AI reporting', fn: 'services/reportAgent.js', data: 'Only the user\u2019s question \u2014 numbers computed in code', sensitive: false, core: false, kind: 'llm' },
  { id: 'help-agent', feature: 'AI help assistant', fn: 'services/helpAgent.js', data: 'User\u2019s question + a curated app description', sensitive: false, core: false, kind: 'llm' },
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
    if (tp.sensitive) return tp.kind === 'embed' ? 'Amazon Titan \u00b7 Bedrock GovCloud' : 'Claude \u00b7 Bedrock GovCloud (FedRAMP High)';
    return tp.kind === 'embed' ? 'Voyage (published data only)' : 'Claude commercial (no records seen)';
  }
  return tp.kind === 'embed' ? 'Voyage AI' : 'Claude (commercial API)';
}

export default function AIDataFlowPage() {
  var [status, setStatus] = useState(null);
  var [profile, setProfile] = useState('standard');
  var [conn, setConn] = useState({ aws_region: '', titan_model: '', bedrock_access_key_id: '', bedrock_secret_key: '' });
  var [saving, setSaving] = useState(false);
  var [savedMsg, setSavedMsg] = useState('');
  var [openCode, setOpenCode] = useState(null);
  var [codeCache, setCodeCache] = useState({});

  useEffect(function () { load(); }, []);
  async function load() {
    try {
      var r = await api.get('/integrations'); var d = r.data; setStatus(d);
      if (d.deployment) { setProfile(d.deployment.profile || 'standard'); setConn(function (c) { return Object.assign({}, c, { aws_region: d.deployment.aws_region || '', titan_model: d.deployment.titan_model || '' }); }); }
    } catch (e) { /* ignore */ }
  }
  async function save() {
    setSaving(true); setSavedMsg('');
    try {
      await api.post('/integrations', { deployment: { profile: profile, aws_region: conn.aws_region, titan_model: conn.titan_model, bedrock_access_key_id: conn.bedrock_access_key_id, bedrock_secret_key: conn.bedrock_secret_key } });
      setSavedMsg('Saved.'); setConn(function (c) { return Object.assign({}, c, { bedrock_access_key_id: '', bedrock_secret_key: '' }); }); load();
    } catch (e) { setSavedMsg('Could not save.'); }
    setSaving(false);
  }
  async function toggleCode(id) {
    if (openCode === id) { setOpenCode(null); return; }
    setOpenCode(id);
    if (!codeCache[id]) {
      try { var r = await api.get('/integrations/touchpoint-code/' + id); setCodeCache(function (c) { var n = Object.assign({}, c); n[id] = r.data; return n; }); }
      catch (e) { setCodeCache(function (c) { var n = Object.assign({}, c); n[id] = { error: true }; return n; }); }
    }
  }

  if (!status) return <div style={{ color: '#9CA3AF', padding: '40px' }}>Loading\u2026</div>;
  var sensitiveCount = TOUCHPOINTS.filter(function (t) { return t.sensitive; }).length;

  var inp = { width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', outline: 'none', boxSizing: 'border-box' };
  var lbl = { fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '5px' };

  return (
    <div style={{ maxWidth: '960px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#111', margin: '0 0 4px' }}>AI Data Flow &amp; Compliance</h1>
      <p style={{ fontSize: '13px', color: '#6B7280', margin: '0 0 8px', lineHeight: 1.55 }}>Every place this software calls an AI service, exactly what data is sent, whether it can contain private record content, and how each is routed under the selected deployment profile. Code references are read live from the running codebase.</p>
      <div style={{ fontSize: '12px', color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', padding: '9px 13px', marginBottom: '22px' }}>
        The Government / Air-gapped routing targets shown below are the <strong>configured targets</strong>. Activating live routing to Bedrock GovCloud is a validated deployment step performed with the customer\u2019s cloud environment.
      </div>

      {/* Deployment profile */}
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#374151', marginBottom: '10px' }}>Deployment profile</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: '10px', marginBottom: '16px' }}>
        {PROFILES.map(function (p) {
          var active = profile === p.key;
          return (
            <div key={p.key} onClick={function () { setProfile(p.key); }} style={{ cursor: 'pointer', border: '2px solid ' + (active ? BLUE : '#E5E7EB'), background: active ? '#EBF3FB' : 'white', borderRadius: '12px', padding: '14px 16px' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: active ? BLUE : '#111', marginBottom: '4px' }}>{p.name}</div>
              <div style={{ fontSize: '12px', color: '#6B7280', lineHeight: 1.45 }}>{p.desc}</div>
            </div>
          );
        })}
      </div>

      {/* Government connection settings */}
      {profile === 'government' ? (
        <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '18px 20px', marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#111', marginBottom: '12px' }}>AWS Bedrock GovCloud connection <span style={{ color: '#B45309', fontWeight: 600 }}>\u00b7 configured, activation pending validation</span></div>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '180px' }}><label style={lbl}>GovCloud region</label><input value={conn.aws_region} onChange={function (e) { setConn(Object.assign({}, conn, { aws_region: e.target.value })); }} placeholder="us-gov-west-1" style={inp} /></div>
            <div style={{ flex: 1, minWidth: '180px' }}><label style={lbl}>Titan embedding model</label><input value={conn.titan_model} onChange={function (e) { setConn(Object.assign({}, conn, { titan_model: e.target.value })); }} placeholder="amazon.titan-embed-text-v2:0" style={inp} /></div>
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '180px' }}><label style={lbl}>Bedrock access key ID {status.deployment && status.deployment.bedrock_key_set ? <span style={{ color: '#03543F' }}>\u00b7 set</span> : null}</label><input type="password" value={conn.bedrock_access_key_id} onChange={function (e) { setConn(Object.assign({}, conn, { bedrock_access_key_id: e.target.value })); }} placeholder={status.deployment && status.deployment.bedrock_key_set ? 'Saved \u2014 enter to replace' : 'AKIA\u2026'} style={inp} autoComplete="new-password" /></div>
            <div style={{ flex: 1, minWidth: '180px' }}><label style={lbl}>Bedrock secret key {status.deployment && status.deployment.bedrock_secret_set ? <span style={{ color: '#03543F' }}>\u00b7 set</span> : null}</label><input type="password" value={conn.bedrock_secret_key} onChange={function (e) { setConn(Object.assign({}, conn, { bedrock_secret_key: e.target.value })); }} placeholder={status.deployment && status.deployment.bedrock_secret_set ? 'Saved \u2014 enter to replace' : '\u2022\u2022\u2022\u2022'} style={inp} autoComplete="new-password" /></div>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '24px' }}>
        <button onClick={save} disabled={saving} style={{ padding: '10px 22px', borderRadius: '9px', border: 'none', background: saving ? '#9CB4CC' : BLUE, color: 'white', fontSize: '13.5px', fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving\u2026' : 'Save profile'}</button>
        {savedMsg ? <span style={{ fontSize: '13px', fontWeight: 600, color: '#03543F' }}>{savedMsg}</span> : null}
      </div>

      {/* Touchpoint inspector */}
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#374151', marginBottom: '4px' }}>AI touchpoints ({TOUCHPOINTS.length}) \u00b7 {sensitiveCount} see record content</div>
      <div style={{ fontSize: '11.5px', color: '#9CA3AF', marginBottom: '12px' }}>Core redaction (mass redaction / field-map / manual) uses no AI. Sensitive AI touchpoints are mostly optional assists that can be disabled.</div>
      <div style={{ border: '1px solid #E5E7EB', borderRadius: '12px', overflow: 'hidden', background: 'white' }}>
        {TOUCHPOINTS.map(function (t, i) {
          var open = openCode === t.id; var cc = codeCache[t.id];
          return (
            <div key={t.id} style={{ borderTop: i ? '1px solid #F3F4F6' : 'none' }}>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ flex: '2 1 260px', minWidth: '220px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#111' }}>{t.feature}</span>
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 7px', borderRadius: '999px', color: t.sensitive ? '#9B1C1C' : '#03543F', background: t.sensitive ? '#FDE8E8' : '#DEF7EC' }}>{t.sensitive ? (t.low ? 'SEES DATA (LOW)' : 'SEES RECORD DATA') : 'NO RECORDS'}</span>
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 7px', borderRadius: '999px', color: '#374151', background: '#F3F4F6' }}>{t.core ? 'CORE' : 'OPTIONAL'}</span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#9CA3AF', fontFamily: 'monospace', marginTop: '3px' }}>{t.fn}</div>
                </div>
                <div style={{ flex: '2 1 220px', fontSize: '12.5px', color: '#374151' }}>{t.data}</div>
                <div style={{ flex: '1 1 180px', fontSize: '12px', fontWeight: 600, color: BLUE }}>{routesTo(t, profile)}</div>
                <button onClick={function () { toggleCode(t.id); }} style={{ flexShrink: 0, padding: '5px 11px', borderRadius: '7px', border: '1px solid #D1D5DB', background: open ? '#EBF3FB' : 'white', color: BLUE, fontSize: '11.5px', fontWeight: 700, cursor: 'pointer' }}>{open ? 'Hide code' : 'View code'}</button>
              </div>
              {open ? (
                <div style={{ background: '#0F172A', padding: '12px 16px', overflowX: 'auto' }}>
                  {!cc ? <div style={{ color: '#94A3B8', fontSize: '12px' }}>Reading source\u2026</div> : cc.error ? <div style={{ color: '#FCA5A5', fontSize: '12px' }}>Could not read source.</div> : (
                    <div>
                      <div style={{ fontSize: '11px', color: '#94A3B8', fontFamily: 'monospace', marginBottom: '8px' }}>{cc.file} : lines {cc.lines}</div>
                      <pre style={{ margin: 0, fontSize: '11.5px', lineHeight: 1.55, color: '#E2E8F0', fontFamily: 'ui-monospace, Menlo, monospace', whiteSpace: 'pre' }}>{cc.code}</pre>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
