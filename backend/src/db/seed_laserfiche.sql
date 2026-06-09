-- Laserfiche ECM demo source: the citywide DMS. One source, many departments.
-- Stub API served by /opt/optimumq/demo-connectors/laserfiche (pm2: laserfiche-stub, port 4003).
INSERT INTO record_repositories (id, name, connector_type, status, config, sort_order, description) VALUES
 ('repo-laserfiche','Laserfiche ECM (Citywide Records)','laserfiche','active','{"baseUrl":"http://localhost:4003","apiKey":"demo-laserfiche-key-replace-in-production"}',5,'The city''s central document management system. Most departments file their official records here.')
ON CONFLICT (id) DO UPDATE SET status='active', config=EXCLUDED.config, connector_type='laserfiche';

-- Link the record types Laserfiche holds, spanning six owning departments (many-to-many).
INSERT INTO record_type_repositories (id, record_type_id, repository_id, format, filter_spec, sort_order)
SELECT 'rr-lf-' || v.rt, v.rt, 'repo-laserfiche', NULL, '{}', 100
FROM (VALUES ('rt-building-permits'),('rt-business-licenses'),('rt-certificates-occupancy'),('rt-plats-subdivisions'),('rt-variances-rezoning'),('rt-zoning-records'),('rt-legal-opinions'),('rt-settlements'),('rt-council-agendas'),('rt-council-minutes'),('rt-ordinances'),('rt-resolutions'),('rt-budgets'),('rt-property-deeds'),('rt-financial-audits'),('rt-leases-easements'),('rt-property-appraisals'),('rt-purchasing-contracts'),('rt-surplus-disposal'),('rt-personnel-files'),('rt-construction-contracts')) AS v(rt)
WHERE NOT EXISTS (SELECT 1 FROM record_type_repositories x WHERE x.record_type_id = v.rt AND x.repository_id='repo-laserfiche');
