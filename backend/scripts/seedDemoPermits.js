'use strict';
// Demo corpus seeder: City of Autumn Falls building-permit records.
// Two application/issued pairs (single-family + industrial), same project within each pair so the
// ONLY difference is application-vs-issued. Seeds public-ready fulfilled_records + full-text
// embeddings (owner_type='fulfilled_record') so portal search (keyword + semantic) works on them.
// Idempotent: removes prior demo-af-* rows/embeddings first. Re-runnable.
var db = require('../src/db');
var v = require('../src/services/voyageEmbed');
var ei = require('../src/services/embedIndex');

var RT = 'rt-building-permits';
var DEPT = 'dept-building';

// ---- Synthetic Autumn Falls data (fully invented) ----
var SF = {
  address: '1428 Sycamore Ridge Drive, Autumn Falls, TX 75701',
  subdivision: 'Sycamore Ridge, Phase 2', lotblock: 'Lot 14 / Block 3', parcel: 'AF-R-2024-014-003',
  zoning: 'R-1 Single-Family Residential', flood: 'Zone X (outside 100-year floodplain)',
  owner: 'Marcus and Renee Caldwell', ownerAddr: '1428 Sycamore Ridge Drive, Autumn Falls, TX 75701',
  gc: 'Brightpath Builders, LLC', gclic: 'AF-BC-04417',
  elec: 'Summit Electrical Services (AF-EC-2231)', mech: 'Reliant HVAC Co. (AF-MC-1180)', plumb: 'TrueLine Plumbing (AF-PC-3094)',
  type: 'Type V-B', area: '2,640 sq ft conditioned (3,510 sq ft under roof)', stories: '2', garage: '3-car attached',
  porch: 'Covered front and rear porches', beds: '4', baths: '3.5', cost: '$385,000'
};
var IND = {
  address: '500 Foundry Parkway, Autumn Falls Industrial Park, TX 75703',
  parkName: 'Autumn Falls Industrial Park', parcel: 'AF-I-2024-031', zoning: 'I-2 Heavy Industrial',
  flood: 'Zone X (outside 100-year floodplain)',
  owner: 'Northgate Logistics Holdings, LP', tenant: 'Vantage Distribution Co.', developer: 'Cedar Industrial Partners',
  gc: 'Ironclad Commercial Construction', gclic: 'AF-CC-11892', super: 'D. Whitaker',
  struct: 'Apex Structural Steel (AF-SC-0771)', elec: 'Voltline Industrial Electric (AF-EC-2640)',
  mech: 'ThermaCore Mechanical (AF-MC-1905)', plumb: 'Cornerstone Plumbing (AF-PC-3320)', fire: 'Guardian Fire Protection (AF-FP-0512)',
  occ: 'F-1 (Moderate-Hazard Factory/Industrial) with S-1 storage', type: 'Type II-B',
  sprinkler: 'NFPA 13 automatic fire sprinkler system (required)', alarm: 'Addressable fire alarm system (required)',
  hazard: 'Moderate-hazard; limited storage of combustible packaging materials', area: '48,000 sq ft',
  height: '38 ft', stories: '1 (with mezzanine office)', occLoad: '120', cost: '$6,400,000'
};

function joinLines(a){ return a.filter(Boolean).join('\n'); }

