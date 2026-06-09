-- Set fulfillment_method / medium on existing record types that are NOT retrievable by connector search
-- (communications collected from devices/systems, recordings, video, and bulk data exports)
UPDATE record_types SET fulfillment_method='manual_collection', medium='electronic'
  WHERE code IN ('official-email','text-messages','911-recordings','police-video','internal-memos','legal-opinions');
UPDATE record_types SET fulfillment_method='bulk_export', medium='electronic'
  WHERE code IN ('system-data-exports','gis-mapping-data');

-- Example record types that are requestable but not connector-searchable (illustrate the medium/fulfillment dimension)
INSERT INTO record_types (id, category_id, name, code, description, keywords, formats, is_structured_data, public_availability, auto_release_eligible, is_canonical, status, source, confidence, sort_order, fulfillment_method, medium, created_at, updated_at) VALUES
 ('rt-mobile-device','cat-technology','Mobile device contents (photos, video, app data)','mobile-device-data','Photos, video, messages and app data collected from a government-issued or official-use mobile device. Collected from the device or its backup; not retrievable by system search.','["mobile","phone","cell phone","photos","images","video","app data","device"]','["image","video","document"]',0,'review_required',0,1,'active','seed',1.0,210,'manual_collection','electronic', now()::text, now()::text),
 ('rt-forensic-image','cat-technology','Forensic device images & drive copies','forensic-images','A bit-for-bit forensic image or full copy of a hard drive, server or storage device, typically produced for litigation or investigation. Produced as a bulk export; sensitive.','["forensic","disk image","hard drive","drive copy","bit copy","server image","clone"]','["structured_data","document"]',0,'confidential',0,1,'active','seed',1.0,220,'bulk_export','electronic', now()::text, now()::text)
ON CONFLICT (id) DO UPDATE SET fulfillment_method=EXCLUDED.fulfillment_method, medium=EXCLUDED.medium, description=EXCLUDED.description;
