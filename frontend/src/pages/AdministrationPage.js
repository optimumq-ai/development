import React from 'react';
import { useSearchParams, Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import SetupHubPage from './SetupHubPage';
import SetupGuidePage from './SetupGuidePage';

// ADMINISTRATION (2026-08-01, Kevin's menu reorganization): the thirteen technical-setup screens under
// ONE panel item, tabbed — the Organization-tab pattern applied to the config surface. Each tab RENDERS
// the existing page component unchanged; nothing was rewritten, only re-homed. The old standalone URLs
// redirect here with ?tab=, so bookmarks and the help assistant's deep links survive. Iterate on real
// third-party user feedback before calling the grouping final.
const TABS = [
  // H1 (2026-08-25): the Setup & Configuration HUB replaces the 7-phase wizard as the front door (SPEC_setup_hub.md).
  // Kevin 2026-08-30: the hub tab is 'Settings and Configuration'; 'Set Up Guide' is Plan A (the dependency
  // gantt, docs/mockups/setup_hub/PlanGantt.dc.html) driven by the same hub data — the first step of retiring
  // the Jurisdiction Configuration screen.
  { key: 'setup',        label: 'Settings and Configuration', el: SetupHubPage },
  { key: 'guide',        label: 'Set Up Guide',         el: SetupGuidePage },
  // C10–C11 (Kevin 2026-08-30): the v1 Configuration tab is RETIRED — its six sections are dedicated /setup
  // screens behind hub rows (authentication, notifications, video-redaction, time-capture, time-budgets,
  // agent-rules); ?tab=config lands on the hub.
  // C16 (Kevin 2026-08-30): the Update Configuration and Redaction Rules tabs are RETIRED — /setup screens.
  // C4 (Kevin 2026-08-29) hid the v1 "Fee Configuration" rate-table tab; C9 (Kevin 2026-08-30) RETIRED it — the
  // screen was blank and Fee rules (/setup/fee-law) is the fee schedule now. /fee-config and ?tab=fees land on Fee rules.
  // C7 cleanup (Kevin 2026-08-29): the nav tab is gone — the hub's Taxonomy row (System Features and
  // Options) and the calibration row are the doors; ?tab=taxonomy stays routable.
  // C17 (Kevin 2026-08-30): the hidden Taxonomy and User Types tabs are RETIRED — /setup/taxonomy, /setup/user-types.
  // C15 (Kevin 2026-08-30): the Workflow and Process Map tabs are RETIRED — /setup/workflow-rules and /setup/process-map.
  // C14 (Kevin 2026-08-30): the Sources tab is RETIRED — Record Sources and Connectors is /setup/record-sources.
  // C3 (2026-08-29) hid the Integrations tab; C12 (Kevin 2026-08-30) RETIRED it and the AI Data Flow tab —
  // both live on the hub's one 'AI configuration' row (/setup/ai-configuration, three tabs).
  // C13 (Kevin 2026-08-30): the Portal Agent Security tab is RETIRED — its reference content is the AI
  // configuration screen's fourth tab, "AI Portal Security Information".
  // v3 user-type model (SPEC_user_type_model §10.2, S3): the catalog matrix. Visible to anyone who may see Administration.
  // C6 cleanup (Kevin 2026-08-29): the nav tab is gone — reached from the Organization page's Staff tab
  // ("View user types"); ?tab=user-types stays routable.
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
  // RETIRED 2026-08-30 (C11): the v1 Configuration tab — its sections are /setup screens; land on the hub.
  if (activeKey === 'config') return <Navigate to="/admin?tab=setup" replace />;
  // RETIRED 2026-08-30 (C12): the Integrations and AI Data Flow tabs — AI configuration is one /setup screen.
  if (activeKey === 'integrations') return <Navigate to="/setup/ai-configuration?tab=keys" replace />;
  if (activeKey === 'ai-data') return <Navigate to="/setup/ai-configuration?tab=deployment" replace />;
  if (activeKey === 'security') return <Navigate to="/setup/ai-configuration?tab=security" replace />;
  if (activeKey === 'sources') return <Navigate to="/setup/record-sources" replace />;
  if (activeKey === 'workflow') return <Navigate to="/setup/workflow-rules" replace />;
  if (activeKey === 'map') return <Navigate to="/setup/workflow-rules" replace />; // process map DELETED 2026-08-31
  if (activeKey === 'updates') return <Navigate to="/setup/update-configuration" replace />;
  if (activeKey === 'redaction') return <Navigate to="/setup/redaction-rules" replace />;
  if (activeKey === 'taxonomy') return <Navigate to="/setup/taxonomy" replace />;
  if (activeKey === 'user-types') return <Navigate to="/setup/user-types" replace />;
  const active = tabs.find(function (t) { return t.key === activeKey; }) || tabs[0];
  const Body = active.el;
  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 2px' }}>Administration</h1>
        <p style={{ color: 'var(--oq-fg-9ca3af)', fontSize: '13px', margin: 0 }}>Technical setup and configuration — everything that shapes how the system runs.</p>
      </div>
      {/* C17: with every tab but Setup retired, a one-tab strip is noise — render it only when there is a choice. */}
      {tabs.filter(function (t) { return !t.hidden; }).length > 1 ? <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', borderBottom: '2px solid var(--oq-ln-e5e7eb)', marginBottom: '20px' }}>
        {tabs.filter(function (t) { return !t.hidden; }).map(function (t) {
          const on = t.key === active.key;
          return (
            <button key={t.key} onClick={function () { setParams({ tab: t.key }); }}
              style={{ padding: '8px 14px', border: 'none', borderBottom: '2px solid ' + (on ? 'var(--oq-ln-1f4e79)' : 'transparent'),
                marginBottom: '-2px', background: 'none', color: on ? 'var(--oq-fg-1f4e79)' : 'var(--oq-fg-6b7280)',
                fontSize: '13px', fontWeight: on ? '700' : '500', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {t.label}
            </button>
          );
        })}
      </div> : null}
      <Body />
    </div>
  );
}
