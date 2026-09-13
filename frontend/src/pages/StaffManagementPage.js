import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';
import RemovalDialog from '../components/ui/RemovalDialog';

// v3 user-type model (SPEC_user_type_model §10.1, S3): people hold USER TYPES, fetched from /user-types. Office
// types are held office-wide; team types are held against a fulfillment team (one chip per team — multi-team is
// allowed, and office + team together). The legacy function-role chips are gone.
const TYPE_COLORS = { oro_sysadmin:{bg:'var(--oq-bg-fef2f2)',color:'var(--oq-fg-991b1b)'}, oro_director:{bg:'var(--oq-bg-ede9fe)',color:'var(--oq-fg-6d28d9)'}, oro_supervisor:{bg:'var(--oq-bg-dbeafe)',color:'var(--oq-fg-1e40af)'}, oro_senior_legal:{bg:'var(--oq-bg-fce7f3)',color:'var(--oq-fg-9d174d)'}, oro_legal_associate:{bg:'var(--oq-bg-fce7f3)',color:'var(--oq-fg-9d174d)'}, oro_associate:{bg:'var(--oq-bg-fef3c7)',color:'var(--oq-fg-92400e)'}, oro_finance:{bg:'var(--oq-bg-ecfdf5)',color:'var(--oq-fg-047857)'}, city_management:{bg:'var(--oq-bg-f3f4f6)',color:'var(--oq-fg-374151)'}, team_manager:{bg:'var(--oq-bg-d1fae5)',color:'var(--oq-fg-065f46)'}, team_supervisor:{bg:'var(--oq-bg-d1fae5)',color:'var(--oq-fg-065f46)'}, team_staff:{bg:'var(--oq-bg-f0fdf4)',color:'var(--oq-fg-166534)'} };
function sameType(a,b){ return a.key===b.key && (a.teamId||null)===(b.teamId||null); }

