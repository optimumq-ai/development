import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

const PHASE_META = {
  jurisdiction: { link: '/jurisdiction-profile', linkLabel: 'Open Jurisdiction Profile', guide: "Select your state's jurisdiction profile. This sets statutory response deadlines, tolling rules, and the exemption basis used for redaction." },
  departments:  { link: '/departments', linkLabel: 'Open City Departments', guide: "Confirm your city's departments so they match your org chart \u2014 add, remove, or rename as needed." },
  teams:        { link: '/departments', linkLabel: 'Open Fulfillment Teams', guide: "Define your Request Fulfillment Teams and select which departments each one serves." },
  ownership:    { link: '/taxonomy', linkLabel: 'Open Taxonomy', guide: "Confirm the owning City Department for each record type. AI proposes sensible defaults; you adjust." },
  repositories: { link: '/sources', linkLabel: 'Open Sources', guide: "Connect your source systems and run discovery to catalog record types. Discovered types arrive as drafts for your review." },
  fees:         { link: '/fee-config', linkLabel: 'Open Fee Configuration', guide: "Configure your fee schedule and per-record-type estimate calibration." },
  redaction:    { link: '/redaction-rules', linkLabel: 'Open Redaction Rules', guide: "Review the AI-suggested jurisdiction redaction rules (drafts). Add, edit, or remove as needed \u2014 nothing takes effect until you approve it." },
};

function statusChip(status) {
  const map = {
    complete: { bg: '#D1FAE5', color: '#065F46', label: 'Complete' },
    review_requested: { bg: '#FEF3C7', color: '#92400E', label: 'Review requested' },
    in_progress: { bg: '#DBEAFE', color: '#1E40AF', label: 'In progress' },
    not_started: { bg: '#F3F4F6', color: '#6B7280', label: 'Not started' },
  };
  return map[status] || map.not_started;
}

