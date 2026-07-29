import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { C } from '../lib/theme';
import { SubmittedDescription, G } from '../components/primitives';

// PHASE 7 / BW6 — THE MRR ACTIVITY TASK SCREEN (the ASSIGNEE's view).
// (docs/DRAFT_processing_ui_mrr_hub.md rev 5b annotations 11–12 · mockup screen 4's inset)
//
// This is the surface Draft 5's "What the assignee sees" inset describes, built for real. It is
// deliberately THIN, and thin is the design rather than an unfinished state:
//
//   * The person doing the work sees a normal-looking task — item wording, the requestor's attachments,
//     one Done control. That normality is the point: the difference between an MRR activity and a flow
//     task is not how it LOOKS, it is what completing it DOES.
//   * Completing it updates the Request Manager's hub AND NOTHING ELSE. No stage advances. The screen
//     says so out loud, in the server's words, before the button is pressed — a person who thinks they
//     just moved a request forward will stop chasing it, and that is the failure this line prevents.
//   * THERE IS NO CONTACT-REQUESTOR CONTROL, and none may be added. One request, one voice: everything
//     the requestor hears about this record comes from its Request Manager. The button here emails the
//     manager. The backend enforces the same rule (the write is manager-only), so this is not the only
//     thing standing between an assignee and the requestor's inbox — but it is what they SEE.
//
// ATTACHMENTS RIDE THE ITEM (draft §0b). A requestor who attached a file to item 2 attached it to item 2,
// not to the request, and the searcher working item 2 must see it here — not by going up to the master
// record, which they may not even be able to open.

function Panel(props) {
  return (
    <div style={{ background: C.surface, border: '1px solid ' + G.line, borderRadius: 6,
      padding: '11px 13px', marginBottom: 11 }}>
      {props.title ? (
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
          color: C.muted, marginBottom: 7 }}>{props.title}</div>
      ) : null}
      {props.children}
    </div>
  );
}

var STATUS_TINT = {
  queued: { bg: C.surface2, fg: C.muted, bd: G.line },
  in_process: { bg: G.amberBg, fg: G.amberInk, bd: G.amberLine },
  complete: { bg: G.statuteBg, fg: G.statute, bd: G.statute },
  not_started: { bg: C.surface, fg: G.ghost, bd: G.ghost },
  not_required: { bg: C.surface, fg: G.ghost, bd: G.ghost }
};

function StatusPill(props) {
  var t = STATUS_TINT[props.status] || STATUS_TINT.not_started;
  return (
    <span style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, borderRadius: 3,
      padding: '2px 8px', border: '1px solid ' + t.bd, background: t.bg, color: t.fg, whiteSpace: 'nowrap' }}>
      {props.children}
    </span>
  );
}

