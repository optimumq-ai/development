import React, { useEffect, useState } from 'react';
import api from '../lib/api';

var COLORS = ['#2E75B6','#1F4E79','#C0392B','#27AE60','#8E44AD','#6B8E23','#D97706','#0E7490','#BE185D','#475569'];
var btnPrimary = {background:'#1F4E79',color:'white',border:'none',borderRadius:'8px',padding:'9px 14px',fontSize:'13px',fontWeight:'600',cursor:'pointer'};
var btnSecondary = {background:'white',color:'#1F4E79',border:'1px solid #1F4E79',borderRadius:'8px',padding:'9px 14px',fontSize:'13px',fontWeight:'600',cursor:'pointer'};
var btnGhost = {background:'#F3F4F6',color:'#374151',border:'none',borderRadius:'8px',padding:'7px 12px',fontSize:'13px',fontWeight:'600',cursor:'pointer'};
var btnGhostSm = {background:'#F3F4F6',color:'#374151',border:'none',borderRadius:'6px',padding:'5px 10px',fontSize:'12px',fontWeight:'600',cursor:'pointer'};
var cardStyle = {background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',overflow:'hidden',boxShadow:'0 1px 3px rgba(0,0,0,.04)'};
var avatar = {width:'30px',height:'30px',borderRadius:'50%',background:'#1F4E79',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontSize:'12px',fontWeight:'700',flexShrink:0};
var inputStyle = {width:'100%',padding:'9px 11px',borderRadius:'8px',border:'1px solid #D1D5DB',fontSize:'14px',boxSizing:'border-box'};
function chip(c){ return {width:'44px',height:'44px',borderRadius:'10px',background:c||'#2E75B6',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontSize:'14px',fontWeight:'700',flexShrink:0}; }
function chipSm(c){ return {width:'30px',height:'30px',borderRadius:'8px',background:c||'#2E75B6',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontSize:'12px',fontWeight:'700',flexShrink:0}; }
function badge(bg,fg){ return {background:bg,color:fg,fontSize:'11px',fontWeight:'700',padding:'2px 8px',borderRadius:'20px'}; }
function Modal(props){
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 16px',zIndex:50,overflowY:'auto'}} onClick={props.onClose}>
      <div onClick={function(e){e.stopPropagation();}} style={{background:'white',borderRadius:'14px',width:'100%',maxWidth:'520px',padding:'24px',boxShadow:'0 10px 40px rgba(0,0,0,.2)'}}>
        {props.children}
      </div>
    </div>
  );
}
function Field(props){
  return (
    <div style={{marginBottom:'14px'}}>
      <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>{props.label}</label>
      {props.children}
    </div>
  );
}

