# The seed layer — what is authoritative

## TL;DR

| File | Status | Purpose |
|---|---|---|
| **`seed_fixture.sql`** | **AUTHORITATIVE** | The whole config layer, as data. `schema.postgres.sql` + this = a working system from an empty database. Generated; do not hand-edit. |
| **`gen_fixture_seed.js`** | **AUTHORITATIVE** | Regenerates `seed_fixture.sql` from the live config. |
| `record_types_seed.tsv` + `gen_seed_sql.js` | **AUTHORING SOURCE** | Where the record-type taxonomy is *written* (TSV → `seed_rt_all.sql`). Still the right place to edit record types. |
| `seed_*.sql`, `seed_*.js` (the rest) | **LEGACY — do not trust** | Partial, applied ad hoc over months, drifted from live. Superseded by `seed_fixture.sql`. Kept for provenance only. |

## How to build a database from nothing

```bash
# 1. schema (tables, indexes, FKs, the payment-history delete guard)
#    -> applied automatically on API boot, or by tests/reset_test_db.js
# 2. config
psql "$DATABASE_URL" -f src/db/seed_fixture.sql
```

That is exactly what `tests/reset_test_db.js` does, and it is what a new city install should do.

## Why the old seed files are not trusted

There was never a seed *runner*. The `seed_*` files were applied by hand, in an order nobody wrote down, over
several months — and the live config kept moving afterwards (jurisdiction rules, per-record-type routing,
clarification policies). By 2026-07-14 they no longer described the running system, and nothing noticed because
nothing ever built a database from them.

That is the same disease that made `schema.postgres.sql` unable to create a fresh database, and made it drift
from live by an entire table and 20 columns: **a file that only ever runs against an environment that already
satisfies it is not a source of truth, it is decoration.**

`seed_fixture.sql` is generated and checked in, so it can be diffed, reviewed, and — most importantly — it is
built from empty on every single test run. It cannot rot quietly.

## Regenerating

```bash
node src/db/gen_fixture_seed.js     # rewrites seed_fixture.sql from the live config
npm test                            # builds a DB from empty with it, runs the suite
git diff src/db/seed_fixture.sql    # review the config change like any other code change
```

Regeneration is deterministic — same config in, byte-identical file out — so a diff always means the config
actually changed.

## What it contains, and what it must never contain

**In:** the taxonomy (categories, record types, routing), the org chart (departments, teams, users, roles), the
rules (jurisdiction rules and their provenance, redaction rules, fee profiles, workflow/agent rules), the
17-state jurisdiction survey.

**Out:** every transactional row — requests, tasks, history, clocks, payments, files, embeddings — and the demo
corpus. A fixture that ships 126 requests and 3,200 demo emails is a backup, not a fixture.

**Never:** secrets. `gen_fixture_seed.js` writes `NULL` for password hashes and MFA secrets, and blanks any
credential-shaped `system_config` value (the key survives so the installer knows the slot exists; the value is
set locally). This file goes into git.

## `import_state_template.js` — not a seed

`import_state_template.js` stands a state up from its Phase-6 research template
(`docs/rules_research/workflow/templates/<ST>.json`) rather than from a hand-written seed, so it belongs to a
different category from everything above and is subject to different rules:

```bash
node src/db/import_state_template.js TX OH        # import these states
node src/db/import_state_template.js OH --dry-run # report only, write nothing
node src/db/import_state_template.js --all        # all 32 gathered states
```

- It **never overwrites** a config that already exists. A domain that differs is staged as a pending
  `config_proposals` row, and what it proposes is the MERGE — the city's values are preserved and the
  template only contributes citations, rule ids, and surfaces the config did not have.
- It is **idempotent**: same template + same database = no writes and no new proposals on the second run.
- It **does not set legal values it cannot derive**. `clarification`, `payment` and `fee_waiver` arrive at
  their safe-manual defaults (`enabled: false`) with the statute filed as provenance; a human sets the enums.
  Every ⚠ city-config knob arrives `confirmed: false`, and its profile section cannot be attested until
  someone confirms it.
- It makes a state **available (`status = 'library'`), not active**. Switching the city over is a separate act.

See `../services/stateTemplateImport.js` for the mapping and the reasoning behind each of those rules.
