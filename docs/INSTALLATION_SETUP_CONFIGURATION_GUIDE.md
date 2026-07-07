# Installation, Setup & Configuration Guide

Setup-and-configuration reference for standing up Optimum Q at a jurisdiction. Ongoing day-to-day operation belongs in a separate Admin/User Guide (to be split later); this document covers **initial setup and the configuration model**. Started 2026-07-05.

> Format note: kept as Markdown for now. If we later want linked Admin/User/Setup guides that share item-level content, we can restructure into HTML with shared sections — deferred to avoid over-engineering.

---

## 1. The core model: Sources and Record Types

Everything about getting records into the system revolves around two linked ideas:

- A **Source** — a specific place records live and how the system reaches them.
- A **Record Type** — a kind of record (e.g. building permits, payroll records, 911 call records).

They are **many-to-many**: one Source can hold many Record Types (a shared drive with permits, HR files, and finance exports); one Record Type can live in many Sources (payroll records in paper, on a shared drive, and in the payroll system's database). This relationship is what routes requests and gives records a path to become searchable.

### A Source has four attributes
1. **Name (free text)** — call it whatever makes sense to your staff. People describe records differently — by the *system* ("Axon Evidence"), by the *content* ("Payroll records"), or by the *location* ("Z Drive files") — and all are fine. The name is the human label; it does not have to follow any convention and does not affect how records are processed.
2. **Location** — where it is: a system's address/URL, a folder/drop path, or a physical archive location.
3. **Access method** — *how records in this Source become available to the system.* This is the field that determines whether records can be searched/published (see §2).
4. **Record type(s)** — what kinds of records it holds (the many-to-many link).

> The **name absorbs human variability**; the **access method + record-type link** carry the functional behavior. Keeping these separate is what keeps setup clear.

---

## 2. Access methods — and when to use each

The access method answers the key question: **how does a record in this Source become searchable in the system?** Choose by *purpose*, not by technical label:

| Access method | Use when you want to… | What happens to the records |
|---|---|---|
| **Live connection** (connector to a system/database) | Help staff **find** records that live in another system | Records stay in the source system; the system queries it to locate them. A discovery/search aid — records are **not** brought in or published. |
| **Import** (push or pull of files) | **Bring records in** so they can be redacted and published to the public library | Files are ingested, text-extracted, and **indexed** → they can reach public-ready. This is the true "path to searchable/published." |
| **Paper records index** | Catalog **physical** records so staff can locate them | A locator only; a human retrieves the physical document. |
| **Non-police A/V storage** | Bring in audio/video for redaction | Ingested and processed like import, with A/V redaction. |
| **Email** | Handle email record requests | **Count-only** search — the system reports approximately how many emails match, **never content**, and all email is human-reviewed for exempt content before release. Never returns email content through the public portal. |
| **Manual** | Staff handle the records directly | No automated ingestion. |

**The decisive distinction — live connection vs. import:** to become **public-ready**, content must come **into** the system (you cannot redact-and-publish something you only query live). So:
- **Live connection = discovery aid** (records stay put).
- **Import = the pipeline** (records come in, get indexed, can be published).

If unsure, ask: *"Do I just need to find these where they are, or do I need to bring them in to redact and publish?"*

**Push vs. pull (for imports):**
- **Push** — the source system's export job drops files into a folder the system watches.
- **Pull** — the system reaches out to a location/API on a schedule to retrieve new files.

---

## 3. The recommended setup sequence

1. **Create the Source** — give it a free-text name, choose the access method, enter the location/details.
2. **See what it can do** — the screen indicates, based on access method, whether the Source is eligible for auto-discovery, feeds the import/public-ready pipeline, or is live-only.
3. **Populate the taxonomy** — either **run auto-discovery** (for file/folder and import sources: it scans samples, proposes Record Types, and links them to this Source), or **create Record Types manually** and link them to the Source.
4. **Configure import** (for import sources) — set push/pull, schedule, and an optional redaction template so ingested files flow into mass redaction → review → public-ready.
5. **Result:** every Source has a clear outcome — it either feeds discovery/import (records become searchable) or serves as a live discovery aid.

---

## 4. The indexing goal & coverage (why this matters)

The whole model exists to guarantee **records have a path to become searchable/public-ready**. A Record Type is only reachable if it is linked to at least one Source whose access method leads to searchability (import). Watch for **orphans**:
- A Record Type with **no Source**, or only **manual/live-connection** sources, has **no import path** → it will never reach the public library on its own.
- The setup screens should surface these so gaps are visible rather than silent.

---

## 5. Auto-discovery

For file/folder and import Sources, auto-discovery scans sample files, asks the AI to identify the distinct Record Types present, proposes a catalog entry for each, and **links them to the Source**. Discovered types land as **drafts awaiting review** — a human approves them into the active taxonomy. (Live-API connectors do not yet support discovery; their Record Types are created manually.)

---

## 6. Email handling & routing

Email is deliberately constrained: the portal never returns email content; a request produces a **count only**, and all email is human-reviewed before any release. Routing of email requests can be configured: by default they go to the team designated for email (often IT), but a jurisdiction may **toggle** routing so an email request clearly tied to a department (e.g. Finance, Parks & Recreation) is routed to that department's team — useful when a central team would otherwise be overloaded. (Note: some jurisdictions have IT run the mail system technically even when a department owns the records, so this is a per-jurisdiction operating choice.)

---

## 7. Onboarding wizard

Initial setup is guided by the onboarding wizard, which walks through configuration in phases with live readiness signals and per-phase review/approval. The Sources/Record-Types phase reflects the model above (Sources connected, discovered types awaiting review). [To be kept in sync as the unified Sources screen ships.]

---

*Ongoing-use topics (day-to-day request processing, redaction operation, reporting, etc.) will live in a separate Admin/User Guide; this document is scoped to installation, setup, and configuration.*
