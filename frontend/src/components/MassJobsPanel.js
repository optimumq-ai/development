import React, { useEffect, useState } from 'react';
import api from '../lib/api';

function statusStyle(s) {
  if (s === 'running') return { c: '#1E40AF', b: '#DBEAFE', label: 'Running' };
  if (s === 'queued') return { c: '#374151', b: '#F3F4F6', label: 'Queued' };
  if (s === 'paused') return { c: '#92400E', b: '#FEF3C7', label: 'Paused' };
  if (s === 'completed') return { c: '#03543F', b: '#DEF7EC', label: 'Completed' };
  if (s === 'failed') return { c: '#9B1C1C', b: '#FDE8E8', label: 'Failed' };
  return { c: '#6B7280', b: '#F3F4F6', label: 'Canceled' };
}
function whenRan(j) { return (j.last_run_at || j.updated_at || j.created_at || '').replace('T', ' ').slice(0, 16); }

export default function MassJobsPanel(props) {
  var [jobs, setJobs] = useState([]);
  var [cfg, setCfg] = useState(null);
  var [loaded, setLoaded] = useState(false);
  var [busy, setBusy] = useState({});
  var [showLog, setShowLog] = useState(false);

  async function load() {
    try { var r = await api.get('/mass-jobs'); setJobs(r.data || []); } catch (e) { /* keep prior */ }
    setLoaded(true);
  }
  useEffect(function () { api.get('/mass-jobs/config').then(function (r) { setCfg(r.data); }).catch(function () {}); }, []);
  useEffect(function () { load(); var t = setInterval(load, 8000); return function () { clearInterval(t); }; }, [props.reloadKey]);

  async function act(id, verb) {
    setBusy(function (m) { var n = Object.assign({}, m); n[id] = true; return n; });
    try { await api.post('/mass-jobs/' + id + '/' + verb); await load(); }
    catch (e) { alert('Could not ' + verb + ' the job. ' + ((e.response && e.response.data && e.response.data.error) || '')); }
    setBusy(function (m) { var n = Object.assign({}, m); delete n[id]; return n; });
  }

  if (!loaded && !jobs.length) return null;

  var active = jobs.filter(function (j) { return ['queued', 'running', 'paused'].indexOf(j.status) >= 0; });
  var log = jobs.filter(function (j) { return ['completed', 'canceled', 'failed'].indexOf(j.status) >= 0; })
    .sort(function (a, b) { return String(whenRan(b)).localeCompare(String(whenRan(a))); });

  var windowLabel = cfg ? (fmt(cfg.window_start) + '\u2013' + fmt(cfg.window_end)) : '';
  function fmt(hhmm) {
    var p = String(hhmm || '').split(':'); var h = parseInt(p[0], 10); var m = p[1] || '00';
    var ap = h >= 12 ? 'PM' : 'AM'; var hh = h % 12; if (hh === 0) hh = 12;
    return hh + ':' + m + ' ' + ap;
  }

  return (
    <div style={{ marginBottom: '22px' }}>
      {/* ACTIVE / SCHEDULED — jobs that will run or are running */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ fontSize: '13px', fontWeight: '700', color: '#374151' }}>Active &amp; scheduled jobs ({active.length})</div>
        {cfg ? (
          <div style={{ fontSize: '11.5px', color: '#9CA3AF' }}>
            {cfg.after_hours_only ? ('Runs nightly ' + windowLabel + ' \u00b7 ') : 'Runs continuously \u00b7 '}
            shared budget {cfg.nightly_budget}/night
          </div>
        ) : null}
      </div>

      {active.length === 0 ? (
        <div style={{ padding: '16px', textAlign: 'center', background: 'white', border: '1px dashed #E5E7EB', borderRadius: '10px', color: '#9CA3AF', fontSize: '12.5px' }}>
          No active or scheduled jobs. Use &ldquo;Schedule job&rdquo; on a template below to queue a batch.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {active.map(function (j) {
            var st = statusStyle(j.status);
            var bz = !!busy[j.id];
            return (
              <div key={j.id} style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '14px 18px', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <span style={{ fontWeight: '700', fontSize: '14px', color: '#1F4E79' }}>{j.name}</span>
                  <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '.03em', padding: '1px 7px', borderRadius: '999px', color: j.kind === 'fields' ? '#3730A3' : '#374151', background: j.kind === 'fields' ? '#E0E7FF' : '#F3F4F6' }}>{j.kind === 'fields' ? 'FIELDS' : 'PAGES'}</span>
                  <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '999px', color: st.c, background: st.b }}>{st.label}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: '12px', fontWeight: '700', color: '#374151' }}>{j.processed_items} / {j.total_items}</span>
                </div>
                <div style={{ height: '8px', background: '#F3F4F6', borderRadius: '999px', overflow: 'hidden', marginBottom: '8px' }}>
                  <div style={{ width: j.pct + '%', height: '100%', background: '#1F4E79', transition: 'width .3s' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '12px', color: '#6B7280' }}>
                    {j.redacted_count} redacted &middot; {j.held_count} held{j.error_count ? ' \u00b7 ' + j.error_count + ' error(s)' : ''}
                  </span>
                  {j.remaining_items > 0 ? (
                    <span style={{ fontSize: '12px', color: '#6B7280' }}>
                      {j.remaining_items} left &middot; ~{j.nights_remaining} night{j.nights_remaining !== 1 ? 's' : ''}{j.est_completion ? ' (done around ' + j.est_completion + ')' : ''}
                    </span>
                  ) : null}
                  <span style={{ flex: 1 }} />
                  <button onClick={function () { act(j.id, 'run-now'); }} disabled={bz} title="Process one chunk right now, ignoring the nightly window" style={btn('#1F4E79', 'white')}>{bz ? '...' : 'Run a chunk now'}</button>
                  {j.status === 'running' || j.status === 'queued' ? (
                    <button onClick={function () { act(j.id, 'pause'); }} disabled={bz} style={btn('white', '#374151', '#E5E7EB')}>Pause</button>
                  ) : null}
                  {j.status === 'paused' ? (
                    <button onClick={function () { act(j.id, 'resume'); }} disabled={bz} style={btn('white', '#1F4E79', '#1F4E79')}>Resume</button>
                  ) : null}
                  <button onClick={function () { if (window.confirm('Cancel this job? Documents already redacted stay released; the rest are not processed.')) act(j.id, 'cancel'); }} disabled={bz} style={btn('white', '#DC2626', '#FCA5A5')}>Cancel</button>
                </div>
                {j.error_log && j.error_log.length ? (
                  <div style={{ marginTop: '8px', fontSize: '11px', color: '#9B1C1C' }}>Last issue: {j.error_log[j.error_log.length - 1].error}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* PROCESSED JOBS LOG — a scrollable history of runs that have finished */}
      {log.length ? (
        <div style={{ marginTop: '18px' }}>
          <div onClick={function () { setShowLog(!showLog); }} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#374151' }}>Processed jobs &mdash; history ({log.length})</span>
            <span style={{ fontSize: '11px', color: '#6B7280' }}>{showLog ? '\u25be hide' : '\u25b8 show'}</span>
          </div>
          {showLog ? (
            <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: '10px', background: 'white' }}>
              {log.map(function (j, i) {
                var st = statusStyle(j.status);
                return (
                  <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 14px', borderTop: i ? '1px solid #F3F4F6' : 'none', fontSize: '12.5px' }}>
                    <span style={{ fontSize: '11px', fontWeight: '700', padding: '1px 7px', borderRadius: '999px', color: st.c, background: st.b, flexShrink: 0 }}>{st.label}</span>
                    <span style={{ fontWeight: '600', color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '260px' }}>{j.name}</span>
                    <span style={{ color: '#9CA3AF', flexShrink: 0 }}>{j.redacted_count} redacted{j.held_count ? ' \u00b7 ' + j.held_count + ' held' : ''}{j.error_count ? ' \u00b7 ' + j.error_count + ' err' : ''}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ color: '#9CA3AF', flexShrink: 0, fontSize: '11.5px' }}>{whenRan(j)}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function btn(bg, color, border) {
  return { flexShrink: 0, padding: '6px 12px', borderRadius: '8px', border: border ? ('1px solid ' + border) : 'none', background: bg, color: color, fontSize: '12px', fontWeight: '700', cursor: 'pointer' };
}
