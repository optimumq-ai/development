import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

// THE MAGIC SCREEN (DESIGN_magic_screen.md slice 3; Kevin approved the mock 2026-08-14).
// URL-only (/magic, no nav entry), a deliberately DARK backstage console so a glimpsed screen is
// unmistakably the control room, never the product. Every capability here is server-gated
// (demo_mode + SYSTEM_ADMIN); if the API answers 404 the screen says so and offers nothing.
//
// The clock's pace: each held tick advances HALF A DAY and awaits the server (shift + worker
// sweeps ~1s), so a held button ages the world roughly a day per two seconds — inside Kevin's
// 15–60s-per-day envelope, and the workers always keep up because each tick completes before the
// next begins.

var C = {
  bg: '#10151c', card: '#171e28', line: '#2a3542', ink: '#d7dee8', dim: '#93a2b5',
  faint: '#7a8aa0', amber: '#e8a33d', blue: '#7fc4ef', red: '#fecaca'
};
var cardStyle = { background: C.card, border: '1px solid ' + C.line, borderRadius: 12, padding: '18px 20px' };
var hStyle = { fontSize: 11, fontWeight: 800, letterSpacing: '.12em', color: C.faint, textTransform: 'uppercase', marginBottom: 10 };
var kv = { fontSize: 12.5, color: C.dim, lineHeight: 1.55 };

function fmtDate(d) { return d.toISOString().slice(0, 10); }
function noticedWords(t) {
  if (!t || typeof t !== 'object') return null;
  var parts = [];
  if (t.estimate_lapsed) parts.push(t.estimate_lapsed + ' estimate' + (t.estimate_lapsed === 1 ? '' : 's') + ' lapsed');
  if (t.deposit_overdue) parts.push(t.deposit_overdue + ' deposit' + (t.deposit_overdue === 1 ? '' : 's') + ' overdue');
  if (t.deposit_withdrawn) parts.push(t.deposit_withdrawn + ' withdrawn for non-deposit');
  if (t.stalled) parts.push(t.stalled + ' flagged as stalled');
  if (t.withdrawn) parts.push(t.withdrawn + ' withdrawn');
  if (t.nonpayment_dunned) parts.push(t.nonpayment_dunned + ' payment reminder' + (t.nonpayment_dunned === 1 ? '' : 's') + ' sent');
  if (t.nonpayment_closed) parts.push(t.nonpayment_closed + ' closed for non-payment');
  if (t.clarification_timeout_closed) parts.push(t.clarification_timeout_closed + ' clarification window' + (t.clarification_timeout_closed === 1 ? '' : 's') + ' closed');
  return parts.length ? parts.join(' · ') : 'nothing new to notice this time';
}

function ClockFace(props) {
  var d = props.date;
  var h = d.getHours() % 12, m = d.getMinutes(), s = d.getSeconds();
  var hourA = (h + m / 60) * 30, minA = (m + s / 60) * 6;
  function hand(angle, len, width, color) {
    var rad = (angle - 90) * Math.PI / 180;
    return <line x1="100" y1="100" x2={100 + len * Math.cos(rad)} y2={100 + len * Math.sin(rad)}
      stroke={color} strokeWidth={width} strokeLinecap="round" />;
  }
  var ticks = [];
  for (var i = 0; i < 12; i++) {
    var a = (i * 30 - 90) * Math.PI / 180;
    ticks.push(<line key={i} x1={100 + 82 * Math.cos(a)} y1={100 + 82 * Math.sin(a)}
      x2={100 + 90 * Math.cos(a)} y2={100 + 90 * Math.sin(a)} stroke="#5b6c80" strokeWidth="2" />);
  }
  return (
    <svg width="180" height="180" viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="94" fill="#0d1117" stroke="#3b4a5c" strokeWidth="3" />
      {ticks}
      {hand(hourA, 50, 6, '#e8eef5')}
      {hand(minA, 72, 4, '#e8eef5')}
      <circle cx="100" cy="100" r="5" fill={C.amber} />
    </svg>
  );
}

