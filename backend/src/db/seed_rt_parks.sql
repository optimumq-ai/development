-- Parks, Recreation & Community Services record types. Idempotent via ON CONFLICT (code). No owner dept in demo.
INSERT INTO record_types (id, category_id, name, code, description, intent, expected_content, typical_request_reason, synonyms, disambiguators, keywords, identifying_facets, formats, is_structured_data, public_availability, auto_release_eligible, redaction_profile_id, fee_estimate_low, fee_estimate_high, fee_estimate_note, is_canonical, status, source, confidence, sort_order) VALUES
('rt-park-facility-records','cat-parks','Park & facility records','park-facility-records','Records about parks, trails, and recreation facilities.','Describe parks, trails, and recreation facilities and their management.','Facility locations, amenities, hours, maintenance, and usage information.','Requested by residents and groups planning use of parks and facilities.','["park records","facility records","trails","amenities","recreation facility"]','["not program registrations","not reservations"]','["park","facility","trail","amenity","recreation"]','["facility or park name","location","date"]','["document"]',0,'releasable',1,NULL,0,0,NULL,0,'active','seed',NULL,10),
('rt-program-registrations','cat-parks','Recreation program registrations','program-registrations','Enrollment records for recreation programs and classes.','Record enrollment in recreation programs and classes.','Participant, program, fees, and contact details; often includes minors.','Requested regarding enrollment in city recreation programs.','["program registration","class registration","camp registration","enrollment","sign-up"]','["not facility reservations","not park records"]','["registration","program","class","enrollment","camp"]','["participant","program name","season or date"]','["structured_data"]',1,'confidential',0,NULL,0,0,'Participant data, including minors, is generally confidential.',0,'active','seed',NULL,20),
('rt-facility-reservations','cat-parks','Facility & pavilion reservations','facility-reservations','Reservations of parks, pavilions, fields, and facilities.','Record reservations of parks, pavilions, fields, and facilities.','Reserving party, facility, date, fees, and contact details.','Requested regarding use or availability of reservable facilities.','["reservation","pavilion rental","field reservation","facility booking","permit to use"]','["not program registrations","not park records"]','["reservation","rental","booking","pavilion","field"]','["facility","reservation date","reserving party"]','["structured_data"]',1,'review_required',0,NULL,0,0,NULL,0,'active','seed',NULL,30)
ON CONFLICT (code) DO UPDATE SET
  category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description,
  intent=EXCLUDED.intent, expected_content=EXCLUDED.expected_content,
  typical_request_reason=EXCLUDED.typical_request_reason, synonyms=EXCLUDED.synonyms,
  disambiguators=EXCLUDED.disambiguators, keywords=EXCLUDED.keywords,
  identifying_facets=EXCLUDED.identifying_facets, formats=EXCLUDED.formats,
  is_structured_data=EXCLUDED.is_structured_data, public_availability=EXCLUDED.public_availability,
  auto_release_eligible=EXCLUDED.auto_release_eligible, sort_order=EXCLUDED.sort_order,
  updated_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS');

-- Owner links (added once Parks & Recreation department existed)
INSERT INTO record_type_departments (id, record_type_id, department_id, role, sort_order) VALUES
('rd-park-facility-records-own','rt-park-facility-records','dept-parks','owner',10),
('rd-program-registrations-own','rt-program-registrations','dept-parks','owner',10),
('rd-facility-reservations-own','rt-facility-reservations','dept-parks','owner',10)
ON CONFLICT (record_type_id, department_id, role) DO NOTHING;
