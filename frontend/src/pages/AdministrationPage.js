import React from 'react';
import { useSearchParams, Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import SetupHubPage from './SetupHubPage';
import ConfigurationPage from './ConfigurationPage';
import RuleUpdatesPage from './RuleUpdatesPage';
import TaxonomyPage from './TaxonomyPage';
import WorkflowPage from './WorkflowPage';
import WorkflowMapPage from './WorkflowMapPage';
import SourcesPage from './SourcesPage';
import RedactionRulesPage from './RedactionRulesPage';
import IntegrationsPage from './IntegrationsPage';
import AIDataFlowPage from './AIDataFlowPage';
import SecurityPage from './SecurityPage';
import UserTypesPage from './UserTypesPage';

// ADMINISTRATION (2026-08-01, Kevin's menu reorganization): the thirteen technical-setup screens under
// ONE panel item, tabbed — the Organization-tab pattern applied to the config surface. Each tab RENDERS
// the existing page component unchanged; nothing was rewritten, only re-homed. The old standalone URLs
// redirect here with ?tab=, so bookmarks and the help assistant's deep links survive. Iterate on real
// third-party user feedback before calling the grouping final.
const TABS = [
  // H1 (2026-08-25): the Setup & Configuration HUB replaces the 7-phase wizard as the front door (SPEC_setup_hub.md).
  { key: 'setup',        label: 'Setup',                el: SetupHubPage },
  { key: 'config',       label: 'Configuration',        el: ConfigurationPage, admin: true },
  { key: 'updates',      label: 'Update Configuration', el: RuleUpdatesPage },
  // C4 (Kevin 2026-08-29) hid the v1 "Fee Configuration" rate-table tab; C9 (Kevin 2026-08-30) RETIRED it — the
  // screen was blank and Fee rules (/setup/fee-law) is the fee schedule now. /fee-config and ?tab=fees land on Fee rules.
  // C7 cleanup (Kevin 2026-08-29): the nav tab is gone — the hub's Taxonomy row (System Features and
  // Options) and the calibration row are the doors; ?tab=taxonomy stays routable.
  { key: 'taxonomy',     label: 'Taxonomy',             el: TaxonomyPage, hidden: true },
  { key: 'workflow',     label: 'Workflow',             el: WorkflowPage },
  { key: 'map',          label: 'Process Map',          el: WorkflowMapPage },
  { key: 'sources',      label: 'Sources',              el: SourcesPage },
  { key: 'redaction',    label: 'Redaction Rules',      el: RedactionRulesPage },
  // C3 cleanup (Kevin 2026-08-29): the nav tab is gone — the hub's "AI service keys" row is the one door
  // (its ?tab=integrations deep link keeps working via `hidden`); the screen is titled "AI Service Keys".
  { key: 'integrations', label: 'AI Service Keys', el: IntegrationsPage, admin: true, hidden: true },
  { key: 'ai-data',      label: 'AI Data Flow',         el: AIDataFlowPage, admin: true },
  { key: 'security',     label: 'Portal Agent Security', el: SecurityPage, admin: true },
  // v3 user-type model (SPEC_user_type_model §10.2, S3): the catalog matrix. Visible to anyone who may see Administration.
  // C6 cleanup (Kevin 2026-08-29): the nav tab is gone — reached from the Organization page's Staff tab
  // ("View user types"); ?tab=user-types stays routable.
  { key: 'user-types',   label: 'User Types',           el: UserTypesPage, hidden: true },
];

export default function AdministrationPage() {
  const [params, setParams] = useSearchParams();
  const store = useAuthStore();
  const isAdmin = store.hasAuthority('system');   // S4: technical tabs = the system authority (oro_sysadmin)
  const tabs = TABS.filter(function (t) { return !t.admin || isAdmin; });
  const activeKey = params.get('tab') || tabs[0].key;
  // RETIRED 2026-08-12: the v1 Jurisdiction Profile tab. BW9a/BW9b replaced it wholesale — the
  // go-live checklist, section screens and rule editors live at /jurisdiction-config. Deep links
  // (help assistant, bookmarks) land there instead of silently falling to the first tab.
  if (activeKey === 'jurisdiction') return <Navigate to="/jurisdiction-config" replace />;
  // RETIRED 2026-08-30 (C9): the v1 Fee Configuration rate-table tab — Fee rules is the fee schedule now.
  if (activeKey === 'fees') return <Navigate to="/setup/fee-law" replace />;
  const active = tabs.find(function (t) { return t.key === activeKey; }) || tabs[0];
  const Body = active.el;
  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 2px' }}>Administration</h1>
        <p style={{ color: '#9CA3AF', fontSize: '13px', margin: 0 }}>Technical setup and configuration — everything that shapes how the system runs.</p>
      </div>
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', borderBottom: '2px solid #E5E7EB', marginBottom: '20px' }}>
        {tabs.filter(function (t) { return !t.hidden; }).map(function (t) {
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
