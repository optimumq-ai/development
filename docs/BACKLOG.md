# Backlog / Ideas to Consider

Running list of enhancement ideas captured during build sessions. Not yet scheduled.

## Discovery -> Redaction integration (captured 2025-06-08)

Enhance AI Discovery so record-type discovery and redaction setup go hand in hand:

- When discovery runs, create a **snapshot of the record types** found (point-in-time record of what was discovered/proposed).
- During the **review** step (approve/reject of discovered drafts), add two options per record type:
  1. **Generate a redaction template** for that record type, derived from its structure, expected content, and sensitivity (public_availability / auto_release_eligible). The type already encodes which exemptions are plausible, so a starter template can be proposed automatically.
  2. **Generate a mass auto-redaction process + scheduling** for records of that type - a recurring/bulk redaction job.

Rationale: once a record type is approved, we know its structure and sensitivity - exactly what is needed to draft a redaction template and configure scheduled bulk redaction. These pair naturally with the approval step rather than being separate later work.

Related: docs/FEATURE_context_aware_redaction.md.
