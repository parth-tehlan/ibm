# Enterprise IBM Angle — 5 Productizable Ideas
**IBM Bob 2.0 Hackathon | "Build with purpose"**
Role: Fortune-500 SDLC / regulated-industry strategist

---

## How IBM judges actually score

They are not scoring "coolest agent." They are scoring: *would a CIO, CISO, or VP Engineering at a GSIB / payer / OEM / telco pay IBM for this, and did Bob do multi-step engineering work that Copilot-in-VS-Code cannot?*

| Signal they want | How we show it |
|---|---|
| Bob is **core**, not a sticker | Agent mode + **subagents in parallel** + **document understanding** (PDFs, ADRs, runbooks, RFC, tickets) + Skills + custom modes |
| Multi-step workflow | Not "generate a function." A pipeline with gates, artifacts, and a human decision |
| watsonx Orchestrate | Owns the **business process** (intake → classify → approve → evidence → close). Bob owns the **code-aware work** |
| Granite | Classification / residual-risk summary / policy Q&A — the **air-gapped, auditable** model, not the code writer |
| Governance & auditability | Every artifact has actor (human\|agent), model, policy pack, session id — `bob_sessions` becomes the product |
| Not last year | Kill list below |

### Kill list (do not pitch)

- HIPAA / PHI scanners, "compliance chatbot," EU AI Act wrappers
- Generic "OWASP linter with an LLM"
- COBOL → TypeScript / Java "modernization accelerator" (watsonx Code Assistant for Z already did this; the appendix already suggests it)
- Onboarding chatbot that only explains a repo
- Unit-test generator with coverage % as the demo

### The 2026 pain thesis (use this in every pitch)

> Coding is no longer the bottleneck. **Agents now write most of the diffs.** The bottleneck is *permission to ship*: change control, control integrity, interface contracts, provenance, and production-safety of agent-authored IaC. Those artifacts live in **runbooks, ADRs, RFC PDFs, and tickets** — not in Git.

---

## Ranked top 3 (build these first)

| Rank | Codename | IBM product it wants to become | 48h win probability |
|---|---|---|---|
| **1** | **ChangeForge** | IBM Concert + watsonx Orchestrate for engineering change | Highest |
| **2** | **Agent Ledger** | watsonx.governance for coding agents (Bob enterprise control plane) | Highest differentiation |
| **3** | **TraceLock** | watsonx.governance + industrial/auto quality (ISO 26262 / IEC 62443 evidence) | Strongest regulated-industry story |

#4 **Z-Edge Sentinel** (watsonx Code Assistant for Z + Concert contract layer) — IBM-unique, but easier for judges to misread as "COBOL toy."
#5 **HashiPreflight** (HashiCorp Terraform/Vault + Bob) — extremely productizable; slightly narrower demo.

**Recommendation:** Prototype **ChangeForge** as the submission spine. Steal Agent Ledger's **session provenance pack** as a ChangeForge output artifact (one extra day of work, two judge-narratives). Keep Z-Edge as a single "blast-radius" subagent inside ChangeForge if a mainframe ICD PDF is in the dataset — you get the Z story without betting the demo on COBOL.

---

# 1. ChangeForge — Agentic Change Intelligence
**Rank: 1. Build this.**

### One-liner
The agent can write the patch. It cannot ship. ChangeForge turns a ticket + RFC PDF + ADRs + runbook + diff into a **CAB-ready evidence pack** and an Orchestrate approval workflow — or a hard block.

### Buyer (persona)
- **Economic:** VP Engineering / Head of SRE at a GSIB, insurer, or telco
- **Champion:** Change Manager + Platform Engineering
- **Blocker today:** CISO / Internal Audit ("agents are not in the change model")

### Workflow improved
**Release & deployment** + application maintenance. Specifically the 3–10 day CAB cycle that still runs on Word docs and ServiceNow comments while GitHub is already 70% agent-authored.

