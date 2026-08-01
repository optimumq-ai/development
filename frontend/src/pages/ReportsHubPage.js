import React from 'react';
import { useSearchParams } from 'react-router-dom';
import ARIAReportsPage from './ARIAReportsPage';
import AIReportingPage from './AIReportingPage';

// REPORTS (2026-08-01, Kevin's menu reorganization): one panel item, two report surfaces — ARIA's
// canned reports and the AI reporting workbench — switched by top tabs. Two screens giving the
// illusion of one; neither was rewritten, only re-homed. /ai-reporting redirects here with ?tab=ai.
const TABS = [
  { key: 'aria', label: 'ARIA Reports', el: ARIAReportsPage },
  { key: 'ai',   label: 'AI Reporting', el: AIReportingPage },
];

export default function ReportsHubPage() {
  const [params, setParams] = useSearchParams();
  const active = TABS.find(function (t) { return t.key === params.get('tab'); }) || TABS[0];
  const Body = active.el;
  return (
    <div>
      <div style={{ display: 'flex', gap: '4px', borderBottom: '2px solid #E5E7EB', marginBottom: '20px' }}>
        {TABS.map(function (t) {
          const on = t.key === active.key;
          return (
            <button key={t.key} onClick={function () { setParams({ tab: t.key }); }}
              style={{ padding: '9px 18px', border: 'none', borderBottom: '2px solid ' + (on ? '#1F4E79' : 'transparent'),
                marginBottom: '-2px', background: 'none', color: on ? '#1F4E79' : '#6B7280',
                fontSize: '14px', fontWeight: on ? '700' : '500', cursor: 'pointer' }}>
              {t.label}
            </button>
          );
        })}
      </div>
      <Body />
    </div>
  );
}
