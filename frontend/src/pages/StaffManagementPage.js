import React, { useEffect, useState } from 'react';
import api from '../lib/api';

const FUNCTION_ROLES = ['COORDINATOR','SUPERVISOR','FEE_WAIVER_APPROVER','REDACTION_REVIEWER','REDACTION_APPROVER','ATTORNEY_REVIEWER','CUSTODIAN','DEPT_MANAGER','DIRECTOR','SYSTEM_ADMIN'];
const ROLE_COLORS = { SYSTEM_ADMIN:{bg:'#FEF2F2',color:'#991B1B'}, DIRECTOR:{bg:'#EDE9FE',color:'#6D28D9'}, SUPERVISOR:{bg:'#DBEAFE',color:'#1E40AF'}, DEPT_MANAGER:{bg:'#D1FAE5',color:'#065F46'}, COORDINATOR:{bg:'#FEF3C7',color:'#92400E'}, CUSTODIAN:{bg:'#E0E7FF',color:'#3730A3'}, REDACTION_REVIEWER:{bg:'#CCFBF1',color:'#0F766E'}, REDACTION_APPROVER:{bg:'#CCFBF1',color:'#0F766E'}, ATTORNEY_REVIEWER:{bg:'#FEE2E2',color:'#B91C1C'}, FEE_WAIVER_APPROVER:{bg:'#FEF9C3',color:'#854D0E'} };