var docs = [
  {
    id: 'demo-af-sf-permit',
    title: 'Single-Family Residential Building Permit — 1428 Sycamore Ridge Drive',
    summary: 'Issued building permit (Permit No. BP-SF-2025-00417) authorizing construction of a new detached single-family residence at 1428 Sycamore Ridge Drive. Issued March 12, 2025; all required inspections and Certificate of Occupancy listed.',
    keywords: 'single family residential building permit issued certificate of occupancy inspections Sycamore Ridge Autumn Falls',
    body: joinLines([
      'CITY OF AUTUMN FALLS — BUILDING PERMIT',
      'Single-Family Residential Construction — ISSUED PERMIT',
      'Permit Number: BP-SF-2025-00417',
      'Issue Date: March 12, 2025    Expiration Date: March 12, 2026',
      'Status: ISSUED — approved for construction.',
      '',
      'PROJECT INFORMATION',
      'Project Address: ' + SF.address,
      'Subdivision: ' + SF.subdivision + '    ' + SF.lotblock,
      'Parcel Number: ' + SF.parcel + '    Zoning District: ' + SF.zoning,
      'Floodplain Status: ' + SF.flood,
      'OWNER: ' + SF.owner + ', ' + SF.ownerAddr,
      'CONTRACTORS: General Contractor ' + SF.gc + ' (License ' + SF.gclic + '); Electrical ' + SF.elec + '; Mechanical ' + SF.mech + '; Plumbing ' + SF.plumb + '.',
      '',
      'PROJECT DESCRIPTION: Construction of a new detached single-family residence together with all approved accessory structures, driveways, utility connections, grading, and related site improvements in accordance with the approved construction documents.',
      'Occupancy Classification: Residential (IRC). Construction Type: ' + SF.type + '. Building Area: ' + SF.area + '. Stories: ' + SF.stories + '. Garage: ' + SF.garage + '. ' + SF.porch + '. Bedrooms: ' + SF.beds + '; Bathrooms: ' + SF.baths + '.',
      'VALUATION: Estimated Construction Cost ' + SF.cost + '. Permit, plan review, and other fees assessed and PAID.',
      '',
      'REQUIRED INSPECTIONS (scheduled through the permit): Foundation; Underground Plumbing; Underground Electrical; Slab; Framing; Rough Electrical; Rough Plumbing; Rough Mechanical; Insulation; Energy Code; Final Building; Final Electrical; Final Plumbing; Final Mechanical; Certificate of Occupancy.',
      'PERMIT CONDITIONS: Authorizes construction only as shown on the approved plans. Work shall comply with the International Residential Code, local building ordinances, and applicable energy, fire, plumbing, mechanical, fuel gas, and electrical codes. Approved plans shall remain on site. Required inspections must be approved prior to concealment. Occupancy is prohibited until a Certificate of Occupancy has been issued.',
      'SIGNATURES: Building Official (signed); Permit Technician (signed); Owner/Contractor acknowledgment on file. Issued by the City of Autumn Falls Building & Planning Department.'
    ])
  },
  {
    id: 'demo-af-sf-app',
    title: 'Single-Family Residential Building Permit Application — 1428 Sycamore Ridge Drive',
    summary: 'Application for a building permit to construct a new single-family residence at 1428 Sycamore Ridge Drive. Received February 3, 2025 (Application No. APP-SF-2025-00298); plan review pending. No permit issued.',
    keywords: 'single family residential building permit application submitted plan review pending Sycamore Ridge Autumn Falls',
    body: joinLines([
      'CITY OF AUTUMN FALLS — BUILDING PERMIT APPLICATION',
      'Single-Family Residential Construction — APPLICATION (not yet issued)',
      'Application Number: APP-SF-2025-00298',
      'Date Received: February 3, 2025    Permit Number: (to be assigned upon approval)',
      'Status: SUBMITTED — under plan review. No permit has been issued.',
      '',
      'APPLICANT / PROJECT INFORMATION',
      'Project Address: ' + SF.address,
      'Subdivision: ' + SF.subdivision + '    ' + SF.lotblock,
      'Parcel Number: ' + SF.parcel + '    Zoning District: ' + SF.zoning,
      'Floodplain Status: ' + SF.flood,
      'APPLICANT / OWNER: ' + SF.owner + ', ' + SF.ownerAddr,
      'PROPOSED CONTRACTORS: General Contractor ' + SF.gc + ' (License ' + SF.gclic + '); subcontractors to be registered prior to permit issuance.',
      '',
      'PROPOSED SCOPE OF WORK: Applicant requests authorization to construct a new detached single-family residence with attached garage, covered porches, driveway, and utility connections in accordance with the submitted construction documents.',
      'Proposed Occupancy: Residential (IRC). Proposed Construction Type: ' + SF.type + '. Proposed Building Area: ' + SF.area + '. Proposed Stories: ' + SF.stories + '. Bedrooms: ' + SF.beds + '; Bathrooms: ' + SF.baths + '.',
      'ESTIMATED VALUATION: ' + SF.cost + '. Permit and plan review fees ESTIMATED; due upon approval.',
      '',
      'SUBMITTAL CHECKLIST: Completed application; site plan; construction drawings; energy compliance documentation; contractor registration. Plan review by the Building Official is PENDING.',
      'APPLICANT ACKNOWLEDGMENT: The applicant certifies the information provided is accurate and agrees that no construction will begin until a permit is issued. Applicant signature on file. Submitted to the City of Autumn Falls Building & Planning Department for review.'
    ])
  },
  {
    id: 'demo-af-ind-permit',
    title: 'Industrial Building Permit — 500 Foundry Parkway',
    summary: 'Issued building permit (Permit No. BP-IND-2025-00088) authorizing construction of a 48,000 sq ft industrial distribution facility at 500 Foundry Parkway. Issued April 21, 2025; fire protection, special inspections, and Certificate of Occupancy required.',
    keywords: 'industrial building permit issued warehouse distribution fire sprinkler hazardous occupancy Foundry Parkway Autumn Falls',
    body: joinLines([
      'CITY OF AUTUMN FALLS — BUILDING PERMIT',
      'Industrial Building Construction — ISSUED PERMIT',
      'Permit Number: BP-IND-2025-00088',
      'Issue Date: April 21, 2025    Expiration Date: April 21, 2026',
      'Status: ISSUED — approved for construction.',
      '',
      'PROJECT INFORMATION',
      'Project Address: ' + IND.address,
      'Industrial Park: ' + IND.parkName + '    Parcel Number: ' + IND.parcel,
      'Zoning District: ' + IND.zoning + '    Floodplain Status: ' + IND.flood,
      'OWNER: ' + IND.owner + '. Tenant: ' + IND.tenant + '. Developer: ' + IND.developer + '.',
      'CONTRACTORS: General Contractor ' + IND.gc + ' (License ' + IND.gclic + '); Superintendent ' + IND.super + '; Structural ' + IND.struct + '; Electrical ' + IND.elec + '; Mechanical ' + IND.mech + '; Plumbing ' + IND.plumb + '; Fire Protection ' + IND.fire + '.',
      '',
      'PROJECT DESCRIPTION: Construction of a new industrial distribution and light-manufacturing facility together with associated site improvements, utilities, fire protection systems, and supporting infrastructure in accordance with approved construction documents.',
      'OCCUPANCY: ' + IND.occ + '. Construction Type: ' + IND.type + '. Fire Sprinkler: ' + IND.sprinkler + '. Fire Alarm: ' + IND.alarm + '. Hazard Classification: ' + IND.hazard + '. Building Area: ' + IND.area + '. Height: ' + IND.height + '. Stories: ' + IND.stories + '. Maximum Occupant Load: ' + IND.occLoad + '.',
      'VALUATION: Estimated Construction Cost ' + IND.cost + '. Permit, plan review, technology, and other fees assessed and PAID.',
      '',
      'REQUIRED INSPECTIONS: Site Preparation; Footings; Foundation; Underground Utilities; Structural Steel; Concrete Placement; Fireproofing; Framing; Roof; Mechanical; Electrical; Plumbing; Fire Sprinkler; Fire Alarm; Special Inspections; Accessibility Compliance; Final Building; Final Fire; Final Mechanical; Final Electrical; Final Plumbing; Certificate of Occupancy.',
      'PERMIT CONDITIONS: Construction shall comply with the approved plans and the International Building, Fire, Mechanical, Plumbing, and Fuel Gas Codes, the National Electrical Code, and local ordinances. Required special inspections shall be provided. Fire protection systems shall not be placed in service until approved. Hazardous material storage shall comply with all fire and environmental regulations. The building shall not be occupied until a Certificate of Occupancy has been issued.',
      'SIGNATURES: Building Official (signed); Permit Technician (signed); Owner and Contractor acknowledgment on file. Issued by the City of Autumn Falls Building & Planning Department.'
    ])
  },
  {
    id: 'demo-af-ind-app',
    title: 'Industrial Building Permit Application — 500 Foundry Parkway',
    summary: 'Application for a building permit to construct a 48,000 sq ft industrial distribution facility at 500 Foundry Parkway. Received February 28, 2025 (Application No. APP-IND-2025-00061); plan review and fire-protection review pending. No permit issued.',
    keywords: 'industrial building permit application submitted plan review pending warehouse distribution Foundry Parkway Autumn Falls',
    body: joinLines([
      'CITY OF AUTUMN FALLS — BUILDING PERMIT APPLICATION',
      'Industrial Building Construction — APPLICATION (not yet issued)',
      'Application Number: APP-IND-2025-00061',
      'Date Received: February 28, 2025    Permit Number: (to be assigned upon approval)',
      'Status: SUBMITTED — under plan review and fire-protection review. No permit has been issued.',
      '',
      'APPLICANT / PROJECT INFORMATION',
      'Project Address: ' + IND.address,
      'Industrial Park: ' + IND.parkName + '    Parcel Number: ' + IND.parcel,
      'Zoning District: ' + IND.zoning + '    Floodplain Status: ' + IND.flood,
      'PROPERTY OWNER: ' + IND.owner + '. Tenant: ' + IND.tenant + '. Developer: ' + IND.developer + '.',
      'PROPOSED CONTRACTORS: General Contractor ' + IND.gc + ' (License ' + IND.gclic + '); structural, fire-protection, and trade subcontractors to be registered prior to permit issuance.',
      '',
      'PROPOSED SCOPE OF WORK: Applicant requests authorization to construct a new industrial distribution and light-manufacturing facility with associated utilities, fire protection systems, and site improvements per the submitted construction documents.',
      'PROPOSED OCCUPANCY: ' + IND.occ + '. Proposed Construction Type: ' + IND.type + '. Proposed Fire Sprinkler: ' + IND.sprinkler + '. Hazard Classification: ' + IND.hazard + '. Proposed Building Area: ' + IND.area + '. Proposed Maximum Occupant Load: ' + IND.occLoad + '.',
      'ESTIMATED VALUATION: ' + IND.cost + '. Permit, plan review, and technology fees ESTIMATED; due upon approval.',
      '',
      'SUBMITTAL CHECKLIST: Completed application; civil/site plans; structural, mechanical, electrical, plumbing, and fire-protection drawings; hazardous-materials inventory; special-inspection agreement. Plan review and fire-protection review are PENDING.',
      'APPLICANT ACKNOWLEDGMENT: The applicant certifies the information is accurate and agrees that no construction, and no placement of fire-protection systems into service, will occur until a permit is issued and required approvals obtained. Applicant signature on file. Submitted to the City of Autumn Falls Building & Planning Department for review.'
    ])
  }
];

