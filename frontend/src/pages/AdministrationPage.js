import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import SetupPage from './SetupPage';
import ConfigurationPage from './ConfigurationPage';
import JurisdictionProfilePage from './JurisdictionProfilePage';
import RuleUpdatesPage from './RuleUpdatesPage';
import FeeConfigPage from './FeeConfigPage';
import TaxonomyPage from './TaxonomyPage';
import WorkflowPage from './WorkflowPage';
import WorkflowMapPage from './WorkflowMapPage';
import SourcesPage from './SourcesPage';
import RedactionRulesPage from './RedactionRulesPage';
import IntegrationsPage from './IntegrationsPage';
import AIDataFlowPage from './AIDataFlowPage';
import SecurityPage from './SecurityPage';

// ADMINISTRATION (2026-08-01, Kevin's menu reorganization): the thirteen technical-setup screens under
// ONE panel item, tabbed — the Organization-tab pattern applied to the config surface. Each tab RENDERS
// the existing page component unchanged; nothing was rewritten, only re-homed. The old standalone URLs
// redirect here with ?tab=, so bookmarks and the help assistant's deep links survive. Iterate on real
// third-party user feedback before calling the grouping final.
const TABS = [
  { key: 'setup',        label: 'Setup',                el: SetupPage },
  { key: 'config',       label: 'Configuration',        el: ConfigurationPage, admin: true },
  { key: 'jurisdiction', label: 'Jurisdiction Profile', el: JurisdictionProfilePage },
  { key: 'updates',      label: 'Update Configuration', el: RuleUpdatesPage },
  { key: 'fees',         label: 'Fee Configuration',    el: FeeConfigPage },
  { key: 'taxonomy',     label: 'Taxonomy',             el: TaxonomyPage },
  { key: 'workflow',     label: 'Workflow',             el: WorkflowPage },
  { key: 'map',          label: 'Process Map',          el: WorkflowMapPage },
  { key: 'sources',      label: 'Sources',              el: SourcesPage },
  { key: 'redaction',    label: 'Redaction Rules',      el: RedactionRulesPage },
  { key: 'integrations', label: 'Integrations & API Keys', el: IntegrationsPage, admin: true },
  { key: 'ai-data',      label: 'AI Data Flow',         el: AIDataFlowPage, admin: true },
  { key: 'security',     label: 'Portal Agent Security', el: SecurityPage, admin: true },
];

export default function AdministrationPage() {
  const [params, setParams] = useSearchParams();
  const store = useAuthStore();
  const isAdmin = store.hasAnyRole('SYSTEM_ADMIN');
  const tabs = TABS.filter(function (t) { return !t.admin || isAdmin; });
  const activeKey = params.get('tab') || tabs[0].key;
  const active = tabs.find(function (t) { return t.key === activeKey; }) || tabs[0];
  const Body = active.el;
  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 2px' }}>Administration</h1>
        <p style={{ color: '#9CA3AF', fontSize: '13px', margin: 0 }}>Technical setup and configuration — everything that shapes how the system runs.</p>
      </div>
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', borderBottom: '2px solid #E5E7EB', marginBottom: '20px' }}>
        {tabs.map(function (t) {
          const on = t.key === active.key;
          return (
            <button key={t.key} onClick={function () { setParams({ tab: t.key }); }}
              style={{ padding: '8px 14px', border: 'none', borderBottom: '2px solid ' + (on ? '#1F4E79' : 'transparent'),
                marginBottom: '-2px', background: 'none', color: on ? '#1F4E79' : '#6B7280',
                fontSize: '13px', fontWeight: on ? '700' : '500', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {t.label}
            </button>
          );
        })}
      </div>
      <Body />
    </div>
  );
}
