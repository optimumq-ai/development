import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import api from '../lib/api';
import { STAGE_LABELS as STAGES } from '../lib/stages';
import GoLiveBanner from '../components/ui/GoLiveBanner';

// OPERATIONAL DASHBOARD (SPEC_operational_dashboard.md, design approved by Kevin 2026-08-12 from the
// mockups). A pane grid over ONE ops-summary read: per-user layout with role defaults; late = over the
// task's BUDGET (the early-warning layer), never the statutory clock, which gets its own clearly-labeled
// pane. Recent Requests is retired (redundant with the Request Queue). v2 idiom, scoped styles.
const STYLES = `
.ops{--page:transparent;--panel:#EBF3FB;--surface:#FFFFFF;--civic:#1F4E79;--civic-700:#163A5C;
  --civic-tint:#E7EEF6;--ink:#14202B;--muted:#5B6B7A;--hair:#C9D6E2;
  --warn:#C77A0A;--warn-bg:#FBEFD7;--serious:#B23A3A;--serious-bg:#F9E4E4;
  --critical:#7C1D1D;--critical-bg:#F3D2D2;--ok:#17803D;--ok-bg:#E6F4EC;
  --shadow:0 1px 2px rgba(20,32,43,.06),0 6px 20px rgba(20,32,43,.06);
  max-width:1200px;color:var(--ink);font-size:14px;line-height:1.45}
.ops *{box-sizing:border-box}
.ops .topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:18px}
.ops h1{font-size:24px;font-weight:700;margin:0 0 4px}
.ops .sub{color:#9CA3AF;font-size:14px;margin:0}
.ops .customize{background:white;border:1px solid var(--hair);color:var(--civic);padding:9px 16px;
  border-radius:9px;font-weight:600;font-size:13px;cursor:pointer}
.ops .panes{display:flex;flex-direction:column;gap:16px;margin-top:16px}
.ops .pane{background:var(--panel);border:1px solid var(--hair);border-radius:14px;box-shadow:var(--shadow);padding:18px 20px}
.ops .pane h2{font-size:15px;font-weight:700;margin:0}
.ops .scope{font-size:12px;color:var(--muted);margin:2px 0 14px}
.ops .tiles{display:flex;gap:12px;flex-wrap:wrap}
.ops .tile{flex:1;min-width:118px;background:var(--surface);border:1px solid var(--hair);border-radius:10px;
  padding:12px 14px;text-decoration:none;display:block}
.ops .tile .n{font-size:26px;font-weight:800;color:var(--civic)}
.ops .tile .l{font-size:12px;color:var(--muted);margin-top:2px}
.ops table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--hair);
  border-radius:10px;overflow:hidden}
.ops th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);text-align:right;
  padding:9px 12px;border-bottom:1px solid var(--hair);font-weight:700}
.ops th:first-child{text-align:left}
.ops td{padding:9px 12px;border-bottom:1px solid var(--hair);text-align:right;font-variant-numeric:tabular-nums;font-size:13px}
.ops td:first-child{text-align:left;font-weight:600}
.ops tr:last-child td{border-bottom:none}
.ops .chip{display:inline-block;min-width:34px;text-align:center;padding:2px 8px;border-radius:14px;
  font-size:12px;font-weight:700}
.ops .c-warn{background:var(--warn-bg);color:var(--warn)}
.ops .c-serious{background:var(--serious-bg);color:var(--serious)}
.ops .c-critical{background:var(--critical-bg);color:var(--critical)}
.ops .c-zero{background:var(--civic-tint);color:var(--muted);font-weight:600}
.ops .c-paused{background:var(--surface);border:1px dashed var(--hair);color:var(--muted);font-weight:600}
.ops .legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:var(--muted)}
.ops .hchip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:14px;
  font-size:12px;font-weight:700;white-space:nowrap}
.ops .hchip .dot{width:8px;height:8px;border-radius:50%;flex:none}
.ops .h-ok{background:var(--ok-bg);color:var(--ok)} .ops .h-ok .dot{background:var(--ok)}
.ops .h-warn{background:var(--warn-bg);color:var(--warn)} .ops .h-warn .dot{background:var(--warn)}
.ops .h-bad{background:var(--serious-bg);color:var(--serious)} .ops .h-bad .dot{background:var(--serious)}
.ops .hgrid{display:grid;gap:6px;background:var(--surface);border:1px solid var(--hair);border-radius:10px;padding:14px}
.ops .hgrid .hhdr{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);
  padding:4px 6px;text-align:center;font-weight:700}
.ops .hcell{border-radius:8px;padding:10px 8px;text-align:center;font-size:13px;font-weight:700}
.ops .hcell small{display:block;font-weight:400;font-size:11px;margin-top:2px}
.ops .hc-ok{background:var(--ok-bg);color:var(--ok)} .ops .hc-warn{background:var(--warn-bg);color:var(--warn)}
.ops .hc-bad{background:var(--serious-bg);color:var(--serious)} .ops .hc-none{background:#F0F2F5;color:#9CA3AF}
.ops .hrow{font-size:13.5px;font-weight:700;padding:12px 6px 0}
.ops .hrow small{display:block;font-weight:600;font-size:11.5px}
.ops .strip{display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--hair);
  border-radius:10px;padding:10px 14px;font-size:13px}
.ops .strip b{color:var(--serious)}
.ops .note{font-size:11px;color:var(--muted);margin-top:8px}
.ops-overlay{position:fixed;inset:0;background:rgba(20,32,43,.45);display:flex;align-items:center;
  justify-content:center;padding:20px;z-index:60}
.ops-modal{width:100%;max-width:560px;background:#EBF3FB;border:1px solid #C9D6E2;border-radius:14px;
  box-shadow:0 10px 32px rgba(20,32,43,.18);padding:24px 26px;max-height:86vh;overflow-y:auto}
.ops-modal h2{font-size:20px;font-weight:700;margin:0 0 4px;color:#14202B}
.ops-modal .lede{color:#5B6B7A;font-size:13px;margin:0 0 16px}
.ops-modal .row{display:flex;align-items:flex-start;gap:10px;background:white;border:1px solid #C9D6E2;
  border-radius:10px;padding:12px 14px;margin-bottom:10px;cursor:pointer}
.ops-modal .rt{font-weight:700;font-size:14px;color:#14202B}
.ops-modal .rd{font-size:12px;color:#5B6B7A;margin-top:2px}
.ops-modal .scopebtns{display:flex;gap:6px;margin-top:8px}
.ops-modal .sb{padding:5px 12px;border-radius:8px;border:2px solid #E5E7EB;background:white;font-size:12px;
  font-weight:600;color:#5B6B7A;cursor:pointer}
.ops-modal .sb.on{border-color:#1F4E79;background:#EBF3FB;color:#1F4E79}
.ops-modal .actions{display:flex;gap:12px;justify-content:flex-end;margin-top:14px}
.ops-modal .btn{background:#1F4E79;color:#fff;border:1px solid #1F4E79;padding:10px 18px;border-radius:9px;
  font-weight:600;font-size:14px;cursor:pointer}
.ops-modal .btn.sec{background:transparent;color:#1F4E79}
.ops-modal .err{background:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;padding:10px 12px;
  font-size:13px;color:#DC2626;margin-top:10px}
`;

