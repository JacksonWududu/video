#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {atomicWriteJson} from '../episode-tooling/file-integrity.mjs';
import {loadAndValidateSharedSoundEffectLibrary} from './contract.mjs';
import {
  GLOBAL_SOUND_EFFECT_RENDER_OWNER,
  IAN_SOUND_EFFECT_RENDER_OWNER,
  KNOWLEDGE_VIDEO_SOUND_DESIGN_POLICY,
  KNOWLEDGE_VIDEO_SOUND_DESIGN_VERSION,
  buildSoundDesignMapSha256,
  deriveSoundDesignCandidateEvents,
  validateKnowledgeVideoSoundDesign,
} from './sound-design.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(HERE, '../../../..');

const silentDecision = (candidate, reason) => ({
  ...candidate,
  decision: 'silent',
  reason,
  semantic_role: null,
  intensity: null,
  render_owner: null,
  source: null,
  derived_asset: null,
  gain_multiplier: null,
  qa_result: null,
});

const buildAudibleDecision = ({candidate, decision, library, defaultOwner = null}) => {
  const asset = library.assets.find(({asset_id: assetId}) => assetId === decision.asset_id);
  if (!asset || !asset.semantic_roles.includes(decision.semantic_role)) {
    throw new Error(`no active shared sound effect matches ${candidate.event_id}/${decision.semantic_role}`);
  }
  return {
    ...candidate,
    decision: 'audible',
    reason: decision.reason,
    semantic_role: decision.semantic_role,
    intensity: decision.intensity,
    render_owner: decision.render_owner ?? defaultOwner ?? GLOBAL_SOUND_EFFECT_RENDER_OWNER,
    source: {
      asset_id: asset.asset_id,
      path: asset.path,
      checksum_sha256: asset.checksum_sha256,
      provider: asset.provider,
      source_item_url: asset.source_item_url,
      license_url: asset.license_url,
    },
    derived_asset: structuredClone(decision.derived_asset),
    gain_multiplier: decision.gain_multiplier,
    qa_result: 'pass',
  };
};

const buildIanDecision = ({candidate, shot, library}) => {
  const entry = shot.ian_layered_scene.entry_effects.layers.find(
    ({layer_id: layerId}) => layerId === candidate.ian_layer_id,
  );
  const cue = entry?.sound_effect;
  if (cue === null) return silentDecision(candidate, 'Ian 分层入场方案已锁定为静音');
  if (!cue) throw new Error(`${candidate.event_id} has no locked Ian entry cue decision`);
  const asset = library.assets.find(({asset_id: assetId}) => assetId === cue.source.asset_id);
  if (!asset || !asset.semantic_roles.includes(cue.role)) {
    throw new Error(`${candidate.event_id} Ian cue is absent from the active semantic library`);
  }
  return buildAudibleDecision({
    candidate,
    library,
    defaultOwner: IAN_SOUND_EFFECT_RENDER_OWNER,
    decision: {
      asset_id: cue.source.asset_id,
      semantic_role: cue.role,
      intensity: 'micro',
      reason: cue.selection_reason,
      gain_multiplier: cue.gain_multiplier,
      derived_asset: {
        path: `leverage-video/src/${cue.derived_asset.asset}`,
        asset: cue.derived_asset.asset,
        checksum_sha256: cue.derived_asset.checksum_sha256,
        sample_rate_hz: 44100,
        channels: 2,
        format: 'wav',
        source_sample_rate_hz: asset.sample_rate_hz,
        trim_start_sample: cue.source.trim_start_sample,
        trim_end_sample: cue.source.trim_end_sample_exclusive,
        duration_in_frames: Math.ceil((
          (cue.source.trim_end_sample_exclusive - cue.source.trim_start_sample)
          / asset.sample_rate_hz
        ) * 30),
        runtime_transform: 'forbidden',
      },
    },
  });
};

export const buildKnowledgeVideoSoundDesign = (input, {
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  libraryValidation = null,
  verifyFiles = true,
} = {}) => {
  if (input?.resume_mode !== 'standard') {
    throw new Error('standard sound-design builder cannot analyze a revoice variant');
  }
  const library = libraryValidation ?? loadAndValidateSharedSoundEffectLibrary({repositoryRoot});
  const mechanical = deriveSoundDesignCandidateEvents(input.shots);
  const semantic = (input.semantic_events ?? []).map((event) => ({
    ...structuredClone(event),
    candidate_source: 'semantic',
  }));
  const candidates = [...mechanical, ...semantic];
  const decisions = new Map((input.event_decisions ?? []).map((decision) => [
    decision.event_id,
    decision,
  ]));
  if (decisions.size !== (input.event_decisions ?? []).length) {
    throw new Error('sound-design event decisions contain duplicate event ids');
  }
  const shotsById = new Map(input.shots.map((shot) => [shot.shot_id, shot]));
  const events = candidates.map((candidate) => {
    if (candidate.anchor_kind === 'ian-layer-entry') {
      return buildIanDecision({candidate, shot: shotsById.get(candidate.shot_id), library});
    }
    const decision = decisions.get(candidate.event_id);
    if (!decision) throw new Error(`sound-design analysis is missing: ${candidate.event_id}`);
    decisions.delete(candidate.event_id);
    if (decision.decision === 'silent') return silentDecision(candidate, decision.reason);
    if (decision.decision !== 'audible') throw new Error(`${candidate.event_id} decision is invalid`);
    return buildAudibleDecision({candidate, decision, library});
  });
  if (decisions.size > 0) {
    throw new Error(`sound-design decisions reference unknown events: ${[...decisions.keys()].join(', ')}`);
  }
  const value = {
    contract_version: KNOWLEDGE_VIDEO_SOUND_DESIGN_VERSION,
    status: 'qa_passed',
    resume_mode: 'standard',
    revoice: null,
    episode_workspace: input.episode_workspace,
    fps: 30,
    duration_frames: input.duration_frames,
    policy: structuredClone(KNOWLEDGE_VIDEO_SOUND_DESIGN_POLICY),
    bindings: structuredClone(input.bindings),
    bus_gain_multiplier: input.bus_gain_multiplier ?? 1,
    shot_analysis: input.shots.map((shot) => ({
      shot_id: shot.shot_id,
      storyboard_content_analyzed: true,
      visible_action_analysis: 'complete',
      local_video_action_analysis: shot.local_video == null ? 'not_applicable' : 'complete',
      candidate_event_ids: events.filter(({shot_id: shotId}) => shotId === shot.shot_id)
        .map(({event_id: eventId}) => eventId),
    })),
    events,
    event_map_sha256: '',
    result: 'pass',
  };
  value.event_map_sha256 = buildSoundDesignMapSha256(value);
  validateKnowledgeVideoSoundDesign(value, {
    shots: input.shots,
    durationFrames: input.duration_frames,
    episodeWorkspace: input.episode_workspace,
    repositoryRoot,
    libraryValidation: library,
    expectedBindings: input.bindings,
    verifyFiles,
  });
  return value;
};

const main = () => {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    throw new Error('usage: build-sound-design.mjs <analysis-input.json> <sound-design.json>');
  }
  const input = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  atomicWriteJson(outputPath, buildKnowledgeVideoSoundDesign(input));
  process.stdout.write(`${path.resolve(outputPath)}\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
