import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

// ── Public Open Records WIZARD (SPEC §2c) ──────────────────────────────────────
// Slice 1: full-screen stepped shell + progress rail + step routing.
// Slice 2: the "Your Information" step + the STRICT email link-verify gate —
//   send a real verification link, poll /verify-status, unlock the rest of the
//   form only when the link is clicked. No "visually verified" fallback, no skip
//   (§2c G5). Backend round-trip already exists (publicChat.js request-verification
//   / verify / verify-status). Email is the sole communication channel; postal is
//   records-delivery only.
// Behind a NEW route (/portal/wizard); the live split-canvas flow at /portal/request
// is untouched until cutover. Palette/type carried from the approved prototype.

const API = (process.env.REACT_APP_API_URL || '/api');
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function validEmail(v) { return EMAIL_RE.test((v || '').trim()); }

const STYLES = `
.pwz{
  --page:#D8E0E8; --panel:#EBF3FB; --surface:#FFFFFF;
  --civic:#1F4E79; --civic-700:#163A5C; --civic-tint:#E7EEF6;
  --ink:#14202B; --muted:#5B6B7A; --hair:#C9D6E2;
  --active:#C77A0A; --active-bg:#FBEFD7; --active-line:#E6B863;
  --done:#2E7D4F; --done-line:#8FC7A6; --done-box:#BFE3CC;
  --danger:#B23A3A;
  --shadow:0 1px 2px rgba(20,32,43,.06),0 6px 20px rgba(20,32,43,.06);
  --radius:10px;
  --serif:Georgia,"Times New Roman",serif;
  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  min-height:100vh;background:var(--page);color:var(--ink);font-family:var(--sans);
  font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased;
}
@media (prefers-color-scheme:dark){
  .pwz{
    --page:#0A1017; --panel:#131E29; --surface:#1E3040;
    --civic:#5B93C7; --civic-700:#7FB0DC; --civic-tint:#1B2C3B;
    --ink:#E6EEF5; --muted:#93A6B6; --hair:#2A3B4B;
    --active:#E0A94A; --active-bg:#3A2E17; --active-line:#7A5F2C;
    --done:#66B487; --done-line:#2F6043; --done-box:#1E4630;
    --danger:#D77C7C;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.35);
  }
}
.pwz *{box-sizing:border-box}
.pwz .wrap{max-width:1040px;margin:0 auto;padding:20px 20px 64px}
.pwz h1{text-wrap:balance;margin:0}
.pwz button{font-family:inherit;font-size:inherit;cursor:pointer}
.pwz button:focus-visible,.pwz input:focus-visible{outline:2px solid var(--civic);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.pwz *{transition:none!important;animation:none!important}}

.pwz .topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 18px;
  background:var(--surface);border:1px solid var(--hair);border-radius:var(--radius);box-shadow:var(--shadow)}
.pwz .crest{font-family:var(--serif);font-size:19px;font-weight:700;letter-spacing:.2px;color:var(--ink)}
.pwz .crest .ai{color:var(--civic)}
.pwz .sub{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.pwz .devtag{display:inline-flex;align-items:center;gap:7px;font-size:11px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--active);border:1px dashed var(--active-line);background:var(--active-bg);
  padding:5px 10px;border-radius:20px;font-weight:700}

.pwz .rail{display:flex;gap:6px;margin:12px 0 18px;background:var(--surface);border:1px solid var(--hair);
  border-radius:var(--radius);padding:8px;box-shadow:var(--shadow);overflow-x:auto}
.pwz .node{flex:1 1 0;min-width:120px;display:flex;align-items:center;gap:9px;padding:9px 12px;border-radius:8px;
  font-size:13px;color:var(--muted);white-space:nowrap}
.pwz .node .dot{width:20px;height:20px;border-radius:50%;border:2px solid var(--hair);display:grid;
  place-items:center;font-size:11px;font-weight:700;color:var(--muted);background:var(--panel)}
.pwz .node.done{color:var(--done);background:var(--done-box)}
.pwz .node.done .dot{border-color:var(--done-line);background:var(--surface);color:var(--done)}
.pwz .node.active{color:var(--active);background:var(--active-bg)}
.pwz .node.active .dot{border-color:var(--active-line);background:var(--surface);color:var(--active)}

.pwz .card{background:var(--panel);border:1px solid var(--hair);border-radius:14px;padding:26px 28px;
  box-shadow:var(--shadow);min-height:280px;display:flex;flex-direction:column}
.pwz .eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--civic);font-weight:600;
  margin-bottom:8px}
.pwz .title{font-family:var(--serif);font-size:26px;font-weight:700;letter-spacing:.2px;margin-bottom:6px}
.pwz .lede{color:var(--muted);max-width:64ch;margin:0 0 8px}
.pwz .stub{margin-top:14px;border:1px dashed var(--hair);background:var(--surface);border-radius:9px;
  padding:14px 16px;font-size:13px;color:var(--muted);max-width:64ch}
.pwz .stub b{color:var(--ink)}
.pwz .spacer{flex:1}
.pwz .actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:22px}
.pwz .btn{background:var(--civic);color:#fff;border:1px solid var(--civic);padding:11px 18px;border-radius:9px;
  font-weight:600;font-size:14px}
.pwz .btn:hover{background:var(--civic-700);border-color:var(--civic-700)}
.pwz .btn:disabled{opacity:.45;cursor:not-allowed}
.pwz .btn.sec{background:transparent;color:var(--civic)}
.pwz .btn.sec:hover{background:var(--civic-tint)}
.pwz .btn.sm{padding:8px 13px;font-size:13px}

/* form */
.pwz .field{margin:0 0 16px;max-width:520px}
.pwz .field > label{display:block;font-weight:600;font-size:13px;margin-bottom:6px}
.pwz .field .hint{font-weight:400;color:var(--muted);font-size:12px}
.pwz input[type=text],.pwz input[type=email]{width:100%;background:var(--surface);color:var(--ink);
  border:1px solid var(--hair);border-radius:8px;padding:10px 12px;font-size:15px}
.pwz .inline{display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap}
.pwz .inline input[type=email]{flex:1 1 240px}
.pwz .lead-note{font-size:12.5px;line-height:1.5;color:var(--muted);margin:-2px 0 10px;max-width:520px}
.pwz .lead-note b{color:var(--ink)}

.pwz .lockbanner{display:flex;gap:10px;align-items:flex-start;background:var(--civic-tint);border:1px solid var(--hair);
  border-left:3px solid var(--civic);border-radius:8px;padding:10px 12px;font-size:13px;margin:0 0 14px;max-width:520px}
.pwz .lockbanner .pulse{width:9px;height:9px;border-radius:50%;background:var(--civic);margin-top:4px;flex:none;
  animation:pwzpulse 1.4s ease-in-out infinite}
@keyframes pwzpulse{0%,100%{opacity:.35}50%{opacity:1}}
.pwz .verified{display:flex;align-items:center;gap:8px;color:var(--done);font-weight:600;font-size:13px;margin:0 0 16px}
.pwz .expired{color:var(--danger);font-size:13px;margin:0 0 12px;max-width:520px}
.pwz .senderr{color:var(--danger);font-size:12.5px;margin:6px 0 0}

.pwz .locked.is-locked > .lockfield{opacity:.42;pointer-events:none;filter:saturate(.6)}
.pwz .opt{display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border:1px solid var(--hair);
  border-radius:9px;background:var(--surface);margin:0 0 8px;max-width:520px;cursor:pointer}
.pwz .opt:hover{border-color:var(--civic)}
.pwz .opt.checked{border-color:var(--civic);background:var(--civic-tint)}
.pwz .opt input{margin-top:3px}
.pwz .opt .ot{font-weight:600;font-size:14px}
.pwz .opt .od{font-size:12.5px;color:var(--muted)}
.pwz .addr{max-width:520px;display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:4px 0 10px}
.pwz .addr .full{grid-column:1/3}
`;

