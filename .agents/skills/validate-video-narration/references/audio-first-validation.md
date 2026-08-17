# User-audio-first narration validation

## Preserve and inspect sources

- Ask the user whether audio lookup may begin and record the explicit permission. Do not inspect audio files before permission.
- After permission, inspect only the already resolved script-resource topic folder. Prefer exact top-level `voice.mp3`; otherwise require exactly one real regular top-level `voice*.mp3`. Never scan sibling folders or select by modification time.
- For `revoice_variant`, replace the standard preference rule with exact selection: require the user to name one basename matching `voice*.mp3` and explicitly permit that exact file, reject path separators, and inspect only that real top-level file even when other voice files coexist.
- Require a readable, nonempty, real regular file and reject symbolic links.
- Never overwrite the resolved source audio, its archived copy, or the source narration file.
- Record the original path, byte size, and checksum; copy the exact bytes under `<episode-workspace>/assets/audio/user-source/` with a versioned filename and verify matching checksums. Standard and `revoice_variant` ingestion share this sole user-source archive category; never create `<episode-workspace>/audio/`.
- For `revoice_variant`, also record the parent source/master paths and checksums, require the replacement source checksum to differ from the parent source checksum, and preserve every parent audio artifact unchanged.
- Use `ffprobe` to record duration, codec, sample rate, channel count, and bitrate.
- Decode the full source once with `ffmpeg -v error`. Reject any file that does not decode cleanly.
- If conversion is necessary, create a new versioned lossless PCM WAV under `<episode-workspace>/assets/audio/` while preserving the immutable archived source under `assets/audio/user-source/`.

## Audit words and meaning

- Transcribe the complete audio locally with timestamps. Use word-level timestamps for suspicious regions, and do not send audio to an external service without explicit user permission.
- Compare audio against the exact locked script, checking numbers, formulas, proper nouns, financial terms, repeated phrases, omissions, and additions.
- Treat ASR as evidence, not truth. Correct an ASR transcript only when the spoken audio and locked script support the correction.
- Stop before downstream production if speech is missing, clipped, duplicated, or materially different from the locked script.
- A revoice replacement must preserve the same spoken lexical content and order. Voice, cadence, pauses, and total duration may change; any changed word, number, name, formula, term, omission, addition, repetition, or reordering exits the voice-only route.

## Audit pauses and edit points

- Run silence detection and inspect word gaps around suspicious cuts.
- Classify each pause as sentence ending, rhetorical pause, clause pause, or invalid mid-phrase pause.
- Flag clipped endings, abrupt joins, repeated mechanical gaps, pauses inside grammatical units, and topic jumps without a complete sentence.
- Do not treat ASR segment boundaries as valid edit points by themselves.

## Repair reversibly

- Write every repair to a new versioned output such as `*-fixed-v01.wav` or `*-approved-v01.wav`.
- Cut only inside verified silence and use a short 10–30 ms crossfade to prevent clicks.
- Preserve speaker identity, pitch, speed, loudness, and wording unless the user explicitly authorizes a broader change.
- Create short before/after comparison clips for every subjective or material edit.

## Validate the master

- Fully decode the repaired file and re-measure its real duration.
- Re-run silence detection and word-level transcription around every edit.
- Check clipping, missing/repeated syllables, channel changes, and noise at joins.
- Record the master checksum, exact duration, codec, sample rate, channels, script checksum, and passing QA evidence.
- Derive all subtitles, scene boundaries, state schedules, transitions, and composition duration from this master only.
- Locate the exact end of the locked first sentence in the timestamped transcript and audio. Record its timestamp and `first_sentence_end_frame = ceil(timestamp_seconds × 30)` under rule ID `opening-first-sentence-boundary-v1`; verify that the corresponding audio interval contains the complete first sentence and no spoken word from the next sentence. This frame is the single opening-cover end boundary under `cover-only-v1`.
- Never reuse timestamps from an earlier narration version.
- In `revoice_variant`, label the validated output as the replacement narration master for that `variant_id`; do not replace the parent master or its timing evidence.

## Subtitle boundary

Mechanical subtitle segmentation may change line breaks only. It must not change spoken wording, numbers, paragraph order, or meaning.
