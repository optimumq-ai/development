import { create } from 'zustand';
import api from '../lib/api';
import { applyTheme, isTheme } from '../lib/theme';
// A signed-in user's display choice follows the PERSON (users.ui_theme), not the browser: apply it whenever
// the server hands us the user. docs/SPEC_display_theme.md.
function adoptTheme(user) { if (user && isTheme(user.ui_theme)) applyTheme(user.ui_theme); }

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
        adoptTheme(d.user);
        return d;
      } catch(e) { return { error: (e.response && e.response.data && e.response.data.error) || 'Login failed' }; }
    },
    verifyMfa: async function(token) {
      try {
        var r = await api.post('/auth/mfa/verify', { token: token });
        localStorage.setItem('oq_token', r.data.accessToken);
        set({ user: r.data.user, isAuthenticated: true });
        adoptTheme(r.data.user);
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
        adoptTheme(r.data.user);
      } catch(e) { set({ isAuthenticated: false }); }
    },
    // Display theme choice from the account menu: instant on screen, remembered in this browser, saved on the
    // account so it follows the person to any machine. A failed save leaves the screen as chosen (the browser
    // still remembers it) and returns the error for the menu to show.
    setTheme: async function(key) {
      var k = applyTheme(key);
      var u = get().user; if (u) set({ user: Object.assign({}, u, { ui_theme: k }) });
      try { await api.put('/auth/me/display', { theme: k }); return {}; }
      catch(e) { return { error: (e.response && e.response.data && e.response.data.error) || 'Could not save the display choice' }; }
    },
    // v3 user-type model (SPEC_user_type_model §7, S2): /auth/me carries authorities, permissionGroups, inOro.
    // Every screen gates on these (S4); the legacy role helpers were deleted in S5.
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
    hasAnyAuthority: function() {
      var keys = Array.prototype.slice.call(arguments);
      var u = get().user;
      if (!u || !Array.isArray(u.authorities)) return false;
      for (var i = 0; i < keys.length; i++) { if (u.authorities.indexOf(keys[i]) !== -1) return true; }
      return false;
    },
    inOro: function() { var u = get().user; return !!(u && u.inOro); }
  };
});
