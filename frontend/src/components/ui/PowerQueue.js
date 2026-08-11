import React, { useEffect, useRef, useState } from 'react';
import { C } from '../../lib/theme';
import { G } from '../primitives';

// PHASE 7 / BW8 — the POWER-QUEUE SHELL (Draft 9 §4, deliberately scoped): progress strip + act row +
// populate-in-place. A LIBRARY COMPONENT instanced per task type — release review is the first
// instance; the close-approval queue and routed waivers are future customers and DO NOT build in v1.
//
// The shell owns the walk and nothing else:
//   * populate-in-place — acting clears the item's data and the next populates the same screen
//   * skip-resurface    — a skipped item stays in the queue untouched and RESURFACES AT THE END of
//                         the pass (Kevin 2026-08-11: as drafted, not held to the next session)
//   * keyboard acts     — each act carries its key; keys pause while a dialog is open or a field
//                         has focus, so typing a return note can never approve something
//   * counts only       — the progress strip is position / remaining / skipped. No timing anywhere:
//                         per-reviewer pace metrics were considered and DECLINED (Draft 9 §5.4).
//   * NO BULK ACTS      — the shell renders one item and acts on one item. There is deliberately no
//                         select-all and no "approve remaining" and none should ever be added here.
//
// props:
//   title            — powerbar title ("⚡ POWER MODE — Release Review")
//   contextLine      — right-hand powerbar text (city · reviewer)
//   items            — the queue, already in walk order (clock-aware, from the queue endpoint)
//   fetchItem(item)  — Promise of the payload renderItem needs; called one item at a time
//   renderItem(payload, item) — the substance panel
//   acts             — [{ key, label, tone: 'primary'|'quiet', run(item, payload) -> Promise<'advance'|'stay'>, disabled(payload) }]
//                      `run` resolving 'advance' moves the walk on; 'stay' keeps the item in place
//   keysEnabled      — set false while a dialog is open (the instance owns its dialogs)
//   onExit()         — leave power mode
export default function PowerQueue(props) {
  var items = props.items || [];
  var [walk, setWalk] = useState({ main: items, skipped: [], pos: 0, acted: 0, cycle: 1 });
  var [payload, setPayload] = useState(null);
  var [loading, setLoading] = useState(false);
  var [err, setErr] = useState('');
  var keysOn = props.keysEnabled !== false;
  var busyRef = useRef(false);

  function currentOf(w) {
    if (w.pos < w.main.length) return w.main[w.pos];
    var si = w.pos - w.main.length;
    return si < w.skipped.length ? w.skipped[si] : null;
  }
  var current = currentOf(walk);
  var total = items.length;
  var seen = Math.min(walk.pos + 1, total);
  var remaining = Math.max(0, total - seen); // mockup semantics: "#3 of 12 · 9 remaining"

  useEffect(function () {
    var alive = true;
    if (!current) { setPayload(null); return undefined; }
    setLoading(true); setErr(''); setPayload(null);
    Promise.resolve(props.fetchItem(current))
      .then(function (p) { if (alive) { setPayload(p); setLoading(false); } })
      .catch(function () { if (alive) { setErr('Could not load this item — Skip moves on; the task is untouched.'); setLoading(false); } });
    return function () { alive = false; };
  }, [current && current.id]); // deliberately narrow: refetch only when the walk moves

  function advance(acted) {
    setWalk(function (w) {
      return { main: w.main, skipped: w.skipped, pos: w.pos + 1, acted: w.acted + (acted ? 1 : 0), cycle: w.cycle };
    });
  }
  function skip() {
    // The task is untouched — it resurfaces at the end of THIS pass (never lost, never held over).
    setWalk(function (w) {
      var cur = currentOf(w);
      if (!cur) return w;
      var inMain = w.pos < w.main.length;
      return { main: w.main, skipped: inMain ? w.skipped.concat([cur]) : w.skipped.concat([cur]),
               pos: w.pos + 1, acted: w.acted, cycle: w.cycle };
    });
  }

  function runAct(act) {
    if (!current || busyRef.current) return;
    if (act.builtin === 'skip') { skip(); return; }
    if (act.disabled && act.disabled(payload)) return;
    busyRef.current = true;
    Promise.resolve(act.run(current, payload))
      .then(function (outcome) { busyRef.current = false; if (outcome === 'advance') advance(true); })
      .catch(function (e) {
        busyRef.current = false;
        setErr((e && e.response && e.response.data && e.response.data.error) || 'The act failed — the item is unchanged.');
      });
  }

  var acts = (props.acts || []).concat([{ key: 'S', label: 'Skip →', tone: 'quiet', builtin: 'skip' }]);

  useEffect(function () {
    function onKey(e) {
      if (!keysOn) return;
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      var hit = acts.filter(function (a) { return a.key && a.key.toLowerCase() === e.key.toLowerCase(); })[0];
      if (hit) { e.preventDefault(); runAct(hit); }
    }
    window.addEventListener('keydown', onKey);
    return function () { window.removeEventListener('keydown', onKey); };
  }, [keysOn, current && current.id, payload]); // acts close over these; rebinding per item is the point

  var btn = function (a, i) {
    var primary = a.tone === 'primary';
    var off = a.disabled && a.disabled(payload);
    return (
      <button key={i} type="button" disabled={!!off || !current || loading}
        onClick={function () { runAct(a); }}
        style={{ font: 'inherit', fontSize: 13, fontWeight: 700, padding: '8px 15px', borderRadius: 6,
          cursor: (off || !current) ? 'not-allowed' : 'pointer', opacity: (off || !current) ? 0.5 : 1,
          background: primary ? G.navy : C.surface, color: primary ? '#fff' : C.ink,
          border: '1px solid ' + (primary ? G.navy : G.line) }}>
        {a.label} {a.key ? <span style={{ fontSize: 10.5, fontWeight: 800, background: primary ? 'rgba(255,255,255,.22)' : C.surface2, border: '1px solid ' + (primary ? 'rgba(255,255,255,.4)' : G.line), borderRadius: 3, padding: '1px 6px', marginLeft: 4 }}>{a.key}</span> : null}
      </button>
    );
  };

  return (
    <div>
      <div style={{ background: G.navy, color: '#fff', borderRadius: 8, padding: '9px 14px', display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <span style={{ fontWeight: 800, fontSize: 14 }}>{props.title}</span>
        <span style={{ fontSize: 12, opacity: 0.85 }}>{props.contextLine}</span>
        <span style={{ marginLeft: 'auto', fontFamily: C.mono, fontSize: 12.5, fontWeight: 700 }}>
          {current ? ('#' + seen + ' of ' + total + ' · ' + remaining + ' remaining · ' + walk.skipped.length + ' skipped') : (total + ' walked · ' + walk.acted + ' acted')}
        </span>
      </div>

      {err ? <div style={{ background: C.critTint, border: '1px solid ' + C.crit, color: C.crit, borderRadius: 6, padding: '8px 12px', fontSize: 12.5, marginBottom: 10 }}>{err}</div> : null}

      {current ? (
        loading ? <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>Loading the next item…</div>
                : (payload ? props.renderItem(payload, current) : null)
      ) : (
        <div style={{ background: C.surface, border: '1px solid ' + G.line, borderRadius: 8, padding: '22px 18px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: G.navy, marginBottom: 6 }}>The pass is complete.</div>
          <div style={{ fontSize: 13, color: C.muted }}>
            {walk.acted} item(s) acted on{walk.skipped.length ? ' · ' + walk.skipped.length + ' skipped item(s) remain in the queue, untouched — they are still on My Tasks' : ' · nothing remains'}.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        {current ? acts.map(btn) : null}
        <button type="button" onClick={props.onExit}
          style={{ font: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '7px 13px', borderRadius: 6, marginLeft: 'auto',
            background: C.surface, color: C.muted, border: '1px solid ' + G.line, cursor: 'pointer' }}>
          Exit power mode
        </button>
      </div>
    </div>
  );
}
