import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {buildKnowledgeVideoSoundDesign} from '../sound-effects/build-sound-design.mjs';
import {buildSoundEffectDerivedWav} from '../sound-effects/build-derived-wav.mjs';
import {loadAndValidateSharedSoundEffectLibrary} from '../sound-effects/contract.mjs';
import {buildSoundDesignMapSha256, deriveSoundDesignCandidateEvents} from '../sound-effects/sound-design.mjs';
import {buildFlipbookOpeningSoundBinding, buildFlipbookOpeningSoundScopes, loadFlipbookOpeningSoundDesign,
  preflightFlipbookOpeningSound, validateFlipbookOpeningRenderAudio} from './flipbook-opening-sound.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const library = loadAndValidateSharedSoundEffectLibrary({repositoryRoot});
const waveform = samples => {
  const bytes = Buffer.alloc(44 + samples * 4);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(44100, 24); bytes.writeUInt32LE(176400, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 4, 40);
  for (let i = 0; i < samples; i += 1) {
    const time = i / 44100;
    const value = Math.round(1800 * Math.sin(2 * Math.PI * (230 * time + 31 * time * time)));
    bytes.writeInt16LE(value, 44 + i * 4); bytes.writeInt16LE(value, 46 + i * 4);
  }
  return bytes;
};

