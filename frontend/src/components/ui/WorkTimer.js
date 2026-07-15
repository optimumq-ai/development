import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../lib/api';

// WORK TIMER (Slice D). Actual-labor capture for a task screen: starts on mount (begin-work), counts ACTIVE
// time only — pauses on window/tab blur and after idle, resumes on focus/activity — heartbeats the running
// total to the server, and continues across sessions. A separate number from the calendar clocks.
var IDLE_MS = 5 * 60 * 1000;   // pause after 5 min of no input (configurable later)
var BEAT_S = 30;               // heartbeat every 30s

export function fmtDur(s) {
  s = Math.floor(s || 0);
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm';
  return sec + 's';
}

export function useWorkTimer(taskId, enabled) {
  var [state, setState] = useState({ seconds: 0, paused: false, idle: false });
  var R = useRef({ seconds: 0, lastActivity: Date.now(), visible: true, finalized: false, sinceBeat: 0 });

  var flush = useCallback(function () {
    if (R.current.finalized || !taskId) return Promise.resolve();
    return api.post('/tasks/' + taskId + '/work', { seconds: R.current.seconds }).catch(function () {});
  }, [taskId]);

  useEffect(function () {
    if (!taskId || enabled === false) return;
    var alive = true;
    api.get('/tasks/' + taskId).then(function (r) {
      if (!alive) return; var t = (r.data && r.data.task) || {};
      R.current.seconds = t.work_seconds || 0; R.current.finalized = !!t.work_finalized;
      setState(function (s) { return { seconds: R.current.seconds, paused: s.paused, idle: s.idle }; });
    }).catch(function () {});

    function activity() { R.current.lastActivity = Date.now(); }
    function onVis() { R.current.visible = document.visibilityState === 'visible'; if (R.current.visible) R.current.lastActivity = Date.now(); }
    function onBlur() { R.current.visible = false; }
    function onFocus() { R.current.visible = true; R.current.lastActivity = Date.now(); }
    var acts = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    acts.forEach(function (e) { window.addEventListener(e, activity, { passive: true }); });
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur); window.addEventListener('focus', onFocus);

    var tick = setInterval(function () {
      var idle = (Date.now() - R.current.lastActivity) >= IDLE_MS;
      var active = R.current.visible && !idle && !R.current.finalized;
      if (active) { R.current.seconds += 1; R.current.sinceBeat += 1; }
      if (R.current.sinceBeat >= BEAT_S) { R.current.sinceBeat = 0; flush(); }
      setState({ seconds: R.current.seconds, paused: !active && !R.current.finalized, idle: R.current.visible && idle && !R.current.finalized });
    }, 1000);

    return function () {
      alive = false; clearInterval(tick);
      acts.forEach(function (e) { window.removeEventListener(e, activity); });
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus);
      flush();
    };
  }, [taskId, enabled, flush]);

  return { seconds: state.seconds, paused: state.paused, idle: state.idle, flush: flush, markFinalized: function () { R.current.finalized = true; } };
}

// The live badge for the task-screen header.
export function WorkTimerBadge(props) {
  var t = props.timer; if (!t) return null;
  var paused = t.paused;
  var base = { display: 'inline-flex', alignItems: 'center', gap: '7px', borderRadius: '999px', padding: '5px 12px', fontSize: '13px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' };
  var style = paused ? Object.assign({}, base, { background: '#F3F4F6', color: '#6B7280', border: '1px solid #E5E7EB' }) : Object.assign({}, base, { background: '#E8F4EC', color: '#17803D' });
  var dot = { width: '8px', height: '8px', borderRadius: '50%', background: paused ? '#9CA3AF' : '#17803D' };
  return <span style={style} title="Active work time on this task">
    <span style={dot} />⏱ {fmtDur(t.seconds)}{paused ? (t.idle ? ' · paused (idle)' : ' · paused') : ''}
  </span>;
}