### Pain that exists *because* agents write the code
1. Volume: PR rate 3–5×, CAB capacity unchanged.
2. Opacity: the on-call and the CAB member did not write the change and cannot explain it.
3. Missed coupling: agents optimize the local repo and are blind to the runbook, the Fedwire cutoff, the downstream CICS contract named in an ICD PDF.
4. Audit: "who approved this?" used to mean a human. Now it must mean human + agent session + policy pack.

### Bob + watsonx split

| Layer | Does | Does not |
|---|---|---|
| **Bob IDE (core)** | Document understanding of RFC PDF, ADR set, runbook, ICD; parallel subagents: (a) code blast radius, (b) runbook delta, (c) rollback plan, (d) test gaps, (e) interface/ICD conflict; writes the patch + updated runbook + CAB markdown/PDF | Does not "approve" production |
| **Granite on watsonx.ai** | Change **risk class** (standard / normal / emergency), residual-risk paragraph, "explain this pack to a non-engineer CAB member." Air-gap story. | Not used as the code model |
| **watsonx Orchestrate** | Intake ticket → Granite classifies → wait for Bob pack → route by blast-radius (app owner, SRE, FRAUD-control owner) → merge gate → post-deploy runbook check → close ticket with evidence bundle | Does not read the repo |

This is the Orchestrate tutorial pattern (BPMN → agents) applied to **engineering ops**, not invoices.

### 48h prototype scope (do not exceed)

**Dataset (synthetic, no PI):**
- `northstar-ach/` — small Java/Spring (or Node) "ACH/Fedwire-like" payments gateway. Synthetic. No real bank data.
- `docs/ADR-00{1-5}.md` + **one ADR as PDF** (document understanding)
- `docs/RUNBOOK-ach-settlement.pdf` (cutoff windows, rollback, pages)
- `docs/RFC-rate-limit-connector.pdf`
- `tickets/CHG-*.yaml` — ServiceNow-shaped change tickets
- `cmdb/services.yaml` — fake CMDB (ach-gateway, fraud-score, zos-clearing-adapter)
- Optional: `interfaces/ACH.cpy` + `ICD-ach-clearing.pdf` (gives you the Z-Edge talking point)

**Bob skills / modes:**
- Skill: `cab-pack` (the multi-subagent pipeline)
- Custom mode: `change-agent` (can edit app + tests + runbook; **cannot** edit `infra/prod` or `controls/`)
- Rules: never ship without `evidence/CHG-xxxx/` folder

**Outputs the demo must produce:**
```
evidence/CHG-1042/
  impact.md            # blast radius vs CMDB + ADRs
  rollback.md
  runbook-diff.md
  tests-added/
  cab-briefing.md      # Granite-summarizable
  provenance.json      # agent, model, skill, session
```

**Orchestrate:** 5-state machine: `Intake → Classify → EvidenceReady → CABDecision → Closed`. Human gate on CABDecision. Show one **Approve** and one **Block** (block because RFC contradicts ADR-003 "no dual-writes to settlement store").

**Fallback if Orchestrate access is late:** local FastAPI + simple UI that is *Orchestrate-shaped* (same states, same payload). Do not let Orchestrate provisioning kill the demo.

### Demo narrative (3 minutes)

> **0:00** "Northstar Bank still has a CAB. Their agents do not."  
> **0:20** Open CHG-1042: "Rate-limit the ACH connector before 17:00 Fed cutoff." Ticket + RFC PDF on screen.  
> **0:40** Hit **Forge pack**. Bob fans out 4 subagents. Judges see Tasks running in parallel.  
> **1:20** Pack appears. Blast radius includes `zos-clearing-adapter` because the ICD PDF says field `ACH-RETRY-COUNT` is wired through. Runbook needs a new rollback step.  
> **1:50** Orchestrate: Granite classifies **Normal** (not Standard) because cutoff window + Z dependency. Routes to SRE *and* Payments Control Owner.  
> **2:10** **Path A:** Control owner approves. Merge gate opens. Provenance JSON attached to the ticket.  
> **2:30** **Path B (the money shot):** A second ticket where the agent "helpfully" dual-writes. Bob cites ADR-003 in the PDF. Orchestrate stays **Blocked**. No merge.  
> **2:50** Before/after: CAB prep 6 hours → 8 minutes. Missed-dependency Sev-1: designed out.