const fixture = t => {
  const root = fs.mkdtempSync(path.join(repositoryRoot, 'leverage-video/src/flipbook-opening-sound-test-'));
  t.after(() => fs.rmSync(root, {recursive: true}));
  const episodeWorkspace = path.relative(repositoryRoot, root);
  fs.mkdirSync(path.join(root, 'schema'));
  fs.mkdirSync(path.join(root, 'assets/audio'), {recursive: true});
  const narration = waveform(90 * 1470);
  const narrationPath = `${episodeWorkspace}/assets/audio/narration.wav`;
  fs.writeFileSync(path.join(repositoryRoot, narrationPath), narration);
  const bindings = Object.fromEntries(['storyboard', 'visual_manifest', 'visual_rhythm', 'transition_review']
    .map(key => [key, {path: `${episodeWorkspace}/schema/${key}.json`, checksum_sha256: 'a'.repeat(64)}]));
  bindings.narration_master = {path: narrationPath, checksum_sha256: sha(narration)};
  bindings.sound_effect_library = structuredClone(library.manifest);
  const decisions = candidates => candidates.map(candidate => {
    const role = candidate.anchor_kind === 'shot-boundary' ? 'page_turn' : 'state_change';
    const asset = library.assets.find(item => item.semantic_roles.includes(role));
    const derived = buildSoundEffectDerivedWav({repositoryRoot, episodeWorkspace, libraryValidation: library,
      assetId: asset.asset_id, outputPath: `${episodeWorkspace}/assets/audio/sfx/${candidate.event_id.replaceAll(':', '-')}.wav`,
      trimStartSample: 0, trimEndSample: Math.round(asset.sample_rate_hz * 0.1)});
    const reason = candidate.anchor_kind === 'shot-boundary' ? '实体封面于第24帧打开，翻动纸张' : '闭合书或正文开始时的克制入场标记';
    return {event_id: candidate.event_id, decision: 'audible', reason, semantic_role: role,
      intensity: 'micro', asset_id: asset.asset_id, gain_multiplier: 0.12, derived_asset: derived,
      selection_basis: {selection_method: 'hard-gates-then-deterministic-ranking-v1', visible_event: reason,
        visual_route: 'illustrated-flipbook', material: asset.timbre_family, motion_direction: 'none',
        energy: 'micro', attack_class: 'transient', duration_fit: 'pretrimmed', narration_masking_risk: 'low',
        semantic_role: role, selected_asset_id: asset.asset_id, selected_reason: reason,
        hard_gate_results: {license: true, media: true, semantic_role: true, motion_direction: true}, rejected_candidates: []}};
  });
  const bodyShots = [{shot_id: 'S01', start_frame: 0, end_frame: 90, transition: null}];
  const bodyDesign = buildKnowledgeVideoSoundDesign({resume_mode: 'standard', episode_workspace: episodeWorkspace,
    duration_frames: 90, shots: bodyShots, semantic_events: [], event_decisions: decisions(deriveSoundDesignCandidateEvents(bodyShots)), bindings},
  {repositoryRoot, libraryValidation: library});
  const bodyPlan = {schema_version: 'knowledge-video-assembly-plan-v3', full_master_frames: 90,
    timeline: {first_sentence_end_frame: 30},
    narration_asset: narrationPath.replace(/^leverage-video\/src\//, ''), bgm: {mode: 'disabled', source: null, track: null},
    sound_effects: {contract_version: 'knowledge-video-sound-effect-track-v2', resume_mode: 'standard',
      policy: bodyDesign.bindings.sound_design_policy, library: library.manifest, narration_gain: 1, normalization: 'disabled',
      peak_ceiling_dbfs: -1, overflow_action: 'lower-sfx-bus-uniformly', audio_preflight_policy: 'required-before-first-full-render-v1',
      bus_gain_multiplier: bodyDesign.bus_gain_multiplier, cues: bodyDesign.events},
    qa_contract: {sound_design: {resume_mode: 'standard', bindings: bodyDesign.bindings}}};
  const openingCover = {hold_frames: 24, open_frames: 30,
    image: {path: `${episodeWorkspace}/assets/image/cover.png`, checksum_sha256: 'b'.repeat(64), width: 1920, height: 1080}};
  const scopes = buildFlipbookOpeningSoundScopes({openingCover, bodyFrames: 90});
  const design = buildKnowledgeVideoSoundDesign({resume_mode: 'standard', episode_workspace: episodeWorkspace,
    duration_frames: 144, shots: scopes, semantic_events: [], event_decisions: decisions(deriveSoundDesignCandidateEvents(scopes)), bindings},
  {repositoryRoot, libraryValidation: library});
  design.opening_adapter = buildFlipbookOpeningSoundBinding({openingCover, bodyPlan});
  const manifest = {opening_cover: openingCover};
  const save = () => {
    design.event_map_sha256 = buildSoundDesignMapSha256(design);
    const bytes = Buffer.from(JSON.stringify(design));
    const target = `${episodeWorkspace}/schema/opening-sound-v1.json`;
    fs.writeFileSync(path.join(repositoryRoot, target), bytes);
    manifest.opening_sound_design = {path: target, checksum_sha256: sha(bytes)};
  };
  save();
  return {root, manifest, bodyPlan, design, save, repositoryRoot, episodeWorkspace};
};

test('opening sound uses real library WAVs and preserves the body plan while validating all three sample anchors', t => {
  const input = fixture(t);
  const before = structuredClone(input.bodyPlan);
  const validated = loadFlipbookOpeningSoundDesign(input);
  assert.deepEqual(validated.validation.audible_cues.map(cue => [cue.cue_frame, cue.sync_frame]), [[0, 0], [24, 54]]);
  const preflight = preflightFlipbookOpeningSound(input);
  assert.equal(preflight.evidence.narration_delay_samples, 79380);
  assert.equal(preflight.evidence.decoded_sample_count, 144 * 1470);
  assert.deepEqual(preflight.plan.sound_effects.cues.map(cue => cue.cue_frame), [0, 24, 54]);
  assert.deepEqual(input.bodyPlan, before);
});

test('missing sound decisions, stale adapter hashes and mutated WAVs cannot authorize a cover mix', t => {
  const input = fixture(t);
  assert.throws(() => loadFlipbookOpeningSoundDesign({...input, manifest: {...input.manifest, opening_sound_design: null}}), /binding/);
  input.design.opening_adapter.body_assembly_plan_sha256 = 'c'.repeat(64); input.save();
  assert.throws(() => loadFlipbookOpeningSoundDesign(input), /body-plan hash/);
  input.design.opening_adapter = buildFlipbookOpeningSoundBinding({openingCover: input.manifest.opening_cover, bodyPlan: input.bodyPlan});
  const removed = input.design.events.pop(); input.save();
  assert.throws(() => loadFlipbookOpeningSoundDesign(input), /missing sound-design candidate/);
  input.design.events.push(removed); input.save();
  fs.appendFileSync(path.join(repositoryRoot, input.design.events[0].derived_asset.path), 'changed');
  assert.throws(() => loadFlipbookOpeningSoundDesign(input), /bytes are missing or stale/);
});

test('decoded AAC verifies exact presentation samples and rejects a one-frame narration offset', t => {
  const input = fixture(t);
  const preflight = preflightFlipbookOpeningSound(input);
  const render = (name, filters, frames = 144) => {
    const target = path.join(input.root, 'assets/audio', name);
    const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', ...preflight.inputArgs,
      '-filter_complex', filters.join(';'), '-map', '[mix]', '-c:a', 'aac', '-b:a', '192k', '-t', String(frames / 30), target], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    return target;
  };
  const accepted = validateFlipbookOpeningRenderAudio({renderPath: render('accepted.m4a', preflight.filters), preflight});
  assert.equal(accepted.expected_sample_count, 144 * 1470);
  const prefix = validateFlipbookOpeningRenderAudio({renderPath: render('prefix.m4a', preflight.filters, 84), preflight, renderFrames: 84});
  assert.equal(prefix.expected_sample_count, 84 * 1470);
  const shifted = preflight.filters.map(filter => filter.replace('adelay=delays=79380S:all=1,apad', 'adelay=delays=80850S:all=1,apad'));
  assert.throws(() => validateFlipbookOpeningRenderAudio({renderPath: render('shifted.m4a', shifted), preflight}), /sample-aligned/);
});
