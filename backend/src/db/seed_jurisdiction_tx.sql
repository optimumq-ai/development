-- Texas Jurisdiction Profile + Redaction Rules Library (aligned to the prototype spec).
-- Rules = redaction policies (approved + active defaults); legal_sources = authorizing law (many-to-many).
-- Category codes match the prototype: privacy, law_enforcement, health, legal, personnel, commercial, security, administrative.

INSERT INTO jurisdiction_profiles (id, code, name, statute_name, statute_citation, status) VALUES
 ('jur-tx','TX','Texas','Texas Public Information Act','Tex. Gov''t Code Ch. 552','active')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, statute_name=EXCLUDED.statute_name, statute_citation=EXCLUDED.statute_citation, status='active';

INSERT INTO redaction_categories (id, key, label, sort_order) VALUES
 ('rc-privacy','privacy','Privacy / PII',10),
 ('rc-law-enforcement','law_enforcement','Law Enforcement',20),
 ('rc-health','health','Medical / Health',30),
 ('rc-legal','legal','Legal Privilege',40),
 ('rc-personnel','personnel','Personnel',50),
 ('rc-commercial','commercial','Commercial / Trade',60),
 ('rc-security','security','Security',70),
 ('rc-administrative','administrative','Administrative',80)
ON CONFLICT (id) DO UPDATE SET key=EXCLUDED.key, label=EXCLUDED.label, sort_order=EXCLUDED.sort_order;

INSERT INTO legal_sources (id, jurisdiction_id, name, citation, source_type, description, source) VALUES
 ('ls-tx-552147','jur-tx','Texas PIA - Social Security numbers','Tex. Gov''t Code Sec. 552.147','statute','Confidentiality of a living person''s Social Security number.','seed'),
 ('ls-tx-552130','jur-tx','Texas PIA - Motor vehicle records','Tex. Gov''t Code Sec. 552.130','statute','Driver''s license number, license plate, and motor vehicle record information.','seed'),
 ('ls-tx-552136','jur-tx','Texas PIA - Card and access device numbers','Tex. Gov''t Code Sec. 552.136','statute','Credit, debit, charge card, and access device numbers.','seed'),
 ('ls-tx-552117','jur-tx','Texas PIA - Personal info of officials/employees','Tex. Gov''t Code Sec. 552.117','statute','Home address, phone, SSN, and family info of officials/employees who elect confidentiality.','seed'),
 ('ls-tx-5521175','jur-tx','Texas PIA - Peace officers and certain officials','Tex. Gov''t Code Sec. 552.1175','statute','Personal information of peace officers, judges, and other listed officials.','seed'),
 ('ls-tx-552137','jur-tx','Texas PIA - Email addresses of the public','Tex. Gov''t Code Sec. 552.137','statute','Email address of a member of the public communicating with a governmental body.','seed'),
 ('ls-tx-552102','jur-tx','Texas PIA - Personnel file information','Tex. Gov''t Code Sec. 552.102','statute','Personnel-file information whose disclosure would be a clearly unwarranted invasion of privacy.','seed'),
 ('ls-tx-552108','jur-tx','Texas PIA - Law enforcement and prosecution','Tex. Gov''t Code Sec. 552.108','statute','Records of detection, investigation, or prosecution of crime where release would interfere.','seed'),
 ('ls-tx-552101','jur-tx','Texas PIA - Information confidential by law','Tex. Gov''t Code Sec. 552.101','statute','Information deemed confidential under other law.','seed'),
 ('ls-tx-552026','jur-tx','Texas PIA - Student/education records','Tex. Gov''t Code Sec. 552.026','statute','Education records to the extent protected by FERPA.','seed'),
 ('ls-fed-ferpa','jur-tx','FERPA','20 U.S.C. Sec. 1232g','statute','Family Educational Rights and Privacy Act (federal).','seed'),
 ('ls-fed-hipaa','jur-tx','HIPAA Privacy Rule','45 CFR Parts 160 and 164','regulation','Protected health information under the federal HIPAA Privacy Rule.','seed'),
 ('ls-tx-mpa','jur-tx','Texas Medical Practice Act','Tex. Occ. Code Ch. 159','statute','Confidentiality of physician-patient communications and records.','seed'),
 ('ls-tx-552111','jur-tx','Texas PIA - Agency memoranda (deliberative)','Tex. Gov''t Code Sec. 552.111','statute','Interagency or intraagency memoranda reflecting advice, opinion, or recommendation in the deliberative process.','seed'),
 ('ls-tx-552107','jur-tx','Texas PIA - Attorney-client/litigation','Tex. Gov''t Code Sec. 552.107','statute','Information within the attorney-client privilege or related to pending litigation.','seed'),
 ('ls-tx-552110','jur-tx','Texas PIA - Trade secrets','Tex. Gov''t Code Sec. 552.110','statute','Trade secrets and certain commercial or financial information of a private party.','seed'),
 ('ls-tx-552139','jur-tx','Texas PIA - Security and critical infrastructure','Tex. Gov''t Code Sec. 552.139','statute','Government information related to security or critical infrastructure.','seed')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, citation=EXCLUDED.citation, source_type=EXCLUDED.source_type, description=EXCLUDED.description;

