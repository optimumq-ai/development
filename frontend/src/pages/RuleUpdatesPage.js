import React, { useState, useEffect } from 'react';
import api from '../lib/api';

var DOMAINS = [
  { key: 'fee', label: 'Fee & cost schedule' },
  { key: 'deadline', label: 'Response deadlines & tolling' },
  { key: 'exemption', label: 'Exemption model & appeals' },
  { key: 'redaction', label: 'Redaction / exemption rules' },
  { key: 'taxonomy', label: 'Record types & taxonomy' }
];
function domLabel(k) { for (var i = 0; i < DOMAINS.length; i++) if (DOMAINS[i].key === k) return DOMAINS[i].label; return k; }
var navy = '#1F4E79';
var card = { background: 'white', borderRadius: '12px', border: '1px solid #E5E7EB', padding: '20px', marginBottom: '16px' };
var btn = { padding: '7px 14px', borderRadius: '8px', border: 'none', background: navy, color: 'white', fontSize: '13px', fontWeight: 600, cursor: 'pointer' };
var btnOutline = { padding: '7px 14px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: navy, fontSize: '13px', fontWeight: 600, cursor: 'pointer' };
var lbl = { fontSize: '11px', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '.05em' };

export default function RuleUpdatesPage() {
  const [status, setStatus] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [pasteDomain, setPasteDomain] = useState('fee');
  const [pasteText, setPasteText] = useState('');
  const [review, setReview] = useState(null);
  const [cadenceInput, setCadenceInput] = useState(182);
  const [recipientInput, setRecipientInput] = useState('');
  const [scheduled, setScheduled] = useState([]);

  useEffect(function () { load(); }, []);
  async function load() {
    try {
      var s = await api.get('/config-freshness/status'); setStatus(s.data);
      setCadenceInput(s.data.cadenceDays || 182); setRecipientInput(s.data.recipient || '');
      var p = await api.get('/config-freshness/proposals?status=pending'); setProposals(p.data.proposals || []);
      var sc = await api.get('/config-freshness/scheduled'); setScheduled(sc.data.scheduled || []);
    } catch (e) {}
  }
  async function runReminder() {
    setBusy(true); setMsg('');
    try { var r = await api.post('/config-freshness/run'); setMsg('Reminder email sent' + (r.data.emailed ? '.' : ' (email not delivered).')); }
    catch (e) { setMsg('Could not send the reminder.'); }
    await load(); setBusy(false);
  }
  async function submitPaste() {
    if (!pasteText.trim()) return;
    setBusy(true); setMsg('');
    try { await api.post('/config-freshness/extract', { domain: pasteDomain, rawText: pasteText }); setMsg('Document received — Optimum Q drafted a proposed update below for your review.'); setPasteText(''); }
    catch (e) { setMsg('Could not read that document.'); }
    await load(); setBusy(false);
  }
  async function openReview(id) {
    try { var r = await api.get('/config-freshness/proposals/' + id); setReview({ detail: r.data, step: 1, editedText: JSON.stringify(r.data.proposed, null, 2), agreed: false, error: '', mode: 'now', effectiveDate: '' }); } catch (e) {}
  }
  async function applyProposal() {
    var rv = review, cfg;
    try { cfg = JSON.parse(rv.editedText); } catch (e) { setReview(Object.assign({}, rv, { error: 'The edited configuration is not valid JSON — please fix it before approving.' })); return; }
    var payload = { editedConfig: cfg, attested: true };
    if (rv.mode === 'schedule' && rv.effectiveDate) payload.effectiveDate = rv.effectiveDate;
    setBusy(true);
    try { var r = await api.post('/config-freshness/proposals/' + rv.detail.proposal.id + '/apply', payload); setReview(null); setMsg(r.data && r.data.scheduled ? ('Scheduled. This change will take effect automatically on ' + r.data.effectiveDate + '.') : 'Approved. The configuration has been updated.'); }
    catch (e) { setReview(Object.assign({}, rv, { error: (e.response && e.response.data && e.response.data.error) || 'Could not complete.' })); setBusy(false); return; }
    await load(); setBusy(false);
  }
  async function cancelScheduled(id) { setBusy(true); setMsg(''); try { await api.post('/config-freshness/scheduled/' + id + '/cancel'); setMsg('Scheduled change cancelled — it has been returned to Review & approve.'); } catch (e) { setMsg('Could not cancel that scheduled change.'); } await load(); setBusy(false); }
  async function dismiss(id) { setBusy(true); try { await api.post('/config-freshness/proposals/' + id + '/dismiss'); setReview(null); } catch (e) {} await load(); setBusy(false); }
  async function saveSettings() { setBusy(true); setMsg(''); try { await api.post('/config-freshness/settings', { cadenceDays: Number(cadenceInput) || 182, recipient: recipientInput }); setMsg('Reminder settings saved.'); } catch (e) { setMsg('Could not save settings.'); } await load(); setBusy(false); }
  async function uploadFile(file) { if (!file) return; setBusy(true); setMsg(''); try { var fd = new FormData(); fd.append('file', file); fd.append('domain', pasteDomain); var r = await api.post('/config-freshness/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); if (r.data && r.data.ok === false) setMsg('Could not read that file: ' + r.data.error); else setMsg('Document received — Optimum Q drafted a proposed update below for your review.'); } catch (e) { setMsg('Upload failed.'); } await load(); setBusy(false); }

  if (!status) return <div style={{ padding: '32px', color: '#6B7280' }}>Loading…</div>;

  return (
    <div style={{ padding: '32px', maxWidth: '1000px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111', margin: '0 0 4px' }}>Update Configuration</h1>
      <p style={{ fontSize: '14px', color: '#6B7280', margin: '0 0 20px', lineHeight: 1.5 }}>When a change to the laws, codes, ordinances, or fee rules that affect records requests is adopted, upload an approved copy of the change here. Optimum Q drafts the matching configuration update for you to review and approve. Keeping configuration current with applicable law is your office&rsquo;s responsibility.</p>

      {msg ? <div style={{ background: '#EBF3FB', border: '1px solid #BFD9F2', color: navy, borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '16px' }}>{msg}</div> : null}

      <div style={card}>
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#111', marginBottom: '8px' }}>1. Upload an approved copy of a change</div>
        <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '12px', lineHeight: 1.5 }}>Upload the document you obtained (PDF or text), or paste its text, and choose which area it affects. Optimum Q will draft a proposed configuration update for your review — nothing changes until you approve it.</div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
          <label style={lbl}>Area</label>
          <select value={pasteDomain} onChange={function (e) { setPasteDomain(e.target.value); }} style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid #E5E7EB', fontSize: '13px' }}>
            {DOMAINS.map(function (d) { return <option key={d.key} value={d.key}>{d.label}</option>; })}
          </select>
          <span style={{ fontSize: '12px', color: '#9CA3AF' }}>Upload a file (PDF / text):</span>
          <input type="file" accept=".pdf,.txt,.md,.html,.htm" onChange={function (e) { var f = e.target.files && e.target.files[0]; if (f) { uploadFile(f); e.target.value = ''; } }} style={{ fontSize: '12px' }} />
        </div>
        <textarea value={pasteText} onChange={function (e) { setPasteText(e.target.value); }} placeholder="…or paste the statute, ordinance, or fee-schedule text here" rows={5} style={{ width: '100%', boxSizing: 'border-box', padding: '10px', borderRadius: '8px', border: '1px solid #E5E7EB', fontSize: '13px', fontFamily: 'inherit' }} />
        <div style={{ marginTop: '8px' }}><button onClick={submitPaste} disabled={busy || !pasteText.trim()} style={btn}>Draft proposed update</button></div>
      </div>

      {proposals.length > 0 ? (
        <div style={card}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#111', marginBottom: '12px' }}>2. Review &amp; approve ({proposals.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {proposals.map(function (p) {
              return (
                <div key={p.id} style={{ border: '1px solid #E5E7EB', borderRadius: '8px', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <span style={{ background: '#FEF3C7', color: '#92400E', fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{domLabel(p.domain)}</span>
                  <div style={{ flex: 1, minWidth: '220px' }}>
                    <div style={{ fontSize: '13px', color: '#374151', lineHeight: 1.4 }}>{p.summary || 'Proposed update'}</div>
                    <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '2px' }}>from {p.source_ref} · {String(p.created_at).slice(0, 16)}</div>
                  </div>
                  <button onClick={function () { openReview(p.id); }} disabled={busy} style={btn}>Review</button>
                  <button onClick={function () { dismiss(p.id); }} disabled={busy} style={Object.assign({}, btnOutline, { color: '#9B1C1C' })}>Discard</button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {scheduled.length > 0 ? (
        <div style={card}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#111', marginBottom: '4px' }}>Scheduled changes ({scheduled.length})</div>
          <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '12px', lineHeight: 1.5 }}>Approved changes waiting for their effective date. Each deploys automatically on that date — no further action needed. Cancelling returns a change to Review &amp; approve.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {scheduled.map(function (sc) {
              return (
                <div key={sc.id} style={{ border: '1px solid #E5E7EB', borderRadius: '8px', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <span style={{ background: '#EBF3FB', color: navy, fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{domLabel(sc.domain)}</span>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ fontSize: '13px', color: '#374151', lineHeight: 1.4 }}>{sc.summary || 'Approved configuration update'}</div>
                    <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '2px' }}>scheduled {String(sc.created_at).slice(0, 10)}{sc.created_by ? ' by ' + sc.created_by : ''}</div>
                  </div>
                  <span style={{ background: '#F0FDF4', color: '#166534', fontSize: '12px', fontWeight: 700, padding: '4px 12px', borderRadius: '8px', whiteSpace: 'nowrap' }}>Effective {sc.effective_date}</span>
                  <button onClick={function () { cancelScheduled(sc.id); }} disabled={busy} style={Object.assign({}, btnOutline, { color: '#9B1C1C' })}>Cancel</button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div style={card}>
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#111', marginBottom: '12px' }}>Reminder settings</div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label style={lbl}>Send reminder every (days)</label><input type="number" min="1" value={cadenceInput} onChange={function (e) { setCadenceInput(e.target.value); }} style={{ display: 'block', marginTop: '4px', width: '110px', padding: '7px 10px', borderRadius: '8px', border: '1px solid #E5E7EB', fontSize: '13px' }} /></div>
          <div style={{ flex: 1, minWidth: '220px' }}><label style={lbl}>Reminder recipient</label><input type="email" value={recipientInput} onChange={function (e) { setRecipientInput(e.target.value); }} style={{ display: 'block', marginTop: '4px', width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: '8px', border: '1px solid #E5E7EB', fontSize: '13px' }} /></div>
          <button onClick={saveSettings} disabled={busy} style={btn}>Save</button>
          <button onClick={runReminder} disabled={busy} style={btnOutline}>Send reminder now</button>
        </div>
        <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '10px', lineHeight: 1.5 }}>Optimum Q sends a periodic courtesy reminder to review changes your office is already aware of and update the configuration before each change&rsquo;s effective date. It does not monitor or track the law — you bring the approved document and approve the change.</div>
      </div>

      {review ? <ReviewModal review={review} setReview={setReview} busy={busy} onApply={applyProposal} onDismiss={dismiss} /> : null}
    </div>
  );
}

function ReviewModal(props) {
  var review = props.review, setReview = props.setReview, busy = props.busy;
  var d = review.detail, p = d.proposal;
  var tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  function set(patch) { setReview(Object.assign({}, review, patch)); }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto', zIndex: 50 }} onClick={function () { setReview(null); }}>
      <div style={{ background: 'white', borderRadius: '14px', width: '100%', maxWidth: '720px', padding: '24px' }} onClick={function (e) { e.stopPropagation(); }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <span style={{ background: '#FEF3C7', color: '#92400E', fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px' }}>{domLabel(p.domain)}</span>
          <button onClick={function () { setReview(null); }} style={{ border: 'none', background: 'none', fontSize: '20px', color: '#9CA3AF', cursor: 'pointer' }}>×</button>
        </div>

        {review.step === 1 ? (
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#111', margin: '6px 0 10px' }}>Review proposed update</h2>
            <p style={{ fontSize: '13px', color: '#374151', lineHeight: 1.5, background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '12px' }}>{p.summary || 'Proposed configuration update.'}</p>
            {d.snapshot && d.snapshot.text ? (
              <details style={{ marginTop: '12px' }}>
                <summary style={{ fontSize: '13px', fontWeight: 600, color: navy, cursor: 'pointer' }}>View source document</summary>
                <div style={{ fontSize: '12px', color: '#374151', whiteSpace: 'pre-wrap', maxHeight: '180px', overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '10px', marginTop: '8px', background: '#FCFCFD' }}>{d.snapshot.text}</div>
              </details>
            ) : null}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '14px' }}>
              <div>
                <div style={lbl}>Proposed configuration (editable)</div>
                <textarea value={review.editedText} onChange={function (e) { set({ editedText: e.target.value, error: '' }); }} rows={12} style={{ width: '100%', boxSizing: 'border-box', marginTop: '4px', padding: '10px', borderRadius: '8px', border: '1px solid #E5E7EB', fontSize: '12px', fontFamily: 'monospace' }} />
              </div>
              <div>
                <div style={lbl}>Current configuration</div>
                <pre style={{ marginTop: '4px', padding: '10px', borderRadius: '8px', border: '1px solid #E5E7EB', fontSize: '12px', background: '#F9FAFB', maxHeight: '296px', overflow: 'auto' }}>{JSON.stringify(d.current, null, 2)}</pre>
              </div>
            </div>
            {review.error ? <div style={{ color: '#9B1C1C', fontSize: '13px', marginTop: '10px' }}>{review.error}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button onClick={function () { props.onDismiss(p.id); }} disabled={busy} style={Object.assign({}, btnOutline, { color: '#9B1C1C' })}>Discard</button>
              <button onClick={function () { try { JSON.parse(review.editedText); set({ step: 2, error: '' }); } catch (e) { set({ error: 'The edited configuration is not valid JSON — please fix it first.' }); } }} disabled={busy} style={btn}>Continue to confirm</button>
            </div>
            {d.applyMode === 'stage_drafts' ? <div style={{ background: '#FFFBEB', border: '1px solid #FEF3C7', borderRadius: '8px', padding: '12px', fontSize: '13px', color: '#92400E', marginTop: '14px' }}>Approving will add the proposed items as <strong>pending-review drafts</strong> in {d.applyTarget}; they will not take effect until separately approved there.</div> : null}
          </div>
        ) : (
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#111', margin: '6px 0 10px' }}>Confirm &amp; approve</h2>
            <div style={{ background: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: '8px', padding: '14px 16px', fontSize: '13px', color: '#92400E', lineHeight: 1.55 }}>
              {d.applyMode === 'stage_drafts' ? <span><strong>Please confirm.</strong> These items will be added as <strong>pending-review drafts</strong> in {d.applyTarget}. They do not take effect until separately reviewed and approved there. Optimum Q proposes configuration but does not provide legal advice.</span> : <span><strong>Please confirm before approving.</strong> Approving this change updates the configuration the system uses to process requests ({d.applyTarget}). You are responsible for verifying it against the approved source. Optimum Q proposes configuration but does not provide legal advice; this is not a substitute for review by your legal counsel.</span>}
            </div>
            {d.applyMode !== 'stage_drafts' ? (
              <div style={{ marginTop: '14px', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '12px 14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#111', marginBottom: '8px' }}>When should this take effect?</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#374151', cursor: 'pointer', marginBottom: '6px' }}>
                  <input type="radio" name="effmode" checked={review.mode !== 'schedule'} onChange={function () { set({ mode: 'now' }); }} /> Apply now
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#374151', cursor: 'pointer' }}>
                  <input type="radio" name="effmode" checked={review.mode === 'schedule'} onChange={function () { set({ mode: 'schedule' }); }} /> Schedule for a future effective date
                </label>
                {review.mode === 'schedule' ? (
                  <div style={{ marginTop: '8px', paddingLeft: '24px' }}>
                    <input type="date" min={tomorrow} value={review.effectiveDate || ''} onChange={function (e) { set({ effectiveDate: e.target.value }); }} style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid #E5E7EB', fontSize: '13px' }} />
                    <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '6px', lineHeight: 1.5 }}>The current configuration stays in effect until this date, when Optimum Q applies the change automatically.</div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', color: '#374151', marginTop: '14px', cursor: 'pointer' }}>
              <input type="checkbox" checked={review.agreed} onChange={function (e) { set({ agreed: e.target.checked }); }} style={{ marginTop: '3px' }} />
              <span>I have reviewed this update against its approved source and authorize {d.applyMode === 'stage_drafts' ? 'adding it as pending-review drafts' : (review.mode === 'schedule' ? 'scheduling it to take effect on the date above' : 'updating the configuration')}.</span>
            </label>
            {review.error ? <div style={{ color: '#9B1C1C', fontSize: '13px', marginTop: '10px' }}>{review.error}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '18px' }}>
              <button onClick={function () { set({ step: 1, error: '' }); }} disabled={busy} style={btnOutline}>Back</button>
              <button onClick={props.onApply} disabled={busy || !review.agreed || (review.mode === 'schedule' && !review.effectiveDate)} style={Object.assign({}, btn, { background: review.agreed ? navy : '#9CA3AF' })}>{review.mode === 'schedule' ? 'Schedule' : (d.applyMode === 'stage_drafts' ? 'Add as drafts' : 'Approve')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
