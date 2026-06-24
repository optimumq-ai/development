import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

var navy = '#1F4E79';
var card = { background: 'white', borderRadius: '12px', border: '1px solid #E5E7EB', padding: '20px', marginBottom: '16px' };
var lbl = { fontSize: '11px', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '.05em' };

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

  useEffect(function () { load(); }, []);
  async function load() { try { var r = await api.get('/jurisdiction-profile/status'); setProfile(r.data); } catch (e) {} }
  async function resync() { setBusy(true); setMsg(''); try { var r = await api.post('/jurisdiction-profile/sync'); setProfile(r.data); setMsg('Re-indexed from the live configuration.'); } catch (e) { setMsg('Re-sync failed.'); } setBusy(false); }

  if (!profile) return <div style={{ padding: '32px', color: '#6B7280' }}>Loading…</div>;
  var j = profile.jurisdiction || {}, sum = profile.summary || {};

  return (
    <div style={{ padding: '32px', maxWidth: '960px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111', margin: '0 0 4px' }}>Jurisdiction Profile</h1>
      <p style={{ fontSize: '14px', color: '#6B7280', margin: '0 0 20px', lineHeight: 1.5 }}>One versioned record of how this jurisdiction is configured, by area. Each section is indexed from its live configuration with a version that advances whenever that configuration changes. Sign-off (attestation) per section is coming next; the structure below is ready for it.</p>

      {msg ? <div style={{ background: '#EBF3FB', border: '1px solid #BFD9F2', color: navy, borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '16px' }}>{msg}</div> : null}

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={lbl}>Jurisdiction</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#111', marginTop: '2px' }}>{j.name || '—'} <span style={{ fontSize: '13px', fontWeight: 400, color: '#9CA3AF' }}>({j.id})</span></div>
            <div style={{ fontSize: '13px', color: '#6B7280', marginTop: '6px' }}>
              {sum.configured}/{sum.total} sections configured
              {sum.attested ? <span> · {sum.attested} attested</span> : null}
              {sum.drifted ? <span style={{ color: '#92400E' }}> · {sum.drifted} need re-attestation</span> : null}
            </div>
          </div>
          <button onClick={resync} disabled={busy} style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: navy, fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Re-sync from live config</button>
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
                    {s.attested ? ' · attested ' + String(s.attestedAt || '').slice(0, 10) + ' by ' + (s.attestedBy || '') : ' · not yet attested'}
                  </div>
                </div>
                <Link to={s.editor} style={{ fontSize: '13px', fontWeight: 600, color: navy, textDecoration: 'none', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '6px 12px' }}>Open editor</Link>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '12px', lineHeight: 1.5 }}>Configuration lives in each area&rsquo;s own editor; this profile indexes and versions it. When per-section sign-off is added, attesting a section will record who approved which version, and a later change will flag it for re-attestation.</div>
      </div>
    </div>
  );
}
