import React, { useEffect, useState } from 'react';
import api from '../lib/api';

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(function() { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [dr, sr] = await Promise.all([api.get('/departments'), api.get('/staff')]);
      setDepartments(dr.data.departments);
      setStaff(sr.data.staff);
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  function getStaffForDept(deptId) {
    return staff.filter(function(s) { return s.department_id === deptId && s.status === 'active'; });
  }

  function toggle(id) { setExpanded(function(e) { return e === id ? null : id; }); }

  return (
    <div style={{maxWidth:'900px',display:'flex',flexDirection:'column',gap:'20px'}}>
      <div>
        <h1 style={{fontSize:'22px',fontWeight:'700',margin:'0 0 4px'}}>Departments</h1>
        <p style={{color:'#9CA3AF',fontSize:'14px',margin:0}}>{departments.length} departments configured</p>
      </div>

      {loading ? (
        <div style={{padding:'48px',textAlign:'center',color:'#9CA3AF'}}>Loading departments...</div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
          {departments.map(function(dept) {
            var deptStaff = getStaffForDept(dept.id);
            var isOpen = expanded === dept.id;
            return (
              <div key={dept.id} style={{background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',overflow:'hidden',boxShadow:'0 1px 3px rgba(0,0,0,.04)'}}>
                <div onClick={function(){toggle(dept.id);}} style={{display:'flex',alignItems:'center',gap:'16px',padding:'16px 20px',cursor:'pointer'}}
                  onMouseOver={function(e){e.currentTarget.style.background='#F9FAFB';}}
                  onMouseOut={function(e){e.currentTarget.style.background='white';}}>
                  <div style={{width:'44px',height:'44px',borderRadius:'10px',background:dept.color||'#2E75B6',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontSize:'14px',fontWeight:'700',flexShrink:0}}>
                    {dept.code}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                      <span style={{fontWeight:'700',fontSize:'15px',color:'#111'}}>{dept.name}</span>
                      {dept.is_open_records ? <span style={{background:'#EBF3FB',color:'#1F4E79',fontSize:'11px',fontWeight:'700',padding:'2px 8px',borderRadius:'20px'}}>Open Records Hub</span> : null}
                      {dept.is_catch_all ? <span style={{background:'#FEF3C7',color:'#92400E',fontSize:'11px',fontWeight:'700',padding:'2px 8px',borderRadius:'20px'}}>Catch-All</span> : null}
                    </div>
                    <div style={{fontSize:'13px',color:'#9CA3AF',marginTop:'2px'}}>
                      {deptStaff.length} active staff member{deptStaff.length!==1?'s':''}
                    </div>
                  </div>
                  <div style={{fontSize:'20px',color:'#9CA3AF',transition:'transform .2s',transform:isOpen?'rotate(180deg)':'rotate(0deg)'}}>⌄</div>
                </div>

                {isOpen && (
                  <div style={{borderTop:'1px solid #F3F4F6',padding:'16px 20px',background:'#FAFAFA'}}>
                    {deptStaff.length === 0 ? (
                      <div style={{color:'#9CA3AF',fontSize:'14px',fontStyle:'italic'}}>No active staff assigned to this department</div>
                    ) : (
                      <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
                        <div style={{fontSize:'12px',fontWeight:'600',color:'#6B7280',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'4px'}}>Active Staff</div>
                        {deptStaff.map(function(s) {
                          return (
                            <div key={s.id} style={{display:'flex',alignItems:'center',gap:'12px',padding:'10px 14px',background:'white',borderRadius:'8px',border:'1px solid #E5E7EB'}}>
                              <div style={{width:'32px',height:'32px',borderRadius:'50%',background:'#1F4E79',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontSize:'13px',fontWeight:'700',flexShrink:0}}>
                                {s.display_name?s.display_name[0].toUpperCase():'?'}
                              </div>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontWeight:'600',fontSize:'14px',color:'#111'}}>{s.display_name}</div>
                                <div style={{fontSize:'12px',color:'#9CA3AF'}}>{s.title||s.email}</div>
                              </div>
                              <div style={{display:'flex',flexWrap:'wrap',gap:'4px',justifyContent:'flex-end'}}>
                                {(s.functionRoles||[]).map(function(role) {
                                  return <span key={role} style={{background:'#F3F4F6',color:'#374151',fontSize:'10px',fontWeight:'600',padding:'2px 8px',borderRadius:'20px'}}>{role.replace(/_/g,' ')}</span>;
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
