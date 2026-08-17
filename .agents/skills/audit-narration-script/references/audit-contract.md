# Standalone narration audit contract

## Evidence audit

Treat a claim as substantive when its truth affects the script's conclusion, safety, credibility, or recommended judgment. Examples include causal claims, quantities, dates, quotations, research findings, diagnoses, legal duties, platform rules, and descriptions of named people or institutions.

For each substantive claim:

1. Search for the strongest available evidence.
2. Prefer sources in this order:
   - original research, systematic reviews, and meta-analyses;
   - government, university, international-organization, and professional-institution sources;
   - official documentation, datasets, standards, judgments, or policies;
   - explanations by the original academic authors or responsible institutions;
   - strong journalism and books only as secondary explanation.
3. Use jurisdiction-specific official sources in the applicable language when the claim concerns a local law, regulation, policy, or platform rule.
4. Map the claim to what the evidence supports, what it does not support, the relevant population and time range, and any material counterexample or later dispute.
5. Distinguish correlation from causation, individual anecdotes from population evidence, and a plausible mechanism from demonstrated effect.
6. Mark a material claim `无法核实` when authoritative evidence cannot be found. Never fill the gap with a weak source, search snippet, forum post, or invented citation.

Use direct Markdown links near the supported finding. Paraphrase sources; quote only when exact wording matters and keep quotations short.

If the script has no externally verifiable substantive claim, record `未发现需外部核验的实质性主张`. Do not browse merely to decorate the report and do not fabricate an evidence table.

## Content structure audit

Check whether the script has:

- one viewer-understandable central question;
- one recognizable situation or conflict;
- one primary knowledge point and no more supporting concepts than the listener can follow;
- a clear movement from situation to explanation to boundary or counterexample;
- one conclusion consistent with the evidence;
- a useful closing judgment, question, or takeaway.

Flag concept-list framing, unexplained jumps, repeated conclusions, missing logical links, examples that do not prove the stated rule, and endings that introduce a new thesis.

## Spoken-language audit

Check whether:

- the opening conflict is understandable without prior specialist knowledge;
- each sentence carries one main idea where practical;
- professional terms are explained immediately in ordinary language;
- numbers, names, formulas, and quotations can be understood when heard once;
- long modifiers, stacked abstractions, written-language transitions, and repeated rhetorical questions impair delivery;
- the tone remains natural for speech without weakening factual precision.

Do not treat personal style as an error. Mark a language issue only when it harms comprehension, pacing, credibility, or the stated audience fit.

## Platform and safety audit

Check for:

- investment recommendations, return promises, gambling instructions, loan funnels, or recovery schemes;
- diagnosis of the viewer or unsupported medical, legal, or financial conclusions;
- instructions that facilitate wrongdoing, self-harm, dangerous acts, or evasion;
- defamation, fabricated quotations, privacy exposure, or unjustified claims about identifiable people;
- absolutes such as `科学证明`, `人性就是`, `所有人都会`, or equivalent claims stronger than the evidence;
- current platform disclosure, labeling, disclaimer, or sourcing requirements when relevant.

Verify any current platform rule through an official source before stating it. Describe risk precisely; do not issue generic disclaimers unrelated to the script.

## Opening advisory

Compare the first complete sentence with `苏格拉底的猫今天聊的是，<主题>` and its ASCII-comma variant. A mismatch, empty topic, or extra prefix is always a `提示` in this standalone audit. It cannot by itself change `可用` to a worse conclusion.

## Severity and conclusion

- `关键`: a material factual, safety, attribution, or platform problem that makes the current wording unreliable or unsafe.
- `主要`: a structural, evidentiary, or communication defect that materially weakens understanding or credibility.
- `次要`: a localized clarity, pacing, or wording issue.
- `提示`: optional channel-format or polish advice, including the opening advisory.

Choose the overall conclusion mechanically:

- `不建议按现稿发布` when any unresolved `关键` issue remains;
- `修改后可用` when no `关键` issue remains but at least one `主要` issue remains;
- `可用` when only `次要` or `提示` issues remain, or no issue is found.

## Output limits

Return only the five required Chinese sections. Keep each finding tied to a short exact excerpt. Provide localized modification directions, not replacement prose for the complete script. Do not create files, workflow evidence, Gate decisions, locks, audio actions, or hidden publication approval.
