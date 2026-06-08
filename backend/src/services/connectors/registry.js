// Catalog of connector types available when adding a source.
// capabilities: 'scan' = can be scanned for record-type discovery; 'search' = can be queried for records.
module.exports = [
  { key:'filestore', label:'Network Drive / Folder', description:'A folder of documents (PDFs) on a mounted drive or local path. Scannable for record-type discovery.', capabilities:['scan'], fields:[ { key:'path', label:'Folder path', type:'text', placeholder:'/opt/optimumq/sample_repo' } ] },
  { key:'structured', label:'Structured System', description:'A system whose records are defined by a schema and sample rows (JSON definition). Scannable for record-type discovery.', capabilities:['scan'], fields:[ { key:'path', label:'System definition (JSON path)', type:'text', placeholder:'/opt/optimumq/sample_systems/payroll.json' } ] },
  { key:'tyler', label:'Tyler Munis (Financial / ERP)', description:'Tyler Munis ERP connector for financial and procurement records.', capabilities:['search'], fields:[ { key:'endpoint', label:'API endpoint URL', type:'text' }, { key:'api_key', label:'API key', type:'text' } ] },
  { key:'axon', label:'Axon Evidence', description:'Axon digital evidence connector for police records.', capabilities:['search'], fields:[ { key:'endpoint', label:'API endpoint URL', type:'text' }, { key:'api_key', label:'API key', type:'text' } ] },
  { key:'demo', label:'Demo Document Library', description:'Built-in demonstration document set.', capabilities:['search'], fields:[] }
];