export default function DepartmentsPage(){
  const [departments, setDepartments] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [editor, setEditor] = useState(null);
  const [addStaff, setAddStaff] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(function(){ load(); }, []);

  async function load(){
    setLoading(true);
    try {
      const [dr, sr] = await Promise.all([api.get('/departments'), api.get('/staff')]);
      setDepartments(dr.data.departments);
      setStaff(sr.data.staff);
    } catch(e){ console.error(e); }
    setLoading(false);
  }

  function isTeam(d){ return d.kind === 'team'; }
  function depts(){ return departments.filter(function(d){ return !isTeam(d); }); }
  function teams(){ return departments.filter(isTeam); }
  function teamsForDept(id){ return teams().filter(function(t){ return t.parent_id === id; }); }
  function byId(id){ return departments.find(function(d){ return d.id === id; }); }
  function staffForUnit(id){ return staff.filter(function(s){ return s.department_id === id && s.status === 'active'; }); }
  function toggle(id){ setExpanded(function(e){ return e === id ? null : id; }); }
  function setField(k, v){ setEditor(function(ed){ var nd = Object.assign({}, ed.data); nd[k] = v; return Object.assign({}, ed, { data: nd }); }); }

  function openCreate(kind){ setEditor({ mode:'create', kind:kind, data:{ name:'', code:'', color:kind==='team'?'#6B8E23':'#2E75B6', parent_id:'', processed_by:'', fulfills_for:[], is_open_records:0, is_catch_all:0, sort_order:99 } }); }
  function openEdit(d){ setEditor({ mode:'edit', kind:isTeam(d)?'team':'department', data:Object.assign({}, d, { parent_id:d.parent_id||'', processed_by:d.processed_by||'', fulfills_for: departments.filter(function(x){ return x.processed_by===d.id; }).map(function(x){ return x.id; }) }) }); }

  async function saveEditor(){
    var d = editor.data;
    if (!d.name || !d.code){ alert('Name and code are required'); return; }
    setSaving(true);
    try {
      var payload = { name:d.name, code:d.code, color:d.color, kind:editor.kind, parent_id:editor.kind==='team'?(d.parent_id||null):null, processed_by:editor.kind==='department'?(d.processed_by||null):null, is_open_records:d.is_open_records?1:0, is_catch_all:d.is_catch_all?1:0, routing_specialization: editor.kind==='team' ? (d.routing_specialization||null) : null, sort_order:Number(d.sort_order)||99 };
      var savedId = d.id;
      if (editor.mode==='create') { var rc = await api.post('/departments', payload); savedId = rc.data.department.id; }
      else await api.patch('/departments/' + d.id, payload);
      if (editor.kind==='team') await api.post('/departments/' + savedId + '/fulfills', { departmentIds: d.fulfills_for || [] });
      setEditor(null); await load();
    } catch(e){ alert('Save failed: ' + ((e.response && e.response.data && e.response.data.error) || e.message)); }
    setSaving(false);
  }

  async function assignStaff(userId){
    setSaving(true);
    try {
      await api.patch('/staff/' + userId + '/team', { departmentId: addStaff.teamId });
      setAddStaff(null); await load();
    } catch(e){ alert('Assign failed'); }
    setSaving(false);
  }

  function renderEditor(){
    var d = editor.data; var kind = editor.kind;
    return (
      <Modal onClose={function(){ if(!saving) setEditor(null); }}>
        <h2 style={{fontSize:'18px',fontWeight:'700',margin:'0 0 16px'}}>{editor.mode==='create'?'New ':'Edit '}{kind==='team'?'Fulfillment Team':'Department'}</h2>
        <Field label="Name"><input style={inputStyle} value={d.name} onChange={function(e){setField('name',e.target.value);}} /></Field>
        <Field label="Code"><input style={inputStyle} value={d.code} maxLength={6} onChange={function(e){setField('code',e.target.value.toUpperCase());}} /></Field>
        <Field label="Color"><div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>{COLORS.map(function(c){ return <div key={c} onClick={function(){setField('color',c);}} style={{width:'28px',height:'28px',borderRadius:'7px',background:c,cursor:'pointer',border:d.color===c?'3px solid #111':'3px solid transparent'}} />; })}</div></Field>
        {kind==='team' ? (
          <div>
          <Field label="Organizational parent (optional)"><select style={inputStyle} value={d.parent_id} onChange={function(e){setField('parent_id',e.target.value);}}><option value="">— none —</option>{depts().map(function(x){ return <option key={x.id} value={x.id}>{x.name}</option>; })}</select></Field>
          <Field label="Fulfills requests for"><div style={{display:'flex',flexDirection:'column',gap:'5px',maxHeight:'160px',overflowY:'auto',border:'1px solid #E5E7EB',borderRadius:'8px',padding:'8px'}}>{depts().map(function(x){ var on=(d.fulfills_for||[]).indexOf(x.id)>=0; return <label key={x.id} style={{fontSize:'13px',display:'flex',alignItems:'center',gap:'7px',cursor:'pointer'}}><input type="checkbox" checked={on} onChange={function(){ var cur=(d.fulfills_for||[]).slice(); var i=cur.indexOf(x.id); if(i>=0)cur.splice(i,1); else cur.push(x.id); setField('fulfills_for',cur); }}/> {x.name}</label>; })}</div></Field>
          <Field label="Routing specialization (optional)"><textarea style={Object.assign({},inputStyle,{minHeight:'90px',fontFamily:'inherit',lineHeight:'1.5',resize:'vertical'})} value={d.routing_specialization||''} placeholder="Plain-language description of what this team specializes in handling. Used to help route matching requests here." onChange={function(e){setField('routing_specialization',e.target.value);}} /></Field>
          </div>
        ) : (
          <Field label="Requests processed by (fulfillment team)"><select style={inputStyle} value={d.processed_by} onChange={function(e){setField('processed_by',e.target.value);}}><option value="">— unassigned —</option>{teams().map(function(x){ return <option key={x.id} value={x.id}>{x.name}</option>; })}</select></Field>
        )}
        {kind==='department' ? (
          <div style={{display:'flex',gap:'18px',marginBottom:'14px'}}>
            <label style={{fontSize:'13px',display:'flex',alignItems:'center',gap:'6px'}}><input type="checkbox" checked={!!d.is_open_records} onChange={function(e){setField('is_open_records',e.target.checked?1:0);}} /> Open Records Hub</label>
            <label style={{fontSize:'13px',display:'flex',alignItems:'center',gap:'6px'}}><input type="checkbox" checked={!!d.is_catch_all} onChange={function(e){setField('is_catch_all',e.target.checked?1:0);}} /> Catch-All</label>
          </div>
        ) : null}
        <Field label="Sort order"><input type="number" style={inputStyle} value={d.sort_order} onChange={function(e){setField('sort_order',e.target.value);}} /></Field>
        <div style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'8px'}}>
          <button onClick={function(){setEditor(null);}} style={btnGhost} disabled={saving}>Cancel</button>
          <button onClick={saveEditor} style={btnPrimary} disabled={saving}>{saving?'Saving...':'Save'}</button>
        </div>
      </Modal>
    );
  }

  function renderAddStaff(){
    var avail = staff.filter(function(s){ return s.department_id !== addStaff.teamId; });
    return (
      <Modal onClose={function(){ if(!saving) setAddStaff(null); }}>
        <h2 style={{fontSize:'18px',fontWeight:'700',margin:'0 0 6px'}}>Add staff to {addStaff.teamName}</h2>
        <p style={{color:'#6B7280',fontSize:'13px',margin:'0 0 16px'}}>Assign an existing person to this team, or create a new staff member.</p>
        {avail.length===0 ? <div style={{color:'#9CA3AF',fontSize:'14px',marginBottom:'12px'}}>Everyone is already on this team.</div> : (
          <div style={{display:'flex',flexDirection:'column',gap:'8px',maxHeight:'260px',overflowY:'auto',marginBottom:'14px'}}>
            {avail.map(function(s){ return (
              <div key={s.id} style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 10px',border:'1px solid #E5E7EB',borderRadius:'8px'}}>
                <div style={avatar}>{s.display_name?s.display_name[0].toUpperCase():'?'}</div>
                <div style={{flex:1,minWidth:0}}><div style={{fontWeight:'600',fontSize:'13px'}}>{s.display_name}</div><div style={{fontSize:'12px',color:'#9CA3AF'}}>{s.department_name||'Unassigned'}</div></div>
                <button onClick={function(){assignStaff(s.id);}} style={btnGhostSm} disabled={saving}>Assign</button>
              </div>
            ); })}
          </div>
        )}
        <div style={{display:'flex',justifyContent:'space-between',gap:'8px'}}>
          <a href="/staff" style={Object.assign({},btnSecondary,{textDecoration:'none',display:'inline-block'})}>+ New staff</a>
          <button onClick={function(){setAddStaff(null);}} style={btnGhost} disabled={saving}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <div style={{maxWidth:'920px',display:'flex',flexDirection:'column',gap:'20px'}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:'16px'}}>
        <div>
          <h1 style={{fontSize:'22px',fontWeight:'700',margin:'0 0 4px'}}>Departments &amp; Teams</h1>
          <p style={{color:'#9CA3AF',fontSize:'14px',margin:0}}>{depts().length} departments &middot; {teams().length} fulfillment teams</p>
        </div>
        <div style={{display:'flex',gap:'8px',flexShrink:0}}>
          <button onClick={function(){openCreate('team');}} style={btnSecondary}>+ New Team</button>
          <button onClick={function(){openCreate('department');}} style={btnPrimary}>+ New Department</button>
        </div>
      </div>

      {loading ? (
        <div style={{padding:'48px',textAlign:'center',color:'#9CA3AF'}}>Loading...</div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
          {depts().map(function(dept){
            var dteams = teamsForDept(dept.id);
            var direct = staffForUnit(dept.id);
            var isOpen = expanded === dept.id;
            var pb = dept.processed_by ? byId(dept.processed_by) : null;
            return (
              <div key={dept.id} style={cardStyle}>
                <div style={{display:'flex',alignItems:'center',gap:'16px',padding:'16px 20px'}}>
                  <div onClick={function(){toggle(dept.id);}} style={{display:'flex',alignItems:'center',gap:'16px',flex:1,minWidth:0,cursor:'pointer'}}>
                    <div style={chip(dept.color)}>{dept.code}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
                        <span style={{fontWeight:'700',fontSize:'15px',color:'#111'}}>{dept.name}</span>
                        {dept.is_open_records ? <span style={badge('#EBF3FB','#1F4E79')}>Open Records Hub</span> : null}
                        {dept.is_catch_all ? <span style={badge('#FEF3C7','#92400E')}>Catch-All</span> : null}
                      </div>
                      <div style={{fontSize:'13px',color:'#6B7280',marginTop:'3px'}}>
                        Requests processed by: <strong style={{color:'#1F4E79'}}>{pb ? pb.name : 'Unassigned'}</strong>
                        <span style={{color:'#9CA3AF'}}> &middot; {dteams.length} team{dteams.length!==1?'s':''}</span>
                      </div>
                    </div>
                  </div>
                  <button onClick={function(){openEdit(dept);}} style={btnGhost}>Edit</button>
                  <div onClick={function(){toggle(dept.id);}} style={{fontSize:'20px',color:'#9CA3AF',cursor:'pointer',transform:isOpen?'rotate(180deg)':'none'}}>⌄</div>
                </div>
                {isOpen && (
                  <div style={{borderTop:'1px solid #F3F4F6',padding:'16px 20px',background:'#FAFAFA',display:'flex',flexDirection:'column',gap:'12px'}}>
                    {dteams.length===0 && direct.length===0 ? (
                      <div style={{color:'#9CA3AF',fontSize:'14px',fontStyle:'italic'}}>No fulfillment teams under this department yet. Use the + New Team button to add one.</div>
                    ) : null}
                    {dteams.map(function(team){
                      var members = staffForUnit(team.id);
                      return (
                        <div key={team.id} style={{background:'white',borderRadius:'10px',border:'1px solid #E5E7EB',padding:'12px 14px'}}>
                          <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:members.length?'10px':0}}>
                            <div style={chipSm(team.color)}>{team.code}</div>
                            <span style={{fontWeight:'700',fontSize:'14px',color:'#111'}}>{team.name}</span>
                            <span style={badge('#ECFDF5','#065F46')}>Fulfillment Team</span>
                            <div style={{flex:1}}></div>
                            <button onClick={function(){setAddStaff({teamId:team.id,teamName:team.name});}} style={btnGhostSm}>Add staff</button>
                            <button onClick={function(){openEdit(team);}} style={btnGhostSm}>Edit</button>
                          </div>
                          {members.length===0 ? (
                            <div style={{color:'#9CA3AF',fontSize:'13px',fontStyle:'italic'}}>No staff on this team</div>
                          ) : (
                            <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                              {members.map(function(s){ return (
                                <div key={s.id} style={{display:'flex',alignItems:'center',gap:'10px'}}>
                                  <div style={avatar}>{s.display_name?s.display_name[0].toUpperCase():'?'}</div>
                                  <div style={{flex:1,minWidth:0}}>
                                    <div style={{fontWeight:'600',fontSize:'13px',color:'#111'}}>{s.display_name}</div>
                                    <div style={{fontSize:'12px',color:'#9CA3AF'}}>{s.title||s.email}</div>
                                  </div>
                                </div>
                              ); })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editor ? renderEditor() : null}
      {addStaff ? renderAddStaff() : null}
    </div>
  );
}