### Business value number / story
- Large-bank payments platform: ~250 changes/month, ~6 engineer-hours of CAB prep each → **~1,500 hours/year** of senior time (~$250–400k loaded) *before* incident cost.
- Industry rule of thumb: **~80% of unplanned downtime is change-related** (ITIL/Gartner, repeatedly). One customer-impacting ACH incident is a **regulatory notification** and a **seven-figure** operational + reputational event.
- Pitch to IBM sellers: this is **Concert's missing SDLC action layer** + **Orchestrate's first credible engineering-ops SKU**. Attach to every Bob Enterprise + HashiCorp + ServiceNow account.

### Why this wins the room
It uses **document understanding** the way the brief begged us to. It is not appendix #4 (release notes). It is the **permission-to-ship** problem.

---

# 2. Agent Ledger — Control plane for coding agents
**Rank: 2. Steal its provenance pack even if you build #1.**

### One-liner
Treat Bob (and every coding agent) as a **privileged insider**: identity, allowed-action policy, dual-control, and an evidence-grade session ledger. The thing CISOs are blocking Bob *for*, productized.

### Buyer
- **Economic:** CISO + Head of Developer Experience (joint buy)
- **Champion:** AI Governance lead, OSPO
- **This is the deal-blocker** for Bob Enterprise in every GSIB, payer, and federal SI

### Workflow improved
**Code review + release** — but the object under review is the *agent*, not only the diff.

### Pain because agents write the code
- Agents can `run`, `write`, `git push`. That is production-adjacent privilege.
- Shadow skills and over-broad auto-approve.
- No answer to Internal Audit: "which model, which ruleset, which files, which human recertified this skill?"
- `bob_sessions` screenshots are a hackathon requirement — **enterprises will pay for this as a system of record.**

### Bob + watsonx split

| Layer | Does |
|---|---|
| **Bob** | Policy-as-code: custom modes (`junior-agent`, `break-glass`), `.bobignore` as mandatory control boundary, Skills registry, rules that **refuse** to edit `auth/`, `payments/ledger`, `infra/prod` unless an exception id is in context. Generates the **session evidence pack** (the product). Actor-critic review of its own diff. |
| **Granite** | Policy Q&A against the **AI-SDLC policy PDF**. Classifies a proposed skill as Low/High privilege. Summarizes residual risk of an exception. |
| **Orchestrate** | Agent/skill **onboarding**, exception request ("junior-agent needs to touch `auth/jwt.js`"), dual-control approval, 90-day recertification, revoke. Writes the ledger. |

### 48h prototype scope
- Synthetic **AI-SDLC Policy PDF** (8–12 pages, IBM-flavored: identity, least privilege, human accountability, logging)
- Repo folders: `app/`, `auth/`, `payments/`, `infra/prod/`, `controls/`
- Two custom modes + a Skills registry YAML (`skills/catalog.yaml` with owner, expiry, privilege)
- `ledger/` JSONL: `{session_id, actor, mode, skill, paths_touched, commands, decision, exception_id}`
- Demo UI: "Agent catalog" + "Exception CHG-E-19" + session pack viewer
- Orchestrate: 3-step exception flow

**Must-show moment:** junior-agent tries to weaken JWT validation → Bob **refuses** (rule + `.bobignore`) → Orchestrate exception ticket → Granite residual-risk summary → human approves break-glass for 30 minutes → ledger records both the deny and the grant.

