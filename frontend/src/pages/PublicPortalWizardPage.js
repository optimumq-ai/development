import React, { useState } from 'react';

// ── Public Open Records WIZARD (SPEC §2c) ──────────────────────────────────────
// Slice 1: the full-screen stepped SHELL, the corrected progress rail
// (Begin · Your Information · Item Search · Submitted) and step routing.
// Real screens land in later slices — each step here is a labeled placeholder that
// says which slice fills it. Behind a NEW route (/portal/wizard); the live
// split-canvas flow at /portal/request is untouched until cutover.
// Palette/type carried from the approved prototype (docs/mockups/portal_wizard_prototype.html).

const STYLES = `
.pwz{
  --page:#D8E0E8; --panel:#EBF3FB; --surface:#FFFFFF;
  --civic:#1F4E79; --civic-700:#163A5C; --civic-tint:#E7EEF6;
  --ink:#14202B; --muted:#5B6B7A; --hair:#C9D6E2;
  --active:#C77A0A; --active-bg:#FBEFD7; --active-line:#E6B863;
  --done:#2E7D4F; --done-line:#8FC7A6; --done-box:#BFE3CC;
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
    --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.35);
  }
}
.pwz *{box-sizing:border-box}
.pwz .wrap{max-width:1040px;margin:0 auto;padding:20px 20px 64px}
.pwz h1{text-wrap:balance;margin:0}
.pwz button{font-family:inherit;font-size:inherit;cursor:pointer}
.pwz button:focus-visible{outline:2px solid var(--civic);outline-offset:2px}
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
.pwz .btn.sec{background:transparent;color:var(--civic)}
.pwz .btn.sec:hover{background:var(--civic-tint)}
`;

// The rail is the four ratified nodes (§2c: "Complete" deleted, "Submitted" added).
const RAIL = ['Begin', 'Your Information', 'Item Search', 'Submitted'];

// Slice-1 steps map 1:1 onto the rail; later slices expand "Item Search" into
// intro → describe → results → submit-or-continue.
const STEPS = [
  { rail: 0, title: 'Welcome to the AI-powered Open Records Request portal',
    lede: "You'll enter your contact information, then describe the records you're looking for — one at a time. The assistant helps you search; you stay in control of what to submit.",
    stub: 'Shell, progress rail, and step routing — this slice.' },
  { rail: 1, title: 'Your information',
    lede: 'Contact details, records delivery, and the options for your request.',
    stub: 'Slice 2: the form fields + the strict email link-verify gate (enter email → click the real link → the rest unlocks). Email is the only communication channel; postal is records-delivery only.' },
  { rail: 2, title: 'Search for records',
    lede: 'Describe one record at a time. The assistant runs the search, then steps aside so you drive from the results.',
    stub: 'Slices 3–4: the Item 1–10 rail with color states, the assistant-then-hide describe loop, and the results window (records found / not-searchable / no matches) with per-record selection, team-search, and remove-item.' },
  { rail: 3, title: 'Submitted',
    lede: 'Your request is created and your number is shown here.',
    stub: 'Slice 5: submit-or-continue with the empty-request guard, then the on-screen confirmation number (the request is born only at Submit — §0).' },
];

export default function PublicPortalWizardPage() {
  const [idx, setIdx] = useState(0);
  const step = STEPS[idx];
  const railIdx = step.rail;
  const first = idx === 0;
  const last = idx === STEPS.length - 1;

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
      </div>
    </div>
  );
}
