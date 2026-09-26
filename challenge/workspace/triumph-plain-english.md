# TRIUMPH — Explained in Plain English

**A friendly walkthrough of our hackathon plan.**

This document is for **us** — the team — not for the judges. It explains what we're building, why we're building it, and what every jargon-y term in the master plan actually means. If you read this top to bottom, you'll understand the whole thing without any special knowledge.

---

## 1. The big picture: what is this hackathon again?

There's a 48-hour coding competition. We build a small software project that uses an AI tool called **IBM Bob**. Bob is an AI assistant that can read entire codebases, split work between multiple "agents," read PDF documents, and run tasks on its own.

The judges care about four things:
1. **Does our project actually show off what Bob can do?** (not just use it as a decoration)
2. **Is it creative / original?** (not a copy of what everyone else builds)
3. **Does it solve a real business problem?**
4. **Is the presentation clear?**

We have a limited budget of "Bobcoins" — think of them like tokens Bob needs to run. We have about 40. So we have to be smart about how much work we ask Bob to do.

---

## 2. The core idea, in one sentence

> **Before we let a piece of code get released, we run it through three different "courts" — each one a different AI setup that checks a different kind of truth. If it passes all three, it's safe to ship. And when code breaks anyway, a fourth process helps us fix it fast.**

We call the whole thing **TRIUMPH**. Our slogan: **"Legal. Honest. Survivable. Ship it."**

---

## 3. The problem we're solving

Here's the situation in the real world of software in 2026:

A single human used to write code, then write tests to check that code, then explain how to support it. But now, **AI writes more and more of the code.** And the problem is:

- AI writes the code (good).
- AI writes the tests that check that code (suspicious — it's checking its own homework).
- AI writes the documentation too (it can lie).
- When the code breaks at 3am in production, the person on call **didn't write any of it** and has no idea what's going on.

So there's a **single core lie** that runs through everything:

> **"The code is fine."**

But who's actually telling us this? Nobody trustworthy:
- The **code itself** might not match the spec (the written rules of what it should do).
- The **tests** might be shallow copies of the code, so they "pass" even when things are broken.
- The **running system** might crash in a way neither the code nor the tests predicted.

**TRIUMPH is three tools that each catch one kind of lie**, bundled together, running on the same project. That's what makes it strong: it covers the whole journey of writing software, not just one step.

---

## 4. The three "courts" — explained simply

Think of each tool as a courtroom that checks the code's honesty.

### Court 1 — REDLINE: "Does the code match the written rules?" (Legal)

**The idea:** Software has a "spec" — a document that says what the software MUST do. For example: *"Credit card refunds MUST NOT be bigger than the amount we charged."*

The problem is, nobody actually reads the spec against the code line by line. A human audit takes **two days**. And these days, an AI writes both the code and the checklist, so it's checking its own work again.

**How REDLINE works:**
- We give Bob the spec (as a PDF, which Bob can read = "document understanding").
- **We specifically prevent the checking-AI from seeing the actual code.** This is the secret sauce. If the checker can't see the code, it can't be biased by it. It only knows what the rules SAY.
- The checker writes a small test for every rule. For example, for the refund rule it writes a test that says "this must never give back more than was charged."
- Then we run those tests against the real code. Any rule that fails is a violation. We show it on a big visual board — the **"Clause Wall"** — where each rule is green (pass), yellow (waived with reason), or red (broken, with the exact file and line).

**The "wow" moment:** In about 4 minutes, Bob turns a 2-day human audit into a color-coded wall that says exactly which rules the code violates and where.

---

### Court 2 — SPLITBRAIN: "Are the tests actually checking anything?" (Honest)

**The idea:** Picture a student who writes an essay **and** the grading rubric, then grades their own essay. Of course they pass. That's what happens when AI writes both the code and the tests.

Example of a "fake test" (we'll plant one): a test that says `the function's result equals the function's result`. That's a tautology — it's always true, so it never catches a bug. Another example: the tests just copy whatever the code currently does, so if the code is wrong, the tests "bless" the wrongness.

**The "coverage" lie:** Teams brag their code is "94% covered by tests" — meaning tests touch most of the code. But if those tests don't actually check the **right** things, coverage is meaningless. It's a number that sounds impressive but proves nothing.

**How SPLITBRAIN works:**
- **A "Witness" AI** (also forbidden from seeing the code) writes tests from the policy document (the rules). So we get honest tests.
- **We also run a comparison:** the SAME task done by a checker that's *allowed* to see the code. That one "blesses" the bugs — which is our visual proof that blocking the view really matters.
- **A real program (Stryker)** deliberately introduces small bugs (called "mutants") — for example, changes a `>=` to a `>`. Then it runs the existing test suite. If the tests stay green even though we broke the code, the tests were lying. Using Stryker means the score comes from a trusted tool, not a list we made up.
- The tool computes an **"honest coverage"** number vs the **"claimed coverage."** In our demo: claimed **94%**, honest **11%**. A huge trust gap is the visual proof. *(These are target numbers; the real ones come from the actual run.)*

**The "wow" moment:** We flip one character in the code (break it), and the "94% covered" test suite stays green — proving the coverage was fake. The honest test, written without seeing the code, turns red. Then we fix it so honest coverage jumps back up.

---

### Court 3 — WARPATH: "When it crashes anyway, can we fix it fast and safely?" (Survivable)

**The idea:** No matter how good our checks are, sometimes code breaks in production. When it does, a team scrambles. The person on call has to dig through logs, blame history, and docs — that takes ~47 minutes, and it's stressful.

**How WARPATH works (the "war room"):**
- Paste the error. Bob creates a mini "incident response team":
  - **Blame** — checks git history to find which change caused it.
  - **LogWindow** — reads the logs around the crash time.
  - **Callers/Tests** — finds what code calls the broken function.
  - **RunbookDoc** — reads the operations manual (another PDF) to apply the right fix.
- These four run **at the same time** (in parallel) — that's a visually impressive screenshot.
- Bob figures out the **root cause**, proposes the **safe fix** (not the dangerous one), and writes a **postmortem** (a report of what happened and how to prevent it).

**The "wow" moment:** The crash gets diagnosed and fixed in about 82 seconds instead of 47 minutes. AND — here's the clever part — Bob nearly makes a **dangerous wrong fix** (tripping a shared circuit breaker that would take down a different service), but we catch it and **roll back** (undo) that wrong fix and apply the safe one instead. This shows Bob can be wrong too — and that we built a safety net.

---

## 5. Why combine all three into one project?

Three separate reasons:

1. **It shows off Bob far more than any single tool.** The judges love seeing Bob do lots of complex, independent work. Three different, fully-working parts is way more impressive than one.

2. **It solves the whole problem, not a slice.** The theme is about improving a developer's *whole workflow*. A workflow is: make sure the code is legal → make sure the tests are honest → make sure you can survive it breaking. That's the complete journey.

3. **Heads-and-shoulders original.** Almost every other team will build *one* clever thing. By bundling three that share one powerful idea, we're the only one showing a full **methodology** — one skill pack that turns Bob into an entire quality department.

And crucially, all three share a **single clever trick**, so it's elegantly simple underneath:

> **The checking AI is never allowed to see the code it's checking.**

That's our "isolation wall." It's the reason these tools can be trusted — and it's one rule, reused three times. That makes the whole thing feel like one idea done excellently, rather than three random tools taped together.

---

## 6. The sample project we build ("northstar")

To demo all this, we build a small, realistic **payments app** — like a mini version of Stripe. It has features like creating a payment intent, processing webhooks, refunds, account balances, and authentication. It's small enough to build in our time budget but believable enough that the judges think "this is real."

Importantly, we **plant bugs and fake tests on purpose**, so the demo is guaranteed to work:

- **8 spec violations** (REDLINE) — e.g. the refund code allows refunding more than was charged.
- **2 dishonest tests** (SPLITBRAIN) — e.g. a test that compares a function to itself.
- **1 tricky incident** (WARPATH) — a crash, plus a tempting but dangerous "fix" we'll demonstrate avoiding.

We also prepare **PDF documents** (the spec, the runbook) because Bob's ability to *read PDFs* is a key feature the judges want to see on camera.

---

## 7. What are all these strange terms? (a plain-English glossary)

A lot of the master plan uses words you might not know. Here's what they mean:

| Term | What it actually means |
|---|---|
| **`src/`** | The folder holding the real application code. |
| **`tests/`** | The folder holding the test files. |
| **Spec** | A document of rules: "the software MUST do X." |
| **Must clause** | A single rule from the spec. We label them W1, W2, W3… |
| **Subagent** | A tiny focused AI worker that does one job and reports back. (Like 4 helpers working in parallel.) |
| **Parallel** | Multiple helpers working at the same time (vs. one after another). |
| **Mode / custom mode** | A "personality" you give Bob for a specific job — e.g. "Witness" (must not see code), "Surgeon" (only allowed to edit code). |
| **Isolation wall** | A rule that physically stops one AI from seeing certain files. Our key trick. |
| **`.bobignore`** | The setting that tells Bob "this AI is not allowed to read these files." Like a privacy block. |
| **Hook** | A script that fires automatically at a certain moment — e.g. "block any action that tries to let the Witness peek at code." |
| **MCP server** | A little helper that feeds Bob data (here: our fake logs, crash info) without the internet. |
| **Fixture** | Pre-made fake data (logs, crash reports) so our demo is predictable and never fails. |
| **Rollback** | Undo. We snapshot code before AI changes it, so we can undo a bad change. |
| **Coverage** | "What % of the code do the tests touch?" A big fake number in our demo. |
| **Mutant** | A deliberately-introduced small bug, used to test if the tests catch bugs. |
| **Tautology** | Something that's true by definition — like "x equals x." A useless test. |
| **MTTR** | Mean Time To Repair — how long it takes to fix a crash. We show 47 min → 82 sec. |
| **Root cause** | The actual underlying reason for the bug. |
| **Postmortem** | A written report of what went wrong and how to stop it happening again. |
| **RFC 2119** | A standard way to write MUST/SHALL/MAY in a spec. Just a formatting style. |
| **Bobcoin** | The limited currency/tokens Bob consumes each time it does AI work. |
| **Gold path / gold session** | The one perfect, rehearsed demonstration run we do on camera. |

---

## 8. The three things judges will SEE (our screenshots)

A big part of winning is having one amazing image a judge can screenshot and remember. We have **three**, and they tell one story:

1. **The Clause Wall** (from REDLINE) — a colorful board of every rule, green/yellow/red, pointing at the exact broken line. *Story: "Legal."*
2. **The Trust Gap dashboard** (from SPLITBRAIN) — two big numbers: claimed 94% coverage vs honest 11%. *Story: "Honest."*
3. **The Incident Report** (from WARPATH) — a clean accident-report page showing what broke and how we fixed it. *Story: "Survivable."*

Plus, live on the Bob screen, the judges see **two panels of AI sub-agents running at the same time** — the strongest possible proof that Bob is really doing the work (and not us faking it).

---

## 9. What the 2-minute demo looks like (shot by shot)

Here's the exact flow we'll show judges in our video:

1. **0–8s:** Show the three images together. "Legal. Honest. Survivable."
2. **8–22s:** Show the messy reality — a payments app, a "2-day audit," a fake "94% coverage," a "47-minute incident."
3. **22–40s:** **Open Bob.** Point at the spec PDF. Watch the AI helpers light up in parallel. "Bob reads the spec. The helpers have never seen the code."
4. **40–58s:** The Clause Wall fills. We click a red rule, fix it, watch it turn green.
5. **58–72s:** Switch to the honesty court. We break the code with a one-character change — the "94%" suite stays green (fake!), but the honest test goes red. Trust gap: 94% → 11%.
6. **72–86s:** Surgeon fixes it. Then switch to the war room: the crash, the near-wrong-fix, the rollback, the safe fix.
7. **86–100s:** Show all three results on screen. Open the pull request. "Legal → honest → survivable. The whole thing works."
8. **100–112s:** Show the skill pack + sample repo + required screenshots. "Anyone can clone this."
9. **112–120s:** End on the three images. "Legal. Honest. Survivable. Ship it."

**The one tweetable frame:** the triptych of the three screenshots with the caption **"Legal. Honest. Survivable. One repo, three Bob courts."**

---

## 10. What Bob does vs. what we do

To protect our Bobcoin budget (and too look honest), we split the work:

**We do (outside Bob, free):**
- Build the sample payments app.
- Write the spec, runbook, and policy documents.
- Plant the bugs and fake tests (in our *authored* demo lane).
- Set up all the configuration that controls what each Bob "mode" can and can't see (the walls).
- Write the helper code that feeds Bob predictable demo data.
- Install the real tools Bob will use (e.g. Stryker for the honesty check).

**Bob does (the impressive, coin-consuming part):**
- Reads the spec PDF and extracts every rule.
- Writes honest tests (without seeing the code).
- Runs the parallel investigator teams.
- Runs the two comparison agents (the "walled" honest one and the "unwalled" control).
- Runs the real mutation tool to prove which tests catch real bugs.
- Proposes and applies fixes (which we can undo).
- Writes the verdict and the incident report.

So Bob is genuinely doing the star work — but we've done the homework so the demo always succeeds and we don't burn all our coins on trial-and-error.

---

## 11. The plan over the 48 hours

We have ~48 hours. Here's roughly how we spend them (~26 hours of focused building, leaving buffer):

| Hours | What we do |
|---|---|
| 1–4 | Build the `northstar` payments app + all the planted bugs and docs. |
| **By hour 8** | **Decide the real public spec for the "credibility" lane** (this is our Point-6 decision gate — don't leave it to the last minute). |
| 5–10 | Set up REDLINE (court 1) completely, including the fair comparison (walled vs unwalled). Test-rub it. |
| 11–15 | Set up SPLITBRAIN (court 2) completely. Test-rub it. |
| 16–20 | Set up WARPATH (court 3) completely. Test-rub it. |
| 21–24 | Make all three work together as one smooth flow. Take screenshots. |
| 25–28 | Rehearse the narration, polish the visuals, time everything. |
| 29+ | Make the video, write the README, upload the required screenshots, submit. |

If we run out of time or coins, we **cut the SPLITBRAIN "fix" step first** but still show its cool "coverage is fake" reveal. The other two "courts" are enough to tell the story.

---

## 12. The honest risks (and that we planned around them)

- **Might be "too much" to show in 2 minutes?** → We planned an exact timed script; if we must, we cut one court.
- **Might run out of Bobcoins?** → We do all setup outside Bob; Bob only does the impressive demo work, once.
- **Might look like three unrelated tools?** → The shared "never see the code" trick and the "Legal→Honest→Survivable" story tie them together.
- **Might the PDF reading flake?** → We keep plain-text versions of every PDF as a backup.
- **Might Bob peek at the code it shouldn't?** → A hard "block" hook prevents it. We test this in rehearsal.
- **Might it look like we didn't really use Bob?** → We never say "we used Bob to build." The walls, the parallel teams, and the PDF-reading ARE the product. If you swapped Bob for a different AI, none of it would work.

---

## 13. The bottom line, in plain words

We're building **one payments project** and putting it through **three honest checks**, all powered by a single clever idea (the checking AI can't see the code it checks).

1. **REDLINE** makes sure the code follows its written rules.
2. **SPLITBRAIN** makes sure the tests actually test something real.
3. **WARPATH** makes sure that if it still breaks, we can fix it fast and safely.

Then we show it all in a clean, 2-minute story with three memorable screenshots.

**That's TRIUMPH.** Not three random tools — **one complete way to trust software before you ship it.**

---

## 14. Changes we made after a second opinion (read this next)

One more AI helper reviewed the plan and gave us six pieces of advice. We acted on four, decided to do both for one more (not just one option), and parked one for later. Here they are in plain words:

### ✅ Point 1 — We stopped quoting made-up numbers; we now prove it by comparison.
We used to say "Bob is X times faster than a human." That's a guess — there's no real human we measured. Now:
- Any figure we put on camera comes from the **actual run** (really measured), not invented.
- Instead of "faster than a human," we now have a **fair experiment**: we run the SAME task twice — once with the honest checker (blocked from seeing code) and once with a checker that *is* allowed to see the code. The second one blesses the bugs; the first one catches them. That's a real, fair, believable result — stronger than a made-up "hours" number.

### ✅ Point 2 — The "honesty" test now uses a real tool, not our planted list.
We used to say "we'll plant 8 fake bugs by hand." That looked like we'd staged it. Now the tool **Stryker** (a standard, trustworthy testing program) generates the fake bugs itself. Our score comes from a real program's output — much harder to call "staged."

### ✅ Point 4 — One Bob account is reserved just for the final recording.
We set aside one clean account that we won't spend coins experimenting on. The moment we record the demo, that account has no messy trial-and-error history. (The messy experimenting happens on a cheap scratch account first.)

### ✅⭐ Point 6 (we chose "both," the strongest option) — We'd built our own rules; now we also use a REAL public rulebook.
The honest worry from the review: if we write the spec AND the bugs, then "found all 8 violations" is easy — we hid 8 clues for ourselves. A sharp judge could smell that.
> **Our decision:** we'll do **both**.
> 1. **Our own authored demo** — fully controlled, guaranteed to work on camera.
> 2. **A real public spec** (a rulebook nobody in this room wrote) — we run our tool against it too, so the result is *provably* not staged.

We must **pick the real spec by hour 8** of the hackathon (not leaving it to the last minute). If a good real rulebook isn't found quickly, we fall back to our own demo and lean hard on the point-1 comparison to prove we're honest.

### ⏸ Point 5 (parked, decide later) — "Show one thing fully, not three quickly."
The review also suggested: instead of trying to squeeze all three courts into a 2-minute video (which can feel rushed and blurry), maybe show **one court, fully and clearly, plus a fast montage of the other two**, with the full project in the repo for anyone who wants to dig in. That's a legitimately good idea and we're noting it. We haven't switched yet — we'll decide before we record. Keeping it on the list.