### Demo narrative
> "You are about to let 4,000 engineers run an agent that can execute shell. Here is the control plane IBM already has the pieces for."  
> Show the policy PDF → the mode that cannot touch `auth/` → the denied write → the Orchestrate dual-control → the evidence pack that Internal Audit would actually accept.  
> Close: "This is why Bob ships in a bank and Copilot stays in a pilot."

### Business value
- Unblocks **enterprise Bob / coding-assistant rollout** stuck in security review (typical stalled spend: **$2–10M/year** in licenses + 10–30% engineering productivity left on the table).
- Converts CISO from blocker to buyer of **watsonx.governance for SDLC agents**.
- One unauditable agent-authored production change is an **OCC/Fed/PRA conversation**. The ledger is cheaper than that conversation.

### IBM productization path
watsonx.governance (model + agent inventory) + Bob Skills/Modes + Orchestrate (exceptions) + the session summary the hackathon already forces us to screenshot. **This is the most "IBM would ship it next quarter" idea.** Slightly more abstract as a 48h *code* demo than ChangeForge — which is why it is rank 2, not 1.

---

# 3. TraceLock — Evidence-grade traceability for AI-authored code
**Rank: 3. Strongest "regulated industry, build with purpose" story. Not HIPAA.**

### One-liner
Notified bodies, ASPICE assessors, and IEC 62443 auditors do not accept "the agent vibed it." TraceLock binds **requirement PDF → design ADR → function → test → residual risk**, and **refuses untraceable agent code**.

### Buyer
- VP Software Quality / Head of Product Engineering at an **automotive Tier-1, industrial OEM, medical-device software org, or avionics supplier**
- IBM already sells here (Maximo, watsonx for manufacturing, engineering lifecycle)

### Workflow improved
**Testing + code review + release.** The workflow that currently burns 20–40% of regulated-software effort: the evidence pack.

### Pain because agents write the code
- ASPICE / ISO 26262 / IEC 62304 / DO-178C all assume a human designer who can point to a requirement ID.
- Agents generate functions with no `REQ-` tag, tests that assert implementation not requirement, and ADRs that are never updated.
- A missing trace link is not a style issue; it is a **ship-stopper** and, in auto/industrial, a **recall-class** event.

### Bob + watsonx split

| Layer | Does |
|---|---|
| **Bob** | Document understanding of **SRS PDF** + safety plan PDF; maps `REQ-*` to code symbols and tests; parallel subagents: (a) orphan requirements, (b) orphan functions, (c) tests that don't cite a REQ, (d) generate missing contract tests, (e) update ADR. Custom mode **refuses** to merge code without a REQ tag in the evidence matrix. |
| **Granite** | Classifies ASIL/SIL-like severity from the safety plan language (synthetic). Explains residual risk in assessor-English. |
| **Orchestrate** | Baseline change: "REQ-441 modified" → impact workflow to safety manager → accept new matrix → lock baseline. |

### 48h prototype scope
**Do not use PHI, patients, or HIPAA.** Use a synthetic **industrial safety controller** (pressure-relief interlock) or **automotive braking-limiter** — public-looking but fully fake.

- `docs/SRS-brake-limiter.pdf` (40–60 requirements)
- `docs/SAFETY-PLAN.pdf`
- `src/` small Python or C-like Python of the controller
- `tests/` pytest with some REQ tags, some missing
- Output: `traceability-matrix.csv` + HTML + `gaps.md` + generated tests for 3 orphan REQs
- One **blocked** PR: agent adds a "performance optimization" that removes a debounce required by REQ-017 (documented in the PDF)

### Demo narrative
> Assessor: "Show me where REQ-017 lives."  
> Today: a week of Excel.  
> TraceLock: Bob highlights the PDF paragraph, the function, the test, and the agent session that last touched it. Then we show an agent "optimization" that deletes the debounce — **blocked**, safety manager ticket in Orchestrate, Granite residual-risk: "loss of debounce may violate the 50ms plausibility window in SRS §4.2."

