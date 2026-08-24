import { create } from 'zustand';
import api from '../lib/api';

export const useAuthStore = create(function(set, get) {
  return {
    user: null,
    isAuthenticated: !!localStorage.getItem('oq_token'),
    agencyName: 'Optimum Q',
    login: async function(email, password) {
      try {
        var r = await api.post('/auth/login', { email: email, password: password });
        var d = r.data;
        if (d.requiresMfa) { localStorage.setItem('oq_token', d.preAuthToken); return d; }
        localStorage.setItem('oq_token', d.accessToken);
        set({ user: d.user, isAuthenticated: true });
        return d;
      } catch(e) { return { error: (e.response && e.response.data && e.response.data.error) || 'Login failed' }; }
    },
    verifyMfa: async function(token) {
      try {
        var r = await api.post('/auth/mfa/verify', { token: token });
        localStorage.setItem('oq_token', r.data.accessToken);
        set({ user: r.data.user, isAuthenticated: true });
        return {};
      } catch(e) { return { error: (e.response && e.response.data && e.response.data.error) || 'MFA failed' }; }
    },
    logout: async function() {
      try { await api.post('/auth/logout', {}); } catch(e) {}
      localStorage.removeItem('oq_token');
      set({ user: null, isAuthenticated: false });
    },
    loadConfig: async function() {
      try {
        var r = await api.get('/auth/config');
        set({ agencyName: r.data.agencyName });
      } catch(e) {}
    },
    refreshUser: async function() {
      try {
        var r = await api.get('/auth/me');
        set({ user: r.data.user, isAuthenticated: true });
      } catch(e) { set({ isAuthenticated: false }); }
    },
    hasRole: function(role) {
      var u = get().user;
      if (!u || !u.functionRoles) return false;
      return u.functionRoles.indexOf(role) !== -1;
    },
    hasAnyRole: function() {
      var roles = Array.prototype.slice.call(arguments);
      var u = get().user;
      if (!u || !u.functionRoles) return false;
      for (var i = 0; i < roles.length; i++) {
        if (u.functionRoles.indexOf(roles[i]) !== -1) return true;
      }
      return false;
    },
    // v3 user-type model (SPEC_user_type_model §7, S2): /auth/me carries authorities, permissionGroups, inOro.
    // New screens gate on these; hasRole/hasAnyRole/hasAnyPerm are the legacy shim and go away in S4/S5.
    hasAuthority: function(key) {
      var u = get().user;
      return !!(u && Array.isArray(u.authorities) && u.authorities.indexOf(key) !== -1);
    },
    hasPermission: function() {
      var groups = Array.prototype.slice.call(arguments);
      var u = get().user;
      if (!u || !Array.isArray(u.permissionGroups)) return false;
      for (var i = 0; i < groups.length; i++) { if (u.permissionGroups.indexOf(groups[i]) !== -1) return true; }
      return false;
    },
    inOro: function() { var u = get().user; return !!(u && u.inOro); },
    // Capability (permission-role) check, e.g. FINANCE. /auth/me already returns user.permissionRoles;
    // this lets the UI gate on a capability, not just a job title (financial-authority reconciliation, D4 §8).
    hasAnyPerm: function() {
      var perms = Array.prototype.slice.call(arguments);
      var u = get().user;
      if (!u || !u.permissionRoles) return false;
      for (var i = 0; i < perms.length; i++) {
        if (u.permissionRoles.indexOf(perms[i]) !== -1) return true;
      }
      return false;
    }
  };
});