// The completion popup: accept the measured time or adjust it (a reason is required), then run the real
// completion via onConfirm.
export function WorkTimerCompleteModal(props) {
  var open = props.open, taskId = props.taskId, seconds = props.seconds || 0;
  var [mode, setMode] = useState('accept');
  var [h, setH] = useState(0), [m, setM] = useState(0), [reason, setReason] = useState('');
  var [busy, setBusy] = useState(false), [err, setErr] = useState('');
  useEffect(function () { if (open) { setMode('accept'); setH(Math.floor(seconds / 3600)); setM(Math.floor((seconds % 3600) / 60)); setReason(''); setErr(''); } }, [open, seconds]);
  if (!open) return null;

  async function finalize(body) {
    setBusy(true); setErr('');
    try { await api.post('/tasks/' + taskId + '/work/finalize', body); if (props.onConfirm) await props.onConfirm(); }
    catch (e) { setErr((e.response && e.response.data && e.response.data.error) || 'Could not save your time.'); setBusy(false); }
  }
  function accept() { finalize({ seconds: seconds }); }
  function save() { if (!reason.trim()) { setErr('A short reason is required to adjust the time.'); return; } finalize({ seconds: seconds, adjustedSeconds: (Number(h) || 0) * 3600 + (Number(m) || 0) * 60, reason: reason.trim() }); }

  var ov = { position: 'fixed', inset: 0, background: 'rgba(16,26,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
  var box = { width: '420px', maxWidth: '92vw', background: 'white', borderRadius: '14px', boxShadow: '0 12px 40px rgba(16,26,42,.25)', overflow: 'hidden' };
  var btn = { flex: 1, textAlign: 'center', padding: '10px 14px', borderRadius: '9px', fontSize: '13.5px', fontWeight: 700, cursor: 'pointer', border: '1px solid transparent' };
  var input = { width: '56px', textAlign: 'center', fontFamily: 'monospace', fontSize: '15px', fontWeight: 700, padding: '7px', border: '1px solid #D3DAE4', borderRadius: '8px' };
  return (
    <div style={ov} onMouseDown={function (e) { if (e.target === e.currentTarget && props.onClose) props.onClose(); }}>
      <div style={box}>
        <div style={{ padding: '18px 20px 4px' }}>
          <div style={{ fontSize: '16px', fontWeight: 800 }}>Log your time on this task</div>
          {props.contextLabel ? <div style={{ fontSize: '12.5px', color: '#66717F', marginTop: '3px' }}>{props.contextLabel}</div> : null}
        </div>
        {mode === 'accept' ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', padding: '18px 20px' }}>
              <div style={{ fontSize: '40px', fontWeight: 800, letterSpacing: '-.02em', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>{fmtDur(seconds)}</div>
              <div style={{ fontSize: '11.5px', fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#98A2B0' }}>active work time</div>
            </div>
            <div style={{ fontSize: '11.5px', color: '#66717F', textAlign: 'center', background: '#FAFBFC', borderTop: '1px solid #E5E7EB', borderBottom: '1px solid #E5E7EB', padding: '8px' }}>Only active time is counted — idle and time on other windows are excluded.</div>
          </>
        ) : (
          <div style={{ borderTop: '1px solid #E5E7EB', padding: '14px 20px', background: '#FAFBFC' }}>
            <div style={{ fontSize: '11.5px', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#66717F', marginBottom: '2px' }}>Measured</div>
            <div style={{ fontSize: '13px', color: '#98A2B0', textDecoration: 'line-through', marginBottom: '10px', fontFamily: 'monospace' }}>{fmtDur(seconds)}</div>
            <div style={{ fontSize: '11.5px', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#66717F', marginBottom: '6px' }}>Actual time</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <input style={input} type="number" min="0" value={h} onChange={function (e) { setH(e.target.value); }} /><span style={{ color: '#66717F' }}>h</span>
              <input style={input} type="number" min="0" max="59" value={m} onChange={function (e) { setM(e.target.value); }} /><span style={{ color: '#66717F' }}>m</span>
            </div>
            <div style={{ fontSize: '11.5px', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#66717F', marginBottom: '6px' }}>Why the change <span style={{ color: '#C22B2B' }}>· required</span></div>
            <textarea style={{ width: '100%', minHeight: '56px', border: '1px solid #D3DAE4', borderRadius: '8px', padding: '9px', fontSize: '13px', fontFamily: 'inherit', resize: 'vertical' }} placeholder="e.g. ~30 min on a phone call about this record the timer didn't capture." value={reason} onChange={function (e) { setReason(e.target.value); }} />
            <div style={{ fontSize: '11.5px', color: '#98A2B0', marginTop: '4px' }}>The measured time, your adjustment, and this reason are all kept on the record.</div>
          </div>
        )}
        {err ? <div style={{ fontSize: '12.5px', color: '#9B1C1C', background: '#FDE8E8', padding: '8px 20px' }}>{err}</div> : null}
        <div style={{ display: 'flex', gap: '9px', padding: '16px 20px' }}>
          {mode === 'accept' ? (
            <>
              <span style={Object.assign({}, btn, { background: '#1F4E79', color: '#fff', opacity: busy ? .6 : 1 })} onClick={function () { if (!busy) accept(); }}>{busy ? 'Saving…' : (props.confirmLabel || 'Accept & submit')}</span>
              <span style={Object.assign({}, btn, { background: 'white', color: '#1F4E79', borderColor: '#E5E7EB' })} onClick={function () { setMode('adjust'); }}>Adjust time</span>
            </>
          ) : (
            <>
              <span style={Object.assign({}, btn, { background: '#1F4E79', color: '#fff', opacity: busy ? .6 : 1 })} onClick={function () { if (!busy) save(); }}>{busy ? 'Saving…' : 'Save & submit'}</span>
              <span style={Object.assign({}, btn, { background: 'white', color: '#66717F', borderColor: '#E5E7EB' })} onClick={function () { setMode('accept'); }}>Cancel</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