export default function MrrActivityTaskPage() {
  var params = useParams();
  var taskId = params.taskId;
  var [data, setData] = useState(null);
  var [err, setErr] = useState(null);
  var [busy, setBusy] = useState(false);
  var [note, setNote] = useState('');
  var [done, setDone] = useState(false);

  function load() {
    api.get('/mrr/activity-task/' + taskId)
      .then(function (r) { setData(r.data); })
      .catch(function (e) { setErr((e.response && e.response.data && e.response.data.error) || e.message); });
  }
  useEffect(load, [taskId]);

  function complete() {
    if (!data || !data.item || !data.activity) return;
    setBusy(true); setErr(null);
    api.post('/mrr/item/' + data.item.id + '/activity/' + data.activity.activity + '/complete', { note: note })
      .then(function (r) { setDone(true); setBusy(false); load(); return r; })
      .catch(function (e) {
        setBusy(false);
        setErr((e.response && e.response.data && e.response.data.error) || e.message);
      });
  }

  if (err && !data) return <div style={{ padding: 20, color: C.warn || '#8C3A2B' }}>{err}</div>;
  if (!data) return <div style={{ padding: 20, color: C.muted }}>Loading…</div>;

  var act = data.activity;
  var item = data.item;
  var att = data.attachments || { files: [], count: 0 };
  var settled = act && (act.status === 'complete' || act.status === 'not_required');

  return (
    <div style={{ padding: '14px 16px', maxWidth: 900 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontWeight: 800, letterSpacing: '.06em', color: G.navy, fontSize: 13 }}>
          {act ? act.label : 'MRR ACTIVITY'}
        </span>
        <span style={{ fontFamily: C.mono, fontWeight: 700, color: G.navy }}>
          {data.parent ? data.parent.requestNumber : (item && item.requestNumber)}
        </span>
        <span style={{ color: C.muted, fontSize: 12.5 }}>{item ? item.label : ''}</span>
        {act ? <StatusPill status={act.status}>{act.status === 'in_process' ? 'In Process'
          : act.status === 'complete' ? 'Complete' : act.status === 'queued' ? 'Queued' : act.status}</StatusPill> : null}
      </div>

      {/* THE REQUESTOR'S OWN WORDS. Never a paraphrase, never a summary — the global layout rule. */}
      <Panel>
        <SubmittedDescription title="Item Description as Submitted" margin="0">
          {item ? item.description : ''}
        </SubmittedDescription>
      </Panel>

      {/* ATTACHMENTS RIDE THE ITEM. */}
      <Panel title={'Attached by the requestor — this item (' + att.count + ')'}>
        {att.count === 0 ? (
          <div style={{ fontSize: 12.5, color: C.muted }}>Nothing was attached to this item.</div>
        ) : att.files.map(function (f) {
          return (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0',
              borderBottom: '1px solid ' + C.surface2, fontSize: 12.5 }}>
              <span>📄</span>
              <b style={{ color: C.ink }}>{f.original_name || f.filename}</b>
              <span style={{ color: C.muted }}>· uploaded {String(f.uploaded_at || '').slice(0, 10)}</span>
            </div>
          );
        })}
        <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{att.ridesWithItem}</div>
        {att.fulfilsNote ? (
          <div style={{ fontSize: 12, color: G.statute, marginTop: 4, fontWeight: 600 }}>{att.fulfilsNote}</div>
        ) : null}
      </Panel>

      {/* THE WHOLE STRUCTURAL CLAIM, BEFORE THE BUTTON — in the server's words, not the screen's. */}
      <div style={{ background: C.surface2, border: '1px solid ' + G.line, borderRadius: 6,
        padding: '10px 12px', marginBottom: 11, fontSize: 12.5, color: C.ink }}>
        {data.neverAdvances}
      </div>

      <Panel title="Complete this activity">
        {settled ? (
          <div style={{ fontSize: 13, color: G.statute, fontWeight: 600 }}>
            Recorded. The Request Manager’s MRR screen now shows this as {act.status === 'complete' ? 'Complete' : 'Not required'}.
          </div>
        ) : (
          <div>
            <textarea value={note} onChange={function (e) { setNote(e.target.value); }} rows={3}
              placeholder="Anything the Request Manager should know (optional)"
              style={{ width: '100%', fontSize: 13, padding: 8, border: '1px solid ' + G.line,
                borderRadius: 5, fontFamily: 'inherit', marginBottom: 8 }} />
            <button onClick={complete} disabled={busy}
              style={{ font: 'inherit', fontSize: 13, background: G.navy, color: '#fff', border: 'none',
                borderRadius: 5, padding: '6px 14px', fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.5 : 1 }}>
              {busy ? 'Recording…' : 'Mark complete'}
            </button>
            <span style={{ fontSize: 12, color: C.muted, marginLeft: 10 }}>
              Updates the MRR screen. Advances nothing.
            </span>
          </div>
        )}
        {done ? <div style={{ fontSize: 12.5, color: G.statute, marginTop: 8 }}>Saved.</div> : null}
        {err ? <div style={{ fontSize: 12.5, color: '#8C3A2B', marginTop: 8 }}>{err}</div> : null}
      </Panel>

      {/* ONE REQUEST, ONE VOICE. No contact-requestor control here — by design and by rule. */}
      <Panel title="Requestor">
        <a href={data.requestManager && data.requestManager.email ? 'mailto:' + data.requestManager.email : '#'}
          style={{ font: 'inherit', fontSize: 13, background: C.surface2, color: C.ink,
            border: '1px solid ' + G.line, borderRadius: 5, padding: '6px 14px', fontWeight: 500,
            textDecoration: 'none', display: 'inline-block' }}>
          Email the Request Manager{data.requestManager ? ' — ' + data.requestManager.name : ''}
        </a>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{data.oneVoice}</div>
      </Panel>

      <div style={{ fontSize: 12.5 }}>
        <Link to="/my-tasks" style={{ color: G.navy }}>← My Tasks</Link>
      </div>
    </div>
  );
}
