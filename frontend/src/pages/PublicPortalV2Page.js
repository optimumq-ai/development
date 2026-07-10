import React, { useState, useCallback, useEffect, useRef } from 'react';
import axios from 'axios';

// Split-Canvas Portal Intake — v2, build slice 2: the Phase-0 structured intake form.
// New page alongside the chat-first /portal (cut over later). Design contract:
//   docs/DESIGN_split_canvas_intake.md  ·  mockup: docs/mockups/split_canvas_intake.html
// This slice builds the LEFT canvas in its Phase-0 (form) state + the split shell. The chat
// engine (slice 3), results canvas (slice 4), submit (slice 5) and mobile step-through (slice 6)
// are follow-on slices; PROCEED here performs the defined Phase 0->1 trigger (activate chat).

const API = (process.env.REACT_APP_API_URL || '/api');

var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function validEmail(v) { return EMAIL_RE.test((v || '').trim()); }

// Scoped stylesheet (mockup CSS, prefixed under `.scv` so the generic class names — .field,
// .panel, .btn-primary, .step — cannot leak into other client-side routes during a session).
var STYLES = `
.scv{
  --bg:#D8E0E8; --surface:#FFFFFF; --surface-2:#F2F6F9; --ink:#12232E; --muted:#5C6F7C;
  --hair:#D2DCE3; --hair-strong:#BECAD3;
  --blue:#1E6091; --blue-strong:#164E78; --blue-tint:#E4EEF6; --blue-ink:#0E3A5C;
  --green:#1B8A5A; --green-tint:#E1F2E9; --amber:#9A6512; --amber-tint:#F6EBD6;
  --shadow:0 1px 2px rgba(18,35,46,.06),0 6px 20px rgba(18,35,46,.08);
  --radius:12px; --radius-sm:8px;
  --font-ui:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --font-mono:ui-monospace,"SF Mono","Cascadia Code","Roboto Mono",Menlo,Consolas,monospace;
  --step:.18s cubic-bezier(.4,0,.2,1);
  --field-well:#EBF3FB; --field-bg:#FFFFFF; --field-border:#BCCAD6; --chat-ground:#EBF3FB;
  background:var(--bg); color:var(--ink); font-family:var(--font-ui); font-size:15px; line-height:1.5;
  -webkit-font-smoothing:antialiased; display:flex; flex-direction:column; min-height:100vh;
}
@media (prefers-color-scheme:dark){
  .scv{
    --bg:#0A1017; --surface:#152430; --surface-2:#1B2C3A; --ink:#E7EEF3; --muted:#93A6B4;
    --hair:#26383F; --hair-strong:#33474F;
    --blue:#4FA0D2; --blue-strong:#74B7E1; --blue-tint:#153140; --blue-ink:#9CCBEA;
    --green:#47B885; --green-tint:#123227; --amber:#D4A24C; --amber-tint:#2E2718;
    --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 26px rgba(0,0,0,.45);
    --field-well:#131E29; --field-bg:#1E3040; --field-border:#374C57; --chat-ground:#131E29;
  }
}
.scv *{box-sizing:border-box}
.scv .eyebrow{font-family:var(--font-mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}

.scv .appbar{display:flex;align-items:center;gap:14px;padding:12px 20px;background:var(--surface);
  border-bottom:1px solid var(--hair);flex-wrap:wrap}
.scv .crest{width:38px;height:38px;border-radius:9px;flex:none;display:grid;place-items:center;
  background:linear-gradient(150deg,var(--blue),var(--blue-strong));color:#fff;font-weight:700;
  font-family:var(--font-mono);font-size:16px;letter-spacing:-.02em}
.scv .brand h1{margin:0;font-size:15px;font-weight:650;letter-spacing:-.01em}
.scv .brand p{margin:0;font-size:12px;color:var(--muted)}
.scv .appbar .spacer{flex:1}

.scv .stepper{display:flex;gap:6px;align-items:center;padding:10px 20px;background:var(--surface);
  border-bottom:1px solid var(--hair);overflow-x:auto}
.scv .step{display:flex;align-items:center;gap:8px;padding:5px 12px 5px 6px;border-radius:999px;
  border:1px solid transparent;white-space:nowrap;color:var(--muted);font-size:12.5px;transition:var(--step)}
.scv .step .num{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;flex:none;
  font-family:var(--font-mono);font-size:11px;background:var(--surface-2);border:1px solid var(--hair-strong);color:var(--muted)}
.scv .step.active{background:var(--blue-tint);border-color:color-mix(in srgb,var(--blue) 30%,transparent);color:var(--blue-ink)}
.scv .step.active .num{background:var(--blue);border-color:var(--blue);color:#fff}
.scv .step.done .num{background:var(--green);border-color:var(--green);color:#fff}
.scv .step-sep{width:14px;height:1px;background:var(--hair-strong);flex:none}

.scv .stage{flex:1;display:flex;gap:16px;padding:16px 20px 20px;min-height:0;align-items:stretch}
.scv .canvas{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:12px}
.scv .chat{flex:0 0 360px;max-width:38vw;display:flex;flex-direction:column;background:var(--surface);
  border:1px solid var(--hair);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;min-height:0}
.scv .panel{background:var(--surface);border:1px solid var(--hair);border-radius:var(--radius);box-shadow:var(--shadow)}

.scv .formwrap{flex:1;overflow:auto;padding:0;background:var(--field-well)}
.scv .form-head{padding:22px 26px 18px;border-bottom:1px solid var(--hair)}
.scv .form-head .start-here{font-size:28.5px;font-weight:700;letter-spacing:-.02em;line-height:1.02;margin:0 0 8px}
.scv .form-head p{margin:0;color:var(--muted);font-size:13.5px;max-width:60ch}
.scv .form-head p b{color:var(--ink);font-weight:650}
.scv .form-body{padding:18px 26px 4px}
.scv .email-row{display:flex;gap:8px;align-items:center}
.scv .email-row input{flex:1;min-width:0}
.scv .send-btn{font:inherit;font-size:13px;font-weight:600;white-space:nowrap;flex:none;padding:10px 14px;border-radius:var(--radius-sm);
  border:1px solid var(--blue);background:var(--blue-tint);color:var(--blue-ink);cursor:pointer;transition:var(--step)}
.scv .send-btn:hover:not(:disabled){background:color-mix(in srgb,var(--blue) 16%,var(--surface))}
.scv .send-btn:disabled{cursor:default}
.scv .send-btn.sent{background:var(--green-tint);border-color:color-mix(in srgb,var(--green) 45%,transparent);color:var(--green);cursor:default}
.scv .send-btn.err{background:var(--amber-tint);border-color:color-mix(in srgb,var(--amber) 45%,transparent);color:var(--amber)}
@media (max-width:520px){.scv .email-row{flex-wrap:wrap}.scv .email-row input{flex-basis:100%}}
.scv .field{display:flex;flex-direction:column;gap:6px;margin-bottom:16px}
.scv .field label{font-size:12.5px;font-weight:600;color:var(--ink)}
.scv .field label .opt{font-weight:400;color:var(--muted)}
.scv .field input[type=text],.scv .field input[type=email],.scv .field input[type=tel],.scv .field textarea{
  font:inherit;font-size:14.5px;padding:10px 12px;border-radius:var(--radius-sm);
  border:1px solid var(--field-border);background:var(--field-bg);color:var(--ink);transition:var(--step);
  box-shadow:0 1px 1px rgba(18,35,46,.04);width:100%}
.scv .field textarea{resize:vertical;min-height:64px}
.scv .field input:focus,.scv .field textarea:focus{outline:none;border-color:var(--blue);
  box-shadow:0 0 0 3px var(--blue-tint);background:var(--field-bg)}
.scv .addr-grid{display:flex;flex-direction:column;gap:8px}
.scv .addr-row3{display:grid;grid-template-columns:2fr .8fr 1fr;gap:8px}
.scv .field input.state-in{text-transform:uppercase}

.scv .gate{margin:0 26px 20px;padding:16px;border:1px solid color-mix(in srgb,var(--amber) 45%,var(--hair));
  background:var(--amber-tint);border-radius:var(--radius-sm)}
.scv .gate .g-lead{display:flex;gap:9px;align-items:flex-start;margin-bottom:12px}
.scv .gate .g-lead svg{flex:none;margin-top:1px}
.scv .gate .g-lead b{font-size:13px}
.scv .gate .g-lead span{font-size:12.5px;color:color-mix(in srgb,var(--amber) 78%,var(--ink))}
.scv .gate-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
.scv .g-btn{font:inherit;font-size:13px;font-weight:550;padding:8px 13px;border-radius:8px;cursor:pointer;
  border:1px solid var(--amber);background:var(--surface);color:var(--amber);transition:var(--step)}
.scv .g-btn:hover:not(:disabled){background:var(--surface-2)}
.scv .g-btn:disabled{opacity:.5;cursor:not-allowed}
.scv .g-btn.done{background:var(--green);border-color:var(--green);color:#fff;cursor:default;opacity:1}
.scv .gate.satisfied{border-color:color-mix(in srgb,var(--green) 45%,var(--hair));background:var(--green-tint)}
.scv .gate.satisfied .g-lead span,.scv .gate.satisfied .g-lead b{color:color-mix(in srgb,var(--green) 80%,var(--ink))}

.scv .locked-region{position:relative;padding:0 26px 8px;transition:var(--step)}
.scv .locked-region.locked{pointer-events:none}
.scv .locked-region.locked > *:not(.cert-visible){opacity:.4;filter:saturate(.6)}
.scv .cert-visible input:disabled{cursor:not-allowed}
.scv .cert-visible.check-row.cert-dim{opacity:.72}
.scv .cert-hint{margin:6px 2px 0;font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px}
.scv .cert-hint.hidden{display:none}
.scv .lock-note{margin:0 26px 18px;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:7px}
.scv .lock-note.hidden{display:none}
.scv .radio-row{display:flex;gap:10px;flex-wrap:wrap}
.scv .radio-card{flex:1 1 140px;display:flex;gap:9px;align-items:flex-start;padding:11px 13px;border:1px solid var(--field-border);
  border-radius:var(--radius-sm);cursor:pointer;background:var(--field-bg);transition:var(--step);box-shadow:0 1px 1px rgba(18,35,46,.04)}
.scv .radio-card:hover{border-color:var(--muted)}
.scv .radio-card.sel{border-color:var(--blue);background:var(--blue-tint)}
.scv .radio-card input{margin-top:3px}
.scv .radio-card .rc-t{font-size:13px;font-weight:600}
.scv .radio-card .rc-s{font-size:11.5px;color:var(--muted)}
.scv .check-row{display:flex;gap:10px;align-items:flex-start;padding:12px 13px;border:1px solid var(--field-border);
  border-radius:var(--radius-sm);background:var(--field-bg);cursor:pointer;transition:var(--step);box-shadow:0 1px 1px rgba(18,35,46,.04)}
.scv .check-row:hover{border-color:var(--muted)}
.scv .check-row.sel{border-color:var(--blue);background:var(--blue-tint)}
.scv .check-row input{margin-top:2px;width:16px;height:16px;accent-color:var(--blue);flex:none}
.scv .check-row .rc-t{font-size:13px;font-weight:600}
.scv .check-row .rc-s{font-size:11.5px;color:var(--muted)}
.scv .fee-choice{margin-top:14px;padding-top:14px;border-top:1px solid var(--hair)}
.scv .fee-lead{font-size:12.5px;font-weight:600;color:var(--ink);margin-bottom:10px}
.scv .fee-lead span{font-weight:400;color:var(--muted)}
.scv .fee-opts{display:flex;flex-direction:column;gap:10px}
.scv .fee-only{font-size:11.5px;color:var(--muted)}
.scv .waiver-reason{margin:-2px 0 0}
.scv .waiver-reason.hidden{display:none}
.scv .addr-block{margin-top:4px}
.scv .addr-block.hidden{display:none}
.scv .form-foot{padding:18px 26px 24px;border-top:1px solid var(--hair);display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.scv .btn-primary{font:inherit;font-size:14.5px;font-weight:600;color:#fff;background:var(--blue);border:none;
  padding:12px 22px;border-radius:var(--radius-sm);cursor:pointer;transition:var(--step);box-shadow:var(--shadow)}
.scv .btn-primary:hover:not(:disabled){background:var(--blue-strong)}
.scv .btn-primary:disabled{background:var(--hair-strong);color:var(--muted);cursor:not-allowed;box-shadow:none}
.scv .foot-hint{font-size:12px;color:var(--muted)}

.scv .chat-head{display:flex;align-items:center;gap:10px;padding:12px 15px;border-bottom:1px solid var(--hair);background:var(--surface)}
.scv .chat-avatar{width:30px;height:30px;border-radius:8px;background:var(--blue-tint);color:var(--blue-ink);display:grid;place-items:center;flex:none}
.scv .chat-head .ch-t{font-size:13px;font-weight:650}
.scv .chat-head .ch-s{font-size:11px;color:var(--muted)}
.scv .chat-head .live{margin-left:auto;font-family:var(--font-mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;
  color:var(--muted);display:flex;align-items:center;gap:5px}
.scv .chat-head .live::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--hair-strong)}
.scv .chat.on .chat-head .live{color:var(--green)}
.scv .chat.on .chat-head .live::before{background:var(--green);box-shadow:0 0 0 3px var(--green-tint)}
.scv .chat-log{flex:1;overflow:auto;padding:16px 15px;display:flex;flex-direction:column;gap:12px;min-height:0}
.scv .chat.on .chat-log,.scv .chat.on .composer{background:var(--chat-ground)}
.scv .msg{max-width:88%;font-size:13.5px;line-height:1.5;padding:10px 13px;border-radius:14px;
  background:var(--field-bg);color:var(--ink);border:1px solid var(--hair);box-shadow:0 1px 2px rgba(18,35,46,.06)}
.scv .msg.bot{align-self:flex-start;border-bottom-left-radius:5px}
.scv .msg.me{align-self:flex-end;border-bottom-right-radius:5px;background:var(--blue-tint);border-color:color-mix(in srgb,var(--blue) 30%,transparent);color:var(--blue-ink)}
.scv .msg.sys{align-self:center;font-size:11.5px;color:var(--muted);background:transparent;border:1px dashed var(--hair-strong);box-shadow:none;padding:6px 12px;border-radius:999px}
.scv .chat-idle{margin:auto;text-align:center;color:var(--muted);font-size:12.5px;padding:20px;line-height:1.6}
.scv .typing{align-self:flex-start;display:flex;gap:4px;padding:11px 14px;background:var(--field-bg);border:1px solid var(--hair);border-radius:14px;border-bottom-left-radius:5px}
.scv .typing span{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:scvbounce 1.2s infinite}
.scv .typing span:nth-child(2){animation-delay:.15s}.scv .typing span:nth-child(3){animation-delay:.3s}
@keyframes scvbounce{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-4px)}}
.scv .qr{display:flex;flex-wrap:wrap;gap:7px;padding:0 15px 8px}
.scv .qr button{font:inherit;font-size:12.5px;font-weight:550;color:var(--blue);background:var(--surface);
  border:1px solid color-mix(in srgb,var(--blue) 40%,transparent);padding:7px 13px;border-radius:999px;cursor:pointer;transition:var(--step)}
.scv .qr button:hover{background:var(--blue-tint)}
.scv .chat-results{align-self:flex-start;max-width:92%;border:1px solid var(--hair);border-radius:10px;background:var(--surface-2);padding:9px 11px;font-size:12px}
.scv .cr-head{font-weight:650;color:var(--blue-ink);margin-bottom:6px;font-size:12px}
.scv .cr-item{padding:5px 0;border-top:1px solid var(--hair);line-height:1.35}
.scv .cr-item:first-of-type{border-top:none}
.scv .cr-item .cr-t{font-weight:600}
.scv .cr-item .cr-m{font-family:var(--font-mono);font-size:10px;color:var(--muted)}
.scv .cr-tag{font-family:var(--font-mono);font-size:9px;letter-spacing:.04em;text-transform:uppercase;color:var(--green);
  background:var(--green-tint);border:1px solid color-mix(in srgb,var(--green) 35%,transparent);padding:1px 5px;border-radius:999px;margin-left:6px}
.scv .cr-note{margin-top:7px;font-size:10.5px;color:var(--muted);font-style:italic}
.scv .formwrap.inert{opacity:.58;pointer-events:none;filter:saturate(.7)}
.scv .composer{display:flex;gap:8px;padding:11px 12px;border-top:1px solid var(--hair);background:var(--surface)}
.scv .composer input{flex:1;font:inherit;font-size:13.5px;padding:10px 13px;border-radius:999px;border:1px solid var(--field-border);
  background:var(--field-bg);color:var(--ink);box-shadow:0 1px 1px rgba(18,35,46,.04)}
.scv .composer input:disabled{opacity:.5}
.scv .composer button{width:40px;height:40px;flex:none;border-radius:50%;border:none;background:var(--blue);color:#fff;cursor:pointer;display:grid;place-items:center}
.scv .composer button:disabled{background:var(--hair-strong);cursor:not-allowed}

.scv .footnote{padding:8px 20px 16px;font-size:11px;color:var(--muted);text-align:center}

@media (max-width:860px){
  .scv .stage{flex-direction:column}
  .scv .canvas,.scv .chat{max-width:none;width:100%}
  .scv .chat{flex:1 1 auto}
}
@media (prefers-reduced-motion:reduce){.scv *{transition:none!important;animation:none!important}}
.scv :focus-visible{outline:2px solid var(--blue);outline-offset:2px;border-radius:4px}
`;

