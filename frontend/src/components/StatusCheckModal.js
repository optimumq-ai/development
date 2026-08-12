import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { STAGE_LABELS, STAGE_COLORS } from '../lib/stages';

const API = (process.env.REACT_APP_API_URL || '/api');

// PORTAL STATUS CHECK modal (SPEC_portal_status_check.md, decided 2026-08-12). Opened from the /portal
// landing's third row. v2 idiom: scoped styles on the wizard's palette tokens — the v1 landing's inline
// styles are deliberately NOT the reference (UI rule). Everything shown here is the backend allowlist;
// the modal adds only the agency contact line, which is already public config.
const STYLES = `
.psc-overlay{position:fixed;inset:0;background:rgba(20,32,43,.45);display:flex;align-items:center;
  justify-content:center;padding:20px;z-index:60}
.psc{
  --panel:#EBF3FB; --surface:#FFFFFF; --civic:#1F4E79; --civic-700:#163A5C; --civic-tint:#E7EEF6;
  --ink:#14202B; --muted:#5B6B7A; --hair:#C9D6E2; --danger:#B23A3A;
  --shadow:0 1px 2px rgba(20,32,43,.06),0 10px 32px rgba(20,32,43,.18);
  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  width:100%;max-width:560px;background:var(--panel);color:var(--ink);font-family:var(--sans);
  font-size:15px;line-height:1.5;border:1px solid var(--hair);border-radius:14px;box-shadow:var(--shadow);
  padding:26px 28px;-webkit-font-smoothing:antialiased;max-height:86vh;overflow-y:auto}
@media (prefers-color-scheme:dark){
  .psc{--panel:#131E29;--surface:#1E3040;--civic:#5B93C7;--civic-700:#7FB0DC;--civic-tint:#1B2C3B;
    --ink:#E6EEF5;--muted:#93A6B6;--hair:#2A3B4B;--danger:#D77C7C;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 12px 36px rgba(0,0,0,.5)}
}
.psc *{box-sizing:border-box}
.psc .eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--civic);
  font-weight:600;margin-bottom:8px}
.psc h2{font-size:22px;font-weight:700;margin:0 0 6px}
.psc .lede{color:var(--muted);margin:0 0 18px;font-size:14px}
.psc label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
.psc input{width:100%;padding:11px 14px;border:1px solid var(--hair);border-radius:9px;font-size:16px;
  font-family:inherit;background:var(--surface);color:var(--ink);letter-spacing:.04em}
.psc input:focus-visible,.psc button:focus-visible{outline:2px solid var(--civic);outline-offset:2px}
.psc .actions{display:flex;gap:12px;justify-content:flex-end;margin-top:20px}
.psc .btn{background:var(--civic);color:#fff;border:1px solid var(--civic);padding:11px 18px;
  border-radius:9px;font-weight:600;font-size:14px;font-family:inherit;cursor:pointer}
.psc .btn:hover{background:var(--civic-700);border-color:var(--civic-700)}
.psc .btn:disabled{opacity:.45;cursor:not-allowed}
.psc .btn.sec{background:transparent;color:var(--civic)}
.psc .btn.sec:hover{background:var(--civic-tint)}
.psc .nomatch{background:var(--surface);border:1px solid var(--hair);border-radius:9px;padding:14px 16px;
  color:var(--danger);font-size:14px;margin-top:16px}
.psc .result{background:var(--surface);border:1px solid var(--hair);border-radius:9px;padding:16px 18px;
  margin-top:16px}
.psc .reqnum{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:var(--civic)}
.psc .who{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;
  margin-bottom:4px}
.psc .whoname{font-weight:600}
.psc .roll{font-size:13px;color:var(--muted)}
.psc .pill{display:inline-block;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:600;
  white-space:nowrap}
.psc .kids{margin-top:10px;border-top:1px solid var(--hair)}
.psc .kid{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--hair)}
.psc .kid:last-child{border-bottom:none}
.psc .kidno{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--muted);
  flex-shrink:0;width:28px}
.psc .kidlabel{flex:1;font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.psc .contact{margin-top:14px;font-size:13px;color:var(--muted)}
`;

function StagePill({ stage, label }) {
  var c = STAGE_COLORS[stage] || { bg: '#F1F5F9', color: '#475569' };
  return <span className="pill" style={{ background: c.bg, color: c.color }}>{label || STAGE_LABELS[stage] || stage}</span>;
}

export default function StatusCheckModal({ contactEmail, contactPhone, onClose }) {
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // the endpoint's body, verbatim
  const inputRef = useRef(null);

  useEffect(function () { if (inputRef.current) inputRef.current.focus(); }, []);
  useEffect(function () {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return function () { window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  async function check() {
    if (!number.trim() || busy) return;
    setBusy(true);
    try {
      var r = await axios.post(API + '/public/request-status', { requestNumber: number });
      setResult(r.data);
    } catch (e) {
      var b = e && e.response && e.response.data;
      setResult({ found: false, message: (b && (b.error || b.message)) || 'Something went wrong. Please try again in a moment.' });
    }
    setBusy(false);
  }
  function reset() { setResult(null); setNumber(''); if (inputRef.current) inputRef.current.focus(); }

  var contact = [contactEmail, contactPhone].filter(Boolean).join(' or ');

  return (
    <div className="psc-overlay" onMouseDown={function (e) { if (e.target === e.currentTarget) onClose(); }}>
      <style>{STYLES}</style>
      <div className="psc" role="dialog" aria-modal="true" aria-label="Check request status">
        <div className="eyebrow">Public Records Portal</div>
        <h2>Check Request Status</h2>
        {!result && (
          <>
            <p className="lede">Enter your request number. It is on your confirmation email and looks like 2026-000123.</p>
            <label htmlFor="psc-number">Request number</label>
            <input id="psc-number" ref={inputRef} value={number} placeholder="2026-000123"
              onChange={function (e) { setNumber(e.target.value); }}
              onKeyDown={function (e) { if (e.key === 'Enter') check(); }} />
            <div className="actions">
              <button className="btn sec" onClick={onClose}>Cancel</button>
              <button className="btn" onClick={check} disabled={busy || !number.trim()}>{busy ? 'Checking…' : 'Check Status'}</button>
            </div>
          </>
        )}
        {result && !result.found && (
          <>
            <div className="nomatch">{result.message}</div>
            {contact ? <div className="contact">Need help? Contact {contact}.</div> : null}
            <div className="actions">
              <button className="btn sec" onClick={onClose}>Close</button>
              <button className="btn" onClick={reset}>Try Again</button>
            </div>
          </>
        )}
        {result && result.found && (
          <>
            <p className="lede">Request <span className="reqnum">{result.requestNumber}</span></p>
            <div className="result">
              <div className="who">
                <span className="whoname">{result.requestorName || '—'}</span>
                {result.children
                  ? <span className="roll">{result.children.length} records · {result.processStatus}</span>
                  : <StagePill stage={result.stage} label={result.stageLabel} />}
              </div>
              {result.children && (
                <div className="kids">
                  {result.children.map(function (c) {
                    return (
                      <div className="kid" key={c.childNo}>
                        <span className="kidno">–{c.childNo}</span>
                        <span className="kidlabel">{c.label}</span>
                        <StagePill stage={c.stage} label={c.stageLabel} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {contact ? <div className="contact">Questions about this request? Contact {contact}.</div> : null}
            <div className="actions">
              <button className="btn sec" onClick={reset}>Check Another</button>
              <button className="btn" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