### Business value
- Automotive OEM software-quality organizations spend **tens of millions** per program on ASPICE evidence. Cutting matrix maintenance by 50% is a **seven-figure** program saving.
- A missed safety requirement is a recall. Takata-class and ISO 26262 war stories are understood by IBM industrial sellers.
- This is **not** a compliance chatbot. It is **SDLC evidence as a build artifact**, which is what auditors actually open.

### Why not rank 1
Document-heavy; demo can look like "we generated a spreadsheet" if the **block-the-unsafe-optimization** moment is weak. ChangeForge has a clearer 3-minute plot. Combine: ChangeForge's evidence pack *includes* a TraceLock matrix for the payments-control requirements.

---

# 4. Z-Edge Sentinel — Cross-platform interface blast radius
**Rank: 4. IBM-unique moat. Do not let it become a COBOL transpiler.**

### One-liner
Cloud agents ship JSON/Avro/OpenAPI changes that silently break **COBOL copybooks, CICS contracts, and ICD PDFs** on Z. Sentinel proves the blast radius **across the seam**. It does **not** rewrite the COBOL.

### Buyer
VP Mainframe + VP Cloud Engineering (joint), bank / insurer / airline. The only vendor who can sit both sides is IBM.

### Workflow improved
**Release + debugging + maintenance** at the Z/distributed boundary.

### Pain because agents write the code
Distributed-side agents have never seen the copybook. They rename `retryCount` → `retries` and halt clearing at 16:55.

### Bob + watsonx split
- **Bob:** parse synthetic `ACH.cpy` + `ICD-clearing.pdf` + Java/Quarkus consumer + JSON schema; subagents: field-level compatibility, adapter generation (optional), consumer contract tests, "do not ship" verdict.
- **Granite:** severity: "Fed cutoff impact / batch vs online."
- **Orchestrate:** dual CAB — *cloud CD* and *mainframe change* must both close. Classic Orchestrate two-system workflow.

### 48h prototype
No full CICS. A copybook + ICD PDF + a Spring consumer + a proposed OpenAPI diff. Demo the **incompatible rename** and the **compatible additive field**. Generate Pact-like contract tests.

### Business value
70% of F500 core systems still touch Z. One clearing-window miss is **millions in float + operational-risk capital conversations**. watsonx Code Assistant for Z is an existing SKU; this is the **contract intelligence** layer Concert should grow.

### Demo risk
Judges pattern-match "COBOL" → last year's toy. Mitigation: first slide is **"We will not transpile a single line of COBOL."** The artifact is a **compatibility verdict**, not a Java class.

**Use as a ChangeForge subagent** (`interfaces/`) rather than a standalone submission unless the team has a Z SME.

---

# 5. HashiPreflight — Agent-generated IaC evidence pack
**Rank: 5. HashiCorp acquisition made this an IBM product mandate.**

### One-liner
Agents now write Terraform, Helm, and Ansible. The new outage class is a *plausible* plan that deletes a stateful disk, opens `0.0.0.0/0`, or runs in the wrong workspace outside the change window. Preflight is **Vault-aware, runbook-aware, window-aware `terraform plan` with a human gate.**

### Buyer
Head of Platform / Cloud CoE / SRE. HashiCorp Terraform Enterprise + Vault already in the account.

### Workflow improved
**Release & deployment** (infra pipeline), the review queue that does not scale with Copilot-for-HCL.

### Pain because agents write the code
- AI Terraform looks clean and fails in production (missing `prevent_destroy`, wrong assume-role, secret in state).
- Reviewers cannot hold the runbook, the CMDB, and the 800-line plan in their head.
- Vault policies and Terraform workspaces are the real production boundary; agents don't see them.