function Icon(props) {
  // small inline stroke icon set used by the form
  var paths = {
    mail: <><path d="M22 6l-10 7L2 6" /><rect x="2" y="4" width="20" height="16" rx="2" /></>,
    lock: <><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
    send: <><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></>,
    bot: <><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><path d="M8 16h.01M16 16h.01" /></>,
  };
  return (
    <svg width={props.size || 18} height={props.size || 18} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" style={props.style}>{paths[props.name]}</svg>
  );
}

export default function PublicPortalV2Page() {
  // ---- form state ----
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [delivery, setDelivery] = useState('email');
  const [addr, setAddr] = useState({ street1: '', street2: '', city: '', state: '', zip: '' });
  const [cert, setCert] = useState(false);
  const [waiver, setWaiver] = useState(false);
  const [waiverReason, setWaiverReason] = useState('');
  const [commercial, setCommercial] = useState(false);

  // ---- email-accuracy gate state machine ----
  // One flag `emailConfirmed`, satisfied by either path; method records which won (audit).
  const [emailSent, setEmailSent] = useState(false);     // a real verification email has been fired
  const [sendState, setSendState] = useState('idle');    // idle | sending | sent | error
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [verifyMethod, setVerifyMethod] = useState(null); // 'attested' | 'visual'

  // ---- phase (0 form -> 1 chat activated) ----
  const [phase, setPhase] = useState(0);

  // ---- Phase 1: chat conversation engine ----
  // `messages` holds only real user/assistant turns (the static opening greeting is rendered
  // separately, so it is never sent to the API — the Anthropic Messages API needs a user-first turn).
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [quickReplies, setQuickReplies] = useState([]);
  const [agencyName, setAgencyName] = useState('');
  // Latest search results/query — captured here for the results-canvas slice (slice 4) to consume.
  const [lastResults, setLastResults] = useState(null);
  const [lastQuery, setLastQuery] = useState('');
  const chatLogRef = useRef(null);

  useEffect(function () {
    axios.get(API + '/requests/public/config')
      .then(function (r) { setAgencyName((r.data && r.data.agency_name) || ''); })
      .catch(function () { setAgencyName(''); });
  }, []);

  useEffect(function () {
    if (chatLogRef.current) chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
  }, [messages, chatSending, quickReplies]);

  const sendMessage = useCallback(async function (text) {
    var t = (text || '').trim();
    if (!t || chatSending) return;
    var base = messages.concat([{ role: 'user', content: t }]);
    setMessages(base);
    setInput('');
    setQuickReplies([]);
    setChatSending(true);
    try {
      // API wants role + content only; `base` is already clean conversation turns.
      var wire = base.map(function (m) { return { role: m.role, content: m.content }; });
      var r = await axios.post(API + '/public/chat', { mode: 'split_canvas', messages: wire, selectedRecords: [] });
      var reply = (r.data && r.data.reply) || '';
      var results = (r.data && Array.isArray(r.data.searchResults)) ? r.data.searchResults : null;
      var asst = { role: 'assistant', content: reply };
      if (results && results.length) {
        asst.searchResults = results;
        asst.searchQuery = (r.data && r.data.searchQuery) || '';
        setLastResults(results);
        setLastQuery(asst.searchQuery);
      }
      setMessages(base.concat([asst]));
      setQuickReplies((r.data && Array.isArray(r.data.quickReplies)) ? r.data.quickReplies : []);
    } catch (e) {
      setMessages(base.concat([{ role: 'assistant', content: 'I had trouble responding just now. Please try again in a moment.' }]));
    } finally {
      setChatSending(false);
    }
  }, [messages, chatSending]);

  // eslint-disable-next-line no-unused-vars
  var _slice4 = { lastResults: lastResults, lastQuery: lastQuery }; // reserved for the results canvas

  var emailOk = validEmail(email);
  var addrComplete = addr.street1.trim() && addr.city.trim() && addr.state.trim() && addr.zip.trim();
  var canProceed = name.trim() && emailOk && emailConfirmed && (delivery !== 'mail' || addrComplete);

  // Restore the gate to pristine (locked). Fired when the email is edited after a send/confirm,
  // so a confirmation can never go stale against a new address (re-locks the lower fields + cert).
  const resetGate = useCallback(function () {
    setEmailSent(false); setSendState('idle');
    setEmailConfirmed(false); setVerifyMethod(null);
    setCert(false);
  }, []);

  function onEmailChange(v) {
    // Any edit to a sent-or-confirmed address invalidates it.
    if (emailConfirmed || emailSent) resetGate();
    setEmail(v);
  }

  async function sendVerification() {
    if (!emailOk) { return; }
    setSendState('sending');
    try {
      // Reuse the real verification-email path (self-attest model: we fire the send but do NOT
      // poll — "Email address verified" below is the citizen's own attestation of receipt).
      await axios.post(API + '/public/request-verification', { email: email.trim() });
      setEmailSent(true); setSendState('sent');
    } catch (e) {
      setSendState('error');
    }
  }

  function confirmEmail(method) {
    if (!emailOk) return;
    setEmailConfirmed(true);
    setVerifyMethod(method);
  }

  function onWaiverToggle(next) {
    setWaiver(next);
    if (next) setCommercial(false);
    if (!next) setWaiverReason('');
  }
  function onCommercialToggle(next) {
    setCommercial(next);
    if (next) { setWaiver(false); setWaiverReason(''); }
  }

  function proceed() {
    if (!canProceed) return;
    // Phase 0 -> 1 trigger: activate the chat agent. The assembled intake payload is captured here
    // and carried to the submit path in a later slice (slice 5). Fields the split-canvas /public/submit
    // already persists (slice 1 backend): requestorType, feeWaiverRequested/Reason, mailing_* .
    var payload = {
      requestorName: name.trim(),
      requestorEmail: email.trim(),
      requestorPhone: phone.trim(),
      deliveryMethod: delivery,
      requestorType: commercial ? 'commercial' : 'individual',
      feeWaiverRequested: waiver,
      feeWaiverReason: waiver ? waiverReason.trim() : '',
      certificationRequested: cert,
      emailVerificationMethod: verifyMethod,
      submissionChannel: 'manual_form',
    };
    if (delivery === 'mail') {
      payload.mailingStreet1 = addr.street1.trim();
      payload.mailingStreet2 = addr.street2.trim();
      payload.mailingCity = addr.city.trim();
      payload.mailingState = addr.state.trim().toUpperCase();
      payload.mailingZip = addr.zip.trim();
    }
    // eslint-disable-next-line no-console
    console.log('[portal/v2] Phase-0 complete — intake payload for later submit slice:', payload);
    setPhase(1);
  }

  // foot hint mirrors the mockup's guidance
  var footHint = 'Complete the fields above to continue.';
  if (!emailConfirmed) footHint = 'Confirm your email to unlock the rest.';
  else if (delivery === 'mail' && !addrComplete) footHint = 'Complete the mailing address (street, city, state, ZIP) for postal delivery.';
  else if (canProceed) footHint = 'Looks good — the assistant will help you describe each record.';

  var certDim = !emailConfirmed;
  var agencyDisplay = agencyName || 'City of Cedar Vale';
  var crestInitials = (agencyName || 'Cedar Vale')
    .replace(/\b(city|town|county|of|the)\b/gi, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').filter(Boolean).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase() || 'OR';

  return (
    <div className="scv">
      <style>{STYLES}</style>

      <header className="appbar">
        <div className="crest">{crestInitials}</div>
        <div className="brand">
          <h1>{agencyDisplay}</h1>
          <p>AI-Powered Open Records Search</p>
        </div>
        <div className="spacer" />
      </header>

      <nav className="stepper" aria-label="Request progress">
        <div className={'step' + (phase === 0 ? ' active' : ' done')}><span className="num">1</span> Your information</div>
        <span className="step-sep" />
        <div className={'step' + (phase === 1 ? ' active' : '')}><span className="num">2</span> Describe records</div>
        <span className="step-sep" />
        <div className="step"><span className="num">3</span> Review results</div>
        <span className="step-sep" />
        <div className="step"><span className="num">4</span> Submit</div>
      </nav>

      <main className="stage">
        {/* ============ LEFT CANVAS — Phase 0 form ============ */}
        <section className="canvas">
          <div className={'panel formwrap' + (phase === 1 ? ' inert' : '')}>
            <div className="form-head">
              <h2 className="start-here">START HERE</h2>
              <p>Provide information in the form below. When all information is entered, click <b>PROCEED</b>. This will activate the AI Open Record Agent on the right, and it will guide you through record search.</p>
            </div>

            <div className="form-body">
              <div className="field">
                <label htmlFor="v2Name">Full name</label>
                <input type="text" id="v2Name" autoComplete="name" placeholder="Jordan Ellis"
                  value={name} onChange={function (e) { setName(e.target.value); }} />
              </div>
              <div className="field">
                <label htmlFor="v2Email">Email address</label>
                <div className="email-row">
                  <input type="email" id="v2Email" autoComplete="email" placeholder="jordan.ellis@example.com"
                    value={email} onChange={function (e) { onEmailChange(e.target.value); }} />
                  <button type="button"
                    className={'send-btn' + (sendState === 'sent' ? ' sent' : '') + (sendState === 'error' ? ' err' : '')}
                    disabled={!emailOk || sendState === 'sent' || sendState === 'sending'}
                    onClick={sendVerification}>
                    {sendState === 'sent' ? '✓ Verification email sent — check your inbox'
                      : sendState === 'sending' ? 'Sending…'
                      : sendState === 'error' ? 'Couldn’t send — retry'
                      : 'Send verification email now'}
                  </button>
                </div>
              </div>
            </div>

            {/* Email-accuracy gate */}
            <div className={'gate' + (emailConfirmed ? ' satisfied' : '')}>
              <div className="g-lead">
                <Icon name="mail" style={{ color: 'var(--amber)' }} />
                <div><b>To proceed</b><br /><span>If your verification email has been received, click <b>Email address verified</b>. If you don't have access to email right now, carefully review the email address you provided and click <b>Visually verified</b>.</span></div>
              </div>
              <div className="gate-actions">
                {!(emailConfirmed && verifyMethod === 'visual') && (
                  <button type="button"
                    className={'g-btn' + (emailConfirmed && verifyMethod === 'attested' ? ' done' : '')}
                    disabled={!emailSent || emailConfirmed}
                    onClick={function () { confirmEmail('attested'); }}>
                    {emailConfirmed && verifyMethod === 'attested' ? '✓ Email address verified' : 'Email address verified'}
                  </button>
                )}
                {!(emailConfirmed && verifyMethod === 'attested') && (
                  <button type="button"
                    className={'g-btn' + (emailConfirmed && verifyMethod === 'visual' ? ' done' : '')}
                    disabled={!emailOk || emailConfirmed}
                    onClick={function () { confirmEmail('visual'); }}>
                    {emailConfirmed && verifyMethod === 'visual' ? '✓ Visually verified' : 'Visually verified'}
                  </button>
                )}
              </div>
            </div>

            <div className={'lock-note' + (emailConfirmed ? ' hidden' : '')}>
              <Icon name="lock" size={13} /> The fields below unlock once your email is confirmed.
            </div>

            {/* Locked lower region */}
            <div className={'locked-region' + (emailConfirmed ? '' : ' locked')}>
              <div className="field">
                <input type="tel" autoComplete="tel" aria-label="Phone number (optional)" placeholder="Phone number (optional)"
                  value={phone} onChange={function (e) { setPhone(e.target.value); }} />
              </div>
              <div className="field">
                <label>How should we deliver your records &amp; notices?</label>
                <div className="radio-row">
                  <label className={'radio-card' + (delivery === 'email' ? ' sel' : '')}>
                    <input type="radio" name="v2delivery" value="email" checked={delivery === 'email'}
                      onChange={function () { setDelivery('email'); }} />
                    <span><span className="rc-t">Email</span><br /><span className="rc-s">Fastest — digital records and status updates</span></span>
                  </label>
                  <label className={'radio-card' + (delivery === 'mail' ? ' sel' : '')}>
                    <input type="radio" name="v2delivery" value="mail" checked={delivery === 'mail'}
                      onChange={function () { setDelivery('mail'); }} />
                    <span><span className="rc-t">Postal mail</span><br /><span className="rc-s">Printed records mailed to your address</span></span>
                  </label>
                </div>
              </div>

              <div className={'field addr-block' + (delivery === 'mail' ? '' : ' hidden')}>
                <label>Mailing address <span className="opt">(required for postal delivery)</span></label>
                <div className="addr-grid">
                  <input type="text" autoComplete="address-line1" aria-label="Street address" placeholder="Street address"
                    value={addr.street1} onChange={function (e) { setAddr(Object.assign({}, addr, { street1: e.target.value })); }} />
                  <input type="text" autoComplete="address-line2" aria-label="Apt, suite, unit (optional)" placeholder="Apt, suite, unit (optional)"
                    value={addr.street2} onChange={function (e) { setAddr(Object.assign({}, addr, { street2: e.target.value })); }} />
                  <div className="addr-row3">
                    <input type="text" autoComplete="address-level2" aria-label="City" placeholder="City"
                      value={addr.city} onChange={function (e) { setAddr(Object.assign({}, addr, { city: e.target.value })); }} />
                    <input type="text" className="state-in" autoComplete="address-level1" aria-label="State" placeholder="State" maxLength={2}
                      value={addr.state} onChange={function (e) { setAddr(Object.assign({}, addr, { state: e.target.value })); }} />
                    <input type="text" autoComplete="postal-code" aria-label="ZIP code" placeholder="ZIP"
                      value={addr.zip} onChange={function (e) { setAddr(Object.assign({}, addr, { zip: e.target.value })); }} />
                  </div>
                </div>
              </div>

              {/* Certification — visible-but-disabled before the gate (discoverable) */}
              <label className={'check-row cert-visible' + (cert ? ' sel' : '') + (certDim ? ' cert-dim' : '')}>
                <input type="checkbox" disabled={!emailConfirmed} checked={cert}
                  onChange={function (e) { setCert(e.target.checked); }} />
                <span><span className="rc-t">Include certification (certified copy)</span><br /><span className="rc-s">Adds an official signed certification page attesting the records are true and correct copies. Applies to the entire request. An additional fee may apply.</span></span>
              </label>
              <div className={'cert-hint cert-visible' + (emailConfirmed ? ' hidden' : '')}>
                <Icon name="lock" size={12} /> Available once your email is confirmed above.
              </div>

              {/* Fee-choice — waiver / commercial, mutually exclusive */}
              <div className="fee-choice">
                <div className="fee-lead">Fees <span>— standard rates apply by default</span></div>
                <div className="fee-opts">
                  <span className="fee-only">Only if one applies:</span>
                  <label className={'check-row' + (waiver ? ' sel' : '')}>
                    <input type="checkbox" checked={waiver} onChange={function (e) { onWaiverToggle(e.target.checked); }} />
                    <span><span className="rc-t">Request a fee waiver</span><br /><span className="rc-s">For nonprofit, journalist, researcher, or other non-commercial public-interest requests. Subject to review.</span></span>
                  </label>
                  <div className={'field waiver-reason' + (waiver ? '' : ' hidden')}>
                    <textarea placeholder="Briefly describe the public-interest purpose — this helps the reviewer decide."
                      value={waiverReason} onChange={function (e) { setWaiverReason(e.target.value); }} />
                  </div>
                  <label className={'check-row' + (commercial ? ' sel' : '')}>
                    <input type="checkbox" checked={commercial} onChange={function (e) { onCommercialToggle(e.target.checked); }} />
                    <span><span className="rc-t">I'm a commercial requester</span><br /><span className="rc-s">Records requested for commercial use. Subject to review; commercial rates may apply.</span></span>
                  </label>
                </div>
              </div>
            </div>

            <div className="form-foot">
              <button className="btn-primary" type="button" disabled={!canProceed || phase === 1} onClick={proceed}>PROCEED →</button>
              <span className="foot-hint">{phase === 1 ? 'The assistant is now active on the right.' : footHint}</span>
            </div>
          </div>
        </section>

        {/* ============ RIGHT — chat engine (idle until PROCEED) ============ */}
        <aside className={'chat' + (phase === 1 ? ' on' : '')}>
          <div className="chat-head">
            <div className="chat-avatar"><Icon name="bot" size={18} /></div>
            <div>
              <div className="ch-t">AI Open Record Assistant</div>
              <div className="ch-s">Guides you through describing each record</div>
            </div>
            <div className="live">{phase === 1 ? 'Active' : 'Idle'}</div>
          </div>
          <div className="chat-log" ref={chatLogRef}>
            {phase === 0 ? (
              <div className="chat-idle">
                The assistant activates once you complete the form and click <b>PROCEED</b>.
              </div>
            ) : (
              <>
                {/* Verbatim opening script (design Phase 1) — display-only, never sent to the API */}
                <div className="msg bot">Thank you for using the {agencyDisplay} AI Powered Open Record Search. I will work with you to create description content that assures optimal search results. It is important to note that if you are requesting more than one type of record, it is important that the search description for each is entered individually.</div>
                <div className="msg bot">Please enter a description of a requested record.</div>
                {messages.map(function (m, i) {
                  return (
                    <React.Fragment key={i}>
                      {m.content ? <div className={'msg ' + (m.role === 'user' ? 'me' : 'bot')}>{m.content}</div> : null}
                      {m.searchResults && m.searchResults.length ? (
                        <div className="chat-results">
                          <div className="cr-head">Found {m.searchResults.length} matching record{m.searchResults.length !== 1 ? 's' : ''}</div>
                          {m.searchResults.map(function (res, ri) {
                            return (
                              <div className="cr-item" key={ri}>
                                <span className="cr-t">{res.title || res.id || 'Untitled record'}</span>
                                {res.publicReady ? <span className="cr-tag">Public-ready</span> : null}
                                {res.docType || res.sourceSystem ? <div className="cr-m">{[res.docType, res.sourceSystem].filter(Boolean).join(' · ')}</div> : null}
                              </div>
                            );
                          })}
                          <div className="cr-note">Selecting records into your request happens in the results view (next build slice).</div>
                        </div>
                      ) : null}
                    </React.Fragment>
                  );
                })}
                {chatSending ? <div className="typing"><span /><span /><span /></div> : null}
              </>
            )}
          </div>
          {phase === 1 && quickReplies.length > 0 && !chatSending ? (
            <div className="qr">
              {quickReplies.map(function (qr, qi) {
                return <button key={qi} type="button" onClick={function () { sendMessage(qr); }}>{qr}</button>;
              })}
            </div>
          ) : null}
          <div className="composer">
            <input type="text"
              placeholder={phase === 1 ? 'Describe a record…' : 'Complete the form to begin'}
              value={input}
              disabled={phase !== 1 || chatSending}
              onChange={function (e) { setInput(e.target.value); }}
              onKeyDown={function (e) { if (e.key === 'Enter') { e.preventDefault(); sendMessage(input); } }} />
            <button type="button" aria-label="Send" disabled={phase !== 1 || chatSending || !input.trim()}
              onClick={function () { sendMessage(input); }}><Icon name="send" size={17} /></button>
          </div>
        </aside>
      </main>

      <div className="footnote">
        Split-canvas intake · Phase-0 form (build slice 2) · design: docs/DESIGN_split_canvas_intake.md
      </div>
    </div>
  );
}
