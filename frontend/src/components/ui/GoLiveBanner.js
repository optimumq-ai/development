import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { C } from '../../lib/theme';
import { G } from '../primitives';
import { useAuthStore } from '../../store/authStore';

// BW9a — the Director's go-live banner (Kevin 2026-08-11: the gate summary surfaces on the
// Director's home until the city is ready, then disappears). Renders only for Director/SysAdmin,
// only while something on the checklist is open (or the final flip has not been made), and stays
// silent on any error — a dashboard must not break because an admin endpoint refused.
export default function GoLiveBanner() {
  var store = useAuthStore();
  var [s, setS] = useState(null);
  var show = store.hasAuthority('go_live');   // v3 (S2): whoever may flip go-live sees the board
  useEffect(function () {
    if (!show) return undefined;
    var alive = true;
    import('../../lib/api').then(function (m) {
      m.default.get('/jurisdiction-profile/go-live')
        .then(function (r) { if (alive) setS(r.data); })
        .catch(function () { /* silent — the dashboard must not care */ });
    });
    return function () { alive = false; };
  }, [show]);
  if (!show || !s) return null;
  if (s.ready && s.live) return null; // green board, enforcement on — nothing to say
  var bits = [];
  if (s.unconfirmedSettings > 0) bits.push(s.unconfirmedSettings + ' policy setting(s) unconfirmed');
  if (s.proposalsPending > 0) bits.push(s.proposalsPending + ' proposal(s) pending');
  if (s.activeBranchUnconfirmed && s.activeBranchUnconfirmed.length > 0) bits.push(s.activeBranchUnconfirmed.length + ' active branch(es) on an unconfirmed parameter');
  if (s.sectionsAttested < s.sectionsTotal) bits.push((s.sectionsTotal - s.sectionsAttested) + ' section(s) unattested');
  if (s.devMode) bits.push('enforcement in dev mode');
  return (
    <div style={{ border: '1px solid ' + G.amberLine, background: G.amberBg, borderRadius: 8,
      padding: '10px 14px', margin: '0 0 14px', display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: G.amberInk, letterSpacing: '.04em', textTransform: 'uppercase' }}>
        {s.ready ? 'Ready for go-live' : 'Go-live checklist open'}
      </span>
      <span style={{ fontSize: 12.5, color: C.ink }}>{bits.join(' · ') || 'the final enforcement flip has not been made'}</span>
      <Link to="/jurisdiction-config" style={{ fontSize: 12.5, fontWeight: 600, color: C.blue, marginLeft: 'auto' }}>
        Open the checklist →
      </Link>
    </div>
  );
}