function Calendar(props) {
  var synth = props.synth, real = props.real;
  var first = new Date(Date.UTC(synth.getUTCFullYear(), synth.getUTCMonth(), 1));
  var daysIn = new Date(Date.UTC(synth.getUTCFullYear(), synth.getUTCMonth() + 1, 0)).getUTCDate();
  var lead = first.getUTCDay();
  var cells = [];
  for (var b = 0; b < lead; b++) cells.push(null);
  for (var day = 1; day <= daysIn; day++) cells.push(day);
  while (cells.length % 7) cells.push(null);
  var weeks = [];
  for (var w = 0; w < cells.length; w += 7) weeks.push(cells.slice(w, w + 7));
  var sameMonthReal = real.getUTCFullYear() === synth.getUTCFullYear() && real.getUTCMonth() === synth.getUTCMonth();
  var monthName = synth.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }).toUpperCase() + ' ' + synth.getUTCFullYear();
  return (
    <div>
      <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 13, letterSpacing: '.08em', color: '#aebbcb', marginBottom: 8 }}>{monthName}</div>
      <table style={{ borderCollapse: 'collapse', fontSize: 12.5, textAlign: 'center' }}>
        <tbody>
          <tr style={{ color: '#5b6c80', fontSize: 10.5 }}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (x, i) { return <td key={i} style={{ padding: '3px 7px' }}>{x}</td>; })}</tr>
          {weeks.map(function (week, wi) {
            return <tr key={wi}>{week.map(function (day, di) {
              if (!day) return <td key={di} />;
              var isSynth = day === synth.getUTCDate();
              var isReal = sameMonthReal && day === real.getUTCDate();
              return <td key={di} style={{ padding: '5px 7px' }}>
                {isSynth
                  ? <span style={{ display: 'inline-block', minWidth: 22, background: C.amber, borderRadius: 6, padding: '2px 3px', color: C.bg, fontWeight: 800 }}>{day}</span>
                  : isReal
                    ? <span style={{ display: 'inline-block', minWidth: 22, border: '1.5px dashed #5b8bb0', borderRadius: 6, padding: '2px 3px', color: C.blue }}>{day}</span>
                    : <span style={{ color: C.dim }}>{day}</span>}
              </td>;
            })}</tr>;
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 6, textAlign: 'center', fontSize: 12, color: C.dim }}>
        <span style={{ color: C.blue }}>{'▢'} real today ({fmtDate(real)})</span>
        <span> {'·'} </span>
        <span style={{ color: C.amber }}>{'■'} demo today ({fmtDate(synth)})</span>
      </div>
    </div>
  );
}