INSERT INTO redaction_rules (id, jurisdiction_id, title, description, category, approval_status, is_active, source, sort_order) VALUES
 ('rr-ssn','jur-tx','Social Security Numbers','Redact the Social Security number of any living person.','privacy','approved',1,'seed',10),
 ('rr-mvr','jur-tx','Motor Vehicle Record Information','Redact Texas driver''s license numbers, license plate numbers, and related motor vehicle record data.','privacy','approved',1,'seed',20),
 ('rr-cards','jur-tx','Card and Access Device Numbers','Redact credit, debit, and charge card numbers and other access device numbers.','privacy','approved',1,'seed',30),
 ('rr-officials','jur-tx','Personal Information of Officials and Employees','Redact home address, personal phone, SSN, and family information of officials and employees who have elected confidentiality, and of peace officers and other protected officials.','privacy','approved',1,'seed',40),
 ('rr-public-email','jur-tx','Email Addresses of the Public','Redact the email address of a member of the public who communicated with the agency.','privacy','approved',1,'seed',50),
 ('rr-education','jur-tx','Student and Education Records','Redact personally identifiable information in education records protected under state law and FERPA.','privacy','approved',1,'seed',60),
 ('rr-personnel','jur-tx','Personnel File Information','Withhold personnel-file information whose release would be a clearly unwarranted invasion of personal privacy.','personnel','approved',1,'seed',70),
 ('rr-law-enforcement','jur-tx','Ongoing Law Enforcement and Prosecution','Withhold records whose release would interfere with the detection, investigation, or prosecution of crime.','law_enforcement','approved',1,'seed',80),
 ('rr-medical','jur-tx','Medical and Health Information','Redact protected health information, including diagnoses, treatment, and medical record numbers.','health','approved',1,'seed',90),
 ('rr-attorney-client','jur-tx','Attorney-Client Privileged Communications','Withhold communications protected by the attorney-client privilege and information relating to pending litigation.','legal','approved',1,'seed',100),
 ('rr-trade-secrets','jur-tx','Trade Secrets and Proprietary Business Information','Redact trade secrets and commercial or financial information of a private party where disclosure would cause competitive harm.','commercial','approved',1,'seed',110),
 ('rr-security-infra','jur-tx','Security Infrastructure Details','Withhold information related to government security or critical infrastructure, such as network security assessments.','security','approved',1,'seed',120),
 ('rr-deliberative','jur-tx','Deliberative Process / Pre-Decisional Documents','Withhold internal agency deliberations, drafts, and recommendations that are part of the decision-making process and not yet adopted as policy.','administrative','approved',1,'seed',130),
 ('rr-confidential-law','jur-tx','Information Confidential by Law','Withhold information made confidential by other applicable law.','administrative','approved',1,'seed',140)
ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, category=EXCLUDED.category, approval_status=EXCLUDED.approval_status, is_active=EXCLUDED.is_active;

INSERT INTO rule_legal_sources (id, rule_id, legal_source_id) VALUES
 ('rls-ssn-1','rr-ssn','ls-tx-552147'),
 ('rls-mvr-1','rr-mvr','ls-tx-552130'),
 ('rls-cards-1','rr-cards','ls-tx-552136'),
 ('rls-officials-1','rr-officials','ls-tx-552117'),
 ('rls-officials-2','rr-officials','ls-tx-5521175'),
 ('rls-email-1','rr-public-email','ls-tx-552137'),
 ('rls-edu-1','rr-education','ls-tx-552026'),
 ('rls-edu-2','rr-education','ls-fed-ferpa'),
 ('rls-personnel-1','rr-personnel','ls-tx-552102'),
 ('rls-le-1','rr-law-enforcement','ls-tx-552108'),
 ('rls-med-1','rr-medical','ls-fed-hipaa'),
 ('rls-med-2','rr-medical','ls-tx-mpa'),
 ('rls-med-3','rr-medical','ls-tx-552101'),
 ('rls-atty-1','rr-attorney-client','ls-tx-552107'),
 ('rls-trade-1','rr-trade-secrets','ls-tx-552110'),
 ('rls-sec-1','rr-security-infra','ls-tx-552139'),
 ('rls-delib-1','rr-deliberative','ls-tx-552111'),
 ('rls-conf-1','rr-confidential-law','ls-tx-552101')
ON CONFLICT (id) DO NOTHING;

INSERT INTO system_config (key, value) VALUES
 ('state','TX'),('jurisdiction_profile','jur-tx'),
 ('auto_redaction_rules_update','false'),('redaction_update_reminder_days','180')
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;
