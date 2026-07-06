# Document Processing Security

**Purpose:** how an uploaded/imported document (PDF, image, spreadsheet, audio/video) is handled by the system — which processes only *read* it (and therefore cannot execute anything inside it), which processes *could* be a code-execution surface if a file is maliciously malformed, the controls that limit the impact, where this class of file could cause trouble, and what the system does (and does not) do to detect and recover. Written for security discussions and internal hardening. Audited & hardened 2026-07-05.

## Bottom line
- The pipeline **reads and transforms** documents; it does **not open-and-run** them. A spreadsheet macro or PDF JavaScript never executes server-side — there is no Excel, no macro engine, no PDF script interpreter in the path.
- The only realistic code-execution surface is a **memory-corruption bug in a parsing library** triggered by a *malformed* file. That risk is contained by multiple controls, and the most important one — **not running as root** — was applied on 2026-07-05.
- The system's controls are **preventive** (isolation, no-shell, timeouts, patched parsers, least-privilege). It does **not** currently include active malware scanning, file-integrity monitoring, or self-repair — see "Detection & repair" below for the honest state and recommended additions.

## How a document flows through the system
| Step | Process / tool | What it does to the file | Can it execute file content? |
|---|---|---|---|
| Upload | `routes/files.js` (multer) | Stores the file; checks extension against an allowlist; size cap | No |
| Text extraction | `pdftotext` (Poppler), `fs.readFileSync` for text | Reads text out of the PDF / text file | No — reads, does not run |
| OCR (scanned pages) | `pdftoppm` (render page → PNG) → `tesseract` | Renders a page image, recognizes characters | No |
| Indexing / embeddings | `services/embedIndex.js` → Voyage | Sends extracted **text** for vectors | No |
| Search | `services/recordSearch.js` | Queries text + vectors | No |
| Redaction (documents) | `pdf-lib`, `jimp` (pure JS), `structuredRedaction` | Stamps boxes / drops fields / rewrites a clean copy | No |
| Redaction (audio/video) | `ffmpeg` | Mutes/cuts segments | No |
| AI assists (optional) | Claude (see AI_DATA_TOUCHPOINTS.md) | Sends text or a document image | No — the model reads, it does not run the file |

## Processes that only READ (cannot execute the file)
Text extraction, OCR, indexing, embedding, search, classification, and the pure-JS redaction steps all **read or transform** content. None of them interpret or run code embedded in the document:
- **Spreadsheet macros never run** — the system has no spreadsheet engine; `.xlsx`/`.csv` are allow-listed for upload but not deeply parsed, and values are read, not executed.
- **PDF JavaScript is not executed** — `pdftotext`/`pdfinfo` extract text/metadata; they do not run embedded scripts.
- **Formula injection** (e.g. a cell starting with `=`) is inert here — it is only dangerous if a file is re-exported and opened in a desktop spreadsheet app elsewhere; the system reads the value, it does not evaluate the formula.

## Processes that COULD trigger execution — and the controls that limit impact
The only realistic path to code execution is a **malformed file exploiting a bug in a native parser** (Poppler `pdftotext`/`pdfinfo`/`pdftoppm`, `tesseract`, or `ffmpeg` — all C/C++). The controls that limit this:

1. **No shell (no command injection).** External tools are called with `execFileSync(cmd, [args])` — arguments as an array, never through a shell. A hostile *filename* cannot inject commands.
2. **Least privilege — runs as a non-root user (applied 2026-07-05).** The app and every parser subprocess it spawns run as the dedicated `optimumq` user, not root. A successful parser exploit is now boxed into an account that **cannot overwrite the application code, cannot modify system files, and does not own anything outside the app's own data**. This is the single biggest impact-limiter.
3. **Isolated, short-lived subprocesses.** Each parse runs in a separate child process. A crash or exploit hits that disposable process, not the main application directly.
4. **Timeouts + output caps.** Every call has a timeout (15–120 s) and a `maxBuffer` limit, so a hung parse or a "zip bomb" is killed rather than exhausting the server.
5. **Patched parsers.** `pdftotext` 22.02, `tesseract` 4.1.1, `ffmpeg` 4.4.2 are the current patched versions for the OS, with no pending security updates at audit time.
6. **Pure-JS manipulation.** PDF/image *manipulation* (redaction rendering) uses `pdf-lib` and `jimp` — pure JavaScript, without the C-style memory-corruption surface.
7. **No XXE.** The only XML handling is a **regex over Poppler's own trusted output** — there is no entity-processing XML parser (no `xml2js`/`fast-xml-parser`), and `.xlsx` is not opened by a formula/entity engine.
8. **Upload allowlist.** Only expected extensions are accepted (`.pdf .doc .docx .xls .xlsx .jpg .jpeg .png .tiff .mp3 .mp4 .mov .txt .csv`).

## Where this class of file could still cause issues
- **A parser CVE on a malformed file** → worst case, code execution *inside the parsing subprocess* — now as non-root `optimumq`, so contained. Keeping parsers patched (control #5) is the ongoing mitigation.
- **The source storage location** (e.g. the weekly spreadsheet drop) is often the **more likely weak point** than the pipeline — the real exposure is *who can write files there*. This is largely the **customer's access-control responsibility**; deployment guidance should require the source location be writable only by authorized staff/service accounts.
- **Availability** — a crafted file could still make a parse fail or a subprocess die; the system handles this gracefully (below) rather than being harmed, but a flood of such files is a denial-of-service consideration (mitigated by timeouts + rate limiting).

## Detection & "repair" — the honest current state
The system's protections are **preventive, not detective/corrective**. Specifically:
- **On a bad file, it fails safe.** Parse errors are caught (`try/catch` → empty text), timeouts kill hung processes, and oversized output is capped. A malformed file typically just **fails to parse gracefully** and the record proceeds without extracted text — it does not harm the system.
- **What it does NOT have today (be honest with prospects):**
  - No antivirus / malware scanning on upload.
  - No file-integrity monitoring or self-repair of application/system code.
  - No intrusion-detection or automated "repair" of a compromise.
- There is no mechanism that detects a *malicious* file as malicious (only one that fails to parse a *broken* file). "Repair" in the self-healing sense does not exist and should not be implied.

## Recommended future hardening (ops-level, not yet done)
- **Restrict outbound network egress** from the app host, so even a compromised parser cannot exfiltrate data past the firewall (closes the last link in the worst-case chain).
- **Enable unattended security upgrades** for the parser packages (Poppler/Tesseract/ffmpeg) so patches apply automatically.
- **Antivirus scan on upload** (e.g. ClamAV) to catch known-malicious files before processing.
- **File-integrity monitoring** on the application directory to detect unexpected code changes.
- **Reduce the 1 GB upload cap** to the smallest size real files require.

## The real bar: independent security assessment
These internal controls **reduce** risk; they do not **certify** it. Before production use with police/CJIS-governed records, a **professional penetration test / third-party security assessment** is warranted and is the appropriate bar — beyond what internal hardening or self-review can establish.
