import axios from 'axios';
const api = axios.create({ baseURL: '/api', withCredentials: true });
api.interceptors.request.use(config => { const t = localStorage.getItem('oq_token'); if (t) config.headers.Authorization = `Bearer ${t}`; return config; });
api.interceptors.response.use(res => res, err => { if (err.response?.status === 401) { localStorage.removeItem('oq_token'); window.location.href = '/login'; } return Promise.reject(err); });
export default api;
