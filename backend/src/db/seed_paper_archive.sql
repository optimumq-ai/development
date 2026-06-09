-- Sample Paper Records Index source + index items (paper-index connector demo)
INSERT INTO record_repositories (id, name, connector_type, status, config, sort_order, description)
VALUES ('repo-paper-archive', 'City Records Center (Paper Archive)', 'paper-index', 'active',
  '{"facility":"City Records Center"}', 60,
  'Physical paper records held in the City Records Center: older building permits, historical council minutes, archived case files and maps. A search here returns the box and shelf location of a record; staff retrieve it on request.')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, connector_type=EXCLUDED.connector_type, status=EXCLUDED.status, config=EXCLUDED.config, description=EXCLUDED.description;

DELETE FROM paper_index_items WHERE repository_id='repo-paper-archive';
INSERT INTO paper_index_items (id, repository_id, title, description, location, record_date, box, folder, tags, created_at) VALUES
 ('pi-seed-1','repo-paper-archive','Building Permit Files 1988-1995','Original paper building permit applications and approvals, filed alphabetically by street name. Includes permits for 123 Main Street.','Aisle 4, Shelf 2','1988-1995','47','','building permit construction 123 main street historical', now()::text),
 ('pi-seed-2','repo-paper-archive','City Council Meeting Minutes 1979-1990','Bound paper minutes of regular and special City Council meetings, including adopted ordinances and resolutions.','Aisle 1, Shelf 5','1979-1990','12','','council minutes meetings ordinances resolutions', now()::text),
 ('pi-seed-3','repo-paper-archive','Historical Zoning and Land-Use Maps 1965-1985','Large-format paper zoning and land-use maps for the city and surrounding annexed areas.','Map Cabinet 3','1965-1985','','','zoning maps land use planning annexation', now()::text),
 ('pi-seed-4','repo-paper-archive','Closed Police Case Files 1985-1995','Archived paper case files for closed police investigations. Confidential; redaction review required before any release.','Aisle 7, Shelf 1','1985-1995','201','','police case files investigations reports closed', now()::text),
 ('pi-seed-5','repo-paper-archive','Water Utility Service Records 1992-2000','Paper service connection and billing history cards for water utility accounts.','Aisle 5, Shelf 3','1992-2000','133','','water utility service billing connection', now()::text);
