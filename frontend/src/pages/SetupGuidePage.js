import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

// SET UP GUIDE — Plan A from docs/mockups/setup_hub/PlanGantt.dc.html (Kevin chose it 2026-08-24), built
// 2026-08-30 as the Administration page's second tab. One row per setup item, grouped into phases; the
// column is the STEP (order, not dates: a bar in step 3 means two things come before it), computed live
// from each item's dependencies; the bar is coloured by the item's counted state; arrows are the
// dependencies; dashed lines are the last steps feeding go-live. Every row opens its screen. Data: the same
// GET /api/setup-hub the Settings and Configuration tab reads — nothing here is a second catalog.

// THE THREE COLOURS (Kevin 2026-08-31): each bar is the item's own screen speaking — red = required data
// missing · yellow = complete, awaiting the lane owner's approval (or changed since) · green = approved.
var COLOUR = {
  red:    { label: 'Not started',       bg: 'var(--oq-bg-fca5a5)', bd: 'var(--oq-ln-dc2626)', text: 'var(--oq-fg-7f1d1d)' },
  yellow: { label: 'Awaiting approval', bg: 'var(--oq-bg-fcd34d)', bd: 'var(--oq-ln-d97706)', text: 'var(--oq-fg-78350f)' },
  green:  { label: 'Approved',          bg: 'var(--oq-bg-86efac)', bd: 'var(--oq-ln-16a34a)', text: 'var(--oq-fg-14532d)' },
};
var GO = {
  red:    { bg: 'var(--oq-bg-fee2e2)', color: 'var(--oq-fg-991b1b)', bd: 'var(--oq-ln-dc2626)', label: 'Go live — not yet' },
  yellow: { bg: 'var(--oq-bg-fcd34d)', color: 'var(--oq-fg-78350f)', bd: 'var(--oq-ln-d97706)', label: 'Go live — not yet' },
  green:  { bg: 'var(--oq-bg-16a34a)', color: 'var(--oq-fg-ffffff)',   bd: 'var(--oq-ln-16a34a)', label: 'Go live' },
  live:   { bg: 'var(--oq-bg-e1f2e9)', color: 'var(--oq-fg-1b8a5a)', bd: 'var(--oq-ln-86efac)', label: 'Live' },
};
// Phases (Plan A) from the hub's lanes. The agency card is Phase 1; go-live is Phase 6 on its own.
var PHASES = [
  { key: 'foundation',  title: 'Phase 1 · Foundation',                               pick: function (it) { return it.top; } },
  { key: 'technical',   title: 'Phase 2 · Technical connections — System Administrator', lanes: ['technical'] },
  { key: 'people',      title: 'Phase 3 · People and departments — Open Records Office', lanes: ['organization'] },
  { key: 'rules',       title: 'Phase 4 · Review the rules the law set — Senior Legal / Director', lanes: ['compliance'], pick: function (it) { return !it.goLive; } },
  { key: 'operations',  title: 'Phase 5 · How this city works a request — ORO + team supervisors', lanes: ['fulfillment_fees', 'fulfillment_redaction', 'features'] },
  { key: 'golive',      title: 'Phase 6 · Go live',                                  pick: function (it) { return it.goLive; } },
];
var ROW_H = 34, HEAD_H = 34, PHASE_H = 30, LABEL_W = 300, COL_W = 150, BAR_H = 24, PAD = 6;

