#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  FORM_MODEL_CONTRACT_VERSION,
  MERGE_ACTION_STATE_POLICY,
  MERGE_VISUAL_INHERITANCE_POLICY,
  SUBMISSION_CONTRACT_VERSION,
  buildVisualDirectionFormModel,
} from './contract.mjs';
import {validateEpisodeMergeRequestFile} from './validate-merge-request.mjs';
import {buildPresentedMapSha256} from '../visual-generation-routes/contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
const FENCE = '`'.repeat(3);

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

const resolveRootRelative = (rootRelativePath, label) => {
  if (typeof rootRelativePath !== 'string' || rootRelativePath === '' || path.isAbsolute(rootRelativePath)) {
    throw new Error(`${label} must be root-relative`);
  }
  const resolved = path.resolve(REPOSITORY_ROOT, rootRelativePath);
  if (!resolved.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) throw new Error(`${label} escapes repository root`);
  return resolved;
};

const pendingSelection = () => ({
  status: 'pending',
  white_cat_present: null,
  visual_structure_id: null,
  treatment_profile_id: null,
  visual_generation_route: null,
  comic_plan: null,
  visible_text_mode: null,
  exact_visible_text: null,
  visible_text_placement: null,
  local_video_source_path: null,
  exact_message: null,
  decided_at: null,
  presented_map_sha256: null,
});

const summaryCell = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('|', '&#124;')
  .replaceAll('\n', '<br>');

