-- Texas Jurisdiction Profile + core Public Information Act exemptions (starting seed).
-- These are common citations to use as a base; statute_text is NULL until populated
-- from a verified source (e.g., the AI location-based statute feature). source='seed'.
INSERT INTO jurisdiction_profiles (id, code, name, statute_name, statute_citation, status) VALUES
 ('jur-tx','TX','Texas','Texas Public Information Act','Tex. Gov''t Code Ch. 552','active')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, statute_name=EXCLUDED.statute_name, statute_citation=EXCLUDED.statute_citation, status='active';

INSERT INTO exemption_reference_library (id, jurisdiction_id, citation, label, description, category, source, sort_order) VALUES
 ('ex-tx-552101','jur-tx','Tex. Gov''t Code Sec. 552.101','Information confidential by law','Information deemed confidential under other law, such as medical records or other statutory confidentiality.','confidential_by_law','seed',10),
 ('ex-tx-552102','jur-tx','Tex. Gov''t Code Sec. 552.102','Personnel file information','Personnel-file information whose disclosure would be a clearly unwarranted invasion of personal privacy.','personnel','seed',20),
 ('ex-tx-552108','jur-tx','Tex. Gov''t Code Sec. 552.108','Law enforcement and prosecution','Records of the detection, investigation, or prosecution of crime where release would interfere.','law_enforcement','seed',30),
 ('ex-tx-552117','jur-tx','Tex. Gov''t Code Sec. 552.117','Personal information of officials and employees','Home address, telephone number, SSN, and family member information of officials/employees who elect confidentiality.','personal_privacy','seed',40),
 ('ex-tx-5521175','jur-tx','Tex. Gov''t Code Sec. 552.1175','Peace officers and certain officials','Personal information of peace officers, judges, and other listed officials.','personal_privacy','seed',50),
 ('ex-tx-552130','jur-tx','Tex. Gov''t Code Sec. 552.130','Motor vehicle records','Texas driver''s license number, license plate, and related motor vehicle record information.','personal_privacy','seed',60),
 ('ex-tx-552136','jur-tx','Tex. Gov''t Code Sec. 552.136','Card and access device numbers','Credit card, debit card, charge card, and access device numbers.','financial','seed',70),
 ('ex-tx-552137','jur-tx','Tex. Gov''t Code Sec. 552.137','Email addresses of the public','Email address of a member of the public communicating with a governmental body.','personal_privacy','seed',80),
 ('ex-tx-552147','jur-tx','Tex. Gov''t Code Sec. 552.147','Social Security numbers','Social Security number of a living person.','personal_privacy','seed',90),
 ('ex-tx-552026','jur-tx','Tex. Gov''t Code Sec. 552.026','Student and education records (FERPA)','Education records protected under the federal Family Educational Rights and Privacy Act.','minors_education','seed',100)
ON CONFLICT (id) DO UPDATE SET citation=EXCLUDED.citation, label=EXCLUDED.label, description=EXCLUDED.description, category=EXCLUDED.category;

INSERT INTO system_config (key, value) VALUES ('state','TX'),('jurisdiction_profile','jur-tx')
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;
