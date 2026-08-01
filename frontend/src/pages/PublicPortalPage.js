import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const API = (process.env.REACT_APP_API_URL || '/api');

// Public portal landing chooser: Public Ready Records Library vs. Create an Open Records Request.
// The request path opens the split-canvas intake at /portal/request (cut over 2026-07-10; the former
// in-page chat-first request flow was retired — see SPEC_public_portal_intake.md §2 / §2b).
export default function PublicPortalPage() {
  const [agencyName, setAgencyName] = useState('');
  const navigate = useNavigate();

  useEffect(function () {
    axios.get(API + '/requests/public/config').then(function (r) {
      setAgencyName(r.data.agency_name || 'this Agency');
    }).catch(function () { setAgencyName('this Agency'); });
  }, []);

  // Deep-link support: /portal?start=request jumps straight to the request flow.
  useEffect(function () {
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get('start') === 'request') { navigate('/portal/request', { replace: true }); }
    } catch (e) {}
  }, [navigate]);

  function startRequest() { navigate('/portal/request'); }

  var buttonStyle = { flexShrink: 0, padding: '16px 26px', borderRadius: '10px', border: 'none', background: '#1F4E79', color: 'white', fontSize: '15px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap', width: '340px', textAlign: 'center', marginRight: '-24px', boxShadow: '0 2px 10px rgba(31,78,121,0.25)' };
  var blurbStyle = { flex: 1, minWidth: '260px', fontSize: '16px', color: '#374151', lineHeight: '1.6', margin: 0, textAlign: 'left' };
  var rowStyle = { display: 'flex', alignItems: 'center', gap: '28px', padding: '22px 0', borderTop: '1px solid #E5E7EB', flexWrap: 'wrap' };

  return (
    <div style={{ minHeight: '100vh', background: '#F9FAFB', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: 'white', borderBottom: '1px solid #E5E7EB', padding: '16px 24px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '40px', height: '40px', background: '#1F4E79', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '18px', fontWeight: '700' }}>OQ</div>
          <div>
            <div style={{ fontSize: '15px', fontWeight: '700', color: '#1F4E79' }}>{agencyName}</div>
            <div style={{ fontSize: '13px', color: '#4B5563' }}>Public Records Portal</div>
          </div>
        </div>
      </header>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
        <div style={{ maxWidth: '860px', width: '100%', textAlign: 'center' }}>
          <h1 style={{ fontSize: '32px', fontWeight: '800', color: '#1F4E79', margin: '0 0 30px', lineHeight: '1.2', textAlign: 'center' }}>Welcome to the {agencyName}<br />Public Records Portal</h1>
          <div style={rowStyle}>
            <p style={blurbStyle}>
              The <strong>Public Ready Records Library</strong> contains records that have been processed and are ready for immediate download. You can browse records, or use the search tool if you're seeking a specific record.
            </p>
            <button onClick={function () { navigate('/portal/library'); }} style={buttonStyle}>Access Public Ready Records Library</button>
          </div>
          <div style={rowStyle}>
            <p style={blurbStyle}>
              The <strong>Open Records Request Portal</strong> lets you submit a formal request for records not currently available in the Public Ready Records Library. An AI-powered agent helps refine your description for the best possible match. If you're unable to locate an exact match, you can still submit the request for processing by the Open Records team.
            </p>
            <button onClick={startRequest} style={buttonStyle}>Create an Open Records Request</button>
          </div>
          {/* The paper channel (Kevin, 2026-08-01): the printable twin of the wizard — page 1 requestor
              info + one page per record, so a mailed or walked-in form logs in the same shape. */}
          <div style={{ marginTop: '18px', fontSize: '13px', color: '#4B5563' }}>
            Prefer paper? <a href="/portal/form" style={{ color: '#1F4E79', fontWeight: '600' }}>Download a printable request form</a>
            {' '}— complete it and mail or deliver it to our office.
          </div>
        </div>
      </div>
    </div>
  );
}