const parseSections = (markdown) => {
  const matches = [...markdown.matchAll(/^## (OPEN-00|S[0-9]{2,})\n/gm)];
  if (matches.length < 2 || matches[0][1] !== 'OPEN-00') throw new Error('storyboard detailed sections are invalid');
  return matches.map((match, index) => ({
    shot_id: match[1],
    start: match.index,
    end: matches[index + 1]?.index ?? markdown.length,
    text: markdown.slice(match.index, matches[index + 1]?.index ?? markdown.length),
  }));
};

const parseTime = (section) => {
  const line = section.text.match(/^- 时间 \/ 帧：.*$/m)?.[0];
  if (!line) throw new Error(`${section.shot_id} timing line is missing`);
  const timing = line.match(/^- 时间 \/ 帧：([0-9.]+)–([0-9.]+) 秒；旁白与合成 `\[(\d+), (\d+)\)`(?:；(\d+) 帧(.*))?。$/);
  if (!timing) throw new Error(`${section.shot_id} timing line is invalid`);
  return {
    line,
    start_seconds: timing[1],
    end_seconds: timing[2],
    start_frame: Number(timing[3]),
    end_frame: Number(timing[4]),
    frame_count: timing[5] === undefined ? null : Number(timing[5]),
    frame_suffix: timing[6] ?? '',
  };
};

const sourceTextPayload = (section) => {
  const marker = `- 锁稿原文 source_text：\n${FENCE}text\n`;
  const start = section.text.indexOf(marker);
  if (start < 0) throw new Error(`${section.shot_id} source_text block is missing`);
  const payloadStart = start + marker.length;
  const payloadEnd = section.text.indexOf(FENCE, payloadStart);
  if (payloadEnd < 0) throw new Error(`${section.shot_id} source_text fence is incomplete`);
  return {
    marker,
    start: payloadStart,
    end: payloadEnd,
    value: section.text.slice(payloadStart, payloadEnd),
  };
};

const visualProjection = (row) => ({
  scene_class: row.scene_class,
  structured_visual_kind: row.structured_visual_kind ?? null,
  factual_identity: row.factual_identity,
  white_cat_recommendation: row.white_cat_recommendation,
  visual_language_recommendation: row.visual_language_recommendation,
  comic_eligibility: row.comic_eligibility,
  comic_plan_candidate: row.comic_plan_candidate ?? null,
  visible_text_mode: row.visible_text_mode,
  exact_visible_text: row.exact_visible_text ?? null,
  visible_text_placement: row.visible_text_placement ?? null,
  local_video_source_path: row.local_video_source_path ?? null,
  presented_candidate_selection: row.presented_candidate_selection ?? null,
  compatible_routes: row.compatible_routes,
  incompatible_routes: row.incompatible_routes,
  incompatible_route_reasons: row.incompatible_route_reasons,
  recommended_route: row.recommended_route,
  recommendation_reason: row.recommendation_reason,
});

const replaceSummaryTable = ({
  markdown,
  reviewShotIds,
  validation,
  mergedSourceText,
  mergedDurationSeconds,
}) => {
  const lines = markdown.split('\n');
  const headerIndex = lines.indexOf('| 镜头 | 时长（秒） | 画面 | 白猫 | 分镜生成方式 | 可见文字 | 锁稿原文 |');
  if (headerIndex < 0 || lines[headerIndex + 1] !== '|---|---|---|---|---|---|---|') {
    throw new Error('storyboard Summary header is invalid');
  }
  let endIndex = headerIndex + 2;
  while (lines[endIndex]?.startsWith('| ')) endIndex += 1;
  const rows = lines.slice(headerIndex + 2, endIndex).map((line) => {
    const cells = line.slice(1, -1).split('|').map((cell) => cell.trim());
    if (cells.length !== 7) throw new Error('storyboard Summary row is invalid');
    return {shot_id: cells[0], cells};
  });
  const byId = new Map(rows.map((row) => [row.shot_id, row]));
  const survivorRow = byId.get(validation.surviving_shot_id);
  if (!survivorRow) throw new Error('survivor Summary row is missing');
  const renumberByOldId = new Map(validation.renumber_map.map((entry) => [entry.old_shot_id, entry]));
  const outputRows = [byId.get('OPEN-00')];
  for (const oldShotId of reviewShotIds) {
    const entry = renumberByOldId.get(oldShotId);
    if (entry.disposition === 'merged_into') continue;
    const sourceRow = byId.get(oldShotId);
    const cells = [...sourceRow.cells];
    cells[0] = entry.new_shot_id;
    if (entry.disposition === 'merged_survivor') {
      cells[1] = mergedDurationSeconds;
      cells[6] = summaryCell(mergedSourceText);
    }
    outputRows.push({shot_id: cells[0], cells});
  }
  const replacement = [
    lines[headerIndex],
    lines[headerIndex + 1],
    ...outputRows.map((row) => `| ${row.cells.join(' | ')} |`),
  ];
  lines.splice(headerIndex, endIndex - headerIndex, ...replacement);
  return lines.join('\n');
};

const transformSurvivorSection = ({section, firstTime, lastTime, mergedSourceText, validation}) => {
  const totalFrames = lastTime.end_frame - firstTime.start_frame;
  const holdFrames = lastTime.end_frame - firstTime.end_frame;
  const mergedTimingLine = `- 时间 / 帧：${firstTime.start_seconds}–${lastTime.end_seconds} 秒；旁白与合成 \`[${firstTime.start_frame}, ${lastTime.end_frame})\`；${totalFrames} 帧${lastTime.frame_suffix}。`;
  let transformed = section.text.replace(firstTime.line, mergedTimingLine);
  const source = sourceTextPayload({...section, text: transformed});
  transformed = `${transformed.slice(0, source.start)}${mergedSourceText}${transformed.slice(source.end)}`;

  const ignored = validation.ignored_member_visual_contract_shot_ids.map((shotId) => `\`${shotId}\``).join('、');
  const inheritanceLine = `- 合并视觉继承：\`${MERGE_VISUAL_INHERITANCE_POLICY}\`；视觉源 \`${validation.surviving_shot_id}\`；忽略 ${ignored} 的画面、类型、白猫、分镜生成方式与可见文字。原首镜动作族仅在 \`[${firstTime.start_frame}, ${firstTime.end_frame})\` 播放一次，最终视觉态在 \`[${firstTime.end_frame}, ${lastTime.end_frame})\` 保持 ${holdFrames} 帧。`;
  const outgoing = transformed.match(/^- 出场转场：.*$/m);
  if (outgoing) {
    transformed = transformed.replace(outgoing[0], `${inheritanceLine}\n- 出场转场：终端干净保持，无出场转场。`);
  } else {
    const marker = '- 锁稿原文 source_text：';
    transformed = transformed.replace(marker, `${inheritanceLine}\n- 出场转场：终端干净保持，无出场转场。\n${marker}`);
  }
  return transformed;
};

const transformStoryboard = ({markdown, review, validation}) => {
  const sections = parseSections(markdown);
  const byId = new Map(sections.map((section) => [section.shot_id, section]));
  const memberSections = validation.merged_source_shot_ids.map((shotId) => byId.get(shotId));
  if (memberSections.some((section) => !section)) throw new Error('merge member detailed section is missing');
  const memberTimes = memberSections.map(parseTime);
  memberTimes.forEach((timing, index) => {
    if (index > 0 && memberTimes[index - 1].end_frame !== timing.start_frame) {
      throw new Error('merge member timing is not contiguous');
    }
  });
  const mergedSourceText = memberSections.map((section) => sourceTextPayload(section).value).join('');
  const sourceVisualSection = memberSections[0];
  const transformedSurvivor = transformSurvivorSection({
    section: sourceVisualSection,
    firstTime: memberTimes[0],
    lastTime: memberTimes.at(-1),
    mergedSourceText,
    validation,
  });
  const sectionMap = new Map(validation.renumber_map.map((entry) => [entry.old_shot_id, entry]));
  const transformedSections = sections.map((section) => {
    if (section.shot_id === 'OPEN-00') return section.text;
    const entry = sectionMap.get(section.shot_id);
    if (entry.disposition === 'merged_into') return '';
    if (entry.disposition === 'merged_survivor') return transformedSurvivor;
    if (entry.disposition === 'renumbered') {
      return section.text.replace(`## ${entry.old_shot_id}\n`, `## ${entry.new_shot_id}\n`);
    }
    return section.text;
  }).join('');
  const preamble = markdown.slice(0, sections[0].start);
  let newPreamble = replaceSummaryTable({
    markdown: preamble,
    reviewShotIds: review.rows.map((row) => row.shot_id),
    validation,
    mergedSourceText,
    mergedDurationSeconds: ((memberTimes.at(-1).end_frame - memberTimes[0].start_frame) / 30).toFixed(3),
  });
  newPreamble = newPreamble.replace(/^(# .*分镜草案) v1$/m, '$1 v2');
  return {
    markdown: `${newPreamble}${transformedSections}`,
    merged_source_text: mergedSourceText,
    original_action_window: {
      start_frame: memberTimes[0].start_frame,
      end_frame: memberTimes[0].end_frame,
    },
    final_state_hold: {
      start_frame: memberTimes[0].end_frame,
      end_frame: memberTimes.at(-1).end_frame,
      duration_in_frames: memberTimes.at(-1).end_frame - memberTimes[0].end_frame,
    },
  };
};

const nextReviewRows = ({review, validation, inheritance}) => {
  const entries = new Map(validation.renumber_map.map((entry) => [entry.old_shot_id, entry]));
  return review.rows.flatMap((row) => {
    const entry = entries.get(row.shot_id);
    if (entry.disposition === 'merged_into') return [];
    const next = structuredClone(row);
    if (entry.disposition === 'merged_survivor') {
      next.merge_visual_inheritance = inheritance;
      next.selection_history = [
        ...(next.selection_history ?? []),
        {reason: 'storyboard_shot_merge_represent', prior_user_selection: next.user_selection},
      ];
      next.user_selection = pendingSelection();
    } else if (entry.disposition === 'renumbered') {
      next.renumbered_from_shot_id = entry.old_shot_id;
      next.shot_id = entry.new_shot_id;
      next.selection_history = [
        ...(next.selection_history ?? []),
        {reason: 'storyboard_shot_merge_renumber_represent', prior_user_selection: next.user_selection},
      ];
      next.user_selection = pendingSelection();
    }
    return [next];
  });
};

const validateNarrationAndTiming = ({storyboardMarkdown, lockedScript}) => {
  const sections = parseSections(storyboardMarkdown);
  const times = sections.map(parseTime);
  times.forEach((timing, index) => {
    if (index > 0 && times[index - 1].end_frame !== timing.start_frame) {
      throw new Error(`storyboard timing gap or overlap before ${sections[index].shot_id}`);
    }
  });
  const payload = sections.map((section) => sourceTextPayload(section).value).join('');
  const firstText = sourceTextPayload(sections[0]).value;
  const lockedStart = lockedScript.indexOf(firstText);
  if (lockedStart < 0 || lockedScript.slice(lockedStart) !== payload) {
    throw new Error('merged storyboard narration does not exactly cover the locked script body');
  }
  return {
    exact_locked_body_match: true,
    first_frame: times[0].start_frame,
    final_frame: times.at(-1).end_frame,
    active_row_count: sections.length,
  };
};

const buildArtifacts = ({episodeWorkspace, requestPath, processedAt}) => {
  const validation = validateEpisodeMergeRequestFile({episodeWorkspace, requestPath});
  const requestBytes = fs.readFileSync(path.resolve(requestPath));
  const workspacePath = resolveRootRelative(episodeWorkspace, 'episode workspace');
  const statePath = path.join(workspacePath, 'schema/episode-state.json');
  const stateBytes = fs.readFileSync(statePath);
  const state = JSON.parse(stateBytes);
  const reviewPath = resolveRootRelative(state.visual_direction_review.path, 'visual direction review path');
  const reviewBytes = fs.readFileSync(reviewPath);
  const review = JSON.parse(reviewBytes);
  const storyboardPath = resolveRootRelative(review.storyboard.path, 'storyboard path');
  const storyboardBytes = fs.readFileSync(storyboardPath);
  const storyboardMarkdown = storyboardBytes.toString('utf8');
  const lockedPath = resolveRootRelative(state.locked_script.path, 'locked script path');
  const lockedBytes = fs.readFileSync(lockedPath);

  const sourcePath = state.narration_script?.source_path;
  const sourceStat = fs.lstatSync(sourcePath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('narration source is not a real regular file');
  if (sha256(fs.readFileSync(sourcePath)) !== state.narration_script.source_checksum_sha256) {
    throw new Error('narration source checksum changed; return to Gate 2');
  }

  const transformed = transformStoryboard({markdown: storyboardMarkdown, review, validation});
  const storyboardCoverage = validateNarrationAndTiming({
    storyboardMarkdown: transformed.markdown,
    lockedScript: lockedBytes.toString('utf8'),
  });
  if (storyboardCoverage.active_row_count !== validation.resulting_active_row_count) {
    throw new Error('resulting storyboard active row count is incorrect');
  }

  const survivorBefore = review.rows.find((row) => row.shot_id === validation.surviving_shot_id);
  const inheritance = {
    policy: MERGE_VISUAL_INHERITANCE_POLICY,
    source_shot_id: validation.surviving_shot_id,
    ignored_visual_contract_shot_ids: validation.ignored_member_visual_contract_shot_ids,
    action_state_policy: MERGE_ACTION_STATE_POLICY,
    original_action_window: transformed.original_action_window,
    final_state_hold: transformed.final_state_hold,
  };
  const rows = nextReviewRows({review, validation, inheritance});
  const survivorAfter = rows.find((row) => row.shot_id === validation.surviving_shot_id);
  if (JSON.stringify(visualProjection(survivorAfter)) !== JSON.stringify(visualProjection(survivorBefore))) {
    throw new Error('surviving shot visual contract changed during merge');
  }

  const stamp = processedAt.replaceAll('-', '').replaceAll(':', '');
  const newStoryboardRelative = `${episodeWorkspace}/assets/narration/storyboard-draft-v2.md`;
  const newReviewRelative = `${episodeWorkspace}/schema/per-shot-visual-direction-review-v3-merge-v1.json`;
  const requestArchiveRelative = `${episodeWorkspace}/schema/storyboard-shot-merge-request-${stamp}-v1.json`;
  const validationArchiveRelative = `${episodeWorkspace}/schema/storyboard-shot-merge-validation-${stamp}-v1.json`;
  const newStoryboardBytes = Buffer.from(transformed.markdown);

  const oldPresentation = review.presentation;
  const presentationMessage = `已按 ${MERGE_VISUAL_INHERITANCE_POLICY} 合并 S18、S19、S20：保留 S18 完整视觉契约，S19、S20 仅并入原文与时间；通过完整 19 行七列表单重新呈现。`;
  const nextReview = structuredClone(review);
  nextReview.status = 'partially_approved';
  nextReview.storyboard = {
    path: newStoryboardRelative,
    checksum_sha256: sha256(newStoryboardBytes),
  };
  nextReview.generated_shot_count = rows.length;
  nextReview.presentation_history = [
    ...(nextReview.presentation_history ?? []),
    {...oldPresentation, presented_map_sha256: review.presented_map_sha256},
  ];
  nextReview.presentation = {
    presented_at: processedAt,
    exact_message: presentationMessage,
    surface_contract_version: FORM_MODEL_CONTRACT_VERSION,
    submission_contract_version: SUBMISSION_CONTRACT_VERSION,
    submission_modes: ['all', 'selected'],
    form_writes_episode_files: false,
  };
  nextReview.rows = rows;
  nextReview.shot_merge_history = [
    ...(nextReview.shot_merge_history ?? []),
    {
      processed_at: processedAt,
      request_contract_version: JSON.parse(requestBytes).contract_version,
      source_review_path: state.visual_direction_review.path,
      source_review_checksum_sha256: state.visual_direction_review.checksum_sha256,
      source_storyboard_path: review.storyboard.path,
      source_storyboard_checksum_sha256: review.storyboard.checksum_sha256,
      visual_inheritance: inheritance,
      renumber_map: validation.renumber_map,
    },
  ];
  nextReview.presented_map_sha256 = buildPresentedMapSha256(nextReview);
  for (const row of nextReview.rows) {
    if (row.user_selection?.status !== 'approved') continue;
    const priorMap = row.user_selection.presented_map_sha256;
    row.user_selection = {
      ...row.user_selection,
      presented_map_sha256: nextReview.presented_map_sha256,
      prior_presented_map_sha256: priorMap,
      binding_basis: 'mechanically_rebound_after_first_shot_merge_with_unchanged_visual_projection',
      rebound_at: processedAt,
    };
  }
  const newReviewBytes = jsonBytes(nextReview);

  buildVisualDirectionFormModel({
    review: nextReview,
    storyboardMarkdown: transformed.markdown,
    episodeWorkspace,
  });

  const processingValidation = {
    ...validation,
    processing_result: 'pass',
    processed_at: processedAt,
    survivor_visual_contract_validation: 'pass_unchanged',
    narration_coverage_validation: storyboardCoverage,
    first_shot_visual_inheritance: inheritance,
    resulting_storyboard: {
      path: newStoryboardRelative,
      checksum_sha256: sha256(newStoryboardBytes),
    },
    resulting_visual_direction_review: {
      path: newReviewRelative,
      checksum_sha256: sha256(newReviewBytes),
      presented_map_sha256: nextReview.presented_map_sha256,
    },
  };
  const validationBytes = jsonBytes(processingValidation);

  const nextState = structuredClone(state);
  const priorPresentation = {
    presented_at: state.visual_direction_review.presented_at,
    exact_message: state.visual_direction_review.exact_presentation_message,
    artifact_checksum_sha256: state.visual_direction_review.checksum_sha256,
    presented_map_sha256: state.visual_direction_review.presented_map_sha256,
  };
  nextState.visual_direction_review = {
    ...nextState.visual_direction_review,
    status: 'partially_approved',
    path: newReviewRelative,
    checksum_sha256: sha256(newReviewBytes),
    presented_map_sha256: nextReview.presented_map_sha256,
    generated_shot_count: rows.length,
    presented_at: processedAt,
    exact_presentation_message: presentationMessage,
    prior_surface_presentations: [
      ...(nextState.visual_direction_review.prior_surface_presentations ?? []),
      priorPresentation,
    ],
    shot_merge_history: [
      ...(nextState.visual_direction_review.shot_merge_history ?? []),
      {
        processed_at: processedAt,
        request_path: requestArchiveRelative,
        request_checksum_sha256: sha256(requestBytes),
        validation_path: validationArchiveRelative,
        validation_checksum_sha256: sha256(validationBytes),
        source_presented_map_sha256: validation.presented_map_sha256,
        resulting_presented_map_sha256: nextReview.presented_map_sha256,
        visual_inheritance: inheritance,
        renumber_map: validation.renumber_map,
      },
    ],
  };
  const newStateBytes = jsonBytes(nextState);

  return {
    result: 'pass',
    validation: processingValidation,
    output: {
      storyboard: {relative: newStoryboardRelative, bytes: newStoryboardBytes},
      review: {relative: newReviewRelative, bytes: newReviewBytes},
      request: {relative: requestArchiveRelative, bytes: requestBytes},
      validation: {relative: validationArchiveRelative, bytes: validationBytes},
      state: {relative: `${episodeWorkspace}/schema/episode-state.json`, bytes: newStateBytes},
    },
  };
};

const writeArtifacts = (artifacts) => {
  const ordered = [
    artifacts.output.storyboard,
    artifacts.output.request,
    artifacts.output.validation,
    artifacts.output.review,
  ];
  for (const artifact of ordered) {
    const target = resolveRootRelative(artifact.relative, 'output path');
    if (fs.existsSync(target)) throw new Error(`output already exists: ${artifact.relative}`);
  }
  for (const artifact of ordered) {
    const target = resolveRootRelative(artifact.relative, 'output path');
    fs.writeFileSync(target, artifact.bytes, {flag: 'wx'});
  }
  const stateTarget = resolveRootRelative(artifacts.output.state.relative, 'episode state path');
  const stateTemporary = `${stateTarget}.first-shot-merge.tmp`;
  if (fs.existsSync(stateTemporary)) throw new Error('episode state temporary path already exists');
  fs.writeFileSync(stateTemporary, artifacts.output.state.bytes, {flag: 'wx'});
  fs.renameSync(stateTemporary, stateTarget);
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [episodeWorkspace, requestPath, mode, processedAt] = process.argv.slice(2);
  if (!episodeWorkspace || !requestPath || !['--dry-run', '--apply'].includes(mode) || !processedAt) {
    console.error('usage: node apply-first-shot-merge.mjs <episode-workspace> <request.json> <--dry-run|--apply> <processed-at>');
    process.exit(2);
  }
  try {
    const artifacts = buildArtifacts({episodeWorkspace, requestPath, processedAt});
    if (mode === '--apply') writeArtifacts(artifacts);
    process.stdout.write(`${JSON.stringify({
      result: artifacts.result,
      mode,
      validation: artifacts.validation,
      output_paths: Object.fromEntries(Object.entries(artifacts.output).map(([key, value]) => [key, value.relative])),
    }, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
