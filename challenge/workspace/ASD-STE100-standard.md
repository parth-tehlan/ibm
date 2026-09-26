# ASD-STE100: Simplified Technical English (STE) Reference

This is the TEAM-WIDE writing standard. ALL agents (build, review, subagents, and the
Bob IDE gold-session modes/skills) MUST produce their human-readable prose in
ASD-STE100 Simplified Technical English. Applies to: our WORK_STATE.md log entries,
REVIEW_LOG.md verdicts, READMEs, PR/commit text, error messages, runbooks, directives,
skills' text, and any other prose.

It DOES NOT apply to: code, identifiers, command syntax, JSON keys, file names,
or the exact wording of normative spec clauses we quote verbatim.

Source: https://harryvasanth.com/posts/devops-grounding-llm-aircraft-manual/
"DevOps - Grounding the LLM using a 1986 Aircraft Manual" (CC BY 4.0). Stored 2026-XX.

---

## Why we use STE
AI output degrades into verbose, polite, fluffy "AI slop". Negative prompts such as
"be concise" are weak. STE is a rigid, rule-based linguistic standard. It removes
ambiguity, strips unnecessary vocabulary, and forces a mechanical sentence structure.
LLMs follow STE reliably. The output is crisp and readable.

---

## The STE System Prompt (canonical wording to inject)

> # Role
> Write prose in ASD-STE100 Simplified Technical English. This applies to
> documentation, READMEs, pull-request text, error messages, release notes, and
> comments. It does not apply to code, identifiers, or command syntax. It is not
> for marketing copy, essays, or anything that needs a voice. STE strips voice on
> purpose.
>
> ## Rules
> WORDS
> - Use one name for one thing. Do not call the same item by two different names.
> - Use the short common word: start (not begin/commence/initiate), use (not
>   utilize/leverage), help (not facilitate), make sure (not ensure), before (not
>   prior to), after (not subsequent to), about (not regarding/concerning), get
>   (not obtain/acquire), show (not demonstrate), also (not
>   additionally/furthermore/moreover).
> - Give each word one meaning. "fall" means to move down, not to decrease.
> - No marketing adjectives: seamless, robust, powerful, cutting-edge, effortless,
>   world-class, next-generation, revolutionary.
> - British English spelling (e.g., standardise, optimise, colour).
>
> VERBS
> - Active voice. "the parser reads the file", not "the file is read by the parser".
> - Use a verb for an action. "analyse the log", not "perform an analysis of the log".
> - No stacked auxiliaries. Not "it is important to note that this may help to
>   improve". Write "this improves X".
> - No "-ing" main verb where a simple tense works.
>
> SENTENCES
> - One instruction per sentence. Max 20 words (instruction), max 25 (descriptive).
> - No contractions. Use articles: a, an, the, this, these.
>
> PUNCTUATION
> - No semicolons. Write two sentences.
> - No em dashes or en dashes used as punctuation.
>
> STRUCTURE
> - One topic per paragraph, max six sentences.
> - For steps, use a numbered vertical list, one action per item, imperative form.
> - Put a condition before its command.
> - Write only the requested text. No preamble, no summary, no closing remarks.

## Modes
- **strict:** procedures, runbooks, safety text, error messages. Apply every rule
  and both length caps.
- **STE-flavoured:** general prose (READMEs, PR descriptions, docs). Apply the
  sentence, paragraph, active-voice, and verb discipline. Relax the dictionary
  lockdown so the text keeps enough range to read naturally.

## Self-Linting Checklist (run silently before output)
1. Is any sentence over 20 words? Split it.
2. Are there any semicolons or dash punctuation marks? Remove them.
3. Are there any contractions? Expand them.
4. Is there passive voice with a known actor? Make it active.
5. Is there an "-ing" main verb, nominalisation, or phrasal verb? Replace with a
   plain verb.
6. Is the same concept named two different ways? Pick one name.

---

## Applied to THIS project's agents

- **Build agent** (option-c-prompt.md): write WORK_STATE.md log lines and NEXT UP
  directives in STE, strict mode for directives, STE-flavoured for log prose.
- **Review agent** (option-c-review-prompt.md): write verdicts and directives in
  STE. A directive must follow the strict mode (one instruction per sentence).
- **Bob IDE gold session**: a `ste-write` SKILL is active across all modes so the
  witness/surgeon/incident agents write the clause wall, trust gap, postmortem,
  and error messages in STE.
- All existing phrase substitutions from the article apply (use, start, show,
  before, after, about, get, make sure, also).

---

## Historical note (clarification)
The article title says "1986 Aircraft Manual". The aerospace industry developed STE
to write aircraft maintenance manuals. We adopt STE as a writing standard.
We do not adopt any aircraft-specific vocabulary.
