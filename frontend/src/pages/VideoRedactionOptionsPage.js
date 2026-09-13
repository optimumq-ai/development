import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import SetupScreen, { lbl, inp, hint, field, Msg, PrimaryButton } from '../components/setup/SetupScreen';

// VIDEO REDACTION OPTIONS — the hub's `av_redaction` row (C11, Kevin 2026-08-30: the v1 Configuration
// page's Redaction tab becomes this dedicated screen). The city's default for redacting video and audio
// records — documents are always handled inside Optimum Q. Data: GET/POST /api/config `av_redaction_mode`
// (read by routes/avRedaction.js; the v1 tab's Save never persisted it — POST /config dropped the key).

export default function VideoRedactionOptionsPage() {
  var [mode, setMode] = useState(null);
  var [saving, setSaving] = useState(false);
  var [msg, setMsg] = useState(null);
  useEffect(function () {
    api.get('/config').then(function (r) { setMode((r.data && r.data.av_redaction_mode) || 'internal'); })
      .catch(function () { setMode('internal'); setMsg({ ok: false, text: 'The current setting could not be read.' }); });
  }, []);
  async function save(reload) {
    setSaving(true); setMsg(null);
    try { await api.post('/config', { av_redaction_mode: mode }); setMsg({ ok: true, text: 'Video redaction setting saved.' }); await reload(); }
    catch (e) { setMsg({ ok: false, text: (e.response && e.response.data && e.response.data.error) || 'Could not save.' }); }
    setSaving(false);
  }
  return (
    <SetupScreen hubKey="av_redaction" laneLabel="Request Fulfillment Process Setup — Redaction and Release" title="Video Redaction Options"
      intro="How this city handles redaction of video and audio records. Documents are always redacted inside Optimum Q. This is the city-wide default; teams will be able to override it once team routing is configured.">
      {function (s) {
        if (mode === null) return <div style={{ color: 'var(--oq-fg-9ca3af)' }}>Loading…</div>;
        return (
          <div>
            {msg ? <Msg text={msg.text} ok={msg.ok} /> : null}
            <div style={field}>
              <label style={lbl}>Default video and audio redaction mode</label>
              <select value={mode} disabled={!s.can} onChange={function (e) { setMode(e.target.value); }} style={inp}>
                <option value="internal">Internal — redact with Optimum Q's built-in tools</option>
                <option value="external">External — the city uses its own tool; Optimum Q holds the request and resumes on check-in</option>
                <option value="not_required">Not required — presumptively releasable (still reviewed and confirmed before release)</option>
              </select>
              <div style={hint}>Internal: annotate and burn redactions inside Optimum Q. External: download the original, redact in your own tool (for example a body-camera vendor's software), then check the redacted file back in. Not required: for records that are public by default (for example council meeting video) — a reviewer still confirms before release; nothing is released on this setting alone.</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><PrimaryButton disabled={!s.can || saving} onClick={function () { save(s.reload); }}>{saving ? 'Saving…' : 'Save'}</PrimaryButton></div>
          </div>
        );
      }}
    </SetupScreen>
  );
}
