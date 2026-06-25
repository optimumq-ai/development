import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

var navy = '#1F4E79';
var card = { background: 'white', borderRadius: '12px', border: '1px solid #E5E7EB', padding: '20px', marginBottom: '16px' };
var lbl = { fontSize: '11px', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '.05em' };
var btn = { padding: '6px 12px', borderRadius: '8px', border: 'none', background: navy, color: 'white', fontSize: '13px', fontWeight: 600, cursor: 'pointer' };
var btnOutline = { padding: '6px 12px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: navy, fontSize: '13px', fontWeight: 600, cursor: 'pointer', textDecoration: 'none' };

function badge(r) {
  if (r === 'attested') return { bg: '#F0FDF4', color: '#166534', label: 'Attested' };
  if (r === 'needs_reattestation') return { bg: '#FEF3C7', color: '#92400E', label: 'Needs re-attestation' };
  if (r === 'configured') return { bg: '#EBF3FB', color: navy, label: 'Configured' };
  return { bg: '#F3F4F6', color: '#6B7280', label: 'Not configured' };
}

export default function JurisdictionProfilePage() {
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [attestTarget, setAttestTarget] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [devMode, setDevMode] = useState(null);
  const devReveal = (typeof window !== 'undefined' && window.location.hash.toLowerCase().indexOf('dev') >= 0);

  useEffect(function () { load(); }, []);
  async function load() { try { var r = await api.get('/jurisdiction-profile/status'); setProfile(r.data); } catch (e) {} try { var e2 = await api.get('/jurisdiction-profile/enforcement'); setDevMode(!!e2.data.devMode); } catch (e) {} }
  async function toggleDev() { setBusy(true); setMsg(''); try { var r = await api.post('/jurisdiction-profile/enforcement', { devMode: !devMode }); setDevMode(!!r.data.devMode); setMsg('Developer mode ' + (r.data.devMode ? 'ON — enforcement bypassed.' : 'OFF — attestation now enforced for gated actions.')); } catch (e) { setMsg((e.response && e.response.status === 403) ? 'Only a system administrator can change this.' : 'Could not change developer mode.'); } setBusy(false); }
  async function resync() { setBusy(true); setMsg(''); try { var r = await api.post('/jurisdiction-profile/sync'); setProfile(r.data); setMsg('Re-indexed from the live configuration.'); } catch (e) { setMsg('Re-sync failed.'); } setBusy(false); }
  async function doAttest() { if (!attestTarget) return; setBusy(true); setMsg(''); try { var r = await api.post('/jurisdiction-profile/attest', { section: attestTarget.section }); setProfile(r.data); setMsg('Signed off: ' + attestTarget.label + ' (version ' + attestTarget.version + ').'); } catch (e) { setMsg((e.response && e.response.data && e.response.data.error) || 'Sign-off failed.'); } setAttestTarget(null); setAgreed(false); setBusy(false); }
  async function doUnattest(section) { setBusy(true); setMsg(''); try { var r = await api.post('/jurisdiction-profile/unattest', { section: section }); setProfile(r.data); } catch (e) { setMsg('Could not remove sign-off.'); } setBusy(false); }

  if (!profile) return <div style={{ padding: '32px', color: '#6B7280' }}>Loading…</div>;
  var j = profile.jurisdiction || {}, sum = profile.summary || {};

  return (
    <div style={{ padding: '32px', maxWidth: '980px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111', margin: '0 0 4px' }}>Jurisdiction Profile</h1>
      <p style={{ fontSize: '14px', color: '#6B7280', margin: '0 0 20px', lineHeight: 1.5 }}>One versioned record of how this jurisdiction is configured, by area. Each section is indexed from its live configuration with a version that advances whenever that configuration changes. Signing off (attesting) a section records that your office reviewed and approved that exact version; if the configuration later changes, the section is automatically flagged for re-review.</p>

      {msg ? <div style={{ background: '#EBF3FB', border: '1px solid #BFD9F2', color: navy, borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '16px' }}>{msg}</div> : null}

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={lbl}>Jurisdiction</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#111', marginTop: '2px' }}>{j.name || '—'} <span style={{ fontSize: '13px', fontWeight: 400, color: '#9CA3AF' }}>({j.id})</span></div>
            <div style={{ fontSize: '13px', color: '#6B7280', marginTop: '6px' }}>
              {sum.configured}/{sum.total} sections configured · {sum.attested || 0} attested
              {sum.drifted ? <span style={{ color: '#92400E', fontWeight: 600 }}> · {sum.drifted} need re-attestation</span> : null}
            </div>
          </div>
          <button onClick={resync} disabled={busy} style={btnOutline}>Re-sync from live config</button>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#111', marginBottom: '12px' }}>Sections</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {profile.sections.map(function (s) {
            var b = badge(s.readiness);
            return (
              <div key={s.section} style={{ border: '1px solid #E5E7EB', borderRadius: '8px', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <span style={{ background: b.bg, color: b.color, fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{b.label}</span>
                <div style={{ flex: 1, minWidth: '220px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#111' }}>{s.label}</div>
                  <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '2px' }}>
                    version {s.version}{s.source ? ' · ' + s.source : ''}{s.lastChangedAt ? ' · changed ' + String(s.lastChangedAt).slice(0, 10) : ''}
                    {s.attested ? ' · signed off v' + s.attestedVersion + ' ' + String(s.attestedAt || '').slice(0, 10) + ' by ' + (s.attestedBy || '') : ''}
                  </div>
                  {s.readiness === 'needs_reattestation' ? <div style={{ fontSize: '12px', color: '#92400E', marginTop: '4px' }}>Configuration changed since sign-off (approved v{s.attestedVersion}, now v{s.version}). Please review and re-attest.</div> : null}
                </div>
                <Link to={s.editor} style={Object.assign({}, btnOutline, { whiteSpace: 'nowrap' })}>Open editor</Link>
                {s.readiness === 'not_configured' ? null
                  : s.readiness === 'attested'
                    ? <button onClick={function () { doUnattest(s.section); }} disabled={busy} style={Object.assign({}, btnOutline, { color: '#6B7280', whiteSpace: 'nowrap' })}>Remove sign-off</button>
                    : <button onClick={function () { setAttestTarget(s); setAgreed(false); }} disabled={busy} style={Object.assign({}, btn, { whiteSpace: 'nowrap', background: s.readiness === 'needs_reattestation' ? '#92400E' : navy })}>{s.readiness === 'needs_reattestation' ? 'Re-attest' : 'Review & attest'}</button>}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '12px', lineHeight: 1.5 }}>Configuration lives in each area&rsquo;s own editor; this profile indexes, versions, and records sign-off over it. A signed-off section that later changes is flagged here for re-review, so an approval can never silently apply to a configuration no one reviewed.</div>
      </div>

      {attestTarget ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', zIndex: 50 }} onClick={function () { if (!busy) { setAttestTarget(null); setAgreed(false); } }}>
          <div style={{ background: 'white', borderRadius: '12px', padding: '24px', maxWidth: '520px', width: '100%' }} onClick={function (e) { e.stopPropagation(); }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#111', margin: '0 0 12px' }}>Sign off — {attestTarget.label}</h2>
            <div style={{ background: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: '8px', padding: '14px 16px', fontSize: '13px', color: '#92400E', lineHeight: 1.55 }}>
              You are confirming that <strong>{(profile.jurisdiction || {}).name}</strong>&rsquo;s <strong>{attestTarget.label}</strong> configuration (<strong>version {attestTarget.version}</strong>) has been reviewed and is approved as correct for processing requests. The sign-off is recorded with your name, the date, and this exact version. If this configuration later changes, the section is automatically flagged for re-review. Optimum Q proposes and indexes configuration but does not provide legal advice.
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', color: '#374151', marginTop: '14px', cursor: 'pointer' }}>
              <input type="checkbox" checked={agreed} onChange={function (e) { setAgreed(e.target.checked); }} style={{ marginTop: '3px' }} />
              <span>I confirm this section has been reviewed and is approved for {(profile.jurisdiction || {}).name}.</span>
            </label>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '18px' }}>
              <button onClick={function () { setAttestTarget(null); setAgreed(false); }} disabled={busy} style={btnOutline}>Cancel</button>
              <button onClick={doAttest} disabled={busy || !agreed} style={Object.assign({}, btn, { background: agreed ? navy : '#9CA3AF' })}>Sign off</button>
            </div>
          </div>
        </div>
      ) : null}

      {devReveal ? (
        <div style={{ marginTop: '24px', border: '1px dashed #CBD5E1', borderRadius: '10px', padding: '14px 16px', background: '#F8FAFC' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.05em' }}>Developer settings</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '8px' }}>
            <div style={{ fontSize: '13px', color: '#475569', lineHeight: 1.5, maxWidth: '620px' }}>
              <strong>Developer mode (enforcement bypass): {devMode === null ? '…' : devMode ? 'ON' : 'OFF'}.</strong>{' '}
              {devMode ? 'Attestation is NOT yet required — gated actions (e.g. sending a cost notice) proceed normally regardless of sign-off. Leave ON until configuration and testing are complete.' : 'Attestation is ENFORCED — a gated action will be blocked if its section is not signed off (or has changed since sign-off).'}
            </div>
            <button onClick={toggleDev} disabled={busy || devMode === null} style={Object.assign({}, btn, { whiteSpace: 'nowrap', background: devMode ? '#92400E' : '#166534' })}>{devMode ? 'Turn enforcement ON' : 'Turn enforcement OFF (back to dev)'}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