(async function(){
  await db.initDb();
  // idempotent cleanup
  await db.run("DELETE FROM embeddings WHERE owner_type='fulfilled_record' AND owner_id LIKE 'demo-af-%'");
  await db.run("DELETE FROM fulfilled_records WHERE id LIKE 'demo-af-%'");
  for (var i=0;i<docs.length;i++){
    var d = docs[i];
    await db.run(
      "INSERT INTO fulfilled_records (id, request_id, source_file_id, output_file_id, title, summary, record_type_id, department_id, keywords, public_availability, page_count, released_by, released_at, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),?)",
      [d.id, null, null, null, d.title, d.summary, RT, DEPT, d.keywords, 'released', 1, 'Demo Seeder', 'released']);
    // embed full document text (title + summary + body) so semantic search sees the whole record
    var full = d.title + '. ' + d.summary + ' ' + d.body;
    var vecs = await v.embed([full.slice(0, 14000)], { inputType: 'document' });
    await ei.upsertEmbedding('fulfilled_record', d.id, vecs[0], full);
    console.log('seeded + embedded:', d.id, '->', d.title);
  }
  var c = await db.get("SELECT count(*) AS n FROM fulfilled_records WHERE status='released'");
  var e = await db.get("SELECT count(*) AS n FROM embeddings WHERE owner_type='fulfilled_record'");
  console.log('DONE. released records:', c.n, '| fulfilled_record embeddings:', e.n);
  process.exit(0);
})().catch(function(err){ console.error('SEED ERR', err.message, (err.stack||'').split('\n')[1]||''); process.exit(1); });
