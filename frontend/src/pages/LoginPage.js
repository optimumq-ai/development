import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export default function LoginPage() {
  const nav = useNavigate();
  const store = useAuthStore();
  const [step, setStep] = useState('login');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [mfa, setMfa] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confPw, setConfPw] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { store.loadConfig(); if (store.isAuthenticated) nav('/dashboard'); }, []);

  async function handleLogin(e) {
    e.preventDefault(); setErr(''); setLoading(true);
    const r = await store.login(email, pw); setLoading(false);
    if (r.error) { setErr(r.error); return; }
    if (r.requiresMfa) { setStep('mfa'); return; }
    if (r.requiresPasswordChange) { setStep('pwd'); return; }
    nav('/dashboard');
  }
  async function handleMfa(e) {
    e.preventDefault(); setErr(''); setLoading(true);
    const r = await store.verifyMfa(mfa); setLoading(false);
    if (r.error) { setErr(r.error); setMfa(''); return; }
    nav('/dashboard');
  }
  async function handlePwd(e) {
    e.preventDefault(); setErr('');
    if (newPw !== confPw) { setErr('Passwords do not match'); return; }
    if (newPw.length < 10) { setErr('Minimum 10 characters'); return; }
    setLoading(true);
    try {
      const api = (await import('../lib/api')).default;
      await api.post('/auth/password/change', { newPassword: newPw });
      nav('/dashboard');
    } catch (e) { setErr(e.response?.data?.error || 'Failed'); }
    setLoading(false);
  }

  const agencyName = store.agencyName;
  const wrap = { minHeight: '100vh', background: 'linear-gradient(135deg,#1F4E79,#2E75B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' };
  const card = { background: 'white', borderRadius: '20px', padding: '32px', boxShadow: '0 20px 60px rgba(0,0,0,.2)', width: '100%', maxWidth: '400px' };
  const inp = { width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' };
  const btn = { width: '100%', padding: '12px', background: '#1F4E79', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '600', cursor: 'pointer', marginBottom: '8px' };
  const errBox = { background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '8px', padding: '12px', fontSize: '14px', color: '#DC2626', marginBottom: '16px' };

  return (
    <div style={wrap}>
      <div style={{ width: '100%', maxWidth: '420px' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ display: 'inline-flex', width: '64px', height: '64px', background: 'white', borderRadius: '16px', alignItems: 'center', justifyContent: 'center', marginBottom: '16px', boxShadow: '0 4px 24px rgba(0,0,0,.15)' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#1F4E79" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <h1 style={{ color: 'white', fontSize: '28px', fontWeight: '700', margin: '0 0 4px' }}>OPTIMUM Q</h1>
          <p style={{ color: 'rgba(255,255,255,.75)', fontSize: '14px', margin: 0 }}>{agencyName} · Public Records</p>
        </div>
        <div style={card}>
          {step === 'login' && (
            <>
              <h2 style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 4px' }}>Staff Sign In</h2>
              <p style={{ color: '#9CA3AF', fontSize: '14px', margin: '0 0 24px' }}>Enter your credentials to continue</p>
              <form onSubmit={handleLogin}>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '6px' }}>Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inp} placeholder="you@agency.gov" required autoFocus />
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '6px' }}>Password</label>
                  <div style={{ position: 'relative' }}>
                    <input type={showPw ? 'text' : 'password'} value={pw} onChange={e => setPw(e.target.value)} style={{ ...inp, paddingRight: '50px' }} placeholder="••••••••••" required />
                    <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: '11px', fontWeight: '600' }}>
                      {showPw ? 'HIDE' : 'SHOW'}
                    </button>
                  </div>
                </div>
                {err && <div style={errBox}>{err}</div>}
                <button type="submit" disabled={loading} style={btn}>{loading ? 'Signing in…' : 'Sign In'}</button>
              </form>
            </>
          )}
          {step === 'mfa' && (
            <>
              <h2 style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 4px' }}>Two-Factor Auth</h2>
              <p style={{ color: '#9CA3AF', fontSize: '14px', margin: '0 0 24px' }}>Enter the 6-digit code from your authenticator app</p>
              <form onSubmit={handleMfa}>
                <input type="text" value={mfa} onChange={e => setMfa(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  style={{ ...inp, textAlign: 'center', fontSize: '28px', letterSpacing: '12px', fontFamily: 'monospace', marginBottom: '16px' }}
                  placeholder="000000" maxLength={6} autoFocus required />
                {err && <div style={errBox}>{err}</div>}
                <button type="submit" disabled={loading || mfa.length !== 6} style={btn}>{loading ? 'Verifying…' : 'Verify'}</button>
                <button type="button" onClick={() => { setStep('login'); setErr(''); }} style={{ ...btn, background: 'white', color: '#374151', border: '1px solid #D1D5DB' }}>Back to login</button>
              </form>
            </>
          )}
          {step === 'pwd' && (
            <>
              <h2 style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 4px' }}>Set New Password</h2>
              <p style={{ color: '#9CA3AF', fontSize: '14px', margin: '0 0 24px' }}>Required before continuing — minimum 10 characters</p>
              <form onSubmit={handlePwd}>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '6px' }}>New Password</label>
                  <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} style={inp} placeholder="Minimum 10 characters" required autoFocus />
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '6px' }}>Confirm Password</label>
                  <input type="password" value={confPw} onChange={e => setConfPw(e.target.value)} style={inp} placeholder="Repeat new password" required />
                </div>
                {err && <div style={errBox}>{err}</div>}
                <button type="submit" disabled={loading} style={btn}>{loading ? 'Saving…' : 'Set Password & Continue'}</button>
              </form>
            </>
          )}
        </div>
        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,.5)', fontSize: '12px', marginTop: '24px' }}>optimumq.ai · Secure Public Records Management</p>
      </div>
    </div>
  );
}
