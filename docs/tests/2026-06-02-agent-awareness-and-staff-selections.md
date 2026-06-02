# Acceptance Test — Agent Awareness & Staff Selections

**Build date:** 2026-06-02  
**Estimated time:** 20-30 minutes

## Features tested

1. Agent awareness of citizen-selected records
2. "I'm done selecting — continue" button in portal
3. Selected-records panel in staff workspace
4. Message sanitizer (Anthropic API guardrail)
5. Login returns full user with roles
6. Sidebar renders correctly on first load

## How to use this document

Walk through each test in order. Each test has:

- **Setup** — what to do before starting
- **Steps** — the exact actions to take
- **Expected** — what success looks like
- **Watch for** — bug indicators

Mark each test PASS / FAIL / NOTE as you go.

---

## TEST 1 — Sidebar renders correctly on login

**Setup:** Be logged out of staff app. Have admin@optimumq.ai / Rowanne101! ready.

**Steps:**
1. Open http://67.207.91.202/login in any browser
2. Enter credentials, click Sign In
3. Watch the left sidebar IMMEDIATELY after the dashboard appears

**Expected:**

Within 1-2 seconds of login, the sidebar shows ALL 7 items:
- Dashboard
- Request Queue
- My Tasks
- Reports (ARIA)
- Staff Management
- Departments
- Configuration

**Watch for:** Sidebar showing only 3 items initially. If that happens, the Guard regression is back.

---

## TEST 2 — Portal submission with selected records

**Setup:** Fresh incognito window, no prior portal session.

**Steps:**
1. Open http://67.207.91.202/portal in incognito
2. Walk through: name, email, skip phone if asked
3. Agent asks what you need: 'body camera footage from December 2025'
4. When result cards appear, click '+ Include in request' on 2 cards
5. Verify the green banner appears with chips
6. **Click the green ✓ I'm done selecting button**
7. Answer remaining questions, submit

**Expected:**
- Selection chips appear in green banner
- 'I'm done selecting' button visible and clickable
- After button click, agent acknowledges and ADVANCES the conversation
- Agent does NOT run another search after the button click
- Submission completes with confirmation showing request number

**Watch for:**
- Agent ignoring the button click (chat error)
- Agent running another search after click
- Agent forgetting what was selected
- Submission failure

**Note the request number for Test 3.**

---

## TEST 3 — Staff workspace shows selected records

**Setup:** Logged into staff app (from Test 1). Have request number from Test 2.

**Steps:**
1. Click Request Queue in sidebar
2. Find the request from Test 2 (should be at top)
3. Click into it
4. Stay on Request Details tab (default)
5. Scroll down past the description

**Expected:**
- New panel titled 'Records the Requestor Selected from Search Results'
- Green count badge showing 2 (or however many selected)
- Each record shows: title, source system, record ID
- Amber warning badge if any record was redaction-restricted

**Watch for:**
- Panel missing entirely
- Empty panel
- Wrong record titles or missing fields

---

## TEST 4 — Agent rules configuration page

**Setup:** Logged into staff app.

**Steps:**
1. Click Configuration in sidebar
2. Click 'Agent Rules' tab

**Expected:**
- 2 seeded rules appear
- Each has checkbox, text, Edit, Delete
- Each shows 'Added by system'

**Verify edit flow:**
- Toggle a rule off; refresh; verify state persisted
- Toggle back on; refresh; verify
- Add a test rule via the form; verify it appears with admin attribution
- Delete the test rule

**Watch for:**
- 'No rules configured yet' (means API auth failed)
- Toggle clicks not persisting
- Add/delete not working

---

## TEST 5 — Adversarial / edge cases

Optional but worth trying:

**5a. Long conversation message buildup:**
Make a portal request with many back-and-forth messages and multiple searches. Verify chat doesn't crash with 'Extra inputs not permitted' (the message sanitizer should prevent this).

**5b. Skipping records selection:**
Walk through a portal request, see search results, do NOT click any '+ Include' buttons, just answer the agent's next question verbally. Submission should still work (selected records list is just empty).

**5c. Removing a selection mid-flow:**
Select 3 records, click X on one of them, verify chip removes and count updates.

---

## Results template

| Test | Result | Notes |
|------|--------|-------|
| 1. Sidebar load | | |
| 2. Portal with selections | | |
| 3. Staff workspace panel | | |
| 4. Agent rules page | | |
| 5a. Long conversation | | |
| 5b. Skip selection | | |
| 5c. Remove selection | | |

**Overall verdict:** PASS / FAIL / FAIL WITH NOTES

**Issues to file:**

(list any here)
