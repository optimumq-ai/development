import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import FeeEstimatePanel from '../components/ui/FeeEstimatePanel';
import { useWorkTimer, WorkTimerBadge, useTimeCaptureMode } from '../components/ui/WorkTimer';
import { SubmittedDescription } from '../components/primitives';
import CommercialRatePanel from '../components/ui/CommercialRatePanel';

export default function EstimateTaskPage() {
  var params = useParams();
  var taskId = params.taskId;
  var [task, setTask] = useState(null);
  var [ctx, setCtx] = useState(null);          // BW4: /tasks/:id/estimate-context
  var [flash, setFlash] = useState('');
  var [busy, setBusy] = useState('');
  var [err, setErr] = useState('');
  var timer = useWorkTimer(taskId);
  var tcm = useTimeCaptureMode('estimate');   // Slice E: badge visibility only here — the estimate finalize
                                              // ceremony isn't consolidated yet, so the Complete modal rides along later.

  // BW4 — the screen-specific facts, in one read, from the same functions the guards use. Failure is not
  // fatal: the estimate builder is the pre-existing screen and must keep working if a context read breaks.
  function loadCtx() {
    return api.get('/tasks/' + taskId + '/estimate-context')
      .then(function (r) { setCtx(r.data); })
      .catch(function () {});
  }

  useEffect(function () {
    api.get('/tasks/' + taskId)
      .then(function (r) { setTask(r.data.task); api.post('/tasks/' + taskId + '/begin').catch(function () {}); }) // begin-work: owner-gated (Slice A)
      .catch(function () { setErr('Could not load this task.'); });
    loadCtx();
  }, [taskId]);

  function classify(value) {
    if (!ctx) return;
    setBusy('classify');
    return api.post('/requests/' + ctx.task.request_id + '/commercial-classification', { classifyAs: value })
      .then(function (r) {
        setFlash(r.data && r.data.overridesDeclaration
          ? 'Classified as ' + value + ' — this overrides the requester’s declaration and must be communicated.'
          : 'Classified as ' + value + ' — recorded against your name.');
        return loadCtx();
      })
      .catch(function (e) { setFlash((e.response && e.response.data && e.response.data.error) || 'Could not record that classification.'); })
      .then(function () { setBusy(''); });
  }

  if (err) return <div style={{ padding: '24px', color: '#9B1C1C', fontSize: '14px' }}>{err}</div>;
  if (!task) return <div style={{ padding: '24px', color: '#9CA3AF', fontSize: '14px' }}>Loading...</div>;

  var review = (task.title || '').toLowerCase().indexOf('review') >= 0;
  var done = task.status === 'done';

  return (
    <div style={{ maxWidth: '1100px' }}>
      <Link to="/my-tasks" style={{ fontSize: '13px', color: '#1F4E79', textDecoration: 'none' }}>&larr; My Tasks</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '10px 0 4px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', margin: 0 }}>Estimate</h1>
        <span style={{ background: review ? '#FEF3C7' : '#DBEAFE', color: review ? '#92400E' : '#1E40AF', fontSize: '11px', fontWeight: '700', padding: '3px 10px', borderRadius: '20px' }}>{review ? 'REVIEW — auto-generated' : 'CREATE'}</span>
        {done ? <span style={{ background: '#DEF7EC', color: '#03543F', fontSize: '11px', fontWeight: '700', padding: '3px 10px', borderRadius: '20px' }}>TASK COMPLETE</span> : null}
        {done || tcm.mode === 'off' ? null : <WorkTimerBadge timer={timer} />}
      </div>
      <p style={{ color: '#6B7280', fontSize: '14px', margin: '0 0 6px' }}>
        {task.request_number ? task.request_number + ' · ' : ''}{task.requestor_name ? 'for ' + task.requestor_name : ''}{task.record_type_name ? ' · ' + task.record_type_name : ''}
      </p>
      {/* Global record-item layout (SPEC_processing_ui.md §2): verbatim text first, titled — never an
          italic aside. The Mark Vague / Mark Overly Broad defect box arrives with BW4 (markers +
          estimate-task pause ship together; Draft 2 §4.1). */}
      {task.request_description
        ? <SubmittedDescription margin="0 0 18px">{task.request_description}</SubmittedDescription>
        : null}
      {flash ? <div style={{ fontSize: '13px', color: '#03543F', background: '#DEF7EC', border: '1px solid #BCF0DA', borderRadius: '8px', padding: '9px 12px', marginBottom: '12px' }}>{flash}</div> : null}
      {/* BW4 — the classification is the ESTIMATOR's business too: it is their invoice that carries the
          rate. Same component, same endpoint, same single stored fact as the intake screen. */}
      {ctx ? <CommercialRatePanel commercial={ctx.commercial} busy={!!busy} onClassify={classify} /> : null}
      <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E5E7EB', padding: '24px' }}>
        <FeeEstimatePanel requestId={task.request_id} />
      </div>
      <p style={{ color: '#9CA3AF', fontSize: '12px', marginTop: '12px' }}>Sending the estimate to the requestor marks this task complete.</p>
    </div>
  );
}
