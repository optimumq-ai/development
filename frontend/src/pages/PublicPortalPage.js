import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API = (process.env.REACT_APP_API_URL || '/api');

export default function PublicPortalPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [agencyName, setAgencyName] = useState('');
  const scrollRef = useRef(null);

  useEffect(function() {
    axios.get(API + '/requests/public/config').then(function(r) {
      setAgencyName(r.data.agency_name || 'this Agency');
    }).catch(function(){ setAgencyName('this Agency'); });
    sendMessage('', true);
  }, []);

  useEffect(function() {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  async function sendMessage(userText, isInitial) {
    if (submitted) return;
    var nextMessages = isInitial ? [{role:'user', content:'Hi'}] : messages.concat([{role:'user', content:userText}]);
    if (!isInitial) setMessages(nextMessages);
    setInput('');
    setSending(true);
    try {
      var r = await axios.post(API + '/public/chat', { messages: nextMessages });
      var assistantMsg = { role: 'assistant', content: r.data.reply };
      setMessages(nextMessages.concat([assistantMsg]));
      if (r.data.submission) {
        var submitData = Object.assign({}, r.data.submission, { classification: 'standard' });
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

        <div style={{flex:1,background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',display:'flex',flexDirection:'column',minHeight:0,overflow:'hidden'}}>
          <div ref={scrollRef} style={{flex:1,overflowY:'auto',padding:'20px',display:'flex',flexDirection:'column',gap:'12px'}}>
            {messages.map(function(m, i) {
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

        <div style={{textAlign:'center',marginTop:'8px',fontSize:'11px',color:'#9CA3AF',flexShrink:0}}>
          AI-assisted intake · Your conversation helps us route your request correctly · Not legal advice
        </div>
      </div>
    </div>
  );
}