const NODE_LABELS = { estimate:'Estimate', record_search:'Record search', redaction:'Redaction',
  legal_redaction:'Legal redaction', legal_review:'Legal review', redaction_qa:'Redaction QA',
  fee_waiver:'Fee waiver review', routing_review:'Routing review', intake_review:'Intake review',
  mrr_management:'MRR management', release_review:'Release review', close_approval:'Close approval',
  process_withdrawal:'Withdrawal processing' };
function nodeLabel(t){ return NODE_LABELS[t] || String(t).replace(/_/g,' '); }
function money(n){ return '$' + (Number(n)||0).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2}); }

// WORKLOAD HEALTH (#13, model approved 2026-08-13). Wire statuses keep their snake_case names; these
// are the plain display names. The verdict always travels with its points so the number is explainable.
const HEALTH = {
  on_track:        { cls: 'h-ok',   cell: 'hc-ok',   label: 'On track' },
  needs_attention: { cls: 'h-warn', cell: 'hc-warn', label: 'Needs attention' },
  falling_behind:  { cls: 'h-bad',  cell: 'hc-bad',  label: 'Falling behind' },
};
function HealthChip({ health, big }) {
  if (!health) return null;
  const h = HEALTH[health.status] || HEALTH.on_track;
  return (
    <span className={'hchip ' + h.cls} style={big ? { fontSize: '13px', padding: '5px 13px' } : null}>
      <span className="dot" />{h.label}{health.points ? ' · ' + health.points : ''}
    </span>
  );
}