// The USER-TYPE PICKER (§10.1) — module-scope so its own state survives the parent's re-renders: office types as chips; team types as chips per team (defaults to the
// person's home team, more teams via the selector).
function TypePicker(props) {
  var ut = props.userTypes, homeTeam = props.homeTeam, catalog = props.catalog, departments = props.departments, onToggle = props.onToggle;
  var teamName = function(id){ var d = departments.filter(function(x){ return x.id===id; })[0]; return d ? d.name : id; };
  var teams = departments.filter(function(d){ return d.kind==='team'; });
  var pickedTeams = []; ut.forEach(function(t){ if (t.teamId && pickedTeams.indexOf(t.teamId)===-1) pickedTeams.push(t.teamId); });
  if (homeTeam && pickedTeams.indexOf(homeTeam)===-1) pickedTeams.unshift(homeTeam);
  var [extraTeam, setExtraTeam] = useState('');
  var office = catalog.filter(function(c){ return c.scope==='office'; }), teamTypes = catalog.filter(function(c){ return c.scope==='team'; });
  var chipStyle = function(active, col){ return { padding:'5px 12px', borderRadius:'20px', border:'2px solid '+(active?col.color:'var(--oq-ln-e5e7eb)'), background:active?col.bg:'var(--oq-bg-ffffff)', color:active?col.color:'var(--oq-fg-6b7280)', fontSize:'12px', fontWeight:'600', cursor:'pointer' }; };
  return (
    <div>
      <div style={{fontSize:'11px',fontWeight:'700',color:'var(--oq-fg-6b7280)',textTransform:'uppercase',letterSpacing:'0.04em',margin:'0 0 6px'}}>Open Records Office</div>
      <div style={{display:'flex',flexWrap:'wrap',gap:'8px'}}>
        {office.map(function(c){ var active = ut.some(function(x){ return x.key===c.key; }); var col = TYPE_COLORS[c.key]||{bg:'var(--oq-bg-f3f4f6)',color:'var(--oq-fg-374151)'};
          return <button key={c.key} type="button" onClick={function(){ onToggle(c.key, null); }} style={chipStyle(active,col)}>{c.displayName}</button>; })}
      </div>
      {pickedTeams.map(function(teamId){
        return <div key={teamId} style={{marginTop:'10px'}}>
          <div style={{fontSize:'11px',fontWeight:'700',color:'var(--oq-fg-6b7280)',textTransform:'uppercase',letterSpacing:'0.04em',margin:'0 0 6px'}}>{teamName(teamId)}{teamId===homeTeam?' · home team':''}</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:'8px'}}>
            {teamTypes.map(function(c){ var active = ut.some(function(x){ return x.key===c.key && x.teamId===teamId; }); var col = TYPE_COLORS[c.key]||{bg:'var(--oq-bg-f3f4f6)',color:'var(--oq-fg-374151)'};
              return <button key={c.key} type="button" onClick={function(){ onToggle(c.key, teamId); }} style={chipStyle(active,col)}>{c.displayName.replace('[Team] ','')}</button>; })}
          </div>
        </div>; })}
      <div style={{display:'flex',gap:'8px',alignItems:'center',marginTop:'10px'}}>
        <select value={extraTeam} onChange={function(e){ setExtraTeam(e.target.value); }} style={{padding:'6px 8px',border:'1px solid var(--oq-ln-e5e7eb)',borderRadius:'6px',fontSize:'12px'}}>
          <option value="">Add another team…</option>
          {teams.filter(function(d){ return pickedTeams.indexOf(d.id)===-1; }).map(function(d){ return <option key={d.id} value={d.id}>{d.name}</option>; })}
        </select>
        <button type="button" disabled={!extraTeam} onClick={function(){ if (extraTeam) { onToggle('team_staff', extraTeam); setExtraTeam(''); } }}
          style={{padding:'6px 10px',background:extraTeam?'var(--oq-bg-1f4e79)':'var(--oq-bg-e5e7eb)',color:'var(--oq-fg-ffffff)',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:extraTeam?'pointer':'default'}}>Add as staff</button>
      </div>
      <div style={{fontSize:'12px',color:'var(--oq-fg-9ca3af)',marginTop:'6px'}}>A person may hold several types, on several teams, and be in the Open Records Office at the same time.</div>
    </div>
  );
}
// Canonical routable task types (docs/MASTER_task_types_permission_groups.md §A1). The per-person subset
// a staff member can be assigned; this is what task routing resolves eligibility against.
const TASK_TYPES = [
  { key:'estimate', label:'Estimate Creation' },
  { key:'record_search', label:'Record Search' },
  { key:'redaction', label:'Redaction' },
  // Reviewing someone else's redaction is not the same competence as doing one — granted separately since
  // 2026-07-19 (brief §3.5). Until a team is granted this, Elevated reviews keep routing to REDACTION_WORKER.
  { key:'redaction_qa', label:'Redaction Review (second person)' },
  { key:'legal_redaction', label:'Legal Redaction' },
  { key:'legal_review', label:'Legal Review' },
  { key:'fee_waiver', label:'Fee-Waiver Approval' },
  { key:'routing_review', label:'Routing Review (retired — legacy tasks only)' },
  // BW2 (2026-07-29), docs/SPEC_processing_ui.md §8. `intake_review` REPLACES routing_review: same
  // unroutable trigger, same ORO Associate, one screen for the whole first look.
  { key:'intake_review', label:'Intake Review' },
  { key:'mrr_management', label:'MRR Coordination (parent hub)' },
  // ⚠️ Registered ahead of its pipeline: BW5 spawns release reviews, BW8 builds the screen. Granting it
  // now is deliberate (a city configures who reviews before the reviews start arriving), but until BW5
  // lands nothing will pool to it.
  { key:'release_review', label:'Release Review (pipeline lands in BW5)' },
  // `commercial_rate` and `mrr_processing` were REMOVED 2026-07-19 (brief §5.4). Nothing spawns either, so
  // granting them to a person promised work that could never arrive — a permanently empty pool. This list
  // must stay in step with ROUTABLE_TASK_TYPES in backend/src/services/taskRouting.js; a harness checks it.
  // MRR child tasks (mrr_estimate / mrr_search) were never here either — the Request Manager hand-assigns
  // them to any person with no eligibility rules, so they aren't a per-person subset.
];
const TASK_TYPE_LABEL = TASK_TYPES.reduce(function(m,t){ m[t.key]=t.label; return m; }, {});

