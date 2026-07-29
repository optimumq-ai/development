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
import SetupPage from './pages/SetupPage';
import TaxonomyPage from './pages/TaxonomyPage';
import WorkflowPage from './pages/WorkflowPage';
import WorkflowMapPage from './pages/WorkflowMapPage';
import WorkflowSimulatorPage from './pages/WorkflowSimulatorPage';
import SchemaDiscoveryPage from './pages/SchemaDiscoveryPage';
import MyTasksPage from './pages/MyTasksPage';
import EstimateTaskPage from './pages/EstimateTaskPage';
import TicklerPage from './pages/TicklerPage';
import RuleUpdatesPage from './pages/RuleUpdatesPage';
import JurisdictionProfilePage from './pages/JurisdictionProfilePage';
import ConfigurationPage from './pages/ConfigurationPage';
import SourcesPage from './pages/SourcesPage';
import ARIAReportsPage from './pages/ARIAReportsPage';
import AIReportingPage from './pages/AIReportingPage';
import IntegrationsPage from './pages/IntegrationsPage';
import AIDataFlowPage from './pages/AIDataFlowPage';
import SecurityPage from './pages/SecurityPage';
import RedactionRulesPage from './pages/RedactionRulesPage';
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
import StructuredRedactionFieldsPage from './pages/StructuredRedactionFieldsPage';
import ReleasedRecordsPage from './pages/ReleasedRecordsPage';
import PublicLibraryMapPage from './pages/PublicLibraryMapPage';
import MassRedactionPage from './pages/MassRedactionPage';
import FeeConfigPage from './pages/FeeConfigPage';
import CashDrawerPage from './pages/CashDrawerPage';
import AvWorkbenchPage from './pages/AvWorkbenchPage';
import PublicPortalPage from './pages/PublicPortalPage';
import PublicPortalV2Page from './pages/PublicPortalV2Page';
import PublicPortalWizardPage from './pages/PublicPortalWizardPage';
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
        {/* Split-canvas intake is the live request flow (cut over 2026-07-10). /portal/v2 kept as a redirect. */}
        {/* CUTOVER 2026-07-18 (SPEC §2c): /portal/request now serves the wizard. Split-canvas kept at
            /portal/split-canvas for instant rollback. /portal/wizard + /portal/v2 redirect to canonical. */}
        <Route path="/portal/request" element={<PublicPortalWizardPage />} />
        <Route path="/portal/wizard" element={<Navigate to="/portal/request" replace />} />
        <Route path="/portal/split-canvas" element={<PublicPortalV2Page />} />
        <Route path="/portal/v2" element={<Navigate to="/portal/request" replace />} />
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
          <Route path="mrr/:taskId" element={<MrrMasterPage />} />
          <Route path="tickler" element={<TicklerPage />} />
          <Route path="rule-updates" element={<RuleUpdatesPage />} />
          <Route path="jurisdiction-profile" element={<JurisdictionProfilePage />} />
          <Route path="reports" element={<ARIAReportsPage />} />
          <Route path="ai-reporting" element={<AIReportingPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="ai-data-flow" element={<AIDataFlowPage />} />
          <Route path="portal-security" element={<SecurityPage />} />
          <Route path="staff" element={<StaffManagementPage />} />
          <Route path="departments" element={<DepartmentsPage />} />
          <Route path="setup" element={<SetupPage />} />
          <Route path="taxonomy" element={<TaxonomyPage />} />
          <Route path="workflow" element={<WorkflowPage />} />
          <Route path="workflow-map" element={<WorkflowMapPage />} />
          <Route path="workflow-sim" element={<WorkflowSimulatorPage />} />
          <Route path="discovery" element={<SchemaDiscoveryPage />} />
          <Route path="sources" element={<SourcesPage />} />
          <Route path="redaction-rules" element={<RedactionRulesPage />} />
          {/* Redaction TEMPLATE authoring — samples on the SYS-TEMPLATE-SAMPLES pseudo-request, which has
              no task and never will. Citizen records are redacted through /redaction/:taskId instead. */}
          <Route path="redact/:fileId" element={<RedactionWorkspacePage />} />
          <Route path="av-redact/:requestId/:fileId" element={<AvWorkbenchPage />} />
          <Route path="redact-fields/:fileId" element={<StructuredRedactionFieldsPage />} />
          <Route path="released" element={<ReleasedRecordsPage />} />
          <Route path="mass-redaction" element={<MassRedactionPage />} />
          <Route path="fee-config" element={<FeeConfigPage />} />
          <Route path="cash-drawer" element={<CashDrawerPage />} />
          <Route path="config" element={<ConfigurationPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