const RAIL = ['Begin', 'Your Information', 'Item Search', 'Submitted'];

const EMPTY_ADDR = { street1: '', street2: '', city: '', state: '', zip: '' };

export default function PublicPortalWizardPage() {
  const [idx, setIdx] = useState(0);

  // ── Your Information (slice 2) ──
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [sendState, setSendState] = useState('idle'); // idle | sending | sent | error
  const [token, setToken] = useState(null);
  const [verified, setVerified] = useState(false);
  const [expired, setExpired] = useState(false);
  const [deliv, setDeliv] = useState('email'); // email | mail
  const [addr, setAddr] = useState(EMPTY_ADDR);
  const [cert, setCert] = useState(false);
  const [fee, setFee] = useState('standard'); // standard | waiver | commercial
  const [waiverReason, setWaiverReason] = useState('');
  const pollRef = useRef(null);

  const emailOk = validEmail(email);
  const addrComplete = !!(addr.street1 && addr.city && addr.state && addr.zip);
  const canProceed = verified && (deliv === 'email' || addrComplete);

  // Poll the verification status until the citizen clicks the emailed link (or it expires).
  useEffect(function () {
    if (!token || verified || expired) return undefined;
    pollRef.current = setInterval(async function () {
      try {
        const res = await axios.get(API + '/public/verify-status/' + token);
        if (res.data && res.data.verified) { setVerified(true); }
        else if (res.data && res.data.expired) { setExpired(true); }
      } catch (e) { /* transient — keep polling */ }
    }, 3000);
    return function () { if (pollRef.current) clearInterval(pollRef.current); };
  }, [token, verified, expired]);

  function resetGate() {
    setSendState('idle'); setToken(null); setVerified(false); setExpired(false);
  }
  function onEmailChange(v) {
    // Editing a sent/verified address invalidates the gate.
    if (token || verified) resetGate();
    setEmail(v);
  }
  async function sendLink() {
    if (!emailOk) return;
    setSendState('sending'); setExpired(false);
    try {
      const res = await axios.post(API + '/public/request-verification', { email: email.trim() });
      const tok = res.data && res.data.token;
      if (!tok) { setSendState('error'); return; }
      setToken(tok); setSendState('sent');
    } catch (e) { setSendState('error'); }
  }

  const step = STEP_META[idx];
  const railIdx = step.rail;
  const first = idx === 0;
  const last = idx === STEP_META.length - 1;

  function renderInfo() {
    return (
      <div className="card">
        <div className="eyebrow">Step 2 of {RAIL.length}</div>
        <h1 className="title">Your information</h1>
        <p className="lede">To create a request you must provide an email address and verify it by clicking a link
          we send you. We use email to send you updates and your request number.</p>

        <div style={{ marginTop: '10px' }}>
          <div className="field">
            <label htmlFor="pwz-name">Full name</label>
            <input id="pwz-name" type="text" value={name} placeholder="Jordan Rivera"
              onChange={function (e) { setName(e.target.value); }} />
          </div>

          <div className="field">
            <label htmlFor="pwz-email">Email address</label>
            <div className="inline">
              <input id="pwz-email" type="email" value={email} placeholder="you@example.com"
                onChange={function (e) { onEmailChange(e.target.value); }} />
              <button className="btn sm" onClick={sendLink} disabled={!emailOk || sendState === 'sending' || (!!token && !expired && !verified)}>
                {sendState === 'sending' ? 'Sending…' : (token || verified) ? 'Resend link' : 'Send verification link'}
              </button>
            </div>
            {sendState === 'error' && <div className="senderr">We couldn't send the link. Check the address and try again.</div>}
          </div>

          {token && !verified && !expired && (
            <div className="lockbanner">
              <span className="pulse" />
              <div>We've emailed a verification link to <b>{email.trim()}</b>. <b>Click the link to continue</b> —
                the rest of the form stays locked until you do. (This page updates automatically.)</div>
            </div>
          )}
          {expired && (
            <div className="expired">That link expired. Click <b>Resend link</b> above to get a new one.</div>
          )}
          {verified && (
            <div className="verified"><span>✓</span> Email verified — the rest of the form is unlocked.</div>
          )}

          <div className={'locked' + (verified ? '' : ' is-locked')}>
            <div className="lockfield">
              <div className="field">
                <label>Phone <span className="hint">(optional)</span></label>
                <input type="text" value={phone} placeholder="(555) 555-0134"
                  onChange={function (e) { setPhone(e.target.value); }} />
              </div>

              <div className="field">
                <label>Records delivery</label>
                <div className="lead-note">
                  <b>Communications about your request will always be by email.</b> The records themselves can be
                  delivered by email or postal mail — select your preferred method of records delivery.
                </div>
                <div className={'opt' + (deliv === 'email' ? ' checked' : '')} onClick={function () { setDeliv('email'); }}>
                  <input type="radio" name="pwz-deliv" readOnly checked={deliv === 'email'} />
                  <div><div className="ot">Email / download</div><div className="od">Fastest. Records delivered digitally.</div></div>
                </div>
                <div className={'opt' + (deliv === 'mail' ? ' checked' : '')} onClick={function () { setDeliv('mail'); }}>
                  <input type="radio" name="pwz-deliv" readOnly checked={deliv === 'mail'} />
                  <div><div className="ot">Postal mail</div><div className="od">Physical copies mailed to you. We still email you updates.</div></div>
                </div>
                {deliv === 'mail' && (
                  <div className="addr">
                    <input className="full" type="text" placeholder="Street address" value={addr.street1}
                      onChange={function (e) { setAddr(Object.assign({}, addr, { street1: e.target.value })); }} />
                    <input className="full" type="text" placeholder="Street address line 2 (optional)" value={addr.street2}
                      onChange={function (e) { setAddr(Object.assign({}, addr, { street2: e.target.value })); }} />
                    <input type="text" placeholder="City" value={addr.city}
                      onChange={function (e) { setAddr(Object.assign({}, addr, { city: e.target.value })); }} />
                    <input type="text" placeholder="State" value={addr.state}
                      onChange={function (e) { setAddr(Object.assign({}, addr, { state: e.target.value })); }} />
                    <input type="text" placeholder="ZIP" value={addr.zip}
                      onChange={function (e) { setAddr(Object.assign({}, addr, { zip: e.target.value })); }} />
                  </div>
                )}
              </div>

              <div className="field">
                <label>Options</label>
                <div className={'opt' + (cert ? ' checked' : '')} onClick={function () { setCert(!cert); }}>
                  <input type="checkbox" readOnly checked={cert} />
                  <div><div className="ot">Certification</div><div className="od">Include a page attesting the records are true and accurate. Additional fees may apply.</div></div>
                </div>
              </div>

              <div className="field">
                <label>Fees</label>
                <div className={'opt' + (fee === 'standard' ? ' checked' : '')} onClick={function () { setFee('standard'); }}>
                  <input type="radio" name="pwz-fee" readOnly checked={fee === 'standard'} />
                  <div><div className="ot">Continue with standard rates</div><div className="od">The default for most requests.</div></div>
                </div>
                <div className={'opt' + (fee === 'waiver' ? ' checked' : '')} onClick={function () { setFee('waiver'); }}>
                  <input type="radio" name="pwz-fee" readOnly checked={fee === 'waiver'} />
                  <div><div className="ot">Request a fee waiver</div><div className="od">For non-profit journalists, research, or public-interest requests. Subject to review.</div></div>
                </div>
                {fee === 'waiver' && (
                  <div className="field" style={{ marginTop: '2px' }}>
                    <input type="text" placeholder="Briefly, the public-interest reason" value={waiverReason}
                      onChange={function (e) { setWaiverReason(e.target.value); }} />
                  </div>
                )}
                <div className={'opt' + (fee === 'commercial' ? ' checked' : '')} onClick={function () { setFee('commercial'); }}>
                  <input type="radio" name="pwz-fee" readOnly checked={fee === 'commercial'} />
                  <div><div className="ot">I'm a commercial requester</div><div className="od">Commercial-use rates apply. Subject to review.</div></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="spacer" />
        <div className="actions">
          <button className="btn sec" onClick={function () { setIdx(idx - 1); }}>{'←'} Back</button>
          <button className="btn" onClick={function () { setIdx(idx + 1); }} disabled={!canProceed}>
            Proceed to record search {'→'}
          </button>
        </div>
      </div>
    );
  }

  function renderPlaceholder() {
    return (
      <div className="card">
        <div className="eyebrow">Step {railIdx + 1} of {RAIL.length}</div>
        <h1 className="title">{step.title}</h1>
        <p className="lede">{step.lede}</p>
        <div className="stub"><b>Coming in a later slice.</b> {step.stub}</div>
        <div className="spacer" />
        <div className="actions">
          {!first && <button className="btn sec" onClick={function () { setIdx(idx - 1); }}>{'←'} Back</button>}
          {!last && <button className="btn" onClick={function () { setIdx(idx + 1); }}>Next {'→'}</button>}
          {last && <button className="btn sec" onClick={function () { setIdx(0); }}>Start over</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="pwz">
      <style>{STYLES}</style>
      <div className="wrap">
        <div className="topbar">
          <div>
            <div className="crest">City of Autumn Falls <span className="ai">· AI Open Records</span></div>
            <div className="sub">Open Records Request Portal</div>
          </div>
          <span className="devtag" title="Wizard rebuild in progress (SPEC §2c). The live portal is at /portal/request.">
            Preview build · in development
          </span>
        </div>

        <div className="rail" aria-label="Request progress">
          {RAIL.map(function (label, i) {
            var cls = 'node' + (i < railIdx ? ' done' : i === railIdx ? ' active' : '');
            return (
              <div key={label} className={cls} aria-current={i === railIdx ? 'step' : undefined}>
                <span className="dot">{i < railIdx ? '✓' : i + 1}</span> {label}
              </div>
            );
          })}
        </div>

        {idx === 1 ? renderInfo() : renderPlaceholder()}
      </div>
    </div>
  );
}

// Placeholder copy for the not-yet-built steps (begin/items/submitted).
const STEP_META = [
  { rail: 0, title: 'Welcome to the AI-powered Open Records Request portal',
    lede: "You'll enter your contact information, then describe the records you're looking for — one at a time. The assistant helps you search; you stay in control of what to submit.",
    stub: 'Shell, progress rail, and step routing — slice 1.' },
  { rail: 1, title: 'Your information', lede: '', stub: '' },
  { rail: 2, title: 'Search for records',
    lede: 'Describe one record at a time. The assistant runs the search, then steps aside so you drive from the results.',
    stub: 'Slices 3–4: the Item 1–10 rail with color states, the assistant-then-hide describe loop, and the results window (records found / not-searchable / no matches) with per-record selection, team-search, and remove-item.' },
  { rail: 3, title: 'Submitted',
    lede: 'Your request is created and your number is shown here.',
    stub: 'Slice 5: submit-or-continue with the empty-request guard, then the on-screen confirmation number (the request is born only at Submit — §0).' },
];
