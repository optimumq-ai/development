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
import DepartmentsPage from './pages/DepartmentsPage';
import TaxonomyPage from './pages/TaxonomyPage';
import SchemaDiscoveryPage from './pages/SchemaDiscoveryPage';
import MyTasksPage from './pages/MyTasksPage';
import ConfigurationPage from './pages/ConfigurationPage';
import SourcesPage from './pages/SourcesPage';
import ARIAReportsPage from './pages/ARIAReportsPage';
import RedactionRulesPage from './pages/RedactionRulesPage';
import RedactionWorkspacePage from './pages/RedactionWorkspacePage';
import PublicPortalPage from './pages/PublicPortalPage';

function Guard({ c }) {
  const store = useAuthStore();
  if (!store.isAuthenticated) return React.createElement(Navigate, { to: '/login', replace: true });
  if (!store.user) return React.createElement('div', { style:{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'#9CA3AF',fontSize:'14px' } }, 'Loading...');
  return c;
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
  useEffect(function() { store.loadConfig(); }, []);
  useEffect(function() { if (store.isAuthenticated && !store.user) store.refreshUser(); }, [store.isAuthenticated]);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/portal" element={<PublicPortalPage />} />
        <Route path="/" element={<Guard c={<AppLayout />} />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="requests" element={<RequestQueuePage />} />
          <Route path="requests/new" element={<NewRequestPage />} />
          <Route path="requests/:id" element={<RequestWorkspacePage />} />
          <Route path="my-tasks" element={<MyTasksPage />} />
          <Route path="reports" element={<ARIAReportsPage />} />
          <Route path="staff" element={<StaffManagementPage />} />
          <Route path="departments" element={<DepartmentsPage />} />
          <Route path="taxonomy" element={<TaxonomyPage />} />
          <Route path="discovery" element={<SchemaDiscoveryPage />} />
          <Route path="sources" element={<SourcesPage />} />
          <Route path="redaction-rules" element={<RedactionRulesPage />} />
          <Route path="redact/:fileId" element={<RedactionWorkspacePage />} />
          <Route path="config" element={<ConfigurationPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
