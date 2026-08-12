import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';

const API = (process.env.REACT_APP_API_URL || '/api');

// RECORD VERIFICATION modal (SPEC_record_verification.md §3, decided 2026-08-12). The flow mirrors the
// certification sheet's instructions: request number → certified gate → verify a digital file by its code,
// or compare visually (the code unlocks the viewer too — §8.1: the code is the access key). v2 idiom,
// scoped styles; the v1 landing is not a design reference.
const STYLES = `
.pvr-overlay{position:fixed;inset:0;background:rgba(20,32,43,.45);display:flex;align-items:center;
  justify-content:center;padding:20px;z-index:60}
.pvr{
  --panel:#EBF3FB; --surface:#FFFFFF; --civic:#1F4E79; --civic-700:#163A5C; --civic-tint:#E7EEF6;
  --ink:#14202B; --muted:#5B6B7A; --hair:#C9D6E2; --danger:#B23A3A;
  --done:#2E7D4F; --done-bg:#E1F0E7; --done-line:#8FC7A6;
  --shadow:0 1px 2px rgba(20,32,43,.06),0 10px 32px rgba(20,32,43,.18);
  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  width:100%;max-width:640px;background:var(--panel);color:var(--ink);font-family:var(--sans);
  font-size:15px;line-height:1.5;border:1px solid var(--hair);border-radius:14px;box-shadow:var(--shadow);
  padding:26px 28px;-webkit-font-smoothing:antialiased;max-height:90vh;overflow-y:auto}
@media (prefers-color-scheme:dark){
  .pvr{--panel:#131E29;--surface:#1E3040;--civic:#5B93C7;--civic-700:#7FB0DC;--civic-tint:#1B2C3B;
    --ink:#E6EEF5;--muted:#93A6B6;--hair:#2A3B4B;--danger:#D77C7C;
    --done:#66B487;--done-bg:#17301F;--done-line:#2F6043;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 12px 36px rgba(0,0,0,.5)}
}
.pvr *{box-sizing:border-box}
.pvr .eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--civic);
  font-weight:600;margin-bottom:8px}
.pvr h2{font-size:22px;font-weight:700;margin:0 0 6px}
.pvr .lede{color:var(--muted);margin:0 0 18px;font-size:14px}
.pvr label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
.pvr input,.pvr select{width:100%;padding:11px 14px;border:1px solid var(--hair);border-radius:9px;
  font-size:16px;font-family:inherit;background:var(--surface);color:var(--ink);letter-spacing:.04em}
.pvr input:focus-visible,.pvr button:focus-visible,.pvr select:focus-visible{outline:2px solid var(--civic);outline-offset:2px}
.pvr .field{margin-bottom:14px}
.pvr .actions{display:flex;gap:12px;justify-content:flex-end;margin-top:20px;flex-wrap:wrap}
.pvr .btn{background:var(--civic);color:#fff;border:1px solid var(--civic);padding:11px 18px;
  border-radius:9px;font-weight:600;font-size:14px;font-family:inherit;cursor:pointer}
.pvr .btn:hover{background:var(--civic-700);border-color:var(--civic-700)}
.pvr .btn:disabled{opacity:.45;cursor:not-allowed}
.pvr .btn.sec{background:transparent;color:var(--civic)}
.pvr .btn.sec:hover{background:var(--civic-tint)}
.pvr .choice{display:flex;gap:12px;flex-wrap:wrap;margin-top:6px}
.pvr .choicebtn{flex:1;min-width:220px;background:var(--surface);border:1px solid var(--hair);
  border-radius:10px;padding:16px;text-align:left;cursor:pointer;font-family:inherit;color:var(--ink)}
.pvr .choicebtn:hover{border-color:var(--civic)}
.pvr .ct{font-weight:700;font-size:15px;margin-bottom:4px;color:var(--civic)}
.pvr .cd{font-size:13px;color:var(--muted)}
.pvr .bad{background:var(--surface);border:1px solid var(--hair);border-radius:9px;padding:14px 16px;
  color:var(--danger);font-size:14px;margin-top:14px}
.pvr .good{background:var(--done-bg);border:1px solid var(--done-line);border-radius:9px;
  padding:14px 16px;color:var(--done);font-size:14px;font-weight:600;margin-top:14px}
.pvr .reqnum{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:var(--civic)}
.pvr .viewer{margin-top:14px;border:1px solid var(--hair);border-radius:9px;overflow:hidden;
  background:var(--surface)}
.pvr .viewer iframe{display:block;width:100%;height:56vh;border:none}
.pvr .viewnote{font-size:12px;color:var(--muted);margin-top:8px}
`;

