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
import OrgPage from './pages/OrgPage';
import AdministrationPage from './pages/AdministrationPage';
import ReportsHubPage from './pages/ReportsHubPage';
import SchemaDiscoveryPage from './pages/SchemaDiscoveryPage';
import MyTasksPage from './pages/MyTasksPage';
import EstimateTaskPage from './pages/EstimateTaskPage';
import TicklerPage from './pages/TicklerPage';
import RedactionWorkspacePage from './pages/RedactionWorkspacePage';
import RedactionTaskPage from './pages/RedactionTaskPage';
import RecordSearchTaskPage from './pages/RecordSearchTaskPage';
import DispositionsPage from './pages/DispositionsPage';
import LegalReviewTaskPage from './pages/LegalReviewTaskPage';
import IntakeReviewTaskPage from './pages/IntakeReviewTaskPage';
// BW6 — the MRR hub. Four levels: overview → master record → child record, plus the assignee's thin
// per-activity view. The manager's three screens are one page tree; the assignee's is deliberately separate.
import MrrActivityTaskPage from './pages/MrrActivityTaskPage';
import MrrMasterPage from './pages/MrrMasterPage';
import MrrChildPage from './pages/MrrChildPage';
import MrrOverviewPage from './pages/MrrOverviewPage';
import StructuredRedactionFieldsPage from './pages/StructuredRedactionFieldsPage';
import ReleasedRecordsPage from './pages/ReleasedRecordsPage';
import PublicLibraryMapPage from './pages/PublicLibraryMapPage';
import MassRedactionPage from './pages/MassRedactionPage';
import CashDrawerPage from './pages/CashDrawerPage';
import ParentFinancialPage from './pages/ParentFinancialPage';
import AvWorkbenchPage from './pages/AvWorkbenchPage';
import PublicPortalPage from './pages/PublicPortalPage';
import PublicPortalWizardPage from './pages/PublicPortalWizardPage';
import ContributePage from './pages/ContributePage';
import PaperFormPage from './pages/PaperFormPage';
import PublicLibraryPage from './pages/PublicLibraryPage';

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
        {/* CUTOVER 2026-07-18 (SPEC §2c): /portal/request serves the wizard. The split-canvas intake,
            kept at /portal/split-canvas for instant rollback, was RETIRED 2026-08-01 (Kevin) — two weeks
            live on the wizard, and the wizard has since grown things a rollback would lose (the token
            verification the ledger anchors on). Its route redirects home like the other legacy paths;
            its form role is covered by the paper form (/portal/form) + staff multi-item entry. */}
        <Route path="/portal/request" element={<PublicPortalWizardPage />} />
        <Route path="/portal/wizard" element={<Navigate to="/portal/request" replace />} />
        <Route path="/portal/split-canvas" element={<Navigate to="/portal/request" replace />} />
        <Route path="/portal/v2" element={<Navigate to="/portal/request" replace />} />
        <Route path="/contribute/:token" element={<ContributePage />} />
        <Route path="/portal/form" element={<PaperFormPage />} />
        <Route path="/portal/library" element={<PublicLibraryPage />} />
        <Route path="/portal/library/map" element={<PublicLibraryMapPage />} />
        {/* Redaction task screen — full-bleed (no app nav) but auth-gated; a redaction task opens here. */}
        <Route path="/redaction/:taskId" element={<Guard c={<RedactionTaskPage />} />} />
        <Route path="/" element={<Guard c={<AppLayout />} />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="library-map" element={<PublicLibraryMapPage />} />
          <Route path="requests" element={<RequestQueuePage />} />
          <Route path="requests/new" element={<NewRequestPage />} />
          <Route path="requests/:id" element={<RequestWorkspacePage />} />
          {/* BW5 — the Disposition record. Informational, reached from the request header. */}
          <Route path="requests/:id/dispositions" element={<DispositionsPage />} />
          {/* BW7 — the parent financial view. TWO DOORS, ONE SCREEN: the request header (any request), and
              the MRR hub's Financial-view button. Both resolve to the PARENT, because money is a parent
              fact (§4.3) and a child route would give the same request two different ledgers. */}
          <Route path="requests/:requestId/financial" element={<ParentFinancialPage />} />
          <Route path="org" element={<OrgPage />} />
          <Route path="my-tasks" element={<MyTasksPage />} />
          <Route path="estimate/:taskId" element={<EstimateTaskPage />} />
          {/* Record-search task screen. Inside the app shell (unlike the full-bleed redaction workstation):
              the searcher works alongside the queue, the redactor works in a focused workspace. */}
          <Route path="record-search/:taskId" element={<RecordSearchTaskPage />} />
          <Route path="legal-review/:taskId" element={<LegalReviewTaskPage />} />
          {/* Intake review (BW3). Inside the app shell for the same reason record search is: the ORO
              Associate works alongside their exceptions queue. */}
          <Route path="intake-review/:taskId" element={<IntakeReviewTaskPage />} />
          <Route path="mrr-activity/:taskId" element={<MrrActivityTaskPage />} />
          <Route path="mrr" element={<MrrOverviewPage />} />
          <Route path="mrr/:taskId" element={<MrrMasterPage />} />
          <Route path="mrr/:taskId/item/:childId" element={<MrrChildPage />} />
          <Route path="tickler" element={<TicklerPage />} />
          <Route path="rule-updates" element={<Navigate to="/admin?tab=updates" replace />} />
          <Route path="jurisdiction-profile" element={<Navigate to="/admin?tab=jurisdiction" replace />} />
          {/* MENU REORGANIZATION 2026-08-01 (Kevin): Reports unified under one item with top tabs;
              the 13 technical-setup screens live under /admin as tabs. Old URLs redirect in, so
              bookmarks and help-assistant deep links survive. The Simulator is DELETED (page, route,
              backend /simulate) — it was far from functional and its menu slot cost more than it paid. */}
          <Route path="reports" element={<ReportsHubPage />} />
          <Route path="ai-reporting" element={<Navigate to="/reports?tab=ai" replace />} />
          <Route path="admin" element={<AdministrationPage />} />
          <Route path="integrations" element={<Navigate to="/admin?tab=integrations" replace />} />
          <Route path="ai-data-flow" element={<Navigate to="/admin?tab=ai-data" replace />} />
          <Route path="portal-security" element={<Navigate to="/admin?tab=security" replace />} />
          <Route path="staff" element={<StaffManagementPage />} />
          <Route path="departments" element={<DepartmentsPage />} />
          <Route path="setup" element={<Navigate to="/admin?tab=setup" replace />} />
          <Route path="taxonomy" element={<Navigate to="/admin?tab=taxonomy" replace />} />
          <Route path="workflow" element={<Navigate to="/admin?tab=workflow" replace />} />
          <Route path="workflow-map" element={<Navigate to="/admin?tab=map" replace />} />
          <Route path="discovery" element={<SchemaDiscoveryPage />} />
          <Route path="sources" element={<Navigate to="/admin?tab=sources" replace />} />
          <Route path="redaction-rules" element={<Navigate to="/admin?tab=redaction" replace />} />
          {/* Redaction TEMPLATE authoring — samples on the SYS-TEMPLATE-SAMPLES pseudo-request, which has
              no task and never will. Citizen records are redacted through /redaction/:taskId instead. */}
          <Route path="redact/:fileId" element={<RedactionWorkspacePage />} />
          <Route path="av-redact/:requestId/:fileId" element={<AvWorkbenchPage />} />
          <Route path="redact-fields/:fileId" element={<StructuredRedactionFieldsPage />} />
          <Route path="released" element={<ReleasedRecordsPage />} />
          <Route path="mass-redaction" element={<MassRedactionPage />} />
          <Route path="fee-config" element={<Navigate to="/admin?tab=fees" replace />} />
          <Route path="cash-drawer" element={<CashDrawerPage />} />
          <Route path="config" element={<Navigate to="/admin?tab=config" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
