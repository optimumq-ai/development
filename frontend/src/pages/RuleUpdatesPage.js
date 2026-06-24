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
  const [cadenceInput, setCadenceInput] = useState(30);
  const [recipientInput, setRecipientInput] = useState('');
  const [autoInput, setAutoInput] = useState(false);

  useEffect(function () { load(); }, []);
  async function load() {
    try {
      var s = await api.get('/config-freshness/status'); setStatus(s.data);
      setCadenceInput(s.data.cadenceDays || 30); setRecipientInput(s.data.recipient || ''); setAutoInput(!!s.data.autoExtract);
      var p = await api.get('/config-freshness/proposals?status=pending'); setProposals(p.data.proposals || []);
    } catch (e) {}
  }
  async function runReminder() {
    setBusy(true); setMsg('');
    try { var r = await api.post('/config-freshness/run'); setMsg('Reminder sent' + (r.data.emailed ? '' : ' (email not delivered)') + '. ' + r.data.total + ' item(s) pending review.'); }
    catch (e) { setMsg('Could not run the reminder.'); }
    await load(); setBusy(false);
  }
  async function checkSource(id) {
    setBusy(true); setMsg('');
    try { var r = await api.post('/config-freshness/sources/' + id + '/check'); if (r.data.ok === false) setMsg('Could not read that source automatically: ' + r.data.error + '. Paste the text below instead.'); else setMsg('Source checked — a proposal is staged below for your review.'); }
    catch (e) { setMsg('Check failed.'); }
    await load(); setBusy(false);
  }
  async function submitPaste() {
    if (!pasteText.trim()) return;
    setBusy(true); setMsg('');
    try { await api.post('/config-freshness/extract', { domain: pasteDomain, rawText: pasteText }); setMsg('Document analyzed — a proposal is staged below for your review.'); setPasteText(''); }
    catch (e) { setMsg('Could not analyze that document.'); }
    await load(); setBusy(false);
  }
  async function openReview(id) {
    try { var r = await api.get('/config-freshness/proposals/' + id); setReview({ detail: r.data, step: 1, editedText: JSON.stringify(r.data.proposed, null, 2), agreed: false, error: '' }); } catch (e) {}
  }
  async function applyProposal() {
    var rv = review, cfg;
    try { cfg = JSON.parse(rv.editedText); } catch (e) { setReview(Object.assign({}, rv, { error: 'The edited configuration is not valid JSON — please fix it before applying.' })); return; }
    setBusy(true);
    try { await api.post('/config-freshness/proposals/' + rv.detail.proposal.id + '/apply', { editedConfig: cfg, attested: true }); setReview(null); setMsg('Applied. The live configuration has been updated.'); }
    catch (e) { setReview(Object.assign({}, rv, { error: (e.response && e.response.data && e.response.data.error) || 'Apply failed.' })); setBusy(false); return; }
    await load(); setBusy(false);
  }
  async function dismiss(id) { setBusy(true); try { await api.post('/config-freshness/proposals/' + id + '/dismiss'); setReview(null); } catch (e) {} await load(); setBusy(false); }
  async function saveSettings() { setBusy(true); setMsg(''); try { await api.post('/config-freshness/settings', { cadenceDays: Number(cadenceInput) || 30, recipient: recipientInput, autoExtract: autoInput }); setMsg('Settings saved.'); } catch (e) { setMsg('Could not save settings.'); } await load(); setBusy(false); }
  async function uploadFile(file) { if (!file) return; setBusy(true); setMsg(''); try { var fd = new FormData(); fd.append('file', file); fd.append('domain', pasteDomain); var r = await api.post('/config-freshness/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); if (r.data && r.data.ok === false) setMsg('Could not read that file: ' + r.data.error); else setMsg('File analyzed — a proposal is staged below for your review.'); } catch (e) { setMsg('Upload failed.'); } await load(); setBusy(false); }

  if (!status) return <div style={{ padding: '32px', color: '#6B7280' }}>Loading…</div>;
  var sourcesByDomain = {};
  (status.sources || []).forEach(function (s) { (sourcesByDomain[s.domain] = sourcesByDomain[s.domain] || []).push(s); });
  var pendingMap = {}; (status.pending || []).forEach(function (p) { pendingMap[p.domain] = p.pending; });

  return (
    <div style={{ padding: '32px', maxWidth: '1000px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111', margin: '0 0 4px' }}>Rule &amp; Law Updates</h1>
      <p style={{ fontSize: '14px', color: '#6B7280', margin: '0 0 20px', lineHeight: 1.5 }}>Periodically check whether the laws, ordinances, and rules behind your configuration have changed. Proposed updates are held for your review — nothing is applied until you approve it.</p>

      {msg ? <div style={{ background: '#EBF3FB', border: '1px solid #BFD9F2', color: navy, borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '16px' }}>{msg}</div> : null}

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={lbl}>Status</div>
            <div style={{ fontSize: '14px', color: '#111', marginTop: '4px' }}>
              Reminders go to <strong>{status.recipient}</strong> every <strong>{status.cadenceDays} days</strong>.{' '}
              {status.lastRun ? <span>Last checked {String(status.lastRun.created_at).slice(0, 10)}.</span> : <span>No check has run yet.</span>}
            </div>
          </div>
          <button onClick={runReminder} disabled={busy} style={btnOutline}>Send reminder now</button>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#111', marginBottom: '12px' }}>Settings</div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label style={lbl}>Remind every (days)</label><input type="number" min="1" value={cadenceInput} onChange={function (e) { setCadenceInput(e.target.value); }} style={{ display: 'block', marginTop: '4px', width: '100px', padding: '7px 10px', borderRadius: '8px', border: '1px solid #E5E7EB', fontSize: '13px' }} /></div>
          <div style={{ flex: 1, minWidth: '220px' }}><label style={lbl}>Reminder recipient</label><input type="email" value={recipientInput} onChange={function (e) { setRecipientInput(e.target.value); }} style={{ display: 'block', marginTop: '4px', width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: '8px', border: '1px solid #E5E7EB', fontSize: '13px' }} /></div>
          <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', paddingBottom: '7px' }}><input type="checkbox" checked={autoInput} onChange={function (e) { setAutoInput(e.target.checked); }} /> Auto-check sources on schedule</label>
          <button onClick={saveSettings} disabled={busy} style={btn}>Save</button>
        </div>
        <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '8px' }}>With auto-check on, each scheduled run also fetches your registered source URLs and stages any changes for review (best-effort). The reminder email always sends regardless.</div>
      </div>

      {proposals.length > 0 ? (
        <div style={card}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#111', marginBottom: '12px' }}>Pending review ({proposals.length})</div>
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
                  <button onClick={function () { dismiss(p.id); }} disabled={busy} style={Object.assign({}, btnOutline, { color: '#9B1C1C' })}>Dismiss</button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div style={card}>
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#111', marginBottom: '4px' }}>Registered sources</div>
        <div style={{ fontSize: '12px', color: '#9CA3AF', marginBottom: '12px' }}>Where each rule domain&rsquo;s governing text lives. &ldquo;Check now&rdquo; tries to read the source; if it can&rsquo;t, paste the text below.</div>
        {DOMAINS.map(function (d) {
          var list = sourcesByDomain[d.key] || [];
          return (
            <div key={d.key} style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: navy, marginBottom: '6px' }}>{d.label}{pendingMap[d.key] ? <span style={{ color: '#92400E', fontWeight: 600 }}> · {pendingMap[d.key]} pending</span> : null}</div>
              {list.length === 0 ? <div style={{ fontSize: '12px', color: '#9CA3AF' }}>No source registered.</div> : list.map(function (s) {
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderTop: '1px solid #F3F4F6', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '240px' }}>
                      <div style={{ fontSize: '13px', color: '#374151' }}>{s.label}</div>
                      <div style={{ fontSize: '11px', color: '#9CA3AF' }}>{s.last_checked_at ? ('last checked ' + String(s.last_checked_at).slice(0, 10)) : 'never checked'}{s.url ? <span> · <a href={s.url} target="_blank" rel="noreferrer" style={{ color: navy }}>source</a></span> : null}</div>
                    </div>
                    <button onClick={function () { checkSource(s.id); }} disabled={busy} style={btnOutline}>Check now</button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div style={card}>
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#111', marginBottom: '8px' }}>Paste a document to check</div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
          <label style={lbl}>Domain</label>
          <select value={pasteDomain} onChange={function (e) { setPasteDomain(e.target.value); }} style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid #E5E7EB', fontSize: '13px' }}>
            {DOMAINS.map(function (d) { return <option key={d.key} value={d.key}>{d.label}</option>; })}
          </select>
        </div>
        <textarea value={pasteText} onChange={function (e) { setPasteText(e.target.value); }} placeholder="Paste the statute, ordinance, or fee-schedule text here…" rows={5} style={{ width: '100%', boxSizing: 'border-box', padding: '10px', borderRadius: '8px', border: '1px solid #E5E7EB', fontSize: '13px', fontFamily: 'inherit' }} />
        <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}><button onClick={submitPaste} disabled={busy || !pasteText.trim()} style={btn}>Analyze &amp; stage proposal</button><span style={{ fontSize: '12px', color: '#9CA3AF' }}>or upload a file (PDF / text):</span><input type="file" accept=".pdf,.txt,.md,.html,.htm" onChange={function (e) { var f = e.target.files && e.target.files[0]; if (f) { uploadFile(f); e.target.value = ''; } }} style={{ fontSize: '12px' }} /></div>
      </div>

      {review ? <ReviewModal review={review} setReview={setReview} busy={busy} onApply={applyProposal} onDismiss={dismiss} /> : null}
    </div>
  );
}

function ReviewModal(props) {
  var review = props.review, setReview = props.setReview, busy = props.busy;
  var d = review.detail, p = d.proposal;
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
              <button onClick={function () { props.onDismiss(p.id); }} disabled={busy} style={Object.assign({}, btnOutline, { color: '#9B1C1C' })}>Dismiss</button>
              <button onClick={function () { try { JSON.parse(review.editedText); set({ step: 2, error: '' }); } catch (e) { set({ error: 'The edited configuration is not valid JSON — please fix it first.' }); } }} disabled={busy} style={btn}>Continue to confirm</button>
            </div>
            {d.applyMode === 'stage_drafts' ? <div style={{ background: '#FFFBEB', border: '1px solid #FEF3C7', borderRadius: '8px', padding: '12px', fontSize: '13px', color: '#92400E', marginTop: '14px' }}>Applying will add the proposed items as <strong>pending-review drafts</strong> in {d.applyTarget}; they will not take effect until separately approved there.</div> : null}
          </div>
        ) : (
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#111', margin: '6px 0 10px' }}>Confirm &amp; apply</h2>
            <div style={{ background: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: '8px', padding: '14px 16px', fontSize: '13px', color: '#92400E', lineHeight: 1.55 }}>
              {d.applyMode === 'stage_drafts' ? <span><strong>Please confirm.</strong> These items will be added as <strong>pending-review drafts</strong> in {d.applyTarget}. They do not take effect until separately reviewed and approved there. Optimum Q proposes configuration but does not provide legal advice.</span> : <span><strong>Please confirm before applying.</strong> Applying this change updates the live configuration the system uses to process requests ({d.applyTarget}). You are responsible for verifying it against the cited authority. Optimum Q proposes configuration but does not provide legal advice; this is not a substitute for review by your legal counsel.</span>}
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', color: '#374151', marginTop: '14px', cursor: 'pointer' }}>
              <input type="checkbox" checked={review.agreed} onChange={function (e) { set({ agreed: e.target.checked }); }} style={{ marginTop: '3px' }} />
              <span>I have reviewed this update against its source and authorize {d.applyMode === 'stage_drafts' ? 'adding it as pending-review drafts' : 'applying it to the live configuration'}.</span>
            </label>
            {review.error ? <div style={{ color: '#9B1C1C', fontSize: '13px', marginTop: '10px' }}>{review.error}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '18px' }}>
              <button onClick={function () { set({ step: 1, error: '' }); }} disabled={busy} style={btnOutline}>Back</button>
              <button onClick={props.onApply} disabled={busy || !review.agreed} style={Object.assign({}, btn, { background: review.agreed ? navy : '#9CA3AF' })}>{d.applyMode === 'stage_drafts' ? 'Add as drafts' : 'Agree & apply'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
