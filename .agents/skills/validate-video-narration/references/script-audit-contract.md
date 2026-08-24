# Narration script audit contract

## Single-question test

Require one ordinary-language question that a viewer can understand before learning the professional term. Reject concept-list framing as the episode's central question.

Good:

> Why can losing money make it harder to stop?

Poor:

> Sunk cost, prospect theory, loss aversion, and the break-even effect explained.

## Candidate provenance

- Apply `local-script-resource-only-v1`. Every narration candidate must be an exact versioned copy of one uniquely resolved real top-level `*_口播稿.txt` under `/Users/jackson/Desktop/video-edit/script-resource`; its origin is `script_resource` only.
- User-pasted narration is proposed edit text, not a candidate, replacement, or Gate 2 approval. The user must update the resolved source or explicitly ask Codex to edit that exact path; Codex must not write from pasted text or general approval alone.
- After any source edit, reread the exact source path, revalidate that it is a regular non-symlink file in the resolved topic folder, compute its new SHA-256, preserve a new versioned candidate with the same checksum, and repeat the audit. For an unfinished episode, invalidate the previous audit, Gate 2 approval, locked script, audio validation, and downstream dependent artifacts.

## Research package

Search primarily in English. Prefer evidence in this order:

1. original research, systematic reviews, and meta-analyses;
2. government, university, international-organization, and professional-institution sources;
3. explanations by academic authors or authoritative institutions;
4. strong journalism, books, and public educational videos as secondary explanation;
5. platform comments, forums, and personal stories only as problem or scenario signals, never as factual proof.

Prepare at least:

- two high-quality sources directly supporting the core conclusion;
- one counterexample, limitation, or later dispute;
- one clear definition of the primary concept.

Map every substantive script claim to its evidence, the strongest wording the evidence permits, and wording it does not permit. A materially unsupported claim blocks Gate 2 until the user updates the resolved source file or explicitly asks Codex to edit that exact path. Do not silently delete, downgrade, or rewrite it.

## Content structure audit

Before the general structure audit, record the episode-opening sentence:

- Run `python3 .agents/skills/validate-video-narration/scripts/record_first_sentence.py <candidate-path> --expected-sha256 <candidate-sha256>`. Preserve its passing `opening-first-sentence-record-v1` output, which binds the exact first complete sentence and UTF-8 byte range to the current versioned `script_resource` candidate checksum.
- Do not require a fixed brand prefix or extract the topic from this sentence. Punctuation, added introductory wording, or another natural first sentence cannot by itself block Gate 2.
- `.agents/skills/validate-video-narration/scripts/validate_opening_topic.py` and `opening-topic-extraction-v1` are retired historical evidence only. Do not invoke or emit them for a new or revised active audit. A missing or ambiguous complete first sentence still blocks because `OPEN-00` needs one exact narration span; show that content problem without silently rewriting it.

Check that the script contains one recognizable situation, one central question, one primary knowledge point, no more than two necessary supporting points, an important limit or counterexample, and one useful closing judgment question.

Use this 100–240 second structure as an audit reference, not as permission to rewrite the script or estimate final timing:

| Time | Content | Purpose |
|---|---|---|
| 0–8 s | Counterintuitive question or conflict | Stop the viewer |
| 8–35 s | Concrete situation and rising problem | Establish recognition |
| 35–100 s | Primary knowledge point | Explain why |
| 100–160 s | Necessary mechanism or example | Add required depth |
| 160–205 s | Counterexample, boundary, or alternative | Avoid false certainty |
| 205–240 s | Reflection question and conclusion | Leave a usable idea |

A shorter episode may merge the supporting-point and boundary sections. Even a longer episode must remain centered on one question. Treat roughly 400–1000 Chinese characters only as a review signal; the validated narration audio remains the sole timing authority.

## Language and communication audit

- Begin with people and a situation, not terminology.
- Keep each sentence focused on one idea where practical.
- Explain a professional term immediately in ordinary language.
- Avoid listing three or more concepts in succession.
- Reject absolutes such as “science proves,” “human nature is,” or “everyone will.”
- Do not distort research for a stronger hook.
- A character may demonstrate faulty reasoning, but the narration must not present it as advice.
- Do not derive investment actions from a life analogy.
- Prefer a useful closing judgment question over generic encouragement.

Check that the conflict is understandable in the first three seconds, the viewer can recognize the relevant experience within fifteen seconds, the story still works without jargon, the episode has one conclusion, and the ending is worth retaining or sharing.

## Factual and platform-risk audit

For every substantive claim, check source support, population generalization, correlation-versus-causation, concept conflation, material limitations, and counterexamples.

Also check for stock recommendations, return promises, gambling instructions, loan funnels, diagnosis of the viewer, unsupported legal or medical conclusions, named gambling platforms, odds or recovery steps, and any required AI-content label, source note, or disclaimer.

## Gate 2 review package

Present:

1. working title;
2. one-sentence conclusion;
3. concept breakdown;
4. evidence boundaries that must remain;
5. source list;
6. the complete current versioned candidate exactly as resolved from the local source;
7. suggested description and any necessary disclaimer;
8. character count and estimated duration, clearly marked as estimates before audio validation.
9. `opening-first-sentence-record-v1` evidence containing the exact first sentence and candidate-bound byte range; no topic extraction or brand-prefix validation.

Ask the user to judge whether the opening feels real, the situation is natural, the voice fits the channel, any sentence is too formal, verbose, or misleading, and whether the exact text is approved. Research verification, concept distinctions, counting, and risk analysis remain Codex's responsibility; the user is not required to review every paper.
