import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import SetupScreen from '../components/setup/SetupScreen';
import api from '../lib/api';
import StaffManagementPage from './StaffManagementPage';
import RemovalDialog from '../components/ui/RemovalDialog';

// Consolidated "parent" screen for the org model (design §7): City Departments, Fulfillment Teams, and
// Staff in one place, replacing the separate Staff Management and City Departments & Teams screens.
// One physical table (`departments`) holds both departments and teams, discriminated by `kind`.
//   department -> an org-chart entity that OWNS records (Police, Parks, City Clerk...).
//   team       -> a group that PROCESSES requests. A team declares which departments it fulfills.

const PALETTE = ['#2E75B6', '#1F4E79', '#C0392B', '#7030A0', '#375623', '#7F6000', '#0F766E', '#B91C1C', '#1F3864'];

const inp = { width: '100%', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box', background: 'white' };
const lbl = { display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '5px' };
const btnPrimary = { padding: '10px 18px', background: '#1F4E79', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' };
const card = { background: 'white', borderRadius: '12px', border: '1px solid #E5E7EB', padding: '18px' };
const chip = (bg, color) => ({ background: bg, color: color, fontSize: '11px', fontWeight: '700', padding: '3px 10px', borderRadius: '20px', display: 'inline-block' });

function Guidance({ children }) {
  return <div style={{ background: '#F0F6FC', border: '1px solid #D6E4F0', borderRadius: '10px', padding: '14px 16px', fontSize: '13px', color: '#374151', lineHeight: 1.6 }}>{children}</div>;
}

function CodeChip({ code, color }) {
  return <span style={{ background: (color || '#2E75B6') + '22', color: color || '#2E75B6', fontSize: '11px', fontWeight: '800', padding: '3px 9px', borderRadius: '6px', letterSpacing: '.03em' }}>{code}</span>;
}

export default function OrgPage() {
  // LIST MODEL (2026-08-31): three hub rows share this screen — each tab wears the strip of its own row.
  const [params, setParams] = useSearchParams();
  const HUB_KEY = { departments: 'departments', teams: 'teams', staff: 'staff' };
  const tabParam = params.get('tab');
  const [tab, setTabState] = useState(HUB_KEY[tabParam] ? tabParam : 'departments');
  function setTab(t) { setTabState(t); setParams({ tab: t }); }
  const nav = useNavigate();
  const [departments, setDepartments] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  // editor: kind = 'department' | 'team'; row = existing row or null (create)
  const [editKind, setEditKind] = useState(null);
  const [editRow, setEditRow] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [viewStaffTeam, setViewStaffTeam] = useState(null);
  const [removing, setRemoving] = useState(null);   // { kind, id, name } — the deletion process dialog (2026-09-08)
  const [removedMsg, setRemovedMsg] = useState('');

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    try {
      const [dr, sr] = await Promise.all([api.get('/departments'), api.get('/staff')]);
      setDepartments(dr.data.departments || []);
      setStaff(sr.data.staff || []);
    } catch (e) { /* surfaced per-action */ }
    setLoading(false);
  }

  const depts = departments.filter(d => d.kind !== 'team');
  const teams = departments.filter(d => d.kind === 'team');
  const teamById = {}; teams.forEach(t => { teamById[t.id] = t; });
  const memberCount = (teamId) => staff.filter(s => s.department_id === teamId).length;
  const deptsServedBy = (teamId) => depts.filter(d => d.processed_by === teamId);
  const fulfillingTeam = (dept) => (dept.processed_by ? teamById[dept.processed_by] : null);

  function setF(k, v) { setForm(f => Object.assign({}, f, { [k]: v })); }

  function newDepartment() { setEditKind('department'); setEditRow(null); setForm({ name: '', code: '', color: PALETTE[0], is_open_records: 0, is_catch_all: 0 }); setErr(''); }
  function editDepartment(d) { setEditKind('department'); setEditRow(d); setForm({ name: d.name, code: d.code, color: d.color || PALETTE[0], is_open_records: d.is_open_records ? 1 : 0, is_catch_all: d.is_catch_all ? 1 : 0 }); setErr(''); }
  function newTeam() { setEditKind('team'); setEditRow(null); setForm({ name: '', code: '', color: PALETTE[1], routing_specialization: '', auto_load_balancing: 0, is_open_records: 0, parent_id: '', fulfills: [] }); setErr(''); }
  function editTeam(t) { setEditKind('team'); setEditRow(t); setForm({ name: t.name, code: t.code, color: t.color || PALETTE[1], routing_specialization: t.routing_specialization || '', auto_load_balancing: t.auto_load_balancing ? 1 : 0, is_open_records: t.is_open_records ? 1 : 0, parent_id: t.parent_id || '', fulfills: deptsServedBy(t.id).map(d => d.id) }); setErr(''); }
  function closeEditor() { setEditKind(null); setEditRow(null); setErr(''); }

  function toggleFulfills(deptId) {
    setForm(f => { const has = (f.fulfills || []).includes(deptId); return Object.assign({}, f, { fulfills: has ? f.fulfills.filter(x => x !== deptId) : (f.fulfills || []).concat(deptId) }); });
  }

  async function saveEditor() {
    if (!form.name || !form.name.trim()) { setErr('Name is required'); return; }
    if (!form.code || !form.code.trim()) { setErr('Code is required'); return; }
    setSaving(true);
    try {
      const base = { name: form.name.trim(), code: form.code.trim().toUpperCase(), color: form.color, kind: editKind };
      let id = editRow && editRow.id;
      if (editKind === 'department') {
        const payload = Object.assign({}, base, { is_open_records: form.is_open_records ? 1 : 0, is_catch_all: form.is_catch_all ? 1 : 0 });
        if (id) await api.patch('/departments/' + id, payload);
        else { const r = await api.post('/departments', payload); id = r.data.department.id; }
      } else {
        // Team: POST doesn't accept routing_specialization/auto_load_balancing, so create then PATCH the extras.
        const createPayload = Object.assign({}, base, { parent_id: form.parent_id || null, is_open_records: form.is_open_records ? 1 : 0 });
        if (!id) { const r = await api.post('/departments', createPayload); id = r.data.department.id; }
        await api.patch('/departments/' + id, Object.assign({}, createPayload, { routing_specialization: form.routing_specialization || null, auto_load_balancing: form.auto_load_balancing ? 1 : 0 }));
        // The team is the single source of truth for which departments it fulfills.
        await api.post('/departments/' + id + '/fulfills', { departmentIds: form.fulfills || [] });
      }
      closeEditor();
      await load();
    } catch (e) { setErr(e.response && e.response.data ? e.response.data.error : 'Save failed'); }
    setSaving(false);
  }

  const TABS = [['departments', 'City Departments'], ['teams', 'Teams'], ['staff', 'Staff']];

  return (
    <SetupScreen hubKey={HUB_KEY[tab]} laneLabel="Organization Departments, Teams, and Staff Setup" title="Organization" maxWidth="1100px"
      intro="City departments, the teams that fulfill their requests, and the staff on those teams — all in one place.">
    {function () { return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

      <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid #E5E7EB' }}>
        {TABS.map(t => (
          <button key={t[0]} onClick={() => setTab(t[0])}
            style={{ padding: '12px 20px', background: 'none', border: 'none', borderBottom: tab === t[0] ? '2px solid #1F4E79' : '2px solid transparent', marginBottom: '-1px', fontSize: '14px', fontWeight: tab === t[0] ? '700' : '500', color: tab === t[0] ? '#1F4E79' : '#6B7280', cursor: 'pointer' }}>
            {t[1]}{t[0] === 'departments' ? ' (' + depts.length + ')' : t[0] === 'teams' ? ' (' + teams.length + ')' : ' (' + staff.length + ')'}
          </button>
        ))}
      </div>

      {loading ? <div style={{ padding: '48px', textAlign: 'center', color: '#9CA3AF' }}>Loading…</div> : (
        <>
          {/* ---------- DEPARTMENTS ---------- */}
          {tab === 'departments' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <Guidance>
                <strong>City departments</strong> are the org-chart entities that own records — Police, Parks &amp; Recreation, the City Clerk's Office, and so on. Open Records is usually a unit <em>within</em> the City Clerk's or Records office rather than its own department. Each department's requests are handled by the <strong>fulfillment team</strong> you assign on the Teams tab; a department with no team is a coverage gap and is flagged below.
              </Guidance>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={newDepartment} style={btnPrimary}>+ Add Department</button>
              </div>
              {depts.length === 0 ? <div style={{ ...card, textAlign: 'center', color: '#9CA3AF' }}>No departments yet.</div> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {depts.map(d => {
                    const team = fulfillingTeam(d);
                    return (
                      <div key={d.id} style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                          <CodeChip code={d.code} color={d.color} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: '600', fontSize: '14px', color: '#111' }}>{d.name}
                              {d.is_open_records ? <span style={{ marginLeft: '8px', ...chip('#DBEAFE', '#1E40AF') }}>Open Records Hub</span> : null}
                              {d.is_catch_all ? <span style={{ marginLeft: '6px', ...chip('#FEF3C7', '#92400E') }}>Catch-All</span> : null}
                            </div>
                            <div style={{ fontSize: '12px', marginTop: '3px' }}>
                              {team
                                ? <span style={{ color: '#6B7280' }}>Fulfilled by <strong style={{ color: '#1F4E79' }}>{team.name}</strong></span>
                                : <span style={{ color: '#B91C1C', fontWeight: 600 }}>⚠ No fulfillment team assigned</span>}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                          <button onClick={() => editDepartment(d)} style={{ padding: '6px 14px', background: 'white', color: '#1F4E79', border: '1px solid #BFDBFE', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>Edit</button>
                          <button onClick={() => setRemoving({ kind: 'department', id: d.id, name: d.name })} title="Delete this department (a guided process)" style={{ padding: '6px 14px', background: 'white', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>Delete</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ---------- TEAMS ---------- */}
          {tab === 'teams' && (() => {
            // Two groups: office teams (serve no departments — oversight/administration, never in
            // request routing) pinned on top, then the fulfillment teams that process requests.
            const officeTeams = teams.filter(t => deptsServedBy(t.id).length === 0 && !t.is_open_records);
            const fulfillTeams = teams.filter(t => !officeTeams.includes(t));
            const teamCard = (t) => {
              const served = deptsServedBy(t.id);
              const members = memberCount(t.id);
              const staffingOnly = served.length === 0 && !t.is_open_records;
              return (
                <div key={t.id} style={{ ...card, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', minWidth: 0 }}>
                    <CodeChip code={t.code} color={t.color} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: '600', fontSize: '14px', color: '#111' }}>{t.name}
                        {t.is_open_records ? <span style={{ marginLeft: '8px', ...chip('#DBEAFE', '#1E40AF') }}>Open-Records fallback</span> : null}
                        {staffingOnly ? <span style={{ marginLeft: '8px', ...chip('#F3E8FF', '#6D28D9') }}>Oversight (not routed)</span> : null}
                        {t.auto_load_balancing ? <span style={{ marginLeft: '6px', ...chip('#D1FAE5', '#065F46') }}>Auto load-balance</span> : null}
                      </div>
                      <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '3px' }}>
                        {members} member{members !== 1 ? 's' : ''}
                        {' · '}
                        {served.length ? <>Serves {served.map(d => d.name).join(', ')}</> : <span>Serves no departments</span>}
                        {t.routing_specialization ? ' · has routing profile' : ''}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <button onClick={() => setViewStaffTeam(t)} style={{ padding: '6px 14px', background: 'white', color: '#1F4E79', border: '1px solid #BFDBFE', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>View staff</button>
                    <button onClick={() => editTeam(t)} style={{ padding: '6px 14px', background: 'white', color: '#1F4E79', border: '1px solid #BFDBFE', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>Edit</button>
                    <button onClick={() => setRemoving({ kind: 'team', id: t.id, name: t.name })} title="Delete this team (a guided process)" style={{ padding: '6px 14px', background: 'white', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>Delete</button>
                  </div>
                </div>
              );
            };
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <Guidance>
                  The <strong>Open Records Office</strong> team manages and oversees the whole open-records operation (director, legal authority, associates) — it serves no departments, so requests never route to it. <strong>Fulfillment teams</strong> below it do the request work: each serves one or more city departments, and that link is what routes an incoming request to the right people. The team marked <strong>Open-Records fallback</strong> also catches anything that doesn't match a department.
                </Guidance>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={newTeam} style={btnPrimary}>+ Add Team</button>
                </div>
                {teams.length === 0 ? <div style={{ ...card, textAlign: 'center', color: '#9CA3AF' }}>No teams yet.</div> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {officeTeams.map(teamCard)}
                    {fulfillTeams.length > 0 && (
                      <div style={{ fontSize: '13px', fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.04em', margin: '8px 0 0' }}>Fulfillment Teams</div>
                    )}
                    {fulfillTeams.map(teamCard)}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ---------- STAFF ---------- */}
          {tab === 'staff' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <div style={{ flexGrow: 1 }}>
                  <Guidance>
                    <strong>Staff</strong> belong to a fulfillment team. Each person is assigned a subset of <strong>task types</strong> (record search, redaction, …) — task routing only offers a task to people on the right team who hold its type. Use <em>Edit</em> for team and task types, and <em>Routing</em> for the plain-language specialization that smart-routing matches on.
                  </Guidance>
                </div>
                <button onClick={() => nav('/setup/user-types')} title="The catalog of user types: what each may do, which task menus it carries, and who holds it"
                  style={{ padding: '8px 16px', background: 'white', color: '#1F4E79', border: '1px solid #BFDBFE', borderRadius: '6px', fontSize: '12.5px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>View user types</button>
              </div>
              <StaffManagementPage embedded />
            </div>
          )}
        </>
      )}

      {/* ---------- EDITOR MODAL (department / team) ---------- */}
      {removing ? <RemovalDialog kind={removing.kind} id={removing.id} name={removing.name} onClose={() => setRemoving(null)}
        onDone={(r) => { setRemoving(null); setRemovedMsg((r.mode === 'delete' ? 'Deleted ' : 'Removed ') + r.name + (r.mode === 'retire' ? ' — kept on the record of past work.' : '.')); load(); }} /> : null}
      {removedMsg ? <div style={{ margin: '0 0 12px', padding: '10px 14px', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '8px', fontSize: '13px', color: '#065F46', display: 'flex', justifyContent: 'space-between' }}><span>{removedMsg}</span><button onClick={() => setRemovedMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#065F46', fontWeight: '700' }}>Dismiss</button></div> : null}
      {editKind && (
        <div onClick={() => { if (!saving) closeEditor(); }} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(17,24,39,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '12px', padding: '24px', width: '560px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: '16px', fontWeight: '700', color: '#1F4E79' }}>{editRow ? 'Edit ' : 'New '}{editKind === 'team' ? 'fulfillment team' : 'city department'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: '14px', marginTop: '16px' }}>
              <div>
                <label style={lbl}>Name <span style={{ color: '#DC2626' }}>*</span></label>
                <input value={form.name} onChange={e => setF('name', e.target.value)} style={inp} placeholder={editKind === 'team' ? 'Police Records Team' : 'Police Department'} />
              </div>
              <div>
                <label style={lbl}>Code <span style={{ color: '#DC2626' }}>*</span></label>
                <input value={form.code} onChange={e => setF('code', e.target.value.toUpperCase())} maxLength={6} style={inp} placeholder="PD" />
              </div>
            </div>
            <div style={{ marginTop: '12px' }}>
              <label style={lbl}>Color</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {PALETTE.map(c => <button key={c} type="button" onClick={() => setF('color', c)} style={{ width: '28px', height: '28px', borderRadius: '50%', background: c, border: form.color === c ? '3px solid #111' : '2px solid #E5E7EB', cursor: 'pointer' }} />)}
              </div>
            </div>

            {editKind === 'department' && (
              <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#374151', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!form.is_open_records} onChange={e => setF('is_open_records', e.target.checked ? 1 : 0)} /> Open Records hub (badge only)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#374151', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!form.is_catch_all} onChange={e => setF('is_catch_all', e.target.checked ? 1 : 0)} /> Catch-all department
                </label>
                <div style={{ fontSize: '12px', color: '#9CA3AF' }}>Assign which team fulfills this department on the Teams tab (edit the team → “Departments this team fulfills”).</div>
              </div>
            )}

            {editKind === 'team' && (
              <>
                <div style={{ marginTop: '14px' }}>
                  <label style={lbl}>Org-chart grouping <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(display only — does not affect routing)</span></label>
                  <select value={form.parent_id || ''} onChange={e => setF('parent_id', e.target.value)} style={inp}>
                    <option value="">— None —</option>
                    {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div style={{ marginTop: '14px' }}>
                  <label style={lbl}>Routing specialization <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(what this team handles, for smart routing)</span></label>
                  <textarea value={form.routing_specialization} onChange={e => setF('routing_specialization', e.target.value)} rows={2} style={{ ...inp, fontFamily: 'inherit', resize: 'vertical' }} placeholder="e.g. body-worn camera footage, incident and arrest reports, 911 call audio" />
                </div>
                <div style={{ marginTop: '14px' }}>
                  <label style={lbl}>Departments this team fulfills</label>
                  <div style={{ fontSize: '12px', color: '#9CA3AF', margin: '0 0 8px' }}>Leave all unchecked for a staffing-only team (e.g. the Open Records Office) that isn't in request routing.</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto', border: '1px solid #F3F4F6', borderRadius: '8px', padding: '10px' }}>
                    {depts.length === 0 ? <span style={{ fontSize: '12px', color: '#9CA3AF' }}>No departments yet.</span> : depts.map(d => {
                      const other = d.processed_by && d.processed_by !== (editRow && editRow.id);
                      return (
                        <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#374151', cursor: 'pointer' }}>
                          <input type="checkbox" checked={(form.fulfills || []).includes(d.id)} onChange={() => toggleFulfills(d.id)} />
                          <CodeChip code={d.code} color={d.color} /> {d.name}
                          {other ? <span style={{ fontSize: '11px', color: '#9CA3AF' }}>(currently: {teamById[d.processed_by] ? teamById[d.processed_by].name : 'another team'})</span> : null}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#374151', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!form.is_open_records} onChange={e => setF('is_open_records', e.target.checked ? 1 : 0)} /> Open-Records fallback team (catches anything unmatched)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#374151', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!form.auto_load_balancing} onChange={e => setF('auto_load_balancing', e.target.checked ? 1 : 0)} /> Auto load-balancing (assign to least-busy eligible member)
                  </label>
                </div>
              </>
            )}

            {err && <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '8px', padding: '12px', fontSize: '14px', color: '#DC2626', marginTop: '14px' }}>{err}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
              <button onClick={closeEditor} disabled={saving} style={{ padding: '9px 16px', background: 'white', color: '#6B7280', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveEditor} disabled={saving} style={{ padding: '9px 18px', background: saving ? '#9CA3AF' : '#1F4E79', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- VIEW STAFF MODAL (read-only) ---------- */}
      {viewStaffTeam && (
        <div onClick={() => setViewStaffTeam(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(17,24,39,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '12px', padding: '24px', width: '460px', maxWidth: '100%', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <CodeChip code={viewStaffTeam.code} color={viewStaffTeam.color} />
              <div style={{ fontSize: '16px', fontWeight: '700', color: '#1F4E79' }}>{viewStaffTeam.name} — staff</div>
            </div>
            <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {staff.filter(s => s.department_id === viewStaffTeam.id).length === 0
                ? <div style={{ fontSize: '13px', color: '#9CA3AF', padding: '10px 0' }}>No staff on this team yet.</div>
                : staff.filter(s => s.department_id === viewStaffTeam.id).map(s => (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '8px 12px', border: '1px solid #F3F4F6', borderRadius: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: '#111' }}>{s.display_name}</span>
                    <span style={{ fontSize: '12px', color: '#6B7280' }}>{s.title || ''}</span>
                  </div>
                ))}
            </div>
            <div style={{ marginTop: '14px', fontSize: '12px', color: '#6B7280', background: '#F9FAFB', border: '1px solid #F3F4F6', borderRadius: '8px', padding: '10px 12px' }}>
              Go to STAFF to modify team member list.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
              <button onClick={() => setViewStaffTeam(null)} style={{ padding: '9px 16px', background: 'white', color: '#6B7280', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
    ); }}
    </SetupScreen>
  );
}