export default function MagicPage() {
  var nav = useNavigate();
  var [st, setSt] = useState(undefined);       // undefined loading · null = gated off · object = status
  var [cast, setCast] = useState([]);
  var [staff, setStaff] = useState(null);
  var [noticed, setNoticed] = useState(null);
  var [busy, setBusy] = useState('');
  var [msg, setMsg] = useState('');
  var [confirmReset, setConfirmReset] = useState(false);
  var [addPick, setAddPick] = useState('');
  var holding = useRef(false);
  var [heldDays, setHeldDays] = useState(0);

  function load() {
    api.get('/magic/status').then(function (r) { setSt(r.data); })
      .catch(function (e) { var sc = e.response && e.response.status; setSt(sc === 404 ? null : (sc === 403 ? { denied: true } : undefined)); });
    api.get('/magic/cast').then(function (r) { setCast(r.data.cast || []); }).catch(function () {});
  }
  useEffect(function () { load(); }, []);

  async function benchmark() {
    setBusy('bench'); setMsg('');
    try { await api.post('/magic/benchmark', {}); setMsg('Benchmark taken — this moment is now the starting point.'); load(); }
    catch (e) { setMsg((e.response && e.response.data && e.response.data.error) || 'Benchmark failed.'); }
    setBusy('');
  }
  async function resetAll() {
    setConfirmReset(false); setBusy('reset'); setMsg('');
    try {
      var r = await api.post('/magic/reset', { confirm: true });
      setNoticed(null); setHeldDays(0);
      setMsg('Reset complete — the world is back at the benchmark, clock in sync with real time (' +
        r.data.shift.shifted + ' dates re-aligned).');
      setTimeout(load, 1200);
    } catch (e) { setMsg((e.response && e.response.data && e.response.data.error) || 'Reset failed.'); }
    setBusy('');
  }
  async function advance(seconds) {
    var r = await api.post('/magic/clock/advance', { seconds: seconds });
    setNoticed(r.data.workers && r.data.workers.tickler);
    setSt(function (s) { return Object.assign({}, s, { clockOffsetSeconds: r.data.offsetSeconds, syntheticNow: new Date(Date.now() + r.data.offsetSeconds * 1000).toISOString() }); });
    return r.data;
  }
  async function quickAdvance(days) {
    setBusy('adv'); setMsg('');
    try { await advance(days * 86400); }
    catch (e) { setMsg((e.response && e.response.data && e.response.data.error) || 'Advance failed.'); }
    setBusy('');
  }
  // HOLD: sequential half-day ticks while held — each awaits the server, so workers always keep up.
  async function holdStart() {
    if (holding.current || busy) return;
    holding.current = true; setMsg(''); setHeldDays(0);
    var aged = 0;
    while (holding.current) {
      try { await advance(43200); aged += 0.5; setHeldDays(aged); }
      catch (e) { setMsg((e.response && e.response.data && e.response.data.error) || 'Advance failed.'); holding.current = false; }
    }
  }
  function holdStop() { holding.current = false; }

  async function become(u) {
    setBusy('become'); setMsg('');
    try {
      var r = await api.post('/magic/become', { user_id: u.user_id });
      localStorage.setItem('oq_token', r.data.token);
      nav('/'); window.location.reload();
    } catch (e) { setMsg((e.response && e.response.data && e.response.data.error) || 'Could not switch.'); setBusy(''); }
  }
  function openAdd() {
    if (staff === null) api.get('/staff').then(function (r) { setStaff((r.data.staff || []).filter(function (u) { return u.status !== 'inactive'; })); }).catch(function () { setStaff([]); });
  }
  async function saveCast(next) {
    try { var r = await api.put('/magic/cast', { cast: next.map(function (c) { return { user_id: c.user_id, caption: c.caption }; }) }); setCast(next); }
    catch (e) { setMsg((e.response && e.response.data && e.response.data.error) || 'Could not save the cast.'); }
  }

  if (st === undefined) return <div style={{ background: C.bg, minHeight: '100vh', color: C.faint, padding: 40, fontSize: 14 }}>Loading{'…'}</div>;
  if (st && st.denied) return <div style={{ background: C.bg, minHeight: '100vh', color: C.faint, padding: 40, fontSize: 14 }}>The demo controls are for the System Administrator — your user type can't use this screen.</div>;
  if (st === null) return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.dim, padding: 40, fontSize: 14 }}>
      This install is not in demo mode — there is nothing here.
    </div>
  );

  var real = new Date();
  var synth = new Date(st.syntheticNow || Date.now());
  var offsetDays = Math.round((st.clockOffsetSeconds || 0) / 8640) / 10;
  var bench = st.benchmark;

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '26px 30px 50px' }}>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 6, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '.02em', color: '#f0f4f9' }}>MAGIC <span style={{ fontWeight: 400, color: C.faint }}>{'·'} demo controls</span></div>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', background: '#2b1f10', color: C.amber, border: '1px solid #6b4a1a', borderRadius: 20, padding: '3px 12px' }}>DEMO MODE {'·'} operators only {'·'} not part of the product</span>
        </div>
        <div style={Object.assign({}, kv, { marginBottom: 20 })}>
          {bench
            ? <span>Benchmark: <b style={{ color: C.ink }}>{bench.counts && bench.counts.requests} requests {'·'} {bench.tables} tables</b> {'·'} taken <b style={{ color: C.ink }}>{String(bench.taken_at).replace('T', ' ').slice(0, 16)}</b>{bench.taken_by ? ' by ' + bench.taken_by : ''}{bench.label ? ' · “' + bench.label + '”' : ''}</span>
            : <span style={{ color: C.amber }}>No benchmark yet — take one before using the clock. Reset and the clock stay locked until you do.</span>}
        </div>
        {msg ? <div style={{ background: '#101821', border: '1px solid #223140', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 13, color: C.blue }}>{msg}</div> : null}

        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 300px', gap: 16, alignItems: 'start' }}>

          {/* LEFT — starting point */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={cardStyle}>
              <div style={hStyle}>Starting point</div>
              <button onClick={function () { setConfirmReset(true); }} disabled={!bench || !!busy}
                style={{ width: '100%', background: '#7f1d1d', color: C.red, border: '1px solid #b91c1c', borderRadius: 10, padding: 14, fontSize: 15, fontWeight: 800, opacity: (!bench || busy) ? 0.5 : 1 }}>
                {busy === 'reset' ? 'Resetting… (~10s)' : 'Reset All'}
              </button>
              <div style={Object.assign({}, kv, { marginTop: 8 })}>
                Puts every request back exactly as it was at the benchmark — <b style={{ color: C.ink }}>relative time preserved</b>:
                9 days in process stays 9 days in process. Erases everything done since, and puts the clock back in sync with real time.
              </div>
            </div>
            <div style={cardStyle}>
              <div style={hStyle}>Change the starting point</div>
              <button onClick={benchmark} disabled={!!busy}
                style={{ width: '100%', background: '#173042', color: C.blue, border: '1px solid #2a6b96', borderRadius: 10, padding: 12, fontSize: 14, fontWeight: 700, opacity: busy ? 0.5 : 1 }}>
                {busy === 'bench' ? 'Snapshotting…' : 'Benchmark now'}
              </button>
              <div style={Object.assign({}, kv, { marginTop: 8 })}>
                To modify the demo data: use the app normally — add a request, process a payment, age things with the clock —
                then press this. That moment becomes the new starting point Reset returns to.
              </div>
            </div>
          </div>

          {/* CENTER — the clock */}
          <div style={Object.assign({}, cardStyle, { padding: 22 })}>
            <div style={Object.assign({}, hStyle, { textAlign: 'center' })}>The magic clock</div>
            <div style={{ display: 'flex', gap: 26, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
              <ClockFace date={synth} />
              <Calendar synth={synth} real={real} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 18, flexWrap: 'wrap' }}>
              <button
                onPointerDown={holdStart} onPointerUp={holdStop} onPointerLeave={holdStop}
                disabled={!bench || busy === 'reset'}
                style={{ background: C.amber, color: C.bg, border: 'none', borderRadius: 12, padding: '16px 30px', fontSize: 17, fontWeight: 900, letterSpacing: '.03em', boxShadow: '0 0 0 4px rgba(232,163,61,.15)', opacity: (!bench || busy === 'reset') ? 0.5 : 1, userSelect: 'none', touchAction: 'none' }}>
                {'▶▶'} HOLD to advance time{heldDays ? ' (+' + heldDays + 'd)' : ''}
              </button>
              <div style={Object.assign({}, kv, { maxWidth: 210 })}>
                Each held second ages the world about half a day. Release to stop. Deadlines run out, reminders fire,
                and closures happen <b style={{ color: C.ink }}>while everyone watches</b>.
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={function () { quickAdvance(1); }} disabled={!bench || !!busy} style={{ background: '#1c2632', color: '#aebbcb', border: '1px solid ' + C.line, borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, opacity: (!bench || busy) ? 0.5 : 1 }}>+1 day</button>
              <button onClick={function () { quickAdvance(7); }} disabled={!bench || !!busy} style={{ background: '#1c2632', color: '#aebbcb', border: '1px solid ' + C.line, borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, opacity: (!bench || busy) ? 0.5 : 1 }}>+7 days</button>
              <span style={kv}>
                {offsetDays > 0
                  ? <span>Demo time is <b style={{ color: C.amber }}>{offsetDays} day{offsetDays === 1 ? '' : 's'} ahead</b> of real time {'·'} Reset All puts it back in sync</span>
                  : <span>Demo time is in sync with real time</span>}
              </span>
            </div>
            {noticed !== null ? (
              <div style={{ background: '#101821', border: '1px solid #223140', borderRadius: 8, padding: '10px 12px', marginTop: 14, fontSize: 12.5, color: C.dim }}>
                Last advance — the system noticed: <b style={{ color: C.ink }}>{noticedWords(noticed)}</b>
                {' · '}<a href="/tickler" style={{ color: C.blue }}>open the Tickler to show the audience {'→'}</a>
              </div>
            ) : null}
          </div>

          {/* RIGHT — become */}
          <div style={cardStyle}>
            <div style={hStyle}>Become (role switch)</div>
            <div style={Object.assign({}, kv, { marginBottom: 10 })}>One click signs you in as that person, in this tab. Come back by typing <b style={{ color: C.ink }}>/magic</b>.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {cast.map(function (u) {
                return (
                  <div key={u.user_id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button onClick={function () { become(u); }} disabled={!!busy}
                      style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1c2632', color: C.ink, border: '1px solid ' + C.line, borderRadius: 8, padding: '9px 12px', fontSize: 13, opacity: busy ? 0.6 : 1 }}>
                      <span><b>{u.display_name}</b> {'·'} {u.caption}</span>
                      <span style={{ color: C.blue, fontWeight: 700 }}>Become {'→'}</span>
                    </button>
                    <button title="Remove from the cast" onClick={function () { saveCast(cast.filter(function (x) { return x.user_id !== u.user_id; })); }}
                      style={{ background: 'none', border: 'none', color: C.faint, fontSize: 15, padding: '0 2px' }}>{'×'}</button>
                  </div>
                );
              })}
              {!cast.length ? <div style={kv}>No cast yet — add the people you demo as.</div> : null}
            </div>
            <div style={{ marginTop: 10, borderTop: '1px solid ' + C.line, paddingTop: 8 }}>
              <select value={addPick} onFocus={openAdd} onChange={function (e) { setAddPick(e.target.value); }}
                style={{ width: '100%', font: 'inherit', fontSize: 12.5, background: '#1c2632', color: C.ink, border: '1px solid ' + C.line, borderRadius: 8, padding: '7px 9px' }}>
                <option value="">{staff === null ? 'Add a person…' : 'Choose a person to add…'}</option>
                {(staff || []).filter(function (u) { return !cast.some(function (c) { return c.user_id === u.id; }); })
                  .map(function (u) { return <option key={u.id} value={u.id}>{u.display_name}{u.title ? ' — ' + u.title : ''}</option>; })}
              </select>
              {addPick ? <button onClick={function () {
                var u = (staff || []).filter(function (x) { return x.id === addPick; })[0];
                if (u) saveCast(cast.concat([{ user_id: u.id, display_name: u.display_name, caption: u.title || '' }]));
                setAddPick('');
              }} style={{ marginTop: 6, width: '100%', background: '#173042', color: C.blue, border: '1px solid #2a6b96', borderRadius: 8, padding: '7px', fontSize: 12.5, fontWeight: 700 }}>Add to cast</button> : null}
              <div style={Object.assign({}, kv, { marginTop: 8 })}>Edit this cast as you rehearse — it{'’'}s a list on this screen, not code.</div>
            </div>
          </div>
        </div>

        {confirmReset ? (
          <div onClick={function () { setConfirmReset(false); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
            <div onClick={function (e) { e.stopPropagation(); }} style={Object.assign({}, cardStyle, { width: 440, maxWidth: '100%' })}>
              <div style={hStyle}>Reset everything?</div>
              <div style={Object.assign({}, kv, { marginBottom: 14 })}>
                Everything done since the benchmark{bench && bench.taken_at ? ' (' + String(bench.taken_at).replace('T', ' ').slice(0, 16) + ')' : ''} is
                discarded, and the clock returns to real time. The app will pause for about ten seconds while the world is rebuilt.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={resetAll} style={{ background: '#7f1d1d', color: C.red, border: '1px solid #b91c1c', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 800 }}>Yes — reset to the benchmark</button>
                <button onClick={function () { setConfirmReset(false); }} style={{ background: '#1c2632', color: C.ink, border: '1px solid ' + C.line, borderRadius: 8, padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>Cancel</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
