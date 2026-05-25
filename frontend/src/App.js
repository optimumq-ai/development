import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import LoginPage from './pages/LoginPage';
import AppLayout from './components/layout/AppLayout';
import DashboardPage from './pages/DashboardPage';
import RequestQueuePage from './pages/RequestQueuePage';
import NewRequestPage from './pages/NewRequestPage';
import RequestWorkspacePage from './pages/RequestWorkspacePage';
import StaffManagementPage from './pages/StaffManagementPage';

function Guard({ c }) {
  const store = useAuthStore();
  return store.isAuthenticated ? c : React.createElement(Navigate, { to: '/login', replace: true });
}
function Soon({ t }) {
  return React.createElement('div', { style: { display:'flex', alignItems:'center', justifyContent:'center', height:'256px' } },
    React.createElement('div', { style: { textAlign:'center' } },
      React.createElement('div', { style: { fontSize:'48px', marginBottom:'16px' } }, '🚧'),
      React.createElement('h2', { style: { fontSize:'20px', fontWeight:'600', color:'#4B5563', margin:'0 0 8px' } }, t),
      React.createElement('p', { style: { color:'#9CA3AF', fontSize:'14px', margin:0 } }, 'Under active development')
    )
  );
}
export default function App() {
  const store = useAuthStore();
  useEffect(function() { store.loadConfig(); if (store.isAuthenticated) store.refreshUser(); }, []);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Guard c={<AppLayout />} />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="requests" element={<RequestQueuePage />} />
          <Route path="requests/new" element={<NewRequestPage />} />
          <Route path="requests/:id" element={<RequestWorkspacePage />} />
          <Route path="my-tasks" element={<Soon t="My Tasks" />} />
          <Route path="reports" element={<Soon t="ARIA Reporting Agent" />} />
          <Route path="staff" element={<StaffManagementPage />} />
          <Route path="departments" element={<Soon t="Departments" />} />
          <Route path="config" element={<Soon t="Configuration" />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