### Bob + watsonx split
- **Bob:** document understanding of **runbook PDF** + architecture PDF; read Terraform + sentinel-like policy-as-code (synthetic OPA/Sentinel); subagents: plan interpreter, secret-in-code, blast radius vs CMDB, rollback (`terraform apply` reverse), change-window fit.
- **Granite:** risk class from plan (destroy, iam, network).
- **Orchestrate:** window calendar + dual-control for `destroy` + post-apply verification ticket.

### 48h prototype
Tiny Terraform (S3/local mock or `terraform plan -json` checked-in as a fixture so we don't need real cloud). Two plans: (A) additive, safe; (B) `aws_db_instance` destroy without snapshot + SG 0.0.0.0/0. Bob emits `preflight/CHG-88/` with **BLOCK**. Orchestrate will not open the apply gate.

### Business value
A single preventable `terraform destroy` on a stateful store is a **career-ending, regulator-visible** event. Platform teams of 30–80 spend ~30% of time reviewing IaC PRs; agent volume makes that impossible. IBM can sell this the day after a HashiCorp + Bob joint EBC.

### Why rank 5
Narrower than ChangeForge (ChangeForge can *include* an infra subagent). Weaker document-understanding spectacle unless the runbook PDF is excellent. If the team loves HCL, fold into ChangeForge as `subagent: infra-preflight`.

---

## What to actually build in 48 hours

```
northstar-change/                 ← submission spine = ChangeForge
  app/                            ← synthetic ACH gateway
  interfaces/ACH.cpy + ICD.pdf    ← Z-Edge talking point (optional but cheap)
  docs/*.pdf                      ← RFC, runbook, ADR-as-PDF, AI-SDLC policy
  tickets/                        ← CHG yaml
  controls/                       ← control catalog (so Agent Ledger rules work)
  infra/                          ← tiny Terraform (HashiPreflight subagent)
  .bob/skills/cab-pack/
  .bob/modes/change-agent|junior-agent
  evidence/                       ← generated
  ledger/                         ← Agent Ledger JSONL
  orchestrate/                    ← flow definition + fallback UI
  bob_sessions/                   ← required PNGs; also the provenance story
```

**Day 1:** synthetic repo + PDFs + Bob skill that produces a real pack (this is the demo).  
**Day 2 morning:** Orchestrate (or fallback) approval flow + Granite classify.  
**Day 2 afternoon:** the BLOCK path (ADR contradiction or JWT or terraform destroy) + provenance.json + screenshots.

If Orchestrate is painful, the fallback UI is acceptable **if** the pitch says "this is the Orchestrate contract" and you show one real Orchestrate agent from the IBM tutorial path.

---

## Judge-proof phrasing (steal these lines)

1. "Bob is the **code-aware worker**. Orchestrate is the **system of record for permission**. Granite is the **air-gapped risk classifier**."
2. "We did not build a compliance scanner. We built the **missing evidence pack** that CAB, Internal Audit, and the ASPICE assessor already demand — now that the author is an agent."
3. "Document understanding is the product: the constraint is in the **RFC PDF**, not in `main.py`."
4. "We will not transpile COBOL. We will not let a cloud agent break a copybook."
5. "The hackathon asks for `bob_sessions` screenshots. Banks will ask for the same thing as a **ledger**. We productized it."

---

## Dataset rules (do not blow eligibility)

- Fully **synthetic** Northstar Bank / Northstar Motors / Northstar Industrial. No client data, no PI, no social.
- Public references allowed for *structure* (PCI DSS categories, ISO 26262 clause names, ITIL change types) — not copyrighted full standards text. Write our own short PDFs.
- Keep a `DATA-SOURCES.md` list (even if "all synthetic").
- No real SWIFT/ACH payloads; fake field names that *look* real enough for a demo.

---

## Decision

**Ship ChangeForge.** Embed Agent Ledger provenance + one Z-interface check + one Terraform block as subagents. That is one prototype, three IBM product maps (Concert, watsonx.governance, HashiCorp/Z), and a demo that only works because **Bob reads the PDFs.**