export default function SetupGuidePage() {
  var nav = useNavigate();
  var [data, setData] = useState(null);
  var [err, setErr] = useState('');
  var [live, setLive] = useState(null);      // GET /jurisdiction-profile/enforcement → devMode
  var [confirm, setConfirm] = useState(false);
  var [busy, setBusy] = useState(false);
  var [msg, setMsg] = useState('');
  function load() {
    api.get('/setup-hub').then(function (r) { setData(r.data); }).catch(function (e) { setErr((e.response && e.response.data && e.response.data.error) || 'The setup guide could not load.'); });
    api.get('/jurisdiction-profile/enforcement').then(function (r) { setLive(r.data && r.data.devMode === false); }).catch(function () { setLive(null); });
  }
  useEffect(function () { load(); }, []);
  async function goLive() {
    setBusy(true); setMsg('');
    try { await api.post('/jurisdiction-profile/enforcement', { devMode: false }); setConfirm(false); load(); setMsg('The rules are on for real.'); }
    catch (e) { setMsg((e.response && e.response.data && e.response.data.error) || 'Could not go live.'); }
    setBusy(false);
  }
  if (err) return <div style={{ color: 'var(--oq-fg-b91c1c)', padding: '24px' }}>{err}</div>;
  if (!data) return <div style={{ color: 'var(--oq-fg-9ca3af)', padding: '24px' }}>Loading the setup guide…</div>;

  // ---- flatten the hub payload into items with lane + phase, then compute steps from deps
  var items = [];
  (data.top || []).forEach(function (it) { items.push(Object.assign({}, it, { top: true, lane: 'organization' })); });
  (data.lanes || []).forEach(function (l) { (l.items || []).forEach(function (it) { items.push(Object.assign({}, it, { lane: l.key })); }); });
  var byKey = {}; items.forEach(function (it) { byKey[it.key] = it; });
  var stepOf = {};
  function step(key, seen) {
    if (stepOf[key] != null) return stepOf[key];
    seen = seen || {}; if (seen[key]) return 1; seen[key] = true;
    var it = byKey[key]; if (!it) return 1;
    var deps = (it.deps || []).filter(function (d) { return byKey[d]; });
    var s = it.top ? 1 : (deps.length ? 1 + Math.max.apply(null, deps.map(function (d) { return step(d, seen); })) : 2);
    stepOf[key] = s; return s;
  }
  items.forEach(function (it) { if (!it.goLive) step(it.key); });
  var maxStep = Math.max.apply(null, items.filter(function (it) { return !it.goLive; }).map(function (it) { return stepOf[it.key]; }));
  items.forEach(function (it) { if (it.goLive) stepOf[it.key] = maxStep + 1; });
  var STEPS = maxStep + 1;
  // leaves (nothing depends on them) at the last step feed go-live with dashed lines
  var hasDependent = {}; items.forEach(function (it) { (it.deps || []).forEach(function (d) { hasDependent[d] = true; }); });

  // ---- rows in phase order; y positions are deterministic, so the arrow SVG needs no measuring
  var rows = [], y = HEAD_H;
  PHASES.forEach(function (ph) {
    var members = items.filter(function (it) {
      if (ph.pick && !ph.lanes) return ph.pick(it);
      if (ph.lanes && ph.lanes.indexOf(it.lane) === -1) return false;
      if (it.top || it.goLive) return false;
      return ph.pick ? ph.pick(it) : true;
    });
    if (!members.length) return;
    rows.push({ phase: true, title: ph.title, y: y }); y += PHASE_H;
    members.sort(function (a, b) { return stepOf[a.key] - stepOf[b.key]; });
    members.forEach(function (it) { rows.push({ item: it, y: y }); y += ROW_H; });
  });
  var totalH = y;
  var rowY = {}; rows.forEach(function (r) { if (r.item) rowY[r.item.key] = r.y; });
  function barX(s) { return LABEL_W + (s - 1) * COL_W + PAD; }
  function barEnd(s) { return LABEL_W + s * COL_W - PAD; }
  function midY(key) { return rowY[key] + ROW_H / 2; }

  // ---- arrows: from the end of each dependency's bar to the start of the dependent's bar
  // One TRUNK per source: every arrow leaving a bar shares the same vertical, so a fan of dependents reads
  // as one line with branches (Plan A's blue fan), not a bundle. Sources in the same column get staggered trunks.
  var arrows = [], goLiveKey = (items.filter(function (it) { return it.goLive; })[0] || {}).key;
  var trunkX = {}, trunkSlot = {};
  function trunk(src) {
    if (trunkX[src] != null) return trunkX[src];
    var st = stepOf[src]; trunkSlot[st] = (trunkSlot[st] || 0) + 1;
    trunkX[src] = barEnd(st) + 4 + (trunkSlot[st] - 1) * 4; return trunkX[src];
  }
  rows.forEach(function (r) {
    if (!r.item) return; var it = r.item;
    (it.deps || []).forEach(function (d) {
      if (rowY[d] == null) return;
      var x1 = barEnd(stepOf[d]), y1 = midY(d), x2 = barX(stepOf[it.key]), y2 = midY(it.key);
      arrows.push({ d: 'M' + x1 + ' ' + y1 + ' H' + trunk(d) + ' V' + y2 + ' H' + (x2 - 2), dashed: false });
    });
  });
  if (goLiveKey && rowY[goLiveKey] != null) {
    items.forEach(function (it) {
      if (it.goLive || it.top || hasDependent[it.key] || stepOf[it.key] !== maxStep || rowY[it.key] == null) return;
      var x1 = barEnd(stepOf[it.key]), y1 = midY(it.key), x2 = barX(stepOf[goLiveKey]), y2 = midY(goLiveKey);
      arrows.push({ d: 'M' + x1 + ' ' + y1 + ' H' + (x1 + 10) + ' V' + y2 + ' H' + (x2 - 2), dashed: true });
    });
  }
  var width = LABEL_W + STEPS * COL_W;
  var colours = data.colours || {};
  var goColour = live ? 'live' : (data.goLiveColour || 'red');
  var goItem = items.filter(function (it) { return it.goLive; })[0];
  var mayFlip = !!(goItem && goItem.canEdit);
  var go = GO[goColour];

  return (
    <div style={{ color: 'var(--oq-fg-12232e)' }}>
      <div style={{ background: 'var(--oq-bg-ffffff)', border: '1px solid var(--oq-ln-d2dce3)', borderRadius: '10px', padding: '16px 20px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ flexGrow: 1 }}>
          <div style={{ fontSize: '19px', fontWeight: 700, marginBottom: '3px' }}>Set Up Guide</div>
          <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-5c6f7c)', lineHeight: 1.5, marginBottom: '10px' }}>Everything this city must set up before it can answer records requests for real, in the order it has to happen. Each bar is the item's own screen speaking: <b style={{ color: COLOUR.red.text }}>red</b> — required data missing · <b style={{ color: COLOUR.yellow.text }}>yellow</b> — complete, awaiting the lane owner's approval · <b style={{ color: COLOUR.green.text }}>green</b> — approved. A saved change to approved data turns its bar yellow and notifies the approver. Arrows are the dependencies. Click a bar to open the screen.</div>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
            {['red', 'yellow', 'green'].map(function (k) {
              var s = COLOUR[k];
              return <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: 'var(--oq-fg-5c6f7c)' }}><span style={{ width: '14px', height: '10px', borderRadius: '3px', background: s.bg, border: '1.5px solid ' + s.bd }} />{s.label} · {colours[k] || 0}</span>;
            })}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <button type="button" disabled={goColour !== 'green' || !mayFlip || busy} onClick={function () { setConfirm(true); }}
            title={goColour === 'live' ? 'The rules are on for real' : (goColour === 'green' ? (mayFlip ? 'Every item is approved — turn the rules on for real' : 'Every item is approved — the ORO System Administrator or ORO Director flips it') : 'Opens when every bar is green')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', height: '40px', padding: '0 20px', borderRadius: '8px', background: go.bg, color: go.color, fontSize: '14px', fontWeight: 700, fontFamily: 'inherit', border: '2px solid ' + go.bd, cursor: (goColour === 'green' && mayFlip) ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>{go.label}</button>
          <div style={{ fontSize: '11.5px', color: 'var(--oq-fg-5c6f7c)', marginTop: '6px' }}>{goColour === 'live' ? 'the rules are on for real' : ((colours.yellow || 0) + ' awaiting approval · ' + (colours.red || 0) + ' not started')}</div>
          {msg ? <div style={{ fontSize: '11.5px', color: 'var(--oq-fg-1b8a5a)', marginTop: '4px' }}>{msg}</div> : null}
        </div>
      </div>
      {confirm ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(18,35,46,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={function () { if (!busy) setConfirm(false); }}>
          <div onClick={function (e) { e.stopPropagation(); }} style={{ width: '520px', background: 'var(--oq-bg-ffffff)', border: '1px solid var(--oq-ln-d2dce3)', borderRadius: '10px', padding: '18px 20px', boxShadow: '0 8px 24px rgba(18,35,46,0.18)' }}>
            <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>Ready to go live</div>
            <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-5c6f7c)', lineHeight: 1.5, marginBottom: '14px' }}>Every setup item is approved. Going live turns on the rules — deadlines, fees, notices and automatic decisions — for every request from now on. This is recorded by name and can be reversed by the System Administrator.</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" disabled={busy} onClick={function () { setConfirm(false); }} style={{ height: '34px', padding: '0 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit', background: 'var(--oq-bg-ffffff)', color: 'var(--oq-fg-12232e)', border: '1px solid var(--oq-ln-becad3)', cursor: 'pointer' }}>Not yet</button>
              <button type="button" disabled={busy} onClick={goLive} style={{ height: '34px', padding: '0 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit', background: 'var(--oq-bg-16a34a)', color: 'var(--oq-fg-ffffff)', border: '1px solid var(--oq-ln-16a34a)', cursor: 'pointer' }}>{busy ? 'Going live…' : 'Go live'}</button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ background: 'var(--oq-bg-ffffff)', border: '1px solid var(--oq-ln-d2dce3)', borderRadius: '10px', overflowX: 'auto' }}>
        <div style={{ position: 'relative', width: width + 'px', height: totalH + 'px', minWidth: '100%' }}>
          {/* column headers + grid */}
          {Array.apply(null, Array(STEPS)).map(function (_, i) {
            return <div key={i} style={{ position: 'absolute', left: (LABEL_W + i * COL_W) + 'px', top: 0, width: COL_W + 'px', height: totalH + 'px', borderLeft: '1px solid var(--oq-ln-eef2f5)' }}>
              <div style={{ height: HEAD_H + 'px', lineHeight: HEAD_H + 'px', textAlign: 'center', fontSize: '11px', fontWeight: 700, letterSpacing: '.06em', color: 'var(--oq-fg-8296a4)' }}>STEP {i + 1}</div>
            </div>;
          })}
          <div style={{ position: 'absolute', left: 0, top: (HEAD_H - 1) + 'px', width: '100%', borderTop: '1px solid var(--oq-ln-d2dce3)' }} />
          {/* rows */}
          {rows.map(function (r, i) {
            if (r.phase) return <div key={'p' + i} style={{ position: 'absolute', left: 0, top: r.y + 'px', width: '100%', height: PHASE_H + 'px', background: 'var(--oq-bg-f2f6f9)', borderTop: '1px solid var(--oq-ln-e3eaf0)', borderBottom: '1px solid var(--oq-ln-e3eaf0)', padding: '0 14px', lineHeight: PHASE_H + 'px', fontSize: '12.5px', fontWeight: 700, color: 'var(--oq-fg-1e6091)' }}>{r.title}</div>;
            var it = r.item, st = stepOf[it.key];
            var col = it.goLive ? (goColour === 'live' ? 'green' : (data.goLiveColour || 'red')) : (it.approval || 'red');
            var s = COLOUR[col];
            var barText = it.goLive ? (goColour === 'live' ? 'LIVE' : (col === 'green' ? 'READY TO GO LIVE' : 'WAITING ON THE ROWS ABOVE')) : (it.changedSinceApproval ? 'RE-APPROVAL' : (it.approvalModel === 'list' && col === 'yellow' ? (it.ready ? 'READY FOR APPROVAL' : 'IN PROGRESS') : s.label.toUpperCase()));
            var open = it.door ? function () { nav(it.door); } : null;
            return (
              <div key={it.key} onClick={open} title={it.approvalWhy || it.evidence || ''} style={{ position: 'absolute', left: 0, top: r.y + 'px', width: '100%', height: ROW_H + 'px', cursor: open ? 'pointer' : 'default' }}
                onMouseEnter={function (e) { e.currentTarget.style.background = 'var(--oq-x-f8fafc)'; }} onMouseLeave={function (e) { e.currentTarget.style.background = 'transparent'; }}>
                <div style={{ position: 'absolute', left: '14px', top: 0, width: (LABEL_W - 20) + 'px', height: ROW_H + 'px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', color: it.noScreen ? 'var(--oq-fg-8296a4)' : 'var(--oq-fg-12232e)' }}>{it.name}{it.noScreen ? ' — no screen yet' : ''}</span>
                </div>
                <div style={{ position: 'absolute', left: barX(st) + 'px', top: ((ROW_H - BAR_H) / 2) + 'px', width: (COL_W - 2 * PAD) + 'px', height: BAR_H + 'px', borderRadius: '5px', background: s.bg, border: '2px solid ' + s.bd, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9.5px', fontWeight: 700, letterSpacing: '.04em', color: s.text, overflow: 'hidden', whiteSpace: 'nowrap' }}>{barText}</div>
              </div>
            );
          })}
          {/* arrows */}
          <svg style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }} width={width} height={totalH} viewBox={'0 0 ' + width + ' ' + totalH}>
            <defs><marker id="sg-ah" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0 0 L6 3.5 L0 7 Z" fill="var(--oq-fg-5c6f7c)" /></marker></defs>
            {arrows.map(function (a, i) { return <path key={i} d={a.d} fill="none" stroke="var(--oq-fg-5c6f7c)" strokeWidth="1.2" strokeDasharray={a.dashed ? '4 3' : undefined} markerEnd="url(#sg-ah)" />; })}
          </svg>
        </div>
      </div>
    </div>
  );
}
