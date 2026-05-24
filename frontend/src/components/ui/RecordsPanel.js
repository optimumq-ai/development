import React, { useState } from 'react';

const RECORD_TYPES = ['Document / PDF','Email','Photo / Image','Audio Recording','Video Recording','Spreadsheet','Paper Record (Scanned)','Physical Record (Non-Digital)','External Reference'];

export default function RecordsPanel({ records, onAdd, onUpdateStatus, stage }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title:'', recordType:'Document / PDF', description:'', isNonDigital:false });

  function set(k,v){ setForm(function(f){ return Object.assign({},f,{[k]:v}); }); }

  function handleAdd(e) {
    e.preventDefault();
    if (!form.title) return;
    onAdd({ id: Date.now().toString(), title: form.title, recordType: form.recordType, description: form.description, isNonDigital: form.isNonDigital, status: 'attached', attachedAt: new Date().toISOString() });
    setForm({ title:'', recordType:'Document / PDF', description:'', isNonDigital:false });
    setShowAdd(false);
  }

  var responsiveCount = records.filter(function(r){ return r.status==='responsive'; }).length;
  var canAdvance = responsiveCount > 0;
  var inp = { width:'100%', padding:'8px 12px', border:'1px solid #E5E7EB', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box', background:'white' };

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <h3 style={{fontSize:'15px',fontWeight:'700',margin:'0 0 2px'}}>Responsive Records</h3>
          <p style={{fontSize:'12px',color:'#9CA3AF',margin:0}}>
            {records.length===0?'No records attached yet':records.length+' record'+(records.length!==1?'s':'')+' attached · '+responsiveCount+' responsive'}
            {stage==='record_search'&&!canAdvance?' — mark at least one Responsive to advance':''}
          </p>
        </div>
        <button onClick={function(){setShowAdd(!showAdd);}} style={{padding:'8px 14px',background:'#1F4E79',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
          + Attach Record
        </button>
      </div>
      {stage==='record_search'&&(
        <div style={{display:'flex',gap:'10px',padding:'12px',background:canAdvance?'#F0FDF4':'#FFFBEB',borderRadius:'8px',border:'1px solid '+(canAdvance?'#86EFAC':'#FDE68A')}}>
          <div style={{fontSize:'20px'}}>{canAdvance?'✅':'⚠️'}</div>
          <div style={{fontSize:'13px',color:canAdvance?'#166534':'#92400E'}}>
            {canAdvance?responsiveCount+' responsive record'+(responsiveCount!==1?'s':'')+' — ready to advance':'Mark at least one attached record as Responsive before advancing'}
          </div>
        </div>
      )}
      {showAdd&&(
        <div style={{background:'#F9FAFB',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'16px'}}>
          <h4 style={{fontSize:'14px',fontWeight:'700',margin:'0 0 12px'}}>Attach a Record</h4>
          <div style={{display:'flex',gap:'12px',marginBottom:'12px'}}>
            {[['📎 Upload File',false],['📝 Log Non-Digital',true]].map(function(item){
              var active=form.isNonDigital===item[1];
              return <button key={String(item[1])} type="button" onClick={function(){set('isNonDigital',item[1]);}}
                style={{flex:1,padding:'10px',borderRadius:'8px',border:'2px solid '+(active?'#1F4E79':'#E5E7EB'),background:active?'#EBF3FB':'white',color:active?'#1F4E79':'#6B7280',fontSize:'13px',fontWeight:active?'700':'500',cursor:'pointer'}}>
                {item[0]}
              </button>;
            })}
          </div>
          <form onSubmit={handleAdd} style={{display:'flex',flexDirection:'column',gap:'10px'}}>
            <div>
              <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'4px'}}>Record Title *</label>
              <input value={form.title} onChange={function(e){set('title',e.target.value);}} style={inp} placeholder={form.isNonDigital?'e.g., Building inspection file box #3':'e.g., Invoice_2024_Q1.pdf'} required/>
            </div>
            <div>
              <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'4px'}}>Record Type</label>
              <select value={form.recordType} onChange={function(e){set('recordType',e.target.value);}} style={inp}>
                {RECORD_TYPES.map(function(t){return <option key={t} value={t}>{t}</option>;})}
              </select>
            </div>
            <div>
              <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'4px'}}>Description</label>
              <textarea value={form.description} onChange={function(e){set('description',e.target.value);}} style={Object.assign({},inp,{minHeight:'60px',resize:'vertical',fontFamily:'inherit'})} placeholder="Brief description..."/>
            </div>
            {form.isNonDigital&&(
              <div style={{background:'#EBF3FB',borderRadius:'8px',padding:'12px',fontSize:'13px',color:'#1F4E79'}}>
                📷 <strong>Optional:</strong> Attach a photo of this physical record if possible.
              </div>
            )}
            {!form.isNonDigital&&(
              <div style={{border:'2px dashed #D1D5DB',borderRadius:'8px',padding:'20px',textAlign:'center',color:'#9CA3AF',fontSize:'13px',background:'white'}}>
                <div style={{fontSize:'24px',marginBottom:'8px'}}>📁</div>
                <div>Drag files here or <span style={{color:'#1F4E79',fontWeight:'600',cursor:'pointer'}}>browse</span></div>
                <div style={{fontSize:'11px',marginTop:'4px'}}>PDF, DOC, XLS, images, audio, video supported</div>
              </div>
            )}
            <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
              <button type="button" onClick={function(){setShowAdd(false);}} style={{padding:'8px 16px',background:'white',color:'#6B7280',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'13px',cursor:'pointer'}}>Cancel</button>
              <button type="submit" style={{padding:'8px 16px',background:'#1F4E79',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>Log Record</button>
            </div>
          </form>
        </div>
      )}
      {records.length>0&&(
        <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
          {records.map(function(r){
            var isR=r.status==='responsive';
            var isNR=r.status==='non_responsive';
            return(
              <div key={r.id} style={{background:'white',border:'1px solid '+(isR?'#86EFAC':isNR?'#FCA5A5':'#E5E7EB'),borderRadius:'10px',padding:'14px',display:'flex',alignItems:'flex-start',gap:'12px'}}>
                <div style={{fontSize:'24px',flexShrink:0}}>{r.isNonDigital?'📝':r.recordType&&r.recordType.includes('Video')?'🎥':r.recordType&&r.recordType.includes('Audio')?'🎵':r.recordType&&r.recordType.includes('Photo')?'🖼️':'📄'}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:'600',fontSize:'14px',color:'#111',marginBottom:'2px'}}>{r.title}</div>
                  <div style={{fontSize:'12px',color:'#9CA3AF'}}>{r.recordType}{r.description?' · '+r.description:''}</div>
                  {r.isNonDigital&&<div style={{fontSize:'11px',color:'#D97706',fontWeight:'600',marginTop:'2px'}}>Non-Digital Record</div>}
                </div>
                <div style={{display:'flex',gap:'6px',flexShrink:0}}>
                  <button onClick={function(){onUpdateStatus(r.id,'responsive');}} style={{padding:'5px 10px',borderRadius:'6px',border:'1px solid '+(isR?'#16A34A':'#D1D5DB'),background:isR?'#F0FDF4':'white',color:isR?'#16A34A':'#6B7280',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>
                    {isR?'✓ Responsive':'Responsive'}
                  </button>
                  <button onClick={function(){onUpdateStatus(r.id,'non_responsive');}} style={{padding:'5px 10px',borderRadius:'6px',border:'1px solid '+(isNR?'#DC2626':'#D1D5DB'),background:isNR?'#FEF2F2':'white',color:isNR?'#DC2626':'#6B7280',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>
                    {isNR?'✗ Not Responsive':'Not Responsive'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