export default function StaffManagementPage({ embedded }) {
  const [staff, setStaff] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ displayName:'', email:'', title:'', departmentId:'', tempPassword:'', userTypes:[] });
  const [catalog, setCatalog] = useState([]);   // /user-types
  const store = useAuthStore();
  const canManageUsers = store.hasAuthority('manage_users');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');
  const [specFor, setSpecFor] = useState(null);
  const [removing, setRemoving] = useState(null);   // { id, name } — the deletion process dialog (2026-09-08)
  const [removedMsg, setRemovedMsg] = useState('');
  const [specText, setSpecText] = useState('');
  const [specSaving, setSpecSaving] = useState(false);
  const [editFor, setEditFor] = useState(null);
  const [editForm, setEditForm] = useState({ displayName:'', title:'', departmentId:'', taskTypes:[], userTypes:[] });
  const [editSaving, setEditSaving] = useState(false);

  useEffect(function() { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [sr, dr, ur] = await Promise.all([api.get('/staff'), api.get('/departments'), api.get('/user-types').catch(function(){ return { data:{ userTypes:[] } }; })]);
      setCatalog(ur.data.userTypes || []);
      setStaff(sr.data.staff);
      setDepartments(dr.data.departments);
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  async function saveSpec() {
    if (!specFor) return;
    setSpecSaving(true);
    try {
      await api.patch('/staff/' + specFor.id + '/specialization', { routingSpecialization: specText });
      setSpecFor(null); setSpecText('');
      await load();
    } catch(e) { setErr('Failed to save specialization'); }
    setSpecSaving(false);
  }

  function openEdit(s) {
    setEditFor(s);
    setEditForm({ displayName: s.display_name || '', title: s.title || '', departmentId: s.department_id || '', taskTypes: (s.taskTypes || []).slice(), userTypes: (s.userTypes || []).map(function(t){ return { key:t.key, teamId:t.teamId||null }; }) });
    setErr('');
  }

  function setEF(k,v){ setEditForm(function(f){ return Object.assign({},f,{[k]:v}); }); }

  function toggleEditTaskType(key) {
    setEditForm(function(f) {
      var t = f.taskTypes.includes(key) ? f.taskTypes.filter(function(x){ return x!==key; }) : f.taskTypes.concat(key);
      return Object.assign({},f,{taskTypes:t});
    });
  }

  async function saveEdit() {
    if (!editFor) return;
    if (!editForm.displayName.trim()) { setErr('Name is required'); return; }
    setEditSaving(true);
    try {
      await api.patch('/staff/' + editFor.id, { displayName: editForm.displayName, title: editForm.title, departmentId: editForm.departmentId || null });
      if (canManageUsers) await api.patch('/staff/' + editFor.id + '/user-types', { userTypes: editForm.userTypes });
      await api.patch('/staff/' + editFor.id + '/task-types', { taskTypes: editForm.taskTypes });
      setEditFor(null);
      await load();
    } catch(e) { setErr(e.response && e.response.data ? e.response.data.error : 'Failed to save changes'); }
    setEditSaving(false);
  }

  function setF(k,v){ setForm(function(f){ return Object.assign({},f,{[k]:v}); }); }

  // Toggle a user type on a form's userTypes list. Team types carry the team they are held against.
  function toggleType(setter, key, teamId) {
    var t = { key:key, teamId: teamId || null };
    setter(function(f) {
      var has = f.userTypes.some(function(x){ return sameType(x,t); });
      return Object.assign({}, f, { userTypes: has ? f.userTypes.filter(function(x){ return !sameType(x,t); }) : f.userTypes.concat([t]) });
    });
  }
  // The union of the task menus of the types held (§6): what the task-type picker may offer. null = any.
  function menuUnion(userTypes) {
    var menu = [];
    for (var i = 0; i < userTypes.length; i++) {
      var c = catalog.filter(function(x){ return x.key === userTypes[i].key; })[0];
      if (!c) continue;
      if (c.taskMenu.indexOf('*') !== -1) return null;
      c.taskMenu.forEach(function(k){ if (menu.indexOf(k) === -1) menu.push(k); });
    }
    return menu;
  }
  function teamName(id){ var d = departments.filter(function(x){ return x.id===id; })[0]; return d ? d.name : id; }
  function typeLabel(key){ var c = catalog.filter(function(x){ return x.key===key; })[0]; return c ? c.displayName : key; }



  async function createTeam(){
    var name = window.prompt('New fulfillment team name:');
    if (!name || !name.trim()) return;
    name = name.trim();
    var code = name.replace(/[^A-Za-z]/g,'').toUpperCase().slice(0,5) || 'TEAM';
    try {
      var r = await api.post('/departments', { name:name, code:code, kind:'team' });
      var dr = await api.get('/departments');
      setDepartments(dr.data.departments);
      setF('departmentId', r.data.department.id);
    } catch(e){ setErr(e.response && e.response.data ? e.response.data.error : 'Failed to create team'); }
  }

  async function handleAdd(e) {
    e.preventDefault(); setErr(''); setSuccess('');
    if (!form.displayName || !form.email || !form.tempPassword) { setErr('Name, email and temporary password are required'); return; }
    if (form.tempPassword.length < 8) { setErr('Temporary password must be at least 8 characters'); return; }
    if (form.userTypes.length === 0) { setErr('At least one user type must be assigned'); return; }
    setSaving(true);
    try {
      var created = await api.post('/staff', { displayName: form.displayName, email: form.email, title: form.title, departmentId: form.departmentId || null, tempPassword: form.tempPassword });
      await api.patch('/staff/' + created.data.userId + '/user-types', { userTypes: form.userTypes });
      setSuccess('Staff member created successfully. They will be prompted to change their password on first login.');
      setForm({ displayName:'', email:'', title:'', departmentId:'', tempPassword:'', userTypes:[] });
      setShowAdd(false);
      await load();
    } catch(e) { setErr(e.response && e.response.data ? e.response.data.error : 'Failed to create staff member'); }
    setSaving(false);
  }

  async function toggleStatus(userId, currentStatus) {
    try {
      await api.patch('/staff/' + userId + '/status', { status: currentStatus === 'active' ? 'inactive' : 'active' });
      await load();
    } catch(e) { console.error(e); }
  }

  var inp = { width:'100%', padding:'9px 12px', border:'1px solid var(--oq-ln-e5e7eb)', borderRadius:'8px', fontSize:'14px', outline:'none', boxSizing:'border-box', background:'var(--oq-bg-ffffff)' };
  var lbl = { display:'block', fontSize:'13px', fontWeight:'600', color:'var(--oq-fg-374151)', marginBottom:'5px' };

  return (
    <div style={{maxWidth: embedded?'100%':'1100px',display:'flex',flexDirection:'column',gap:'20px'}}>
      {removing ? <RemovalDialog kind="staff" id={removing.id} name={removing.name} onClose={function(){setRemoving(null);}}
        onDone={function(r){ setRemoving(null); setRemovedMsg((r.mode === 'delete' ? 'Deleted ' : 'Removed ') + r.name + (r.mode === 'retire' ? ' — kept on the record of past work.' : '.')); load(); }} /> : null}
      {removedMsg ? <div style={{margin:'0 0 12px',padding:'10px 14px',background:'var(--oq-bg-ecfdf5)',border:'1px solid var(--oq-ln-a7f3d0)',borderRadius:'8px',fontSize:'13px',color:'var(--oq-fg-065f46)',display:'flex',justifyContent:'space-between'}}><span>{removedMsg}</span><button onClick={function(){setRemovedMsg('');}} style={{background:'none',border:'none',cursor:'pointer',color:'var(--oq-fg-065f46)',fontWeight:'700'}}>Dismiss</button></div> : null}
      <div style={{display:'flex',alignItems:'center',justifyContent: embedded?'flex-end':'space-between'}}>
        {!embedded && (
        <div>
          <h1 style={{fontSize:'22px',fontWeight:'700',margin:'0 0 4px'}}>Staff Management</h1>
          <p style={{color:'var(--oq-fg-9ca3af)',fontSize:'14px',margin:0}}>{staff.length} staff member{staff.length!==1?'s':''} in the system</p>
        </div>
        )}
        <button onClick={function(){setShowAdd(!showAdd);setErr('');setSuccess('');}} style={{padding:'10px 18px',background:'var(--oq-bg-1f4e79)',color:'var(--oq-fg-ffffff)',border:'none',borderRadius:'8px',fontSize:'14px',fontWeight:'600',cursor:'pointer'}}>
          + Add Staff Member
        </button>
      </div>

      {success && <div style={{background:'var(--oq-bg-f0fdf4)',border:'1px solid var(--oq-ln-86efac)',borderRadius:'8px',padding:'14px',fontSize:'14px',color:'var(--oq-fg-166534)'}}>{success}</div>}

      {showAdd && (
        <div style={{background:'var(--oq-bg-ffffff)',borderRadius:'12px',border:'2px solid var(--oq-ln-1f4e79)',padding:'24px'}}>
          <h2 style={{fontSize:'16px',fontWeight:'700',margin:'0 0 20px',color:'var(--oq-fg-1f4e79)'}}>Add New Staff Member</h2>
          <form onSubmit={handleAdd} style={{display:'flex',flexDirection:'column',gap:'16px'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
              <div>
                <label style={lbl}>Full Name <span style={{color:'var(--oq-fg-dc2626)'}}>*</span></label>
                <input value={form.displayName} onChange={function(e){setF('displayName',e.target.value);}} style={inp} placeholder="Jane Smith" required/>
              </div>
              <div>
                <label style={lbl}>Email Address <span style={{color:'var(--oq-fg-dc2626)'}}>*</span></label>
                <input type="email" value={form.email} onChange={function(e){setF('email',e.target.value);}} style={inp} placeholder="jsmith@city.gov" required/>
              </div>
              <div>
                <label style={lbl}>Title / Position</label>
                <input value={form.title} onChange={function(e){setF('title',e.target.value);}} style={inp} placeholder="Records Coordinator"/>
              </div>
              <div>
                <label style={lbl}>Request Fulfillment Team</label>
                <select value={form.departmentId} onChange={function(e){setF('departmentId',e.target.value);}} style={inp}>
                  <option value="">— No team assigned —</option>
                  {departments.filter(function(d){ return d.kind==='team'; }).map(function(d){ return <option key={d.id} value={d.id}>{d.name}</option>; })}
                </select>
                <button type="button" onClick={createTeam} style={{marginTop:'6px',background:'none',border:'none',color:'var(--oq-fg-1f4e79)',fontSize:'12px',fontWeight:'600',cursor:'pointer',padding:0}}>+ New team</button>
              </div>
              <div>
                <label style={lbl}>Temporary Password <span style={{color:'var(--oq-fg-dc2626)'}}>*</span></label>
                <input type="password" value={form.tempPassword} onChange={function(e){setF('tempPassword',e.target.value);}} style={inp} placeholder="Min 8 characters"/>
                <div style={{fontSize:'12px',color:'var(--oq-fg-9ca3af)',marginTop:'4px'}}>Staff will be required to change this on first login</div>
              </div>
            </div>
            <div>
              <label style={lbl}>User types <span style={{color:'var(--oq-fg-dc2626)'}}>*</span></label>
              <div style={{marginTop:'6px'}}><TypePicker userTypes={form.userTypes} homeTeam={form.departmentId||null} catalog={catalog} departments={departments} onToggle={function(k,t){ toggleType(setForm,k,t); }}/></div>
            </div>
            {err && <div style={{background:'var(--oq-bg-fef2f2)',border:'1px solid var(--oq-ln-fca5a5)',borderRadius:'8px',padding:'12px',fontSize:'14px',color:'var(--oq-fg-dc2626)'}}>{err}</div>}
            <div style={{display:'flex',gap:'10px',justifyContent:'flex-end'}}>
              <button type="button" onClick={function(){setShowAdd(false);setErr('');}} style={{padding:'10px 20px',background:'var(--oq-bg-ffffff)',color:'var(--oq-fg-6b7280)',border:'1px solid var(--oq-ln-e5e7eb)',borderRadius:'8px',fontSize:'14px',cursor:'pointer'}}>Cancel</button>
              <button type="submit" disabled={saving} style={{padding:'10px 24px',background:'var(--oq-bg-1f4e79)',color:'var(--oq-fg-ffffff)',border:'none',borderRadius:'8px',fontSize:'14px',fontWeight:'600',cursor:'pointer'}}>
                {saving?'Creating...':'Create Staff Member'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div style={{background:'var(--oq-bg-ffffff)',borderRadius:'12px',border:'1px solid var(--oq-ln-e5e7eb)',overflow:'hidden'}}>
        {loading ? (
          <div style={{padding:'48px',textAlign:'center',color:'var(--oq-fg-9ca3af)'}}>Loading staff...</div>
        ) : staff.length === 0 ? (
          <div style={{padding:'48px',textAlign:'center',color:'var(--oq-fg-9ca3af)'}}>
            <div style={{fontSize:'40px',marginBottom:'12px'}}>👥</div>
            <div style={{fontSize:'16px',fontWeight:'600',color:'var(--oq-fg-4b5563)',marginBottom:'8px'}}>No staff members yet</div>
            <div style={{fontSize:'14px'}}>Add your first staff member using the button above</div>
          </div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr style={{background:'var(--oq-bg-f9fafb)'}}>
                {['Name','Email','Home dept','User types','Status','Last Login',''].map(function(h){
                  return <th key={h} style={{textAlign:'left',fontSize:'11px',fontWeight:'600',color:'var(--oq-fg-6b7280)',textTransform:'uppercase',letterSpacing:'.05em',padding:'10px 16px'}}>{h}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {staff.map(function(s,i){
                var isActive = s.status === 'active';
                return (
                  <tr key={s.id} style={{borderTop:'1px solid var(--oq-ln-f3f4f6)'}}>
                    <td style={{padding:'14px 16px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                        <div style={{width:'36px',height:'36px',borderRadius:'50%',background:'var(--oq-bg-1f4e79)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--oq-fg-ffffff)',fontSize:'14px',fontWeight:'700',flexShrink:0}}>
                          {s.display_name?s.display_name[0].toUpperCase():'?'}
                        </div>
                        <div>
                          <div style={{fontWeight:'600',fontSize:'14px',color:'var(--oq-fg-111111)'}}>{s.display_name}</div>
                          {s.title&&<div style={{fontSize:'12px',color:'var(--oq-fg-9ca3af)'}}>{s.title}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{padding:'14px 16px',fontSize:'13px',color:'var(--oq-fg-374151)'}}>{s.email}</td>
                    <td style={{padding:'14px 16px',fontSize:'13px',color:'var(--oq-fg-374151)'}}>{s.department_name||<span style={{color:'var(--oq-fg-d1d5db)',fontStyle:'italic'}}>None</span>}</td>
                    <td style={{padding:'14px 16px'}}>
                      <div style={{display:'flex',flexWrap:'wrap',gap:'4px'}}>
                        {(s.userTypes||[]).map(function(t){
                          var rc = TYPE_COLORS[t.key]||{bg:'var(--oq-bg-f3f4f6)',color:'var(--oq-fg-374151)'};
                          var label = t.teamId ? (t.displayName||typeLabel(t.key)).replace('[Team] ','') + ' · ' + teamName(t.teamId) : (t.displayName||typeLabel(t.key));
                          return <span key={t.key+':'+(t.teamId||'')} style={{background:rc.bg,color:rc.color,fontSize:'10px',fontWeight:'700',padding:'2px 8px',borderRadius:'20px'}}>{label}</span>;
                        })}
                        {!(s.userTypes||[]).length && <span style={{color:'var(--oq-fg-d1d5db)',fontStyle:'italic',fontSize:'11px'}}>No user type — sees nothing gated</span>}
                      </div>
                    </td>
                    <td style={{padding:'14px 16px'}}>
                      <span style={{background:isActive?'var(--oq-bg-f0fdf4)':'var(--oq-bg-f9fafb)',color:isActive?'var(--oq-fg-16a34a)':'var(--oq-fg-9ca3af)',fontSize:'12px',fontWeight:'600',padding:'3px 10px',borderRadius:'20px'}}>
                        {isActive?'Active':'Inactive'}
                      </span>
                    </td>
                    <td style={{padding:'14px 16px',fontSize:'12px',color:'var(--oq-fg-9ca3af)'}}>
                      {s.last_login ? new Date(s.last_login).toLocaleDateString() : 'Never'}
                    </td>
                    <td style={{padding:'14px 16px'}}>
                      <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
                        <button onClick={function(){openEdit(s);}}
                          title="Edit profile, team, and task types"
                          style={{padding:'5px 12px',background:'var(--oq-bg-ffffff)',color:'var(--oq-fg-1f4e79)',border:'1px solid var(--oq-ln-bfdbfe)',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                          Edit
                        </button>
                        <button onClick={function(){setSpecFor(s);setSpecText(s.routing_specialization||'');}}
                          title="Routing specialization"
                          style={{padding:'5px 12px',background:s.routing_specialization?'var(--oq-bg-dbeafe)':'var(--oq-bg-ffffff)',color:'var(--oq-fg-1f4e79)',border:'1px solid var(--oq-ln-bfdbfe)',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                          Routing
                        </button>
                        <button onClick={function(){toggleStatus(s.id,s.status);}}
                          style={{padding:'5px 12px',background:'var(--oq-bg-ffffff)',color:isActive?'var(--oq-fg-dc2626)':'var(--oq-fg-16a34a)',border:'1px solid '+(isActive?'var(--oq-ln-fca5a5)':'var(--oq-ln-86efac)'),borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                          {isActive?'Deactivate':'Activate'}
                        </button>
                        <button onClick={function(){setRemoving({ id: s.id, name: s.display_name || s.email });}}
                          title="Delete this staff member (a guided process)"
                          style={{padding:'5px 12px',background:'var(--oq-bg-ffffff)',color:'var(--oq-fg-b91c1c)',border:'1px solid var(--oq-ln-fca5a5)',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editFor && (
        <div onClick={function(){if(!editSaving)setEditFor(null);}} style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(17,24,39,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'20px'}}>
          <div onClick={function(e){e.stopPropagation();}} style={{background:'var(--oq-bg-ffffff)',borderRadius:'12px',padding:'24px',width:'560px',maxWidth:'100%',maxHeight:'90vh',overflowY:'auto',boxShadow:'0 10px 40px rgba(0,0,0,0.2)'}}>
            <div style={{fontSize:'16px',fontWeight:'700',color:'var(--oq-fg-1f4e79)'}}>Edit staff member</div>
            <div style={{fontSize:'13px',color:'var(--oq-fg-374151)',marginTop:'2px',marginBottom:'16px'}}>{editFor.email}</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'14px'}}>
              <div>
                <label style={lbl}>Full Name <span style={{color:'var(--oq-fg-dc2626)'}}>*</span></label>
                <input value={editForm.displayName} onChange={function(e){setEF('displayName',e.target.value);}} style={inp}/>
              </div>
              <div>
                <label style={lbl}>Title / Position</label>
                <input value={editForm.title} onChange={function(e){setEF('title',e.target.value);}} style={inp}/>
              </div>
              <div style={{gridColumn:'1 / span 2'}}>
                <label style={lbl}>Home department (display only — team membership comes from user types)</label>
                <select value={editForm.departmentId} onChange={function(e){setEF('departmentId',e.target.value);}} style={inp}>
                  <option value="">— No team assigned —</option>
                  {departments.filter(function(d){ return d.kind==='team'; }).map(function(d){ return <option key={d.id} value={d.id}>{d.name}</option>; })}
                </select>
              </div>
            </div>
            {canManageUsers ? (
              <div style={{marginTop:'16px'}}>
                <label style={lbl}>User types</label>
                <div style={{marginTop:'6px'}}><TypePicker userTypes={editForm.userTypes} homeTeam={editForm.departmentId||null} catalog={catalog} departments={departments} onToggle={function(k,t){ toggleType(setEditForm,k,t); }}/></div>
              </div>
            ) : (
              <div style={{marginTop:'16px',fontSize:'12px',color:'var(--oq-fg-9ca3af)'}}>User types: {editForm.userTypes.length ? editForm.userTypes.map(function(t){ return typeLabel(t.key) + (t.teamId ? ' · ' + teamName(t.teamId) : ''); }).join(', ') : 'none'} — assigning user types needs the Manage Users authority.</div>
            )}
            <div style={{marginTop:'16px'}}>
              <label style={lbl}>Task types</label>
              <div style={{fontSize:'12px',color:'var(--oq-fg-9ca3af)',margin:'0 0 8px'}}>The request work this person can be assigned within their team. Task routing offers a task only to eligible people who hold its type.</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:'8px'}}>
                {TASK_TYPES.map(function(t){
                  var active = editForm.taskTypes.includes(t.key);
                  var menu = menuUnion(editForm.userTypes);
                  var covered = menu === null || menu.indexOf(t.key) !== -1;
                  if (!covered && !active) return null;   // §6: the picker offers only what the person's types cover
                  if (!covered && active) return <button key={t.key} type="button" title="Not covered by any user type this person holds — the router ignores it; remove it or add a covering type" onClick={function(){toggleEditTaskType(t.key);}}
                    style={{padding:'6px 14px',borderRadius:'20px',border:'2px dashed var(--oq-ln-f59e0b)',background:'var(--oq-bg-fffbeb)',color:'var(--oq-fg-92400e)',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>{t.label} · not covered</button>;
                  return <button key={t.key} type="button" onClick={function(){toggleEditTaskType(t.key);}}
                    style={{padding:'6px 14px',borderRadius:'20px',border:'2px solid '+(active?'var(--oq-ln-1f4e79)':'var(--oq-ln-e5e7eb)'),background:active?'var(--oq-bg-eff6ff)':'var(--oq-bg-ffffff)',color:active?'var(--oq-fg-1f4e79)':'var(--oq-fg-6b7280)',fontSize:'12px',fontWeight:active?'700':'500',cursor:'pointer'}}>
                    {t.label}
                  </button>;
                })}
              </div>
            </div>
            {err && <div style={{background:'var(--oq-bg-fef2f2)',border:'1px solid var(--oq-ln-fca5a5)',borderRadius:'8px',padding:'12px',fontSize:'14px',color:'var(--oq-fg-dc2626)',marginTop:'14px'}}>{err}</div>}
            <div style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'18px'}}>
              <button onClick={function(){setEditFor(null);}} disabled={editSaving} style={{padding:'9px 16px',background:'var(--oq-bg-ffffff)',color:'var(--oq-fg-6b7280)',border:'1px solid var(--oq-ln-e5e7eb)',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>Cancel</button>
              <button onClick={saveEdit} disabled={editSaving} style={{padding:'9px 18px',background:editSaving?'var(--oq-bg-9ca3af)':'var(--oq-bg-1f4e79)',color:'var(--oq-fg-ffffff)',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:editSaving?'default':'pointer'}}>{editSaving?'Saving...':'Save changes'}</button>
            </div>
          </div>
        </div>
      )}

      {specFor && (
        <div onClick={function(){if(!specSaving)setSpecFor(null);}} style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(17,24,39,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'20px'}}>
          <div onClick={function(e){e.stopPropagation();}} style={{background:'var(--oq-bg-ffffff)',borderRadius:'12px',padding:'24px',width:'540px',maxWidth:'100%',boxShadow:'0 10px 40px rgba(0,0,0,0.2)'}}>
            <div style={{fontSize:'16px',fontWeight:'700',color:'var(--oq-fg-1f4e79)'}}>Routing specialization</div>
            <div style={{fontSize:'13px',color:'var(--oq-fg-374151)',marginTop:'2px'}}>{specFor.display_name}{specFor.title?' \u00b7 '+specFor.title:''}</div>
            <div style={{fontSize:'12px',color:'var(--oq-fg-9ca3af)',margin:'10px 0 8px'}}>Describe, in plain language, the kinds of records or requests this person specializes in \u2014 the system uses it to route matching requests to them within their team.</div>
            <div style={{fontSize:'12px',color:'var(--oq-fg-6b7280)',background:'var(--oq-bg-f9fafb)',border:'1px solid var(--oq-ln-eef0f2)',borderRadius:'8px',padding:'8px 10px',margin:'0 0 12px',lineHeight:'1.55'}}><strong style={{color:'var(--oq-fg-1f4e79)'}}>Tip:</strong> use the words that show up in real requests \u2014 record types, document names, topics \u2014 not an instruction that names the person. Concrete record vocabulary routes far more accurately. <span style={{color:'var(--oq-fg-065f46)'}}>Good: \u201carchived paper and microfilm deeds, plat maps, and land records from the vault.\u201d</span> <span style={{color:'var(--oq-fg-9a3412)'}}>Weaker: \u201call paper requests should go to this person.\u201d</span></div>
            <textarea value={specText} onChange={function(e){setSpecText(e.target.value);}} rows={5}
              placeholder="e.g., All records related to the mounted unit: horses (purchase, veterinary, farrier), saddle and tack inventory, and barn maintenance."
              style={{width:'100%',padding:'10px 12px',border:'1px solid var(--oq-ln-e5e7eb)',borderRadius:'8px',fontSize:'14px',fontFamily:'inherit',lineHeight:'1.5',resize:'vertical',boxSizing:'border-box',outline:'none'}}/>
            <div style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'16px'}}>
              <button onClick={function(){setSpecFor(null);}} disabled={specSaving} style={{padding:'9px 16px',background:'var(--oq-bg-ffffff)',color:'var(--oq-fg-6b7280)',border:'1px solid var(--oq-ln-e5e7eb)',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>Cancel</button>
              <button onClick={saveSpec} disabled={specSaving} style={{padding:'9px 18px',background:specSaving?'var(--oq-bg-9ca3af)':'var(--oq-bg-1f4e79)',color:'var(--oq-fg-ffffff)',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:specSaving?'default':'pointer'}}>{specSaving?'Saving...':'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