export default function StaffManagementPage() {
  const [staff, setStaff] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ displayName:'', email:'', title:'', departmentId:'', tempPassword:'', functionRoles:[] });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');
  const [specFor, setSpecFor] = useState(null);
  const [specText, setSpecText] = useState('');
  const [specSaving, setSpecSaving] = useState(false);

  useEffect(function() { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [sr, dr] = await Promise.all([api.get('/staff'), api.get('/departments')]);
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

  function setF(k,v){ setForm(function(f){ return Object.assign({},f,{[k]:v}); }); }

  function toggleRole(role) {
    setForm(function(f) {
      var roles = f.functionRoles.includes(role) ? f.functionRoles.filter(function(r){ return r!==role; }) : f.functionRoles.concat(role);
      return Object.assign({},f,{functionRoles:roles});
    });
  }

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
    if (form.functionRoles.length === 0) { setErr('At least one role must be assigned'); return; }
    setSaving(true);
    try {
      await api.post('/staff', form);
      setSuccess('Staff member created successfully. They will be prompted to change their password on first login.');
      setForm({ displayName:'', email:'', title:'', departmentId:'', tempPassword:'', functionRoles:[] });
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

  var inp = { width:'100%', padding:'9px 12px', border:'1px solid #E5E7EB', borderRadius:'8px', fontSize:'14px', outline:'none', boxSizing:'border-box', background:'white' };
  var lbl = { display:'block', fontSize:'13px', fontWeight:'600', color:'#374151', marginBottom:'5px' };

  return (
    <div style={{maxWidth:'1100px',display:'flex',flexDirection:'column',gap:'20px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <h1 style={{fontSize:'22px',fontWeight:'700',margin:'0 0 4px'}}>Staff Management</h1>
          <p style={{color:'#9CA3AF',fontSize:'14px',margin:0}}>{staff.length} staff member{staff.length!==1?'s':''} in the system</p>
        </div>
        <button onClick={function(){setShowAdd(!showAdd);setErr('');setSuccess('');}} style={{padding:'10px 18px',background:'#1F4E79',color:'white',border:'none',borderRadius:'8px',fontSize:'14px',fontWeight:'600',cursor:'pointer'}}>
          + Add Staff Member
        </button>
      </div>

      {success && <div style={{background:'#F0FDF4',border:'1px solid #86EFAC',borderRadius:'8px',padding:'14px',fontSize:'14px',color:'#166534'}}>{success}</div>}

      {showAdd && (
        <div style={{background:'white',borderRadius:'12px',border:'2px solid #1F4E79',padding:'24px'}}>
          <h2 style={{fontSize:'16px',fontWeight:'700',margin:'0 0 20px',color:'#1F4E79'}}>Add New Staff Member</h2>
          <form onSubmit={handleAdd} style={{display:'flex',flexDirection:'column',gap:'16px'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
              <div>
                <label style={lbl}>Full Name <span style={{color:'#DC2626'}}>*</span></label>
                <input value={form.displayName} onChange={function(e){setF('displayName',e.target.value);}} style={inp} placeholder="Jane Smith" required/>
              </div>
              <div>
                <label style={lbl}>Email Address <span style={{color:'#DC2626'}}>*</span></label>
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
                <button type="button" onClick={createTeam} style={{marginTop:'6px',background:'none',border:'none',color:'#1F4E79',fontSize:'12px',fontWeight:'600',cursor:'pointer',padding:0}}>+ New team</button>
              </div>
              <div>
                <label style={lbl}>Temporary Password <span style={{color:'#DC2626'}}>*</span></label>
                <input type="password" value={form.tempPassword} onChange={function(e){setF('tempPassword',e.target.value);}} style={inp} placeholder="Min 8 characters"/>
                <div style={{fontSize:'12px',color:'#9CA3AF',marginTop:'4px'}}>Staff will be required to change this on first login</div>
              </div>
            </div>
            <div>
              <label style={lbl}>Function Roles <span style={{color:'#DC2626'}}>*</span></label>
              <div style={{display:'flex',flexWrap:'wrap',gap:'8px',marginTop:'4px'}}>
                {FUNCTION_ROLES.map(function(role){
                  var active = form.functionRoles.includes(role);
                  var rc = ROLE_COLORS[role] || {bg:'#F3F4F6',color:'#374151'};
                  return <button key={role} type="button" onClick={function(){toggleRole(role);}}
                    style={{padding:'6px 14px',borderRadius:'20px',border:'2px solid '+(active?rc.color:'#E5E7EB'),background:active?rc.bg:'white',color:active?rc.color:'#6B7280',fontSize:'12px',fontWeight:active?'700':'500',cursor:'pointer'}}>
                    {role.replace(/_/g,' ')}
                  </button>;
                })}
              </div>
              <div style={{fontSize:'12px',color:'#9CA3AF',marginTop:'6px'}}>Click to toggle roles. Multiple roles can be assigned.</div>
            </div>
            {err && <div style={{background:'#FEF2F2',border:'1px solid #FCA5A5',borderRadius:'8px',padding:'12px',fontSize:'14px',color:'#DC2626'}}>{err}</div>}
            <div style={{display:'flex',gap:'10px',justifyContent:'flex-end'}}>
              <button type="button" onClick={function(){setShowAdd(false);setErr('');}} style={{padding:'10px 20px',background:'white',color:'#6B7280',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'14px',cursor:'pointer'}}>Cancel</button>
              <button type="submit" disabled={saving} style={{padding:'10px 24px',background:'#1F4E79',color:'white',border:'none',borderRadius:'8px',fontSize:'14px',fontWeight:'600',cursor:'pointer'}}>
                {saving?'Creating...':'Create Staff Member'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div style={{background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',overflow:'hidden'}}>
        {loading ? (
          <div style={{padding:'48px',textAlign:'center',color:'#9CA3AF'}}>Loading staff...</div>
        ) : staff.length === 0 ? (
          <div style={{padding:'48px',textAlign:'center',color:'#9CA3AF'}}>
            <div style={{fontSize:'40px',marginBottom:'12px'}}>👥</div>
            <div style={{fontSize:'16px',fontWeight:'600',color:'#4B5563',marginBottom:'8px'}}>No staff members yet</div>
            <div style={{fontSize:'14px'}}>Add your first staff member using the button above</div>
          </div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr style={{background:'#F9FAFB'}}>
                {['Name','Email','Team','Roles','Status','Last Login',''].map(function(h){
                  return <th key={h} style={{textAlign:'left',fontSize:'11px',fontWeight:'600',color:'#6B7280',textTransform:'uppercase',letterSpacing:'.05em',padding:'10px 16px'}}>{h}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {staff.map(function(s,i){
                var isActive = s.status === 'active';
                return (
                  <tr key={s.id} style={{borderTop:'1px solid #F3F4F6'}}>
                    <td style={{padding:'14px 16px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                        <div style={{width:'36px',height:'36px',borderRadius:'50%',background:'#1F4E79',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontSize:'14px',fontWeight:'700',flexShrink:0}}>
                          {s.display_name?s.display_name[0].toUpperCase():'?'}
                        </div>
                        <div>
                          <div style={{fontWeight:'600',fontSize:'14px',color:'#111'}}>{s.display_name}</div>
                          {s.title&&<div style={{fontSize:'12px',color:'#9CA3AF'}}>{s.title}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{padding:'14px 16px',fontSize:'13px',color:'#374151'}}>{s.email}</td>
                    <td style={{padding:'14px 16px',fontSize:'13px',color:'#374151'}}>{s.department_name||<span style={{color:'#D1D5DB',fontStyle:'italic'}}>None</span>}</td>
                    <td style={{padding:'14px 16px'}}>
                      <div style={{display:'flex',flexWrap:'wrap',gap:'4px'}}>
                        {(s.functionRoles||[]).map(function(role){
                          var rc = ROLE_COLORS[role]||{bg:'#F3F4F6',color:'#374151'};
                          return <span key={role} style={{background:rc.bg,color:rc.color,fontSize:'10px',fontWeight:'700',padding:'2px 8px',borderRadius:'20px'}}>{role.replace(/_/g,' ')}</span>;
                        })}
                      </div>
                    </td>
                    <td style={{padding:'14px 16px'}}>
                      <span style={{background:isActive?'#F0FDF4':'#F9FAFB',color:isActive?'#16A34A':'#9CA3AF',fontSize:'12px',fontWeight:'600',padding:'3px 10px',borderRadius:'20px'}}>
                        {isActive?'Active':'Inactive'}
                      </span>
                    </td>
                    <td style={{padding:'14px 16px',fontSize:'12px',color:'#9CA3AF'}}>
                      {s.last_login ? new Date(s.last_login).toLocaleDateString() : 'Never'}
                    </td>
                    <td style={{padding:'14px 16px'}}>
                      <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
                        <button onClick={function(){setSpecFor(s);setSpecText(s.routing_specialization||'');}}
                          title="Routing specialization"
                          style={{padding:'5px 12px',background:s.routing_specialization?'#DBEAFE':'white',color:'#1F4E79',border:'1px solid #BFDBFE',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                          Routing
                        </button>
                        <button onClick={function(){toggleStatus(s.id,s.status);}}
                          style={{padding:'5px 12px',background:'white',color:isActive?'#DC2626':'#16A34A',border:'1px solid '+(isActive?'#FCA5A5':'#86EFAC'),borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                          {isActive?'Deactivate':'Activate'}
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

      {specFor && (
        <div onClick={function(){if(!specSaving)setSpecFor(null);}} style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(17,24,39,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'20px'}}>
          <div onClick={function(e){e.stopPropagation();}} style={{background:'white',borderRadius:'12px',padding:'24px',width:'540px',maxWidth:'100%',boxShadow:'0 10px 40px rgba(0,0,0,0.2)'}}>
            <div style={{fontSize:'16px',fontWeight:'700',color:'#1F4E79'}}>Routing specialization</div>
            <div style={{fontSize:'13px',color:'#374151',marginTop:'2px'}}>{specFor.display_name}{specFor.title?' \u00b7 '+specFor.title:''}</div>
            <div style={{fontSize:'12px',color:'#9CA3AF',margin:'10px 0 12px'}}>Describe, in plain language, the kinds of records or requests this person specializes in. The system can use this to route matching requests to them within their team.</div>
            <textarea value={specText} onChange={function(e){setSpecText(e.target.value);}} rows={5}
              placeholder="e.g., All records related to the mounted unit: horses (purchase, veterinary, farrier), saddle and tack inventory, and barn maintenance."
              style={{width:'100%',padding:'10px 12px',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'14px',fontFamily:'inherit',lineHeight:'1.5',resize:'vertical',boxSizing:'border-box',outline:'none'}}/>
            <div style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'16px'}}>
              <button onClick={function(){setSpecFor(null);}} disabled={specSaving} style={{padding:'9px 16px',background:'white',color:'#6B7280',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>Cancel</button>
              <button onClick={saveSpec} disabled={specSaving} style={{padding:'9px 18px',background:specSaving?'#9CA3AF':'#1F4E79',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:specSaving?'default':'pointer'}}>{specSaving?'Saving...':'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
