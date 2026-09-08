import axios from 'axios';
const api = axios.create({ baseURL: '/api', withCredentials: true });
api.interceptors.request.use(config => { const t = localStorage.getItem('oq_token'); if (t) config.headers.Authorization = `Bearer ${t}`; return config; });
// Any successful write (a setup save, an approval, a claim) may have created or withdrawn a notification for
// this user — tell the bell so it refreshes now instead of at its next 60-second poll. Debounced: a screen that
// fires several saves in a row triggers one reload.
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
function pokeNotifications(method?: string) {
  if (!method || method.toLowerCase() === 'get') return;
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => { notifyTimer = null; try { window.dispatchEvent(new Event('oq:notifications-changed')); } catch (e) { /* ignore */ } }, 600);
}
api.interceptors.response.use(res => { pokeNotifications(res.config && res.config.method); return res; }, err => { if (err.response?.status === 401) { localStorage.removeItem('oq_token'); window.location.href = '/login'; } return Promise.reject(err); });
export default api;
