import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import SetupScreen, { lbl, hint, Msg, PrimaryButton, BLUE } from '../components/setup/SetupScreen';

// PORTAL AGENT RULES — the hub's `agent_rules` row (C11, Kevin 2026-08-30: the v1 Configuration page's
// Agent Rules tab becomes this dedicated screen under System Features and Options). Plain-English rules
// the public portal assistant follows in every conversation, on top of its core instructions.
// Data: GET/POST/PATCH/DELETE /api/agent-rules (system authority to change).

var ta = { width: '100%', minHeight: '70px', padding: '10px', border: '1px solid var(--oq-ln-d1d5db)', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' };
var small = function (color, border) { return { padding: '5px 10px', fontSize: '12px', background: 'var(--oq-bg-ffffff)', color: color, border: '1px solid ' + border, borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit' }; };

export default function AgentRulesPage() {
  var [rules, setRules] = useState(null);
  var [text, setText] = useState('');
  var [editing, setEditing] = useState(null);
  var [editText, setEditText] = useState('');
  var [msg, setMsg] = useState(null);
  function load() { return api.get('/agent-rules').then(function (r) { setRules(Array.isArray(r.data) ? r.data : []); }).catch(function () { setRules([]); setMsg({ ok: false, text: 'The rules could not be read.' }); }); }
  useEffect(function () { load(); }, []);
  function fail(e) { setMsg({ ok: false, text: (e.response && e.response.data && e.response.data.error) || 'Could not save.' }); }
  async function add(reload) { var t = text.trim(); if (!t) return; setMsg(null); try { await api.post('/agent-rules', { rule_text: t }); setText(''); await load(); await reload(); } catch (e) { fail(e); } }
  async function toggle(id, on, reload) { setMsg(null); try { await api.patch('/agent-rules/' + id, { enabled: on ? 1 : 0 }); await load(); await reload(); } catch (e) { fail(e); } }
  async function saveEdit(id, reload) { setMsg(null); try { await api.patch('/agent-rules/' + id, { rule_text: editText }); setEditing(null); setEditText(''); await load(); await reload(); } catch (e) { fail(e); } }
  async function remove(id, reload) { if (!window.confirm('Delete this rule? The assistant stops following it on its next conversation.')) return; setMsg(null); try { await api.delete('/agent-rules/' + id); await load(); await reload(); } catch (e) { fail(e); } }
  return (
    <SetupScreen hubKey="agent_rules" laneLabel="System Features and Options" title="Portal Agent Rules"
      intro="Plain-English rules that guide the public portal assistant. Use them to correct a recurring confusion, set priorities, or shape how the assistant responds. Every enabled rule applies to every conversation, in addition to the assistant's core instructions.">
      {function (s) {
        if (!rules) return <div style={{ color: 'var(--oq-fg-9ca3af)' }}>Loading…</div>;
        return (
          <div>
            {msg ? <Msg text={msg.text} ok={msg.ok} /> : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              {rules.length === 0 ? <div style={{ fontSize: '13px', color: 'var(--oq-fg-9ca3af)', fontStyle: 'italic', padding: '8px 0' }}>No rules yet. Add one below.</div> : null}
              {rules.map(function (r) {
                var isEditing = editing === r.id;
                return (
                  <div key={r.id} style={{ border: '1px solid var(--oq-ln-d2dce3)', borderRadius: '8px', padding: '12px', background: r.enabled ? 'var(--oq-bg-ffffff)' : 'var(--oq-bg-f9fafb)', opacity: r.enabled ? 1 : 0.65 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <input type="checkbox" checked={r.enabled === 1} disabled={!s.can} onChange={function (e) { toggle(r.id, e.target.checked, s.reload); }} style={{ marginTop: '3px', cursor: 'pointer' }} title={r.enabled ? 'Enabled' : 'Disabled'} />
                      <div style={{ flex: 1 }}>
                        {isEditing
                          ? <textarea value={editText} onChange={function (e) { setEditText(e.target.value); }} style={Object.assign({}, ta, { minHeight: '80px' })} />
                          : <div style={{ fontSize: '13px', color: 'var(--oq-fg-374151)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{r.rule_text}</div>}
                        <div style={{ fontSize: '11px', color: 'var(--oq-fg-8296a4)', marginTop: '6px' }}>{r.created_by ? 'Added by ' + r.created_by : ''} {r.created_at ? '· ' + new Date(r.created_at + 'Z').toLocaleDateString() : ''}</div>
                      </div>
                      {s.can ? (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {isEditing
                            ? <><button type="button" onClick={function () { saveEdit(r.id, s.reload); }} style={Object.assign({}, small('var(--oq-bg-ffffff)', BLUE), { background: BLUE })}>Save</button><button type="button" onClick={function () { setEditing(null); setEditText(''); }} style={small('var(--oq-bg-6b7280)', 'var(--oq-fg-d1d5db)')}>Cancel</button></>
                            : <><button type="button" onClick={function () { setEditing(r.id); setEditText(r.rule_text); }} style={small(BLUE, BLUE)}>Edit</button><button type="button" onClick={function () { remove(r.id, s.reload); }} style={small('var(--oq-bg-b91c1c)', 'var(--oq-fg-fca5a5)')}>Delete</button></>}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ borderTop: '1px solid var(--oq-ln-eef2f5)', paddingTop: '16px' }}>
              <label style={lbl}>Add a rule</label>
              <textarea value={text} disabled={!s.can} onChange={function (e) { setText(e.target.value); }} placeholder='Example: "When a citizen mentions a specific case number, always include that case number verbatim in the search."' style={ta} />
              <div style={hint}>Write it the way you would tell a new staff member.</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}><PrimaryButton disabled={!s.can || !text.trim()} onClick={function () { add(s.reload); }}>Add rule</PrimaryButton></div>
            </div>
          </div>
        );
      }}
    </SetupScreen>
  );
}
