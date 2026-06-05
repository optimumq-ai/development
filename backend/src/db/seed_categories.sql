-- Master taxonomy category seed (15). Idempotent via ON CONFLICT (code).
-- Apply: cat seed_categories.sql | docker exec -i optimumq-postgres psql -U optimumq -d optimumq
INSERT INTO categories (id, name, code, description, sort_order, active) VALUES
('cat-governance','Governance & Legislative','governance','Council/board agendas, minutes, ordinances, resolutions, meeting recordings, proclamations, board & commission records',10,1),
('cat-police','Police & Law Enforcement','police','Incident/offense reports, arrests, citations, body-worn & dash-cam footage, 911/CAD records, use-of-force',20,1),
('cat-fire-ems','Fire & EMS','fire-ems','Fire incident reports, EMS run reports, fire inspections, hazmat records',30,1),
('cat-finance','Finance & Procurement','finance','Budgets, financial statements, check registers, invoices, purchase orders, bids/RFPs, vendor contracts, audits, grants',40,1),
('cat-hr','Human Resources & Personnel','hr','Personnel files, payroll, job applications, benefits, disciplinary actions, time & attendance',50,1),
('cat-permits','Permits, Licenses & Inspections','permits','Building permits, certificates of occupancy, business licenses, code enforcement, health/safety inspections',60,1),
('cat-planning','Planning, Zoning & Land Use','planning','Zoning, plats, variances, development & site-plan applications, comprehensive plans, GIS/maps',70,1),
('cat-public-works','Public Works & Utilities','public-works','Streets & infrastructure, water/sewer, utility billing records, work orders, maintenance, capital projects',80,1),
('cat-legal','Legal & Risk','legal','Legal opinions, litigation & claims, settlement agreements, subpoenas, insurance/risk, public-records-request logs',90,1),
('cat-property','Property & Assets','property','Real-property/land records, city-owned property, equipment & vehicle fleet, asset inventory',100,1),
('cat-parks','Parks, Recreation & Community Services','parks','Program registrations, facility reservations & use agreements, library records, community events',110,1),
('cat-communications','Correspondence & Communications','communications','Email correspondence, letters/memos, press releases, social media, public notices',120,1),
('cat-technology','Technology & Information Systems','technology','Device/computer/phone extractions, system & database data records, network/security device info, IT asset inventory',130,1),
('cat-elections','Elections & Vital Records','elections','Voter rolls, election records, and vital records where the jurisdiction maintains them',140,1),
('cat-other','Other / Referred','other','Catch-all for requests the agency does not hold or that belong to another agency; used for routing/referral',150,1)
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, sort_order=EXCLUDED.sort_order, active=EXCLUDED.active;
