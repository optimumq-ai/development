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
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searched, setSearched] = useState(false);

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
  function doSearch() {
    var qq = query.trim(); if (!qq) return;
    setSearching(true); setSearched(true); setRecord(null); setDept(null); setType(null);
    axios.get(API + '/public/library/search?q=' + encodeURIComponent(qq)).then(function (r) { setSearchResults((r.data && r.data.records) || []); setSearching(false); }).catch(function () { setSearchResults([]); setSearching(false); });
  }
  function clearSearch() { setSearched(false); setSearchResults([]); setQuery(''); setRecord(null); }
  function resetTo(level) {
    if (level === 'root') { setDept(null); setType(null); setRecord(null); setYearFilter(null); setSearched(false); setSearchResults([]); setQuery(''); }
    else if (level === 'dept') { setType(null); setRecord(null); setYearFilter(null); }
    else if (level === 'type') { setRecord(null); }
  }

  var sPage = { minHeight: '100vh', background: '#F9FAFB', fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif', color: '#374151' };
  var sHeader = { background: 'white', borderBottom: '1px solid #E5E7EB', padding: '18px 26px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px', flexWrap: 'wrap' };
  var sWrap = { maxWidth: '880px', margin: '0 auto', padding: '26px 24px 44px' };
  var sHeading = { fontSize: '24px', fontWeight: 700, color: '#1F2937', margin: '0 0 14px' };
  var sScrollBox = { background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '10px', maxHeight: '320px', overflowY: 'auto' };
  var sCard = { background: 'white', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '15px 18px', marginBottom: '10px', cursor: 'pointer', transition: 'border-color .12s' };
  var sCount = { fontSize: '14px', color: '#374151', background: '#F3F4F6', borderRadius: '999px', padding: '4px 14px', whiteSpace: 'nowrap' };
  var sChevron = { color: '#9CA3AF', fontSize: '20px', lineHeight: 1 };
  var sCrumbLink = { color: BLUE, cursor: 'pointer', textDecoration: 'none' };
  var sChip = function (active) { return { fontSize: '14px', padding: '5px 14px', borderRadius: '999px', cursor: 'pointer', marginRight: '6px', border: '1px solid ' + (active ? BLUE : '#D1D5DB'), background: active ? '#EBF3FB' : 'white', color: active ? BLUE : '#374151' }; };
  var sSection = { borderTop: '1px solid #E5E7EB', marginTop: '24px', paddingTop: '24px' };
  var sDesc = { fontSize: '16px', color: '#374151', margin: '0 0 12px' };
  var sSearchInput = { flex: 1, padding: '13px 16px', borderRadius: '10px', border: '1px solid #D1D5DB', fontSize: '16px', outline: 'none' };
  var sSearchBtn = { padding: '13px 26px', borderRadius: '10px', border: 'none', background: BLUE, color: 'white', fontSize: '16px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' };
  var sMapBtn = { flexShrink: 0, padding: '11px 22px', borderRadius: '10px', border: 'none', background: BLUE, color: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textDecoration: 'none', display: 'inline-block', whiteSpace: 'nowrap', boxShadow: '0 2px 10px rgba(31,78,121,0.25)' };

  function Crumbs() {
    return (
      <div style={{ fontSize: '14px', marginBottom: '14px', color: '#6B7280' }}>
        <span style={sCrumbLink} onClick={function () { resetTo('root'); }}>Records Library</span>
        {dept && <span> &nbsp;/&nbsp; <span style={sCrumbLink} onClick={function () { resetTo('dept'); }}>{dept.name}</span></span>}
        {type && <span> &nbsp;/&nbsp; <span style={sCrumbLink} onClick={function () { resetTo('type'); }}>{type.name}</span></span>}
        {record && <span> &nbsp;/&nbsp; <span style={{ color: '#374151' }}>{record.title}</span></span>}
      </div>
    );
  }

  function body() {
    if (searched && !record) {
      return (
        <div>
          <div style={{ fontSize: '14px', color: '#6B7280', marginBottom: '12px' }}>
            {searching ? 'Searching\u2026' : (searchResults.length + ' result' + (searchResults.length === 1 ? '' : 's') + ' for \u201c' + query + '\u201d')}
          </div>
          {searching ? null : searchResults.length === 0
            ? <div style={{ color: '#6B7280', padding: '20px 0', fontSize: '15px' }}>No public records match that search. Try different words, or browse the categories below.</div>
            : searchResults.map(function (r) {
              return (
                <div key={r.id} style={sCard} onClick={function () { setRecord({ title: r.title, summary: r.summary, date: r.date, fileId: r.fileId, pageCount: r.pageCount, docType: r.docType }); }}
                  onMouseEnter={function (e) { e.currentTarget.style.borderColor = BLUE; }} onMouseLeave={function (e) { e.currentTarget.style.borderColor = '#E5E7EB'; }}>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: BLUE, marginBottom: '3px' }}>{r.title}</div>
                  <div style={{ fontSize: '13px', color: '#6B7280', marginBottom: '6px' }}>{r.docType}{r.department ? ' \u00b7 ' + r.department : ''}{r.date ? ' \u00b7 ' + r.date : ''}{r.semantic ? '  \u00b7 closest match' : ''}</div>
                  <div style={{ fontSize: '14px', color: '#4B5563', lineHeight: 1.5 }}>{(r.summary || '').slice(0, 180)}{(r.summary || '').length > 180 ? '\u2026' : ''}</div>
                </div>
              );
            })}
        </div>
      );
    }
    if (loading) return <div style={{ color: '#6B7280', padding: '40px 0', textAlign: 'center', fontSize: '15px' }}>Loading the records library\u2026</div>;
    if (!tree.length) return <div style={{ color: '#6B7280', padding: '40px 0', textAlign: 'center', fontSize: '15px' }}>No released records are available to browse yet.</div>;

    if (record) {
      return (
        <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '22px 24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: BLUE, margin: '0 0 6px' }}>{record.title}</h2>
          <div style={{ fontSize: '13px', color: '#6B7280', marginBottom: '14px' }}>{(type && type.name) || record.docType || 'Record'}{record.date ? ' \u00b7 ' + record.date : ''}{record.pageCount ? ' \u00b7 ' + record.pageCount + ' page' + (record.pageCount > 1 ? 's' : '') : ''}</div>
          <p style={{ fontSize: '15px', lineHeight: 1.6, color: '#374151', margin: '0 0 18px' }}>{record.summary}</p>
          {record.fileId
            ? <a href={API + '/public/file/' + record.fileId} style={{ display: 'inline-block', background: BLUE, color: 'white', fontSize: '14px', fontWeight: 600, padding: '10px 20px', borderRadius: '8px', textDecoration: 'none' }}>Download document</a>
            : <div style={{ fontSize: '13px', color: '#6B7280', background: '#F3F4F6', borderRadius: '8px', padding: '10px 12px' }}>This record is catalogued and searchable. A downloadable copy is not attached in this demo.</div>}
        </div>
      );
    }

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
          {recLoading ? <div style={{ color: '#6B7280', padding: '20px 0', fontSize: '15px' }}>Loading records\u2026</div>
            : records.length === 0 ? <div style={{ color: '#6B7280', padding: '20px 0', fontSize: '15px' }}>No records in this group.</div>
            : records.map(function (r) {
              return (
                <div key={r.id} style={sCard} onClick={function () { setRecord(r); }}
                  onMouseEnter={function (e) { e.currentTarget.style.borderColor = BLUE; }} onMouseLeave={function (e) { e.currentTarget.style.borderColor = '#E5E7EB'; }}>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: BLUE, marginBottom: '3px' }}>{r.title}</div>
                  <div style={{ fontSize: '13px', color: '#6B7280', marginBottom: '6px' }}>{r.date}</div>
                  <div style={{ fontSize: '14px', color: '#4B5563', lineHeight: 1.5 }}>{(r.summary || '').slice(0, 180)}{(r.summary || '').length > 180 ? '\u2026' : ''}</div>
                </div>
              );
            })}
        </div>
      );
    }

    if (dept) {
      return (dept.types || []).map(function (t) {
        return (
          <div key={t.id || t.name} style={sCard} onClick={function () { openType(t, dept, null); }}
            onMouseEnter={function (e) { e.currentTarget.style.borderColor = BLUE; }} onMouseLeave={function (e) { e.currentTarget.style.borderColor = '#E5E7EB'; }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ fontSize: '16px', fontWeight: 600, color: '#1F2937' }}>{t.name}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><span style={sCount}>{t.count}</span><span style={sChevron}>{'\u203A'}</span></span>
            </div>
          </div>
        );
      });
    }

    return tree.map(function (d) {
      return (
        <div key={d.id || d.name} style={sCard} onClick={function () { setDept(d); }}
          onMouseEnter={function (e) { e.currentTarget.style.borderColor = BLUE; }} onMouseLeave={function (e) { e.currentTarget.style.borderColor = '#E5E7EB'; }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 600, color: '#1F2937' }}>{d.name}</div>
              <div style={{ fontSize: '14px', color: '#4B5563', marginTop: '3px' }}>{(d.types || []).length} record type{(d.types || []).length === 1 ? '' : 's'}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={sCount}>{d.count} record{d.count === 1 ? '' : 's'}</span>
              <span style={sChevron}>{'\u203A'}</span>
            </div>
          </div>
        </div>
      );
    });
  }

  var atRoot = !dept && !type && !record && !searched;

  return (
    <div style={sPage}>
      <header style={sHeader}>
        <div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: BLUE }}>{agencyName} Records Library</div>
          <div style={{ fontSize: '15px', color: '#4B5563', marginTop: '2px' }}>Browse records already released to the public</div>
        </div>
        <div style={{ textAlign: 'right', maxWidth: '360px' }}>
          <div style={{ fontSize: '14px', color: '#4B5563', marginBottom: '8px', lineHeight: 1.45 }}>Didn't find what you were looking for? Click to create an Open Records Request</div>
          <a href="/portal?start=request" style={{ display: 'inline-block', padding: '11px 22px', borderRadius: '10px', background: BLUE, color: 'white', fontSize: '14px', fontWeight: 600, textDecoration: 'none', boxShadow: '0 2px 10px rgba(31,78,121,0.25)' }}>Open Records Request</a>
        </div>
      </header>
      <div style={sWrap}>
        {atRoot ? (
          <div>
            <h2 style={sHeading}>Click to browse Records Library</h2>
            <div style={sScrollBox}>{body()}</div>
            <div style={sSection}>
              <p style={sDesc}>Enter a description and click Search to locate specific records.</p>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input value={query} onChange={function (e) { setQuery(e.target.value); }} onKeyDown={function (e) { if (e.key === 'Enter') doSearch(); }} placeholder="Search the records library&hellip;" style={sSearchInput} />
                <button onClick={doSearch} style={sSearchBtn}>Search</button>
              </div>
            </div>
            <div style={{ borderTop: '1px solid #E5E7EB', marginTop: '22px', paddingTop: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px' }}>
              <p style={{ fontSize: '16px', color: '#374151', margin: 0 }}>View public records by location on map</p>
              <a href="/portal/library/map" style={sMapBtn}>View Map</a>
            </div>
          </div>
        ) : (
          <div>
            <Crumbs />
            <div style={{ display: 'flex', gap: '10px', marginBottom: '18px' }}>
              <input value={query} onChange={function (e) { setQuery(e.target.value); }} onKeyDown={function (e) { if (e.key === 'Enter') doSearch(); }} placeholder="Search the records library&hellip;" style={sSearchInput} />
              <button onClick={doSearch} style={sSearchBtn}>Search</button>
              {searched ? <button onClick={clearSearch} style={{ padding: '13px 18px', borderRadius: '10px', border: '1px solid #D1D5DB', background: 'white', color: '#374151', fontSize: '15px', cursor: 'pointer' }}>Clear</button> : null}
            </div>
            {record ? body() : <div style={sScrollBox}>{body()}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