function LateChips({ late }) {
  const cells = [ ['d1','c-warn','⚠'], ['d2','c-serious','⚠'], ['d2plus','c-critical','⛔'] ];
  return cells.map(([k, cls, icon]) => (
    <td key={k}>{late && late[k] ? <span className={'chip ' + cls}>{late[k]} {icon}</span> : <span className="chip c-zero">—</span>}</td>
  ));
}

function NodesTable({ nodes, showBudget, budgets }) {
  return (
    <table>
      <thead><tr><th>Task node</th><th>In queue</th><th>In process</th><th>Waiting on requestor</th>
        <th>1 day late</th><th>2 days late</th><th>&gt;2 days late</th><th>Health</th></tr></thead>
      <tbody>
        {(nodes || []).length === 0
          ? <tr><td colSpan={8} style={{ textAlign:'center', color:'#9CA3AF' }}>No open tasks</td></tr>
          : nodes.map(n => (
            <tr key={n.taskType}>
              <td>{nodeLabel(n.taskType)}{showBudget && budgets[n.taskType] != null
                ? <span className="note"> (budget {budgets[n.taskType]}d)</span> : null}</td>
              <td>{n.queued || 0}</td>
              <td>{n.inProcess || 0}</td>
              <td>{n.paused ? <span className="chip c-paused">{n.paused} ⏸</span> : <span className="chip c-zero">—</span>}</td>
              <LateChips late={n.late} />
              <td><HealthChip health={n.health} /></td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

export default function DashboardPage() {
  const store = useAuthStore();
  const user = store.user;
  const [stats, setStats] = useState(null);
  const [ops, setOps] = useState(null);
  const [paneCfg, setPaneCfg] = useState(null);
  const [budgets, setBudgets] = useState({});
  const [loading, setLoading] = useState(true);
  const [customizing, setCustomizing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [saveErr, setSaveErr] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/requests/stats/dashboard'),
      api.get('/tasks/ops-summary'),
      api.get('/config/dashboard-panes'),
      api.get('/config/time-budgets').catch(() => ({ data: { budgets: [] } })),
    ]).then(([s, o, p, b]) => {
      setStats(s.data); setOps(o.data); setPaneCfg(p.data);
      const bm = {}; ((b.data && b.data.budgets) || []).forEach(x => { bm[x.task_type] = Number(x.budget_days); });
      setBudgets(bm);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
  const myTeam = () => (ops && ops.teams && (ops.teams.find(t => t.teamId === user?.department_id) || null));
  const scoped = (pane) => (pane.scope === 'all' ? (ops && ops.totals) : (myTeam() || (ops && ops.totals)));
  const scopeLabel = (pane) => pane.scope === 'all' ? 'All fulfillment teams'
    : (myTeam() ? myTeam().teamName : 'All fulfillment teams');

  function teamLateTotals(team) {
    const sum = { d1: 0, d2: 0, d2plus: 0 };
    (team.nodes || []).forEach(n => { sum.d1 += n.late.d1; sum.d2 += n.late.d2; sum.d2plus += n.late.d2plus; });
    return sum;
  }

  function openCustomize() {
    const known = {}; (paneCfg.library || []).forEach(p => { known[p.key] = p; });
    setDraft((paneCfg.library || []).map(lib => {
      const active = (paneCfg.panes || []).find(p => p.key === lib.key);
      return { key: lib.key, label: lib.label, description: lib.description, scopable: lib.scopable,
               on: !!active, scope: (active && active.scope) || 'own' };
    }));
    setSaveErr(''); setCustomizing(true);
  }
  async function saveCustomize() {
    setSaveErr('');
    try {
      const panes = draft.filter(d => d.on).map(d => (d.scopable ? { key: d.key, scope: d.scope } : { key: d.key }));
      const r = await api.put('/config/dashboard-panes', { panes });
      setPaneCfg(cfg => ({ ...cfg, panes: r.data.panes, defaultsApplied: false }));
      setCustomizing(false);
    } catch (e) { setSaveErr((e.response && e.response.data && e.response.data.error) || 'Failed to save.'); }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '256px' }}>
      <div style={{ fontSize: '16px', color: '#6B7280' }}>Loading dashboard...</div>
    </div>
  );

  const genericCards = [
    { label: 'Active Requests', value: stats?.total ?? 0 },
    { label: 'Past Legal Deadline', value: stats?.overdue ?? 0 },
    { label: 'In Redaction', value: stats?.byStage?.redaction_review ?? 0 },
    { label: 'Ready to Deliver', value: stats?.byStage?.delivery ?? 0 },
  ];

  function renderPane(pane, i) {
    const key = pane.key + i;
    if (pane.key === 'health') {
      const teams = pane.scope === 'all' ? (ops.teams || []) : (myTeam() ? [myTeam()] : (ops.teams || []));
      const types = [...new Set(teams.flatMap(t => (t.nodes || []).map(n => n.taskType)))].sort();
      const overall = pane.scope === 'all' ? (ops.totals && ops.totals.health) : (myTeam() && myTeam().health);
      return (
        <div className="pane" key={key}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <h2>Workload health</h2>
            <HealthChip health={overall} big />
          </div>
          <div className="scope">{scopeLabel(pane)} · the color answers "where do I look first" · budget lateness, not the legal deadline</div>
          {types.length === 0 ? <div className="note">No open tasks anywhere — nothing to score.</div> : (
            <div className="hgrid" style={{ gridTemplateColumns: '170px repeat(' + types.length + ', 1fr)' }}>
              <div className="hhdr" />
              {types.map(tt => <div className="hhdr" key={tt}>{nodeLabel(tt)}</div>)}
              {teams.map(t => {
                const byType = {}; (t.nodes || []).forEach(n => { byType[n.taskType] = n; });
                const th = HEALTH[(t.health && t.health.status) || 'on_track'];
                return (
                  <React.Fragment key={t.teamId || 'none'}>
                    <div className="hrow">{t.teamName}
                      <small style={{ color: th === HEALTH.on_track ? 'var(--ok)' : th === HEALTH.needs_attention ? 'var(--warn)' : 'var(--serious)' }}>
                        {th.label}{t.health && t.health.points ? ' · ' + t.health.points : ''}</small></div>
                    {types.map(tt => {
                      const n = byType[tt];
                      if (!n) return <div className="hcell hc-none" key={tt}>—<small>no tasks</small></div>;
                      const h = HEALTH[(n.health && n.health.status) || 'on_track'];
                      const active = (n.queued || 0) + (n.inProcess || 0) + (n.inReview || 0) + (n.paused || 0);
                      const lateBits = [];
                      if (n.late.d1) lateBits.push(n.late.d1 + ' × 1d late');
                      if (n.late.d2) lateBits.push(n.late.d2 + ' × 2d late');
                      if (n.late.d2plus) lateBits.push(n.late.d2plus + ' × >2d late');
                      return (
                        <div className={'hcell ' + h.cell} key={tt}>
                          {n.health && n.health.points ? n.health.points + ' pts' : 'On track'}
                          <small>{lateBits.length ? lateBits.join(', ') : active + ' active'}</small>
                        </div>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </div>
          )}
          <div className="legend">
            <span>Green — nothing over its time budget</span>
            <span>Amber — 1–3 points: something is late, but contained</span>
            <span>Red — 4+ points: badly stuck or slipping at once, act today</span>
            <span>Points: 1 day over = 1 · 2 days = 2 · more than 2 days = 4 · paused tasks never count</span>
          </div>
        </div>
      );
    }
    if (pane.key === 'teamInProcess') {
      const t = scoped(pane);
      const stages = (t && t.stages) || {};
      return (
        <div className="pane" key={key}>
          <h2>Requests in Process</h2>
          <div className="scope">{scopeLabel(pane)}</div>
          <div className="tiles">
            <Link className="tile" to="/requests"><div className="n">{t ? t.activeRequests : 0}</div><div className="l">Active requests</div></Link>
            {Object.keys(STAGES).filter(k => stages[k]).map(k => (
              <Link className="tile" key={k} to={'/requests?stage=' + k}>
                <div className="n">{stages[k]}</div><div className="l">{STAGES[k]}</div></Link>
            ))}
          </div>
        </div>
      );
    }
    if (pane.key === 'taskNodes') {
      const t = scoped(pane);
      return (
        <div className="pane" key={key}>
          <h2>Task Nodes — where the time is going</h2>
          <div className="scope">{scopeLabel(pane)} · late = over the task's budgeted days, not the legal deadline</div>
          <NodesTable nodes={t ? t.nodes : []} showBudget budgets={budgets} />
          <div className="legend">
            <span>⚠ 1 day late — over budget by up to 24h</span>
            <span>⚠ 2 days late — 24–48h over</span>
            <span>⛔ &gt;2 days — more than 48h over</span>
            <span>⏸ paused — waiting on the requestor</span>
          </div>
        </div>
      );
    }
    if (pane.key === 'lateByTeam') {
      return (
        <div className="pane" key={key}>
          <h2>Late by Team — attention map</h2>
          <div className="scope">Every fulfillment team · counts of tasks over budget</div>
          <table>
            <thead><tr><th>Team</th><th>Active</th><th>1 day late</th><th>2 days late</th><th>&gt;2 days late</th><th>Health</th></tr></thead>
            <tbody>
              {(ops.teams || []).map(t => {
                const late = teamLateTotals(t);
                return (
                  <tr key={t.teamId || 'none'}>
                    <td>{t.teamName}</td><td>{t.activeRequests || 0}</td>
                    <LateChips late={late} />
                    <td><HealthChip health={t.health} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="note">Teams appear and disappear here as departments are added or removed — nothing to reconfigure.</div>
        </div>
      );
    }
    if (pane.key === 'finance') {
      const f = ops.finance || {};
      return (
        <div className="pane" key={key}>
          <h2>Finance</h2>
          <div className="scope">All teams · live balances</div>
          <div className="tiles">
            <div className="tile"><div className="n">{money(f.outstandingBalances)}</div><div className="l">Outstanding balances</div></div>
            <div className="tile"><div className="n">{money(f.billedUnpaid)}</div><div className="l">Billed, unpaid</div></div>
            <div className="tile"><div className="n">{money(f.collectedToDate)}</div><div className="l">Collected to date</div></div>
            <div className="tile"><div className="n">{money(f.waivedToDate)}</div><div className="l">Waived to date</div></div>
          </div>
        </div>
      );
    }
    if (pane.key === 'statutory') {
      const n = stats?.overdue ?? 0;
      return (
        <div className="pane" key={key} style={{ padding: '12px 20px' }}>
          <div className="strip">⚖ Legal clock (separate from budgets):&nbsp;
            {n > 0 ? <b>{n} request{n === 1 ? '' : 's'}</b> : <span style={{ color: 'var(--muted)' }}>no requests</span>}
            &nbsp;past the statutory deadline
            <Link to="/requests" style={{ marginLeft: 'auto', color: 'var(--civic)', fontWeight: 600, textDecoration: 'none' }}>Open queue →</Link>
          </div>
        </div>
      );
    }
    // generic
    return (
      <div className="pane" key={key}>
        <h2>Overview</h2>
        <div className="scope">Agency-wide</div>
        <div className="tiles">
          {genericCards.map(c => (
            <Link className="tile" key={c.label} to="/requests"><div className="n">{c.value}</div><div className="l">{c.label}</div></Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="ops">
      <style>{STYLES}</style>
      <div className="topbar">
        <div>
          <h1>{greet()}, {user?.display_name?.split(' ')[0]}</h1>
          <p className="sub">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <button className="customize" onClick={openCustomize}>⚙ Customize panes</button>
      </div>
      <GoLiveBanner />
      <div className="panes">
        {(paneCfg?.panes || []).map(renderPane)}
      </div>

      {customizing && (
        <div className="ops-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setCustomizing(false); }}>
          <div className="ops-modal" role="dialog" aria-modal="true" aria-label="Customize dashboard panes">
            <h2>Customize panes</h2>
            <p className="lede">Pick the panes you want on your dashboard. Team panes can show your own team or every team.</p>
            {draft.map((d, di) => (
              <div className="row" key={d.key} onClick={() => setDraft(list => list.map((x, xi) => xi === di ? { ...x, on: !x.on } : x))}>
                <input type="checkbox" readOnly checked={d.on} style={{ marginTop: '3px' }} />
                <div style={{ flex: 1 }}>
                  <div className="rt">{d.label}</div>
                  <div className="rd">{d.description}</div>
                  {d.scopable && d.on && (
                    <div className="scopebtns" onClick={e => e.stopPropagation()}>
                      {[['own', 'My team'], ['all', 'All teams']].map(([v, l]) => (
                        <button key={v} className={'sb' + (d.scope === v ? ' on' : '')}
                          onClick={() => setDraft(list => list.map((x, xi) => xi === di ? { ...x, scope: v } : x))}>{l}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {saveErr && <div className="err">{saveErr}</div>}
            <div className="actions">
              <button className="btn sec" onClick={() => setCustomizing(false)}>Cancel</button>
              <button className="btn" onClick={saveCustomize}>Save Layout</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
