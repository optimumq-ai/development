import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';

// USER TYPES — Administration → User types (SPEC_user_type_model §10.2, S3).
// A read-only matrix of the eleven user types × what each one carries (task menu · authority · permission
// groups), so a city can SEE the model. The only editable thing is the display name (model terms, not job
// titles). Re-wiring the matrix is out of v1 — the keys are referenced by code.

var AUTHORITY_LABEL = {
  act_any_request: 'Act on any request', reassign_any: 'Reassign across all teams', reassign_team: 'Reassign within own team',
  override_stage: 'Override stages / reopen', escalate: 'Escalate to legal / director', legal_decision: 'Legal decisions',
  financial_approval: 'Financial approvals', assign_task_subsets_global: 'Set anyone’s task subset',
  assign_task_subsets_team: 'Set task subsets in own team', manage_users: 'Manage accounts & user types',
  system: 'Technical administration', go_live: 'Flip go-live'
};
var GROUP_LABEL = {
  legal_rules: 'Legal Rules', compliance_policy: 'Compliance & Policies', operations_config: 'Operations Configuration',
  fee_configuration: 'Fee Configuration', system_admin: 'Technical Setup', reporting: 'Reporting'
};
var TASK_LABEL = {
  estimate: 'Estimate', record_search: 'Record search', redaction: 'Redaction', redaction_qa: 'Redaction review',
  legal_redaction: 'Legal redaction', legal_review: 'Legal review', fee_waiver: 'Fee-waiver approval',
  intake_review: 'Intake review', mrr_management: 'MRR coordination', release_review: 'Release review',
  close_approval: 'Close approval', process_withdrawal: 'Process withdrawal', '*': 'Any (oversight)'
};

export default function UserTypesPage() {
  var store = useAuthStore();
  var canRename = store.hasAuthority('manage_users');
  var [data, setData] = useState(null);
  var [err, setErr] = useState('');
  var [editing, setEditing] = useState(null);   // {key, name}
  var [saving, setSaving] = useState(false);

  function load() {
    api.get('/user-types').then(function (r) { setData(r.data); })
      .catch(function (e) { setErr((e.response && e.response.data && e.response.data.error) || 'Could not load user types.'); });
  }
  useEffect(load, []);

  async function saveName() {
    if (!editing) return;
    setSaving(true); setErr('');
    try {
      await api.patch('/user-types/' + editing.key, { displayName: editing.name });
      setEditing(null); load();
    } catch (e) { setErr((e.response && e.response.data && e.response.data.error) || 'Could not rename.'); }
    setSaving(false);
  }

  var th = { textAlign: 'left', padding: '10px 12px', fontSize: '11px', fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #E5E7EB', verticalAlign: 'bottom' };
  var td = { padding: '10px 12px', fontSize: '13px', color: '#374151', verticalAlign: 'top', borderBottom: '1px solid #F3F4F6' };
  var chip = function (text, bg, color, key) {
    return <span key={key || text} style={{ display: 'inline-block', background: bg, color: color, fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '12px', margin: '0 4px 4px 0' }}>{text}</span>;
  };

  if (err && !data) return <div style={{ padding: '24px', color: '#DC2626' }}>{err}</div>;
  if (!data) return <div style={{ padding: '24px', color: '#9CA3AF' }}>Loading user types…</div>;

  return (
    <div style={{ padding: '4px 0 24px' }}>
      <div style={{ fontSize: '13px', color: '#6B7280', margin: '0 0 14px', lineHeight: '1.6', maxWidth: '860px' }}>
        A person holds one or more <strong>user types</strong>. Everything else follows from the type: the work the system may route to
        them (<strong>task menu</strong>), what they may do to work they don’t own (<strong>authority</strong>), and which parts of setup they
        may change (<strong>permission groups</strong>). Team types are held against a fulfillment team; a person can hold them on
        several teams, and can be in the Open Records Office at the same time. Display names can be renamed to your city’s terms;
        the wiring is fixed.
      </div>
      {err && <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: '#DC2626', marginBottom: '12px' }}>{err}</div>}
      <div style={{ overflowX: 'auto', background: 'white', border: '1px solid #E5E7EB', borderRadius: '10px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
          <thead><tr>
            <th style={th}>User type</th><th style={th}>Scope</th><th style={th}>Task menu</th><th style={th}>Authority</th><th style={th}>Permission groups</th>
          </tr></thead>
          <tbody>
            {data.userTypes.map(function (t) {
              var isEd = editing && editing.key === t.key;
              return (
                <tr key={t.key}>
                  <td style={td}>
                    {isEd ? (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <input value={editing.name} onChange={function (e) { setEditing({ key: t.key, name: e.target.value }); }} maxLength={80}
                          style={{ padding: '6px 8px', border: '1px solid #BFDBFE', borderRadius: '6px', fontSize: '13px', width: '220px' }} />
                        <button onClick={saveName} disabled={saving} style={{ padding: '6px 10px', background: '#1F4E79', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>Save</button>
                        <button onClick={function () { setEditing(null); }} disabled={saving} style={{ padding: '6px 10px', background: 'white', color: '#6B7280', border: '1px solid #E5E7EB', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontWeight: '600', color: '#111' }}>{t.displayName}{t.legalRulesOwner ? <span title="Owner of the Legal Rules attestations" style={{ marginLeft: '6px', fontSize: '10px', color: '#6D28D9', fontWeight: '700' }}>LEGAL OWNER</span> : null}</div>
                        <div style={{ fontSize: '11px', color: '#9CA3AF', fontFamily: 'monospace' }}>{t.key}
                          {canRename ? <button onClick={function () { setEditing({ key: t.key, name: t.displayName }); }} style={{ marginLeft: '8px', background: 'none', border: 'none', color: '#1F4E79', fontSize: '11px', cursor: 'pointer', padding: 0 }}>Rename</button> : null}
                        </div>
                      </div>
                    )}
                  </td>
                  <td style={td}>{t.scope === 'team' ? chip('per team', '#D1FAE5', '#065F46') : chip('office', '#EDE9FE', '#6D28D9')}</td>
                  <td style={td}>{t.taskMenu.length ? t.taskMenu.map(function (k) { return chip(TASK_LABEL[k] || k, '#EFF6FF', '#1F4E79', k); }) : <span style={{ color: '#D1D5DB' }}>—</span>}</td>
                  <td style={td}>{t.authorities.length ? t.authorities.map(function (k) { return chip(AUTHORITY_LABEL[k] || k, '#FEF3C7', '#92400E', k); }) : <span style={{ color: '#D1D5DB' }}>—</span>}</td>
                  <td style={td}>{t.permissionGroups.length ? t.permissionGroups.map(function (k) { return chip(GROUP_LABEL[k] || k, '#F3F4F6', '#374151', k); }) : <span style={{ color: '#D1D5DB' }}>—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
