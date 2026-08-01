import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

// EXTERNAL-CONTRIBUTOR PAGE (2026-08-01). Public: the token in the URL is the whole credential; no login,
// no account, and axios is used RAW here — the staff api client would attach a Bearer header this page
// must not depend on. Scope discipline mirrors the server's: this page shows the assignment (the item's
// verbatim words, the activity asked, the request number) and nothing else. ONE VOICE: the only contact
// offered is the Request Manager's — an external contributor never talks to the requestor.
const API = (process.env.REACT_APP_API_URL || '/api');

const C = { navy: '#1F4E79', ink: '#111827', dim: '#6B7280', line: '#E5E7EB', bg: '#F9FAFB',
  green: '#166534', greenBg: '#F0FDF4', red: '#9B1C1C', redBg: '#FDE8E8' };
const card = { maxWidth: 640, margin: '0 auto', background: 'white', borderRadius: 12,
  border: '1px solid ' + C.line, padding: '28px 30px' };
const btn = { padding: '10px 20px', borderRadius: 8, border: 'none', background: C.navy, color: 'white',
  fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const btnQuiet = Object.assign({}, btn, { background: 'white', color: C.navy, border: '1px solid ' + C.line });

export default function ContributePage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [gone, setGone] = useState(null);       // the 404 / 410 sentence
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [file, setFile] = useState(null);

  useEffect(function () { load(); /* eslint-disable-next-line */ }, [token]);
  async function load() {
    try {
      var r = await axios.get(API + '/contribute/' + token);
      setData(r.data); setGone(null);
    } catch (e) {
      setGone((e.response && e.response.data && e.response.data.error) || 'This link is not recognized.');
    }
  }

  async function uploadFile() {
    if (!file) return;
    setBusy(true); setMsg('');
    try {
      var fd = new FormData(); fd.append('file', file);
      await axios.post(API + '/contribute/' + token + '/files', fd);
      setFile(null); setMsg('Uploaded.'); await load();
    } catch (e) { setMsg((e.response && e.response.data && e.response.data.error) || 'Upload failed.'); }
    setBusy(false);
  }
  async function sendNote() {
    if (!note.trim()) return;
    setBusy(true); setMsg('');
    try {
      await axios.post(API + '/contribute/' + token + '/note', { note: note.trim() });
      setNote(''); setMsg('Note sent to the Request Manager.');
    } catch (e) { setMsg((e.response && e.response.data && e.response.data.error) || 'Could not send the note.'); }
    setBusy(false);
  }
  async function markComplete() {
    if (!window.confirm('Mark your part complete? The Request Manager is told your work here is done, and this link closes.')) return;
    setBusy(true); setMsg('');
    try {
      await axios.post(API + '/contribute/' + token + '/complete', { note: note.trim() || undefined });
      await load();
    } catch (e) { setMsg((e.response && e.response.data && e.response.data.error) || 'Could not complete.'); }
    setBusy(false);
  }

  const shell = function (inner) {
    return <div style={{ minHeight: '100vh', background: C.bg, padding: '48px 16px', fontFamily: 'Arial,sans-serif' }}>{inner}</div>;
  };

  if (gone) return shell(
    <div style={card}>
      <h1 style={{ color: C.red, fontSize: 20, margin: '0 0 10px' }}>This link is not active</h1>
      <p style={{ color: C.dim, fontSize: 14, lineHeight: 1.5 }}>{gone}</p>
    </div>
  );
  if (!data) return shell(<div style={card}><p style={{ color: C.dim, fontSize: 14 }}>Loading…</p></div>);

  const done = data.linkState === 'completed';
  return shell(
    <div style={card}>
      <div style={{ borderBottom: '1px solid ' + C.line, paddingBottom: 14, marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: C.dim }}>{data.agency}</div>
        <h1 style={{ color: C.navy, fontSize: 20, margin: '4px 0 0' }}>
          {data.activityName} — request {data.requestNumber}
        </h1>
      </div>

      {done ? (
        <div style={{ background: C.greenBg, border: '1px solid #86EFAC', borderRadius: 10, padding: '16px 18px', marginBottom: 16 }}>
          <div style={{ color: C.green, fontWeight: 700, fontSize: 15 }}>✅ Your part is complete — thank you.</div>
          <div style={{ color: C.dim, fontSize: 13, marginTop: 4 }}>
            Completed {data.completedAt}. Nothing more is needed on this link.
          </div>
        </div>
      ) : null}

      <div style={{ fontSize: 12, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
        What was requested — in the requestor's own words
      </div>
      <div style={{ border: '1px solid ' + C.line, borderRadius: 8, padding: '12px 14px', fontSize: 14, color: C.ink,
        whiteSpace: 'pre-wrap', background: C.bg, marginBottom: 18 }}>{data.description}</div>

      {!done ? (
        <React.Fragment>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
            Upload records
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            <input type="file" onChange={function (e) { setFile(e.target.files[0] || null); }} style={{ fontSize: 13 }} />
            <button style={btnQuiet} disabled={busy || !file} onClick={uploadFile}>Upload</button>
          </div>
        </React.Fragment>
      ) : null}
      {data.yourUploads && data.yourUploads.length ? (
        <ul style={{ fontSize: 13, color: C.ink, margin: '4px 0 14px', paddingLeft: 18 }}>
          {data.yourUploads.map(function (f) { return <li key={f.id}>{f.name} <span style={{ color: C.dim }}>({f.at})</span></li>; })}
        </ul>
      ) : null}

      {!done ? (
        <React.Fragment>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '.05em', margin: '10px 0 6px' }}>
            Note to the Request Manager
          </div>
          <textarea rows={3} value={note} onChange={function (e) { setNote(e.target.value); }}
            placeholder="Anything the Request Manager should know — what you found, what you could not find, questions."
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid ' + C.line, borderRadius: 8, padding: '10px 12px', fontSize: 14 }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={btnQuiet} disabled={busy || !note.trim()} onClick={sendNote}>Send note</button>
            <button style={btn} disabled={busy} onClick={markComplete}>Mark my part complete</button>
            {msg ? <span style={{ fontSize: 13, color: C.dim }}>{msg}</span> : null}
          </div>
        </React.Fragment>
      ) : null}

      <div style={{ borderTop: '1px solid ' + C.line, marginTop: 20, paddingTop: 12, fontSize: 12, color: C.dim }}>
        Questions go to the Request Manager{data.requestManager && data.requestManager.name ? ' — ' + data.requestManager.name : ''}
        {data.requestManager && data.requestManager.email
          ? <React.Fragment> · <a href={'mailto:' + data.requestManager.email} style={{ color: C.navy }}>{data.requestManager.email}</a></React.Fragment>
          : null}.
        {' '}This secure page works until {data.expiresAt} and is only for you.
      </div>
    </div>
  );
}
