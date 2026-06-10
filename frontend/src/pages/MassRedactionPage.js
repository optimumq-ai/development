import React, { useEffect, useState } from 'react';
import api from '../lib/api';

export default function MassRedactionPage() {
  var [templates, setTemplates] = useState([]);
  var [loading, setLoading] = useState(true);

  useEffect(function () { load(); }, []);
  async function load() {
    setLoading(true);
    try { var r = await api.get('/redaction-templates'); setTemplates(r.data.templates || []); } catch (e) { console.error(e); }
    setLoading(false);
  }
  async function remove(t) {
    if (!window.confirm('Delete the template "' + t.name + '"? This does not affect any documents already redacted with it.')) return;
    try { await api.delete('/redaction-templates/' + t.id); load(); } catch (e) { alert('Could not delete the template.'); }
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 6px' }}>Mass Redaction</h1>
      <p style={{ color: '#6B7280', fontSize: '13px', margin: '0 0 18px', lineHeight: 1.5 }}>
        Reusable redaction templates for same-format records. Define a template once &mdash; the boxes and the rule each cites &mdash; then reuse it on every document of that form type. The same template can later auto-redact a record pulled into a request before it is released.
      </p>

      <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '10px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: '#1E40AF', lineHeight: 1.5 }}>
        To create a template: open a sample document in the redaction workspace (the <strong>Redact</strong> button on a PDF in a request's Records tab), place your boxes and attach a rule to each, then choose <strong>Save as Reusable Template</strong>.
      </div>

      <div style={{ fontSize: '13px', fontWeight: '700', color: '#374151', marginBottom: '10px' }}>Templates ({templates.length})</div>
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#9CA3AF' }}>Loading templates...</div>
      ) : templates.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', background: 'white', border: '1px dashed #E5E7EB', borderRadius: '12px', color: '#9CA3AF' }}>
          No templates yet. Define one from a sample document in the redaction workspace using "Save as Reusable Template."
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {templates.map(function (t) {
            return (
              <div key={t.id} style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: '700', fontSize: '14.5px', color: '#1F4E79', marginBottom: '3px' }}>{t.name}</div>
                  {t.description ? <div style={{ fontSize: '12.5px', color: '#6B7280', marginBottom: '3px' }}>{t.description}</div> : null}
                  <div style={{ fontSize: '12px', color: '#9CA3AF' }}>
                    {t.zone_count} box{t.zone_count !== 1 ? 'es' : ''}
                    {t.record_type_name ? ' \u00b7 ' + t.record_type_name : ''}
                    {t.source_filename ? ' \u00b7 from ' + t.source_filename : ''}
                    {t.created_at ? ' \u00b7 ' + (t.created_at || '').slice(0, 10) : ''}
                  </div>
                </div>
                <button onClick={function () { remove(t); }} style={{ flexShrink: 0, padding: '7px 12px', borderRadius: '8px', border: '1px solid #FCA5A5', background: 'white', color: '#DC2626', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>Delete</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
