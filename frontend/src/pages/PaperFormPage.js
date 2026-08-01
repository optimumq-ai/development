import React, { useState, useEffect } from 'react';
import axios from 'axios';

// THE PAPER FORM (2026-08-01, Kevin's ask deciding intake channels): the printable twin of the portal
// wizard. Page 1 is requestor information with the wizard's own instructions; then TEN item pages —
// one described record per page, mirroring §5.1's "one description per described record" so what
// arrives on paper can be logged by staff in exactly the shape a portal submission takes (the staff
// New Request page iterates items for the same reason). Print-first: the browser's Print → Save as PDF
// IS the download; no PDF tooling to rot.
const API = (process.env.REACT_APP_API_URL || '/api');
const MAX_ITEMS = 10;

const C = { navy: '#1F4E79', ink: '#111827', dim: '#6B7280', line: '#9CA3AF' };

function Field(props) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: C.ink, marginBottom: 4 }}>
        {props.label}{props.required ? ' *' : ''}
      </div>
      {props.hint ? <div style={{ fontSize: 10.5, color: C.dim, marginBottom: 4 }}>{props.hint}</div> : null}
      <div style={{ borderBottom: '1.5px solid ' + C.line, height: props.lines ? undefined : 26 }}>
        {props.lines ? Array.from({ length: props.lines }).map(function (_, i) {
          return <div key={i} style={{ borderBottom: i < props.lines - 1 ? '1.5px solid ' + C.line : 'none', height: 26 }} />;
        }) : null}
      </div>
    </div>
  );
}
function Check(props) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 18, fontSize: 12.5 }}>
      <span style={{ width: 13, height: 13, border: '1.5px solid ' + C.ink, display: 'inline-block' }} />
      {props.children}
    </span>
  );
}

export default function PaperFormPage() {
  const [cfg, setCfg] = useState({ agency_name: 'City', contact_phone: '', contact_email: '' });
  useEffect(function () {
    axios.get(API + '/requests/public/config').then(function (r) { if (r.data) setCfg(r.data); }).catch(function () {});
  }, []);

  const pageStyle = { background: 'white', maxWidth: 780, margin: '0 auto 18px', padding: '40px 48px',
    border: '1px solid #E5E7EB', pageBreakAfter: 'always', fontFamily: 'Arial, Helvetica, sans-serif', color: C.ink };

  return (
    <div style={{ background: '#F3F4F6', minHeight: '100vh', padding: '18px 12px' }}>
      <style>{'@media print { .no-print { display: none !important; } body { background: white; } ' +
        '.form-page { border: none !important; margin: 0 !important; max-width: none !important; } }'}</style>

      <div className="no-print" style={{ maxWidth: 780, margin: '0 auto 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={function () { window.print(); }}
          style={{ padding: '10px 22px', background: C.navy, color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Print / Save as PDF
        </button>
        <span style={{ fontSize: 13, color: C.dim }}>
          Print all pages, or only page 1 plus one page per record you're requesting.
        </span>
      </div>

      {/* ── PAGE 1 — REQUESTOR INFORMATION ── */}
      <div className="form-page" style={pageStyle}>
        <div style={{ borderBottom: '3px solid ' + C.navy, paddingBottom: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.navy }}>{cfg.agency_name}</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Open Records Request — Paper Form</div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
            Under the Texas Public Information Act. You may also submit online at this office's records portal.
            {cfg.contact_email ? ' Questions: ' + cfg.contact_email : ''}{cfg.contact_phone ? ' · ' + cfg.contact_phone : ''}
          </div>
        </div>

        <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.5, marginBottom: 16 }}>
          <b style={{ color: C.ink }}>Instructions.</b> Complete this page, then describe <b>each record you are
          requesting on its own page</b> — one record per page, up to {MAX_ITEMS}. Describe each record in your own
          words: what it is, who it involves, and the date or date range. You do not need to know exact document
          names. You will receive a written acknowledgment with your request number, and an itemized cost estimate
          before any charges apply. You are not required to state a purpose for your request.
        </div>

        <Field label="Full name" required />
        <Field label="Email address" hint="Used for your acknowledgment, cost estimate, and delivery if selected. Leave blank if you have none." />
        <Field label="Phone number" />
        <Field label="Mailing address" lines={2} hint="Required if you choose delivery by mail." />

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Requestor type</div>
          <Check>Individual</Check><Check>Commercial / business use</Check>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Preferred delivery</div>
          <Check>Email</Check><Check>Mail</Check><Check>Pick up in person</Check>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Options</div>
          <Check>I request certified copies</Check>
          <Check>I request a fee waiver (attach your reason)</Check>
        </div>

        <div style={{ fontSize: 11, color: C.dim, borderTop: '1px solid #E5E7EB', paddingTop: 10, marginTop: 20, lineHeight: 1.5 }}>
          <b style={{ color: C.ink }}>Office use:</b> received (date/channel) ______________________ · logged by ______________________ ·
          identity confirmed in person&nbsp;&nbsp;☐&nbsp;&nbsp;· request number ______________________
        </div>
      </div>

      {/* ── ITEM PAGES — one described record per page ── */}
      {Array.from({ length: MAX_ITEMS }).map(function (_, i) {
        return (
          <div key={i} className="form-page" style={pageStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid ' + C.navy, paddingBottom: 8, marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.navy }}>Record {i + 1} of {MAX_ITEMS}</div>
              <div style={{ fontSize: 11, color: C.dim }}>Requestor name: ____________________________</div>
            </div>
            <div style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.5, marginBottom: 12 }}>
              Describe <b>one record</b> on this page, in your own words. Helpful details: <b>what</b> the record is
              (report, contract, email, video…), <b>who</b> it involves (names, departments, addresses), and
              <b> when</b> (a date or date range). If you're requesting more than one record, use a fresh page for
              each — every record is tracked and delivered individually.
            </div>
            <Field label={'Description of record ' + (i + 1)} lines={14} required />
            <Field label="Date or date range (if known)" />
            <Field label="Department or location (if known)" />
          </div>
        );
      })}
    </div>
  );
}