const btnPrimary = { padding: '8px 16px', background: '#1F4E79', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' };
const btnGhost = { padding: '8px 16px', background: 'white', color: '#6B7280', border: '1px solid #E5E7EB', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' };
function reqBtn(enabled) { return { padding: '8px 16px', background: enabled ? '#EBF3FB' : '#F3F4F6', color: enabled ? '#1F4E79' : '#9CA3AF', border: '1px solid ' + (enabled ? '#C7D9EB' : '#E5E7EB'), borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: enabled ? 'pointer' : 'not-allowed' }; }

export default function SetupPage() {
  const [data, setData] = useState(null);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [o, s] = await Promise.all([api.get('/onboarding'), api.get('/staff').catch(function () { return { data: { staff: [] } }; })]);
      setData(o.data);
      setStaff((s.data && s.data.staff) || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }
  useEffect(function () { load(); }, []);

  async function setReviewer(phase, reviewerId) {
    try { await api.patch('/onboarding/' + phase + '/reviewer', { reviewerId: reviewerId || null }); await load(); } catch (e) { alert('Failed to set reviewer'); }
  }
  async function requestReview(phase) {
    setBusy(phase); setMsg('');
    try { const r = await api.post('/onboarding/' + phase + '/request-review'); setMsg(r.data && r.data.emailed ? 'Review request emailed to the designated reviewer.' : 'Review requested (email not sent \u2014 check email configuration).'); await load(); }
    catch (e) { alert((e.response && e.response.data && e.response.data.error) || 'Failed to request review'); }
    setBusy('');
  }
  async function approve(phase) {
    setBusy(phase); setMsg('');
    try { await api.post('/onboarding/' + phase + '/approve'); await load(); }
    catch (e) { alert((e.response && e.response.data && e.response.data.error) || 'Failed to approve'); }
    setBusy('');
  }
  async function setStatus(phase, status) {
    setBusy(phase); setMsg('');
    try { await api.patch('/onboarding/' + phase, { status: status }); await load(); }
    catch (e) { alert((e.response && e.response.data && e.response.data.error) || 'Failed'); }
    setBusy('');
  }

  if (loading) return <div style={{ padding: '48px', textAlign: 'center', color: '#9CA3AF' }}>Loading setup...</div>;
  if (!data) return <div style={{ padding: '48px', textAlign: 'center', color: '#9CA3AF' }}>Could not load setup.</div>;

  const phases = data.phases || [];
  const complete = phases.filter(function (p) { return p.status === 'complete'; }).length;

  return (
    <div style={{ maxWidth: '860px' }}>
      <div>
        <h1 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 4px' }}>Setup</h1>
        <p style={{ color: '#6B7280', fontSize: '14px', margin: 0 }}>Guided configuration for your agency. The system pre-fills each step to its best effort; you review, edit, and approve. Steps marked <em>Requires approval</em> must be signed off by a designated reviewer before onboarding proceeds.</p>
      </div>

      <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '16px 20px', margin: '16px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '14px', fontWeight: '600', color: '#111' }}>{complete} of {phases.length} steps complete</span>
          <span style={{ fontSize: '14px', fontWeight: '700', color: '#1F4E79' }}>{data.percentComplete}%</span>
        </div>
        <div style={{ height: '8px', background: '#F3F4F6', borderRadius: '999px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: data.percentComplete + '%', background: '#1F4E79', transition: 'width 0.3s' }} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {phases.map(function (p, idx) {
          const meta = PHASE_META[p.phase_key] || {};
          const chip = statusChip(p.status);
          const isCurrent = data.currentPhase === p.phase_key;
          return (
            <div key={p.phase_key} style={{ background: 'white', border: '1px solid ' + (isCurrent ? '#1F4E79' : '#E5E7EB'), borderRadius: '12px', padding: '18px 20px', boxShadow: isCurrent ? '0 0 0 3px #EBF3FB' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
                <div style={{ flexShrink: 0, width: '30px', height: '30px', borderRadius: '50%', background: p.status === 'complete' ? '#065F46' : '#1F4E79', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: '700' }}>{p.status === 'complete' ? '\u2713' : (idx + 1)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: '700', fontSize: '16px', color: '#111' }}>{p.title}</span>
                    <span style={{ fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '999px', background: chip.bg, color: chip.color }}>{chip.label}</span>
                    {p.requires_review ? <span style={{ fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '999px', background: '#F5F3FF', color: '#6D28D9' }}>Requires approval</span> : null}
                  </div>
                  <p style={{ fontSize: '13px', color: '#374151', margin: '8px 0 6px', lineHeight: '1.5' }}>{meta.guide}</p>
                  {p.signal ? <p style={{ fontSize: '12px', color: '#1F4E79', background: '#EBF3FB', border: '1px solid #C7D9EB', borderRadius: '6px', padding: '6px 10px', margin: '0 0 12px' }}>{p.signal}</p> : null}

                  {p.requires_review ? (
                    <div style={{ background: '#FAFAFA', border: '1px solid #F0F0F0', borderRadius: '8px', padding: '10px 12px', marginBottom: '10px' }}>
                      <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '6px' }}>Designated reviewer (must approve before onboarding proceeds):</div>
                      <select value={p.reviewer_id || ''} onChange={function (e) { setReviewer(p.phase_key, e.target.value); }} style={{ padding: '7px 10px', border: '1px solid #E5E7EB', borderRadius: '6px', fontSize: '13px', minWidth: '240px' }}>
                        <option value="">{'\u2014 none assigned \u2014'}</option>
                        {staff.map(function (u) { return <option key={u.id} value={u.id}>{u.display_name}{u.email ? (' (' + u.email + ')') : ''}</option>; })}
                      </select>
                      {p.status === 'review_requested' ? <div style={{ fontSize: '12px', color: '#92400E', marginTop: '6px' }}>Review requested{p.reviewer_name ? (' \u2014 awaiting ' + p.reviewer_name) : ''}.</div> : null}
                    </div>
                  ) : null}

                  {p.status === 'complete' && p.completed_by_name ? <div style={{ fontSize: '12px', color: '#065F46', marginBottom: '10px' }}>{p.requires_review ? 'Approved' : 'Completed'} by {p.completed_by_name}{p.completed_at ? (' \u00b7 ' + String(p.completed_at).slice(0, 10)) : ''}.</div> : null}

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {meta.link ? <Link to={meta.link} style={{ fontSize: '13px', color: '#1F4E79', background: '#EBF3FB', borderRadius: '6px', padding: '8px 14px', textDecoration: 'none', fontWeight: '600' }}>{meta.linkLabel} {'\u2192'}</Link> : null}
                    {p.requires_review && p.status !== 'complete' ? <button disabled={busy === p.phase_key || !p.reviewer_id} onClick={function () { requestReview(p.phase_key); }} style={reqBtn(!!p.reviewer_id)}>Request review email</button> : null}
                    {p.requires_review && p.status !== 'complete' ? <button disabled={busy === p.phase_key} onClick={function () { approve(p.phase_key); }} style={btnPrimary}>Approve &amp; complete</button> : null}
                    {!p.requires_review && p.status !== 'complete' ? <button disabled={busy === p.phase_key} onClick={function () { setStatus(p.phase_key, 'complete'); }} style={btnPrimary}>Mark complete</button> : null}
                    {p.status === 'complete' ? <button disabled={busy === p.phase_key} onClick={function () { setStatus(p.phase_key, 'in_progress'); }} style={btnGhost}>Reopen</button> : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {msg ? <div style={{ marginTop: '14px', fontSize: '13px', color: '#065F46', background: '#D1FAE5', borderRadius: '8px', padding: '10px 14px' }}>{msg}</div> : null}
    </div>
  );
}