export default function VerifyRecordModal({ onClose }) {
  const [step, setStep] = useState('number'); // number | choice | code | viewer
  const [number, setNumber] = useState('');
  const [lookup, setLookup] = useState(null); // the /verify/lookup body once certified
  const [gateMsg, setGateMsg] = useState(null);
  const [mode, setMode] = useState('file'); // file | visual
  const [childNo, setChildNo] = useState('');
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null); // the /verify/code body
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(function () { if (inputRef.current) inputRef.current.focus(); }, [step]);
  useEffect(function () {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return function () { window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  async function doLookup() {
    if (!number.trim() || busy) return;
    setBusy(true); setGateMsg(null);
    try {
      var r = await axios.post(API + '/public/verify/lookup', { requestNumber: number });
      if (r.data.state === 'certified') { setLookup(r.data); setChildNo(r.data.records.length ? String(r.data.records[0].childNo) : ''); setStep('choice'); }
      else setGateMsg(r.data.message);
    } catch (e) {
      var b = e && e.response && e.response.data;
      setGateMsg((b && (b.error || b.message)) || 'Something went wrong. Please try again in a moment.');
    }
    setBusy(false);
  }
  async function doVerify(nextMode) {
    var m = nextMode || mode;
    if (!code.trim() || busy) return;
    setBusy(true);
    try {
      var r = await axios.post(API + '/public/verify/code', { requestNumber: number, childNo: childNo || null, code: code });
      setResult(r.data);
      if (m === 'visual' && r.data.verified && r.data.fileKind === 'document') setStep('viewer');
    } catch (e) { setResult({ verified: false, message: 'Something went wrong. Please try again in a moment.' }); }
    setBusy(false);
  }
  function pick(m) { setMode(m); setResult(null); setCode(''); setStep('code'); }
  function viewUrl() {
    return API + '/public/verify-view?number=' + encodeURIComponent(number) +
      '&code=' + encodeURIComponent(code) + (childNo ? '&childNo=' + encodeURIComponent(childNo) : '');
  }

  var recs = (lookup && lookup.records) || [];
  return (
    <div className="pvr-overlay" onMouseDown={function (e) { if (e.target === e.currentTarget) onClose(); }}>
      <style>{STYLES}</style>
      <div className="pvr" role="dialog" aria-modal="true" aria-label="Verify a certified record">
        <div className="eyebrow">Public Records Portal</div>
        <h2>Verify a Certified Record</h2>

        {step === 'number' && (
          <>
            <p className="lede">Enter the request number printed on the certification sheet. It looks like 2026-000123.</p>
            <label htmlFor="pvr-number">Request number</label>
            <input id="pvr-number" ref={inputRef} value={number} placeholder="2026-000123"
              onChange={function (e) { setNumber(e.target.value); }}
              onKeyDown={function (e) { if (e.key === 'Enter') doLookup(); }} />
            {gateMsg ? <div className="bad">{gateMsg}</div> : null}
            <div className="actions">
              <button className="btn sec" onClick={onClose}>Cancel</button>
              <button className="btn" onClick={doLookup} disabled={busy || !number.trim()}>{busy ? 'Checking…' : 'Continue'}</button>
            </div>
          </>
        )}

        {step === 'choice' && (
          <>
            <p className="lede">Request <span className="reqnum">{lookup.requestNumber}</span> was processed with certification{recs.length ? ' — ' + recs.length + ' certified record' + (recs.length > 1 ? 's' : '') : ''}. Choose how to verify.</p>
            <div className="choice">
              <button className="choicebtn" onClick={function () { pick('file'); }}>
                <div className="ct">Verify a digital file</div>
                <div className="cd">Enter the verification code from the certification sheet. The system confirms it matches the certified record.</div>
              </button>
              <button className="choicebtn" onClick={function () { pick('visual'); }}>
                <div className="ct">Compare visually</div>
                <div className="cd">View the certified document on screen and compare it with the printed copy or PDF in hand. The verification code unlocks the view.</div>
              </button>
            </div>
            <div className="actions">
              <button className="btn sec" onClick={function () { setStep('number'); setLookup(null); setGateMsg(null); }}>Back</button>
            </div>
          </>
        )}

        {step === 'code' && (
          <>
            <p className="lede">{mode === 'file' ? 'Enter the verification code printed on the certification sheet for the record you are checking.' : 'Enter the verification code for the record you want to view — it is printed on the certification sheet.'}</p>
            {recs.length > 1 && (
              <div className="field">
                <label htmlFor="pvr-record">Record</label>
                <select id="pvr-record" value={childNo} onChange={function (e) { setChildNo(e.target.value); setResult(null); }}>
                  {recs.map(function (r) { return <option key={r.childNo} value={String(r.childNo)}>{'–' + r.childNo + '  ' + r.label}</option>; })}
                </select>
              </div>
            )}
            <div className="field">
              <label htmlFor="pvr-code">Verification code</label>
              <input id="pvr-code" ref={inputRef} value={code} placeholder="A1B2-C3D4-E5F6-0789"
                onChange={function (e) { setCode(e.target.value); }}
                onKeyDown={function (e) { if (e.key === 'Enter') doVerify(); }} />
            </div>
            {result && result.verified && mode === 'file' ? <div className="good">{result.message}</div> : null}
            {result && result.verified && mode === 'visual' && result.fileKind !== 'document'
              ? <div className="bad">Visual comparison is available for documents only. For this file type, use digital file verification instead — the code you entered already matches, so this record is verified.</div> : null}
            {result && !result.verified ? <div className="bad">{result.message}</div> : null}
            <div className="actions">
              <button className="btn sec" onClick={function () { setStep('choice'); setResult(null); }}>Back</button>
              <button className="btn" onClick={function () { doVerify(); }} disabled={busy || !code.trim()}>{busy ? 'Checking…' : (mode === 'file' ? 'Verify' : 'Verify and View')}</button>
            </div>
          </>
        )}

        {step === 'viewer' && (
          <>
            <p className="lede"><span className="good" style={{ display: 'inline-block', padding: '4px 10px', marginTop: 0 }}>Verified</span>&nbsp; Compare the document below with the copy in hand.</p>
            <div className="viewer"><iframe title="Certified record" src={viewUrl()} /></div>
            <div className="viewnote">Every page should match your copy exactly. Any difference — added, missing, or altered content — means the copy in hand is not the certified record.</div>
            <div className="actions">
              <button className="btn sec" onClick={function () { setStep('code'); setResult(null); }}>Back</button>
              <button className="btn" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
