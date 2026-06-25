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
  const [selectedRecords, setSelectedRecords] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [agencyName, setAgencyName] = useState('');
  const [lastSearchQuery, setLastSearchQuery] = useState('');
  const [quickReplies, setQuickReplies] = useState([]);
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactDraft, setContactDraft] = useState({ name:'', email:'', phone:'' });
  const [nativeOpen, setNativeOpen] = useState(false);
  const [nativeQuery, setNativeQuery] = useState('');
  const [nativeGroups, setNativeGroups] = useState(null);
  const [nativeSearching, setNativeSearching] = useState(false);
  const [nativeSources, setNativeSources] = useState(null);
  const [nativeSourceId, setNativeSourceId] = useState(null);
  const [nativeSourceName, setNativeSourceName] = useState('');
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

  function toggleRecord(rec) {
    setSelectedRecords(function(prev) {
      var exists = prev.find(function(r){ return r.id === rec.id; });
      if (exists) return prev.filter(function(r){ return r.id !== rec.id; });
      return prev.concat([{ id: rec.id, title: rec.title, sourceSystem: rec.sourceSystem, publicAvailability: rec.publicAvailability }]);
    });
  }
  function isSelected(id) { return selectedRecords.some(function(r){ return r.id === id; }); }

  async function handleFormSubmit(e) {
    e.preventDefault();
    setFormError('');
    if (!formData.requestorName.trim() || !formData.requestorEmail.trim() || !formData.description.trim()) {
      setFormError('Please fill in your name, email, and a description of the records you are requesting.');
      return;
    }
    setFormSubmitting(true);
    try {
      var payload = Object.assign({}, formData, { classification: 'standard', submissionChannel: 'manual_form', selectedRecords: selectedRecords });
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
    // Full history for display (keeps search-result cards visible on screen)
    var displayMessages = isInitial ? [] : messages.concat([{role:'user', content:userText}]);
    if (!isInitial) setMessages(displayMessages);
    // Cleaned history for the API (strip UI-only search cards + extra fields)
    var cleanHistory = messages
      .filter(function(m){ return m.content !== '__SEARCH_RESULTS__'; })
      .map(function(m){ return { role: m.role, content: m.content }; });
    var nextMessages = isInitial ? [{role:'user', content:'Hi'}] : cleanHistory.concat([{role:'user', content:userText}]);
    setInput('');
    setSending(true);
    setQuickReplies([]);
    setShowContactForm(false);
    try {
      var r = await axios.post(API + '/public/chat', { messages: nextMessages, selectedRecords: selectedRecords });
      var assistantMsg = { role: 'assistant', content: r.data.reply };
      var msgsAfter = displayMessages.concat([assistantMsg]);
      if (r.data.searchResults && r.data.searchResults.length > 0) {
        msgsAfter = msgsAfter.concat([{ role: 'assistant', content: '__SEARCH_RESULTS__', searchResults: r.data.searchResults, searchQuery: r.data.searchQuery }]);
      }
      if (r.data.searchQuery) setLastSearchQuery(r.data.searchQuery);
      setQuickReplies(Array.isArray(r.data.quickReplies) ? r.data.quickReplies : []);
      if (r.data.contactForm) { setShowContactForm(true); setContactDraft({ name:'', email:'', phone:'' }); }
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
        var submitData = Object.assign({}, r.data.submission, { classification: 'standard', submissionChannel: 'chat_agent', selectedRecords: selectedRecords });
        var s = await axios.post(API + '/public/submit', submitData);
        setSubmitted(s.data);
      }
    } catch(e) {
      setMessages(displayMessages.concat([{role:'assistant', content:'I had trouble responding. Please try again, or use the form link below.'}]));
    }
    setSending(false);
  }

  async function runNativeSearch(q, sid) {
    var query = (q != null ? q : nativeQuery).trim();
    if (!query || nativeSearching) return;
    var src = (sid !== undefined ? sid : nativeSourceId);
    setNativeQuery(query);
    setNativeSearching(true);
    try {
      var r = await axios.post(API + '/public/native-search', { query: query, sourceId: src === 'ALL' ? null : src });
      setNativeGroups(r.data.groups || []);
    } catch(e) {
      setNativeGroups([]);
    }
    setNativeSearching(false);
  }

  function openNativePanel() {
    var seed = (nativeQuery || lastSearchQuery || '').trim();
    setNativeOpen(true);
    setNativeGroups(null);
    setNativeSourceId(null);
    setNativeSourceName('');
    setNativeQuery(seed);
    loadNativeSources();
  }

  async function loadNativeSources() {
    setNativeSources(null);
    try {
      var r = await axios.get(API + '/public/sources');
      setNativeSources(r.data.sources || []);
    } catch(e) {
      setNativeSources([]);
    }
  }

  function pickSource(id, name) {
    setNativeSourceId(id);
    setNativeSourceName(name);
    setNativeGroups(null);
    var seed = (nativeQuery || '').trim();
    if (seed) runNativeSearch(seed, id);
  }

  function handleSend(e) {
    if (e) e.preventDefault();
    if (!input.trim() || sending) return;
    sendMessage(input.trim(), false);
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function submitContact() {
    if (sending) return;
    var nm = contactDraft.name.trim();
    var em = contactDraft.email.trim();
    var ph = contactDraft.phone.trim();
    if (!nm || !em) return;
    var msg = 'My contact information: Name: ' + nm + ', Email: ' + em + (ph ? ', Phone: ' + ph : ' (no phone provided)') + '.';
    sendMessage(msg, false);
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
        {messages.length === 0 && !showForm ? (
        <div style={{background:'white',borderRadius:'12px',padding:'12px 16px',marginBottom:'12px',border:'1px solid #E5E7EB',flexShrink:0}}>
          <h1 style={{fontSize:'17px',fontWeight:'700',color:'#1F4E79',margin:'0 0 6px'}}>Welcome to the {agencyName} Public Records Self-Service Portal</h1>
          <p style={{fontSize:'13px',color:'#374151',margin:'0 0 10px',lineHeight:'1.5'}}>
            Our AI assistant will guide you through a brief conversation to understand exactly what records you are looking for.
          </p>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))',gap:'8px',marginBottom:'8px'}}>
            <div style={{fontSize:'12px',color:'#374151',lineHeight:'1.4'}}>
              <span style={{fontSize:'15px',marginRight:'4px'}}>🔍</span>
              <strong>Tell us what you need in plain language</strong> — no legal terms required
            </div>
            <div style={{fontSize:'12px',color:'#374151',lineHeight:'1.4'}}>
              <span style={{fontSize:'15px',marginRight:'4px'}}>⚡</span>
              <strong>Skip the wait when possible</strong> — already-public records may be available for immediate download
            </div>
            <div style={{fontSize:'12px',color:'#374151',lineHeight:'1.4'}}>
              <span style={{fontSize:'15px',marginRight:'4px'}}>📋</span>
              <strong>Or we will route it for you</strong> — your request goes to the right department
            </div>
          </div>
          <div style={{fontSize:'12px',color:'#374151',background:'#EBF3FB',border:'1px solid #C7D9EB',borderRadius:'6px',padding:'8px 10px',marginBottom:'8px',lineHeight:'1.4'}}>
            <span style={{fontSize:'15px',marginRight:'4px'}}>💬</span>
            <strong>Have a question?</strong> Ask the assistant anytime — about what records exist, how the process works, deadlines, fees, or anything else.
          </div>
          <p style={{fontSize:'12px',color:'#6B7280',margin:0}}>
            Prefer a traditional form? <button onClick={function(){setShowForm(true);}} style={{background:'none',border:'none',color:'#1F4E79',textDecoration:'underline',cursor:'pointer',fontSize:'12px',padding:0}}>Click here</button>.
          </p>
        </div>
        ) : (
        <div style={{background:'white',borderRadius:'10px',padding:'8px 14px',marginBottom:'12px',border:'1px solid #E5E7EB',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px'}}>
          <div style={{fontSize:'12px',color:'#374151',lineHeight:'1.4'}}><span style={{marginRight:'4px'}}>💬</span>Ask the assistant about records, the process, deadlines, or fees — anytime.</div>
          {!showForm ? <button onClick={function(){setShowForm(true);}} style={{background:'none',border:'none',color:'#1F4E79',textDecoration:'underline',cursor:'pointer',fontSize:'12px',padding:0,whiteSpace:'nowrap'}}>Prefer a form?</button> : null}
        </div>
        )}

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
              if (i === 0 && m.role === 'user' && m.content === 'Hi') return null;
              if (m.content === '__SEARCH_RESULTS__' && m.searchResults) {
                return (
                  <div key={i} ref={i === messages.length - 1 ? searchResultsRef : null} style={{display:'flex',justifyContent:'flex-start',scrollMarginTop:'12px'}}>
                    <div style={{maxWidth:'92%',width:'100%'}}>
                      <div style={{fontSize:'13px',fontWeight:'700',color:'#1F4E79',marginBottom:'10px',padding:'8px 12px',background:'#EBF3FB',borderRadius:'8px',border:'1px solid #C7D9EB'}}>📂 Found {m.searchResults.length} matching record{m.searchResults.length!==1?'s':''}:</div>
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
                                <button onClick={function(){toggleRecord(res);}} style={{padding:'5px 10px',fontSize:'11px',background:isSelected(res.id)?'#16A34A':'white',color:isSelected(res.id)?'white':'#1F4E79',border:'1px solid '+(isSelected(res.id)?'#16A34A':'#1F4E79'),borderRadius:'6px',cursor:'pointer',fontWeight:'600'}}>{isSelected(res.id)?'✓ Added':'+ Include in request'}</button>
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

          {selectedRecords.length > 0 && (
            <div style={{borderTop:'1px solid #E5E7EB',padding:'10px 14px',background:'#F0FDF4'}}>
              <div style={{fontSize:'12px',fontWeight:'700',color:'#166534',marginBottom:'6px'}}>{selectedRecords.length} record{selectedRecords.length!==1?'s':''} selected for your request:</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:'6px',marginBottom:'10px'}}>
                {selectedRecords.map(function(sr){
                  return (
                    <span key={sr.id} style={{display:'inline-flex',alignItems:'center',gap:'6px',background:'white',border:'1px solid #86EFAC',borderRadius:'12px',padding:'3px 8px 3px 10px',fontSize:'11px',color:'#166534'}}>
                      {sr.title}
                      {sr.publicAvailability === 'restricted' ? <span style={{color:'#D97706',fontWeight:'700'}}>(redaction review)</span> : null}
                      <button onClick={function(){setSelectedRecords(function(prev){return prev.filter(function(r){return r.id !== sr.id;});});}} style={{background:'none',border:'none',color:'#9CA3AF',cursor:'pointer',fontSize:'14px',lineHeight:1,padding:0}}>×</button>
                    </span>
                  );
                })}
              </div>
              <div style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'11px',color:'#166534'}}>
                <button
                  onClick={function(){
                    if (sending) return;
                    sendMessage("I'm done selecting records, please continue.", false);
                  }}
                  disabled={sending}
                  style={{background:'#166534',color:'white',border:'none',borderRadius:'6px',padding:'6px 12px',fontSize:'12px',fontWeight:'600',cursor: sending ? 'wait' : 'pointer',opacity: sending ? 0.6 : 1}}
                >
                  ✓ I'm done selecting — continue
                </button>
                <span style={{fontStyle:'italic',color:'#4B7864'}}>or keep browsing and pick more records</span>
              </div>
            </div>
          )}
          {showContactForm && !sending && !verifyingEmail && (
            <div style={{borderTop:'1px solid #E5E7EB',padding:'14px',background:'#F8FAFC'}}>
              <div style={{fontSize:'12px',fontWeight:'700',color:'#1F4E79',marginBottom:'10px',textTransform:'uppercase',letterSpacing:'0.4px'}}>Your contact information</div>
              <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                <div>
                  <label style={{fontSize:'12px',color:'#6B7280',display:'block',marginBottom:'3px'}}>Name</label>
                  <input value={contactDraft.name} onChange={function(e){var v=e.target.value;setContactDraft(function(p){return Object.assign({},p,{name:v});});}} placeholder="Jane Smith" style={{width:'100%',padding:'9px 12px',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'14px',outline:'none',boxSizing:'border-box'}} />
                </div>
                <div>
                  <label style={{fontSize:'12px',color:'#6B7280',display:'block',marginBottom:'3px'}}>Email address</label>
                  <input type="email" value={contactDraft.email} onChange={function(e){var v=e.target.value;setContactDraft(function(p){return Object.assign({},p,{email:v});});}} placeholder="jane@example.com" style={{width:'100%',padding:'9px 12px',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'14px',outline:'none',boxSizing:'border-box'}} />
                </div>
                <div>
                  <label style={{fontSize:'12px',color:'#6B7280',display:'block',marginBottom:'3px'}}>Phone number (optional)</label>
                  <input value={contactDraft.phone} onChange={function(e){var v=e.target.value;setContactDraft(function(p){return Object.assign({},p,{phone:v});});}} placeholder="(555) 123-4567" style={{width:'100%',padding:'9px 12px',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'14px',outline:'none',boxSizing:'border-box'}} />
                </div>
                <button type="button" onClick={submitContact} disabled={!contactDraft.name.trim()||!contactDraft.email.trim()} style={{marginTop:'4px',padding:'10px 16px',background:(!contactDraft.name.trim()||!contactDraft.email.trim())?'#D1D5DB':'#1F4E79',color:'white',border:'none',borderRadius:'8px',fontSize:'14px',fontWeight:'600',cursor:(!contactDraft.name.trim()||!contactDraft.email.trim())?'not-allowed':'pointer'}}>Continue</button>
              </div>
            </div>
          )}
          {quickReplies.length > 0 && !sending && !verifyingEmail && (
            <div style={{borderTop:'1px solid #E5E7EB',padding:'10px 14px',background:'#FAFAFA',display:'flex',flexWrap:'wrap',gap:'8px'}}>
              {quickReplies.map(function(qr, qi){
                return (
                  <button key={qi} type="button" onClick={function(){ if (sending) return; sendMessage(qr, false); }}
                    style={{padding:'8px 14px',fontSize:'13px',fontWeight:'600',background:'white',color:'#1F4E79',border:'1px solid #1F4E79',borderRadius:'18px',cursor:'pointer'}}>
                    {qr}
                  </button>
                );
              })}
            </div>
          )}
          {lastSearchQuery && (
            <div style={{borderTop:'1px solid #E5E7EB',padding:'10px 14px',background:'#FAFAFA',display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
              <span style={{fontSize:'12px',color:'#6B7280'}}>Not seeing the record you need?</span>
              <button type="button" onClick={openNativePanel} style={{padding:'6px 12px',fontSize:'12px',fontWeight:'600',background:'white',color:'#1F4E79',border:'1px solid #1F4E79',borderRadius:'8px',cursor:'pointer'}}>Search connected systems directly</button>
            </div>
          )}
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

        {nativeOpen && (
          <div style={{position:'fixed',inset:0,background:'rgba(17,24,39,0.45)',display:'flex',alignItems:'center',justifyContent:'center',padding:'20px',zIndex:50}}>
            <div style={{background:'white',borderRadius:'14px',width:'100%',maxWidth:'620px',maxHeight:'85vh',display:'flex',flexDirection:'column',overflow:'hidden',boxShadow:'0 12px 48px rgba(0,0,0,0.25)'}}>
              <div style={{padding:'16px 20px',borderBottom:'1px solid #E5E7EB',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div>
                  <div style={{fontSize:'15px',fontWeight:'700',color:'#1F4E79'}}>Search connected systems</div>
                  <div style={{fontSize:'12px',color:'#6B7280',marginTop:'2px'}}>Direct keyword search across all connected record sources</div>
                </div>
                <button onClick={function(){setNativeOpen(false);}} style={{background:'none',border:'none',fontSize:'22px',color:'#9CA3AF',cursor:'pointer',lineHeight:1}}>×</button>
              </div>
              {nativeSourceId === null && (
                <div style={{flex:1,overflowY:'auto',padding:'14px 20px'}}>
                  <div style={{fontSize:'13px',color:'#374151',marginBottom:'12px'}}>Choose a system to search directly. Each one holds different kinds of records.</div>
                  {nativeSources === null && <div style={{color:'#9CA3AF',fontSize:'13px',padding:'10px'}}>Loading systems...</div>}
                  {nativeSources && (
                    <div onClick={function(){pickSource('ALL','All connected sources');}} style={{border:'1px solid #C7D9EB',background:'#F5F9FD',borderRadius:'10px',padding:'12px 14px',marginBottom:'8px',cursor:'pointer'}}>
                      <div style={{fontSize:'14px',fontWeight:'700',color:'#1F4E79'}}>All connected systems</div>
                      <div style={{fontSize:'12px',color:'#374151',marginTop:'4px'}}>Search every connected system at once.</div>
                    </div>
                  )}
                  {nativeSources && nativeSources.map(function(src){
                    return (
                      <div key={src.id} onClick={function(){pickSource(src.id, src.name);}} style={{border:'1px solid #E5E7EB',borderRadius:'10px',padding:'12px 14px',marginBottom:'8px',cursor:'pointer'}}>
                        <div style={{fontSize:'14px',fontWeight:'700',color:'#1F4E79'}}>{src.name}</div>
                        {src.description && <div style={{fontSize:'12px',color:'#374151',marginTop:'4px',lineHeight:'1.4'}}>{src.description}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
              {nativeSourceId !== null && (<>
              <div style={{padding:'10px 20px',borderBottom:'1px solid #F3F4F6'}}>
                <button onClick={function(){setNativeSourceId(null);setNativeGroups(null);}} style={{background:'none',border:'none',color:'#1F4E79',fontSize:'12px',fontWeight:'600',cursor:'pointer',padding:0}}>← Choose a different system</button>
                <div style={{fontSize:'13px',fontWeight:'700',color:'#111',marginTop:'4px'}}>{nativeSourceName}</div>
              </div>
              <div style={{padding:'14px 20px',borderBottom:'1px solid #F3F4F6',display:'flex',gap:'8px'}}>
                <input value={nativeQuery} onChange={function(e){setNativeQuery(e.target.value);}} onKeyDown={function(e){if(e.key==='Enter'){e.preventDefault();runNativeSearch();}}} placeholder="Enter keywords (e.g. building permit 123 Main St)" style={{flex:1,padding:'9px 12px',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'13px',outline:'none'}} />
                <button onClick={function(){runNativeSearch();}} disabled={nativeSearching||!nativeQuery.trim()} style={{padding:'9px 16px',background:(nativeSearching||!nativeQuery.trim())?'#D1D5DB':'#1F4E79',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:(nativeSearching||!nativeQuery.trim())?'not-allowed':'pointer'}}>{nativeSearching?'Searching...':'Search'}</button>
              </div>
              <div style={{flex:1,overflowY:'auto',padding:'16px 20px'}}>
                {nativeSearching && <div style={{textAlign:'center',color:'#6B7280',fontSize:'13px',padding:'20px'}}>Searching connected systems...</div>}
                {!nativeSearching && nativeGroups && nativeGroups.length === 0 && (
                  <div style={{textAlign:'center',padding:'24px 12px'}}>
                    <div style={{fontSize:'13px',color:'#374151',marginBottom:'14px'}}>No records found in the connected systems for that search.</div>
                    <button onClick={function(){setNativeOpen(false);}} style={{padding:'10px 18px',background:'#1F4E79',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>Continue with a formal request</button>
                  </div>
                )}
                {!nativeSearching && nativeGroups === null && <div style={{textAlign:'center',color:'#9CA3AF',fontSize:'13px',padding:'20px'}}>Enter keywords and press Search.</div>}
                {!nativeSearching && nativeGroups && nativeGroups.map(function(g, gi){
                  return (
                    <div key={gi} style={{marginBottom:'18px'}}>
                      <div style={{fontSize:'12px',fontWeight:'700',color:'#1F4E79',textTransform:'uppercase',letterSpacing:'0.4px',marginBottom:'8px',display:'flex',alignItems:'center',gap:'8px'}}>
                        <span>{g.sourceName}</span>
                        <span style={{background:'#EBF3FB',color:'#1F4E79',borderRadius:'10px',padding:'1px 8px',fontSize:'11px',fontWeight:'700'}}>{g.results.length}</span>
                      </div>
                      <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                        {g.results.map(function(res, ri){
                          return (
                            <div key={ri} style={{border:'1px solid #E5E7EB',borderRadius:'10px',padding:'10px 12px'}}>
                              <div style={{display:'flex',justifyContent:'space-between',gap:'8px',marginBottom:'4px'}}>
                                <div style={{fontSize:'13px',fontWeight:'700',color:'#111',flex:1}}>{res.title}</div>
                                {res.publicAvailability === 'restricted' && <span style={{flexShrink:0,fontSize:'10px',fontWeight:'700',color:'#D97706'}}>REDACTION REVIEW</span>}
                                {res.publicAvailability === 'paper' && <span style={{flexShrink:0,fontSize:'10px',fontWeight:'700',color:'#7C3AED'}}>PAPER · ON-SITE</span>}
                              </div>
                              {(res.dateCreated || res.docType || res.department) && <div style={{fontSize:'11px',color:'#9CA3AF',marginBottom:'4px'}}>{[res.docType,res.department,res.dateCreated].filter(Boolean).join(' · ')}</div>}
                              {res.location && <div style={{fontSize:'12px',color:'#5B21B6',background:'#F5F3FF',border:'1px solid #DDD6FE',borderRadius:'6px',padding:'5px 8px',marginBottom:'6px'}}>Location: {res.location}</div>}
                              {res.summary && <div style={{fontSize:'12px',color:'#374151',marginBottom:'6px',lineHeight:'1.4'}}>{res.summary}</div>}
                              {res.matchedTerms && res.matchedTerms.length > 0 && <div style={{fontSize:'11px',color:'#6B7280',marginBottom:'8px'}}>Matched: {res.matchedTerms.join(', ')}</div>}
                              <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                                {res.publicAvailability === 'available' && <button onClick={function(){alert('Download functionality coming soon. For now, include it in your request.');}} style={{padding:'5px 10px',fontSize:'11px',background:'#1F4E79',color:'white',border:'none',borderRadius:'6px',cursor:'pointer',fontWeight:'600'}}>View / Download</button>}
                                <button onClick={function(){toggleRecord(res);}} style={{padding:'5px 10px',fontSize:'11px',background:isSelected(res.id)?'#16A34A':'white',color:isSelected(res.id)?'white':'#1F4E79',border:'1px solid '+(isSelected(res.id)?'#16A34A':'#1F4E79'),borderRadius:'6px',cursor:'pointer',fontWeight:'600'}}>{isSelected(res.id)?'✓ Added':'+ Include in request'}</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              </>)}
              {nativeGroups && nativeGroups.length > 0 && (
                <div style={{padding:'12px 20px',borderTop:'1px solid #E5E7EB',display:'flex',alignItems:'center',justifyContent:'space-between',gap:'10px'}}>
                  <span style={{fontSize:'11px',color:'#6B7280'}}>Selected records carry into your request.</span>
                  <button onClick={function(){setNativeOpen(false);}} style={{padding:'8px 16px',background:'#16A34A',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>Done</button>
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{textAlign:'center',marginTop:'8px',fontSize:'11px',color:'#9CA3AF',flexShrink:0}}>
          AI-assisted intake · Your conversation helps us route your request correctly · Not legal advice
        </div>
      </div>
    </div>
  );
}
