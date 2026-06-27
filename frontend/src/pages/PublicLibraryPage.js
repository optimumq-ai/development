import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API = (process.env.REACT_APP_API_URL || '/api');
const BLUE = '#1F4E79';

export default function PublicLibraryPage() {
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [agencyName, setAgencyName] = useState('');
  const [dept, setDept] = useState(null);
  const [type, setType] = useState(null);
  const [yearFilter, setYearFilter] = useState(null);
  const [records, setRecords] = useState([]);
  const [recLoading, setRecLoading] = useState(false);
  const [record, setRecord] = useState(null);

  useEffect(function () {
    axios.get(API + '/config/public').then(function (r) { setAgencyName((r.data && r.data.agency_name) || 'City'); }).catch(function () {});
    axios.get(API + '/public/browse').then(function (r) { setTree((r.data && r.data.tree) || []); setLoading(false); }).catch(function () { setLoading(false); });
  }, []);

  function openType(t, dp, yr) {
    setType(t); setYearFilter(yr || null); setRecord(null);
    setRecLoading(true); setRecords([]);
    var q = '?recordType=' + encodeURIComponent(t.id || '') + (dp && dp.id ? '&department=' + encodeURIComponent(dp.id) : '') + (yr ? '&year=' + encodeURIComponent(yr) : '');
    axios.get(API + '/public/browse/records' + q).then(function (r) { setRecords((r.data && r.data.records) || []); setRecLoading(false); }).catch(function () { setRecLoading(false); });
  }
  function resetTo(level) {
    if (level === 'root') { setDept(null); setType(null); setRecord(null); setYearFilter(null); }
    else if (level === 'dept') { setType(null); setRecord(null); setYearFilter(null); }
    else if (level === 'type') { setRecord(null); }
  }

  var sPage = { minHeight: '100vh', background: '#F9FAFB', fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif', color: '#374151' };
  var sHeader = { background: 'white', borderBottom: '1px solid #E5E7EB', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
  var sWrap = { maxWidth: '880px', margin: '0 auto', padding: '20px 24px' };
  var sCard = { background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '14px 16px', marginBottom: '10px', cursor: 'pointer', transition: 'border-color .12s' };
  var sCount = { fontSize: '12px', color: '#6B7280', background: '#F3F4F6', borderRadius: '999px', padding: '2px 10px' };
  var sCrumbLink = { color: BLUE, cursor: 'pointer', textDecoration: 'none' };
  var sChip = function (active) { return { fontSize: '12px', padding: '4px 12px', borderRadius: '999px', cursor: 'pointer', marginRight: '6px', border: '1px solid ' + (active ? BLUE : '#D1D5DB'), background: active ? '#EBF3FB' : 'white', color: active ? BLUE : '#374151' }; };

  function Crumbs() {
    return (
      <div style={{ fontSize: '13px', marginBottom: '14px', color: '#6B7280' }}>
        <span style={sCrumbLink} onClick={function () { resetTo('root'); }}>Records Library</span>
        {dept && <span> &nbsp;/&nbsp; <span style={sCrumbLink} onClick={function () { resetTo('dept'); }}>{dept.name}</span></span>}
        {type && <span> &nbsp;/&nbsp; <span style={sCrumbLink} onClick={function () { resetTo('type'); }}>{type.name}</span></span>}
        {record && <span> &nbsp;/&nbsp; <span style={{ color: '#374151' }}>{record.title}</span></span>}
      </div>
    );
  }

  function body() {
    if (loading) return <div style={{ color: '#6B7280', padding: '40px 0', textAlign: 'center' }}>Loading the records library…</div>;
    if (!tree.length) return <div style={{ color: '#6B7280', padding: '40px 0', textAlign: 'center' }}>No released records are available to browse yet.</div>;

    // Record detail
    if (record) {
      return (
        <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '20px 22px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: BLUE, margin: '0 0 6px' }}>{record.title}</h2>
          <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '14px' }}>{type.name}{record.date ? ' · ' + record.date : ''}{record.pageCount ? ' · ' + record.pageCount + ' page' + (record.pageCount > 1 ? 's' : '') : ''}</div>
          <p style={{ fontSize: '14px', lineHeight: 1.6, color: '#374151', margin: '0 0 18px' }}>{record.summary}</p>
          {record.fileId
            ? <a href={API + '/public/file/' + record.fileId} style={{ display: 'inline-block', background: BLUE, color: 'white', fontSize: '13px', fontWeight: 600, padding: '9px 18px', borderRadius: '8px', textDecoration: 'none' }}>Download document</a>
            : <div style={{ fontSize: '12px', color: '#6B7280', background: '#F3F4F6', borderRadius: '8px', padding: '10px 12px' }}>This record is catalogued and searchable. A downloadable copy is not attached in this demo.</div>}
        </div>
      );
    }

    // Records within a type
    if (type) {
      var years = (type.years || []).map(function (y) { return y.year; });
      return (
        <div>
          {years.length > 1 && (
            <div style={{ marginBottom: '14px' }}>
              <span style={sChip(!yearFilter)} onClick={function () { openType(type, dept, null); }}>All years</span>
              {years.map(function (y) { return <span key={y} style={sChip(yearFilter === y)} onClick={function () { openType(type, dept, y); }}>{y}</span>; })}
            </div>
          )}
          {recLoading ? <div style={{ color: '#6B7280', padding: '20px 0' }}>Loading records…</div>
            : records.length === 0 ? <div style={{ color: '#6B7280', padding: '20px 0' }}>No records in this group.</div>
            : records.map(function (r) {
              return (
                <div key={r.id} style={sCard} onClick={function () { setRecord(r); }}
                  onMouseEnter={function (e) { e.currentTarget.style.borderColor = BLUE; }} onMouseLeave={function (e) { e.currentTarget.style.borderColor = '#E5E7EB'; }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: BLUE, marginBottom: '3px' }}>{r.title}</div>
                  <div style={{ fontSize: '11px', color: '#9CA3AF', marginBottom: '6px' }}>{r.date}</div>
                  <div style={{ fontSize: '12.5px', color: '#6B7280', lineHeight: 1.5 }}>{(r.summary || '').slice(0, 180)}{(r.summary || '').length > 180 ? '…' : ''}</div>
                </div>
              );
            })}
        </div>
      );
    }

    // Record types within a department
    if (dept) {
      return (dept.types || []).map(function (t) {
        return (
          <div key={t.id || t.name} style={sCard} onClick={function () { openType(t, dept, null); }}
            onMouseEnter={function (e) { e.currentTarget.style.borderColor = BLUE; }} onMouseLeave={function (e) { e.currentTarget.style.borderColor = '#E5E7EB'; }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '15px', fontWeight: 600, color: '#1F2937' }}>{t.name}</span>
              <span style={sCount}>{t.count}</span>
            </div>
          </div>
        );
      });
    }

    // Departments (root)
    return tree.map(function (d) {
      return (
        <div key={d.id || d.name} style={sCard} onClick={function () { setDept(d); }}
          onMouseEnter={function (e) { e.currentTarget.style.borderColor = BLUE; }} onMouseLeave={function (e) { e.currentTarget.style.borderColor = '#E5E7EB'; }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '15px', fontWeight: 600, color: '#1F2937' }}>{d.name}</span>
            <span style={sCount}>{d.count} record{d.count === 1 ? '' : 's'}</span>
          </div>
          <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '4px' }}>{(d.types || []).length} record type{(d.types || []).length === 1 ? '' : 's'}</div>
        </div>
      );
    });
  }

  return (
    <div style={sPage}>
      <header style={sHeader}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: BLUE }}>{agencyName} Records Library</div>
          <div style={{ fontSize: '12px', color: '#6B7280' }}>Browse records already released to the public</div>
        </div>
        <a href="/portal" style={{ fontSize: '13px', color: BLUE, textDecoration: 'none', fontWeight: 600 }}>Search instead →</a>
      </header>
      <div style={sWrap}>
        <Crumbs />
        {body()}
      </div>
    </div>
  );
}
