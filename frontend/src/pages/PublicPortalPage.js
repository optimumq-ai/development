import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API = (process.env.REACT_APP_API_URL || '/api');

export default function PublicPortalPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [verifyingEmail, setVerifyingEmail] = useState(null);
  const [verifyToken, setVerifyToken] = useState(null);
  const [verifyStartTime, setVerifyStartTime] = useState(null);
  const [formData, setFormData] = useState({ requestorName:'', requestorEmail:'', requestorPhone:'', deliveryMethod:'email', description:'', feeWaiverRequested:false, feeWaiverReason:'' });
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [agencyName, setAgencyName] = useState('');
  const scrollRef = useRef(null);
  const searchResultsRef = useRef(null);

  useEffect(function() {
    axios.get(API + '/requests/public/config').then(function(r) {
      setAgencyName(r.data.agency_name || 'this Agency');
    }).catch(function(){ setAgencyName('this Agency'); });
    sendMessage('', true);
  }, []);

  useEffect(function() {
    var lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.content === '__SEARCH_RESULTS__' && searchResultsRef.current) {
      searchResultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  useEffect(function() {
    if (!verifyToken) return;
    var interval = setInterval(async function() {
      try {
        var r = await axios.get(API + '/public/verify-status/' + verifyToken);
        var elapsed = Date.now() - verifyStartTime;
        if (r.data.verified) {
          clearInterval(interval);
          var email = verifyingEmail;
          setVerifyToken(null); setVerifyingEmail(null); setVerifyStartTime(null);
          await sendMessage('VERIFIED_OK: ' + email, false);
        } else if (elapsed > 10 * 60 * 1000) {
          clearInterval(interval);
          var emailT = verifyingEmail;
          setVerifyToken(null); setVerifyingEmail(null); setVerifyStartTime(null);
          await sendMessage('VERIFIED_TIMEOUT: ' + emailT, false);
        }
      } catch(e) {}
    }, 3000);
    return function() { clearInterval(interval); };
  }, [verifyToken, verifyStartTime, verifyingEmail]);

  function setFD(k, v) { setFormData(function(d){ return Object.assign({}, d, {[k]: v}); }); }

  async function handleFormSubmit(e) {
    e.preventDefault();
    setFormError('');
    if (!formData.requestorName.trim() || !formData.requestorEmail.trim() || !formData.description.trim()) {
      setFormError('Please fill in your name, email, and a description of the records you are requesting.');
      return;
    }
    setFormSubmitting(true);
    try {
      var payload = Object.assign({}, formData, { classification: 'standard', submissionChannel: 'manual_form' });
      var s = await axios.post(API + '/public/submit', payload);
      setSubmitted(s.data);
    } catch(err) {
      setFormError('Submission failed. Please try again or use the chat assistant.');
    }
    setFormSubmitting(false);
  }

  async function resendVerification() {
    if (!verifyingEmail) return;
    try {
      var vr = await axios.post(API + '/public/request-verification', { email: verifyingEmail });
      setVerifyToken(vr.data.token);
      setVerifyStartTime(Date.now());
    } catch(e) {}
  }

  async function skipVerification() {
    if (!verifyingEmail) return;
    var email = verifyingEmail;
    setVerifyToken(null); setVerifyingEmail(null); setVerifyStartTime(null);
    await sendMessage('VERIFIED_TIMEOUT: ' + email, false);
  }


  async function sendMessage(userText, isInitial) {
    if (submitted) return;
    var nextMessages = isInitial ? [{role:'user', content:'Hi'}] : messages.concat([{role:'user', content:userText}]);
    if (!isInitial) setMessages(nextMessages);
    setInput('');
    setSending(true);
    try {
      var r = await axios.post(API + '/public/chat', { messages: nextMessages });
      var assistantMsg = { role: 'assistant', content: r.data.reply };
      var msgsAfter = nextMessages.concat([assistantMsg]);
      if (r.data.searchResults && r.data.searchResults.length > 0) {
        msgsAfter = msgsAfter.concat([{ role: 'assistant', content: '__SEARCH_RESULTS__', searchResults: r.data.searchResults, searchQuery: r.data.searchQuery }]);
      }
      setMessages(msgsAfter);
      if (r.data.verifyEmail) {
        try {
          var vr = await axios.post(API + '/public/request-verification', { email: r.data.verifyEmail });
          setVerifyingEmail(r.data.verifyEmail);
          setVerifyToken(vr.data.token);
          setVerifyStartTime(Date.now());
        } catch(verifyErr) {
          setMessages(msgsAfter.concat([{role:'assistant', content:'I was unable to send the verification email. Let me continue without it.'}]));
        }
      }
      if (r.data.submission) {
        var submitData = Object.assign({}, r.data.submission, { classification: 'standard', submissionChannel: 'chat_agent' });
        var s = await axios.post(API + '/public/submit', submitData);
        setSubmitted(s.data);
      }
    } catch(e) {
      setMessages(nextMessages.concat([{role:'assistant', content:'I had trouble responding. Please try again, or use the form link below.'}]));
    }
    setSending(false);
  }

  function handleSend(e) {
    if (e) e.preventDefault();
    if (!input.trim() || sending) return;
    sendMessage(input.trim(), false);
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  if (submitted) {
    return (
      <div style={{minHeight:'100vh',background:'#F9FAFB',display:'flex',alignItems:'center',justifyContent:'center',padding:'24px'}}>
        <div style={{maxWidth:'560px',width:'100%',background:'white',borderRadius:'16px',padding:'40px',boxShadow:'0 4px 24px rgba(0,0,0,0.08)',textAlign:'center'}}>
          <div style={{fontSize:'56px',marginBottom:'16px'}}>✅</div>
          <h1 style={{fontSize:'24px',fontWeight:'700',color:'#1F4E79',margin:'0 0 8px'}}>Request Submitted</h1>
          <p style={{fontSize:'15px',color:'#6B7280',margin:'0 0 24px'}}>Your records request has been received.</p>
          <div style={{background:'#EBF3FB',borderRadius:'10px',padding:'20px',marginBottom:'24px'}}>
            <div style={{fontSize:'12px',color:'#6B7280',marginBottom:'4px',textTransform:'uppercase',letterSpacing:'0.5px'}}>Request Number</div>
            <div style={{fontSize:'28px',fontWeight:'700',color:'#1F4E79',fontFamily:'monospace'}}>{submitted.requestNumber}</div>
          </div>
          <p style={{fontSize:'13px',color:'#6B7280',margin:0}}>You'll receive a confirmation email shortly. Save your request number — you'll use it to check status, respond to clarifications, and pay any fees.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{height:'100vh',background:'#F9FAFB',display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <header style={{background:'white',borderBottom:'1px solid #E5E7EB',padding:'16px 24px'}}>
        <div style={{maxWidth:'780px',margin:'0 auto',display:'flex',alignItems:'center',gap:'12px'}}>
          <div style={{width:'40px',height:'40px',background:'#1F4E79',borderRadius:'8px',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontSize:'18px',fontWeight:'700'}}>OQ</div>
          <div>
            <div style={{fontSize:'15px',fontWeight:'700',color:'#1F4E79'}}>{agencyName}</div>
            <div style={{fontSize:'12px',color:'#6B7280'}}>Public Records Request Portal</div>
          </div>
        </div>
      </header>

      <div style={{flex:1,display:'flex',flexDirection:'column',maxWidth:'780px',width:'100%',margin:'0 auto',padding:'16px 24px',boxSizing:'border-box',minHeight:0}}>
        <div style={{background:'white',borderRadius:'12px',padding:'12px 16px',marginBottom:'12px',border:'1px solid #E5E7EB',flexShrink:0}}>
          <h1 style={{fontSize:'16px',fontWeight:'700',color:'#111',margin:'0 0 2px'}}>Request Public Records</h1>
          <p style={{fontSize:'13px',color:'#6B7280',margin:0,lineHeight:'1.4'}}>
            Chat with our assistant below to submit your request. The assistant will ask a few questions and help organize your request. You can also <button onClick={function(){setShowForm(true);}} style={{background:'none',border:'none',color:'#1F4E79',textDecoration:'underline',cursor:'pointer',fontSize:'14px',padding:0}}>prefer a form</button> instead.
          </p>
        </div>

        {showForm ? (
          <div style={{flex:1,background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',padding:'24px',overflowY:'auto'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
              <h2 style={{fontSize:'18px',fontWeight:'700',color:'#111',margin:0}}>Records Request Form</h2>
              <button onClick={function(){setShowForm(false);}} style={{background:'none',border:'none',color:'#1F4E79',textDecoration:'underline',cursor:'pointer',fontSize:'13px'}}>Use the chat assistant instead</button>
            </div>
            <form onSubmit={handleFormSubmit} style={{display:'flex',flexDirection:'column',gap:'14px'}}>
              <div>
                <label style={{display:'block',fontSize:'13px',fontWeight:'600',color:'#374151',marginBottom:'4px'}}>Full Name <span style={{color:'#DC2626'}}>*</span></label>
                <input value={formData.requestorName} onChange={function(e){setFD('requestorName',e.target.value);}} style={{width:'100%',padding:'10px 12px',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'14px',outline:'none',boxSizing:'border-box'}} placeholder="Jane Smith"/>
              </div>
              <div>
                <label style={{display:'block',fontSize:'13px',fontWeight:'600',color:'#374151',marginBottom:'4px'}}>Email Address <span style={{color:'#DC2626'}}>*</span></label>
                <input type="email" value={formData.requestorEmail} onChange={function(e){setFD('requestorEmail',e.target.value);}} style={{width:'100%',padding:'10px 12px',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'14px',outline:'none',boxSizing:'border-box'}} placeholder="jane@example.com"/>
              </div>
              <div>
                <label style={{display:'block',fontSize:'13px',fontWeight:'600',color:'#374151',marginBottom:'4px'}}>Phone Number <span style={{color:'#9CA3AF',fontWeight:'400'}}>(optional)</span></label>
                <input value={formData.requestorPhone} onChange={function(e){setFD('requestorPhone',e.target.value);}} style={{width:'100%',padding:'10px 12px',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'14px',outline:'none',boxSizing:'border-box'}} placeholder="(555) 123-4567"/>
              </div>
              <div>
                <label style={{display:'block',fontSize:'13px',fontWeight:'600',color:'#374151',marginBottom:'4px'}}>Preferred Delivery Method</label>
                <select value={formData.deliveryMethod} onChange={function(e){setFD('deliveryMethod',e.target.value);}} style={{width:'100%',padding:'10px 12px',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'14px',outline:'none',boxSizing:'border-box',background:'white'}}>
                  <option value="email">Email</option>
                  <option value="mail">Postal Mail</option>
                </select>
              </div>
              <div>
                <label style={{display:'block',fontSize:'13px',fontWeight:'600',color:'#374151',marginBottom:'4px'}}>Description of Records Requested <span style={{color:'#DC2626'}}>*</span></label>
                <textarea value={formData.description} onChange={function(e){setFD('description',e.target.value);}} style={{width:'100%',padding:'10px 12px',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'14px',outline:'none',boxSizing:'border-box',resize:'vertical',minHeight:'120px',fontFamily:'inherit'}} placeholder="Describe what records you are requesting. Include dates, departments, names, or specific events if relevant."/>
              </div>
              <div style={{background:'#F9FAFB',border:'1px solid #E5E7EB',borderRadius:'8px',padding:'12px 14px'}}>
                <label style={{display:'flex',alignItems:'flex-start',gap:'10px',cursor:'pointer'}}>
                  <input type="checkbox" checked={formData.feeWaiverRequested} onChange={function(e){setFD('feeWaiverRequested',e.target.checked);}} style={{marginTop:'3px'}}/>
                  <div>
                    <div style={{fontSize:'13px',fontWeight:'600',color:'#374151'}}>Request a fee waiver</div>
                    <div style={{fontSize:'12px',color:'#6B7280',marginTop:'2px'}}>For nonprofits, journalists, researchers, or non-commercial public-interest purposes</div>
                  </div>
                </label>
                {formData.feeWaiverRequested && (
                  <div style={{marginTop:'10px'}}>
                    <textarea value={formData.feeWaiverReason} onChange={function(e){setFD('feeWaiverReason',e.target.value);}} placeholder="Briefly describe the purpose of your request" style={{width:'100%',padding:'8px 12px',border:'1px solid #E5E7EB',borderRadius:'6px',fontSize:'13px',outline:'none',boxSizing:'border-box',resize:'vertical',minHeight:'60px',fontFamily:'inherit'}}/>
                  </div>
                )}
              </div>
              {formError && <div style={{background:'#FEF2F2',border:'1px solid #FCA5A5',color:'#991B1B',padding:'10px 14px',borderRadius:'8px',fontSize:'13px'}}>{formError}</div>}
              <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',marginTop:'8px'}}>
                <button type="button" onClick={function(){setShowForm(false);}} style={{padding:'11px 22px',background:'white',color:'#6B7280',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'14px',fontWeight:'600',cursor:'pointer'}}>Cancel</button>
                <button type="submit" disabled={formSubmitting} style={{padding:'11px 28px',background:formSubmitting?'#D1D5DB':'#1F4E79',color:'white',border:'none',borderRadius:'8px',fontSize:'14px',fontWeight:'600',cursor:formSubmitting?'not-allowed':'pointer'}}>{formSubmitting?'Submitting...':'Submit Request'}</button>
              </div>
            </form>
          </div>
        ) : (
        <div style={{flex:1,background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',display:'flex',flexDirection:'column',minHeight:0,overflow:'hidden'}}>
          <div ref={scrollRef} style={{flex:1,overflowY:'auto',padding:'20px',display:'flex',flexDirection:'column',gap:'12px'}}>
            {messages.map(function(m, i) {
              if (m.content === '__SEARCH_RESULTS__' && m.searchResults) {
                return (
                  <div key={i} ref={i === messages.length - 1 ? searchResultsRef : null} style={{display:'flex',justifyContent:'flex-start',scrollMarginTop:'12px'}}>
                    <div style={{maxWidth:'92%',width:'100%'}}>
                      <div style={{fontSize:'13px',fontWeight:'700',color:'#1F4E79',marginBottom:'10px',padding:'8px 12px',background:'#EBF3FB',borderRadius:'8px',border:'1px solid #C7D9EB'}}>📂 Found {m.searchResults.length} matching document{m.searchResults.length!==1?'s':''}:</div>
                      <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                        {m.searchResults.map(function(res, ri) {
                          var scoreColor = res.matchScore >= 85 ? '#16A34A' : res.matchScore >= 70 ? '#1F4E79' : '#D97706';
                          return (
                            <div key={ri} style={{background:'white',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'12px 14px'}}>
                              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'8px',marginBottom:'6px'}}>
                                <div style={{fontSize:'14px',fontWeight:'700',color:'#111',flex:1}}>{res.title}</div>
                                <div style={{flexShrink:0,background:scoreColor,color:'white',fontSize:'11px',fontWeight:'700',padding:'3px 8px',borderRadius:'6px'}}>{res.matchScore}% match</div>
                              </div>
                              <div style={{fontSize:'12px',color:'#9CA3AF',marginBottom:'6px'}}>{res.department} · {res.docType} · {res.dateCreated} · {res.pageCount} pages</div>
                              <div style={{fontSize:'12px',color:'#374151',marginBottom:'4px',lineHeight:'1.4'}}>{res.summary}</div>
                              <div style={{fontSize:'11px',color:'#6B7280',fontStyle:'italic',marginBottom:'8px'}}>Why this matches: {res.relevanceNote}</div>
                              <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                                {res.publicAvailability === 'available' ? (
                                  <button style={{padding:'5px 10px',fontSize:'11px',background:'#1F4E79',color:'white',border:'none',borderRadius:'6px',cursor:'pointer',fontWeight:'600'}} onClick={function(){alert('Download functionality coming soon. For now, mention this in your request.');}}>⬇ Download</button>
                                ) : null}
                                <button style={{padding:'5px 10px',fontSize:'11px',background:'white',color:'#1F4E79',border:'1px solid #1F4E79',borderRadius:'6px',cursor:'pointer',fontWeight:'600'}} onClick={function(){sendMessage('Yes, please include "' + res.title + '" in my request', false);}}>+ Include in request</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              }
              
              var isUser = m.role === 'user';
              return (
                <div key={i} style={{display:'flex',justifyContent:isUser?'flex-end':'flex-start'}}>
                  <div style={{
                    maxWidth:'78%',
                    padding:'10px 14px',
                    borderRadius:'14px',
                    background: isUser ? '#1F4E79' : '#F3F4F6',
                    color: isUser ? 'white' : '#111',
                    fontSize:'14px',
                    lineHeight:'1.5',
                    whiteSpace:'pre-wrap',
                    wordBreak:'break-word'
                  }} dangerouslySetInnerHTML={{__html: m.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br/>')}}></div>
                </div>
              );
            })}
            {verifyingEmail && (
              <div style={{display:'flex',justifyContent:'flex-start'}}>
                <div style={{padding:'12px 16px',borderRadius:'14px',background:'#FFFBEB',border:'1px solid #FDE68A',color:'#92400E',fontSize:'13px',maxWidth:'78%'}}>
                  <div style={{fontWeight:'600',marginBottom:'4px'}}>⏳ Waiting for email verification</div>
                  <div style={{marginBottom:'8px',lineHeight:'1.4'}}>Check your inbox for an email from us and click the verification link.</div>
                  <div style={{display:'flex',gap:'8px',marginTop:'8px'}}>
                    <button onClick={resendVerification} style={{padding:'4px 10px',fontSize:'12px',background:'white',border:'1px solid #FDE68A',borderRadius:'6px',color:'#92400E',cursor:'pointer'}}>Resend email</button>
                    <button onClick={skipVerification} style={{padding:'4px 10px',fontSize:'12px',background:'white',border:'1px solid #FDE68A',borderRadius:'6px',color:'#92400E',cursor:'pointer'}}>Skip verification</button>
                  </div>
                </div>
              </div>
            )}
            {sending && (
              <div style={{display:'flex',justifyContent:'flex-start'}}>
                <div style={{padding:'10px 14px',borderRadius:'14px',background:'#F3F4F6',color:'#6B7280',fontSize:'14px'}}>
                  <span style={{display:'inline-block',animation:'pulse 1.5s infinite'}}>●●●</span>
                </div>
              </div>
            )}
          </div>

          <form onSubmit={handleSend} style={{borderTop:'1px solid #E5E7EB',padding:'14px',display:'flex',gap:'8px'}}>
            <textarea
              value={input}
              onChange={function(e){setInput(e.target.value);}}
              onKeyDown={handleKey}
              placeholder="Type your message..."
              disabled={sending}
              rows={1}
              style={{flex:1,padding:'10px 14px',border:'1px solid #E5E7EB',borderRadius:'10px',fontSize:'14px',outline:'none',resize:'none',fontFamily:'inherit',maxHeight:'120px'}}
            />
            <button type="submit" disabled={!input.trim()||sending}
              style={{padding:'10px 18px',background: (!input.trim()||sending) ? '#D1D5DB' : '#1F4E79',color:'white',border:'none',borderRadius:'10px',fontSize:'14px',fontWeight:'600',cursor:(!input.trim()||sending)?'not-allowed':'pointer'}}>
              Send
            </button>
          </form>
        </div>
        )}

        <div style={{textAlign:'center',marginTop:'8px',fontSize:'11px',color:'#9CA3AF',flexShrink:0}}>
          AI-assisted intake · Your conversation helps us route your request correctly · Not legal advice
        </div>
      </div>
    </div>
  );
}
