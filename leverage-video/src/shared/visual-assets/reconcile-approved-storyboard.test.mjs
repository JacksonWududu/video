import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

import {buildReconciledState} from './reconcile-approved-storyboard.mjs';

const ROOT = new URL('../../../../', import.meta.url);

const toSevenColumnStoryboard = (bytes) => {
  const markdown = bytes.toString('utf8');
  const durations = new Map([...markdown.matchAll(
    /^## (OPEN-00|S\d+)\n[\s\S]*?^- 时间 \/ 帧：[0-9.]+–[0-9.]+ 秒；旁白与合成 `\[(\d+), (\d+)\)`/gm,
  )].map((match) => [
    match[1],
    ((Number(match[3]) - Number(match[2])) / 30).toFixed(3),
  ]));
  const converted = markdown.split('\n').map((line) => {
    if (line === '| 镜头 | 画面 | 白猫 | 生图方式 | 可见文字 | 锁稿原文 |') {
      return '| 镜头 | 时长（秒） | 画面 | 白猫 | 分镜生成方式 | 可见文字 | 锁稿原文 |';
    }
    if (line === '|---|---|---|---|---|---|') return '|---|---|---|---|---|---|---|';
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length === 6 && durations.has(cells[0])) {
      return `| ${cells[0]} | ${durations.get(cells[0])} | ${cells.slice(1).join(' | ')} |`;
    }
    return line;
  }).join('\n');
  return Buffer.from(converted);
};

test('reconciles the approved storyboard into one ordered active queue', () => {
  const state = JSON.parse(fs.readFileSync(new URL('leverage-video/src/topic4/schema/episode-state.json', ROOT)));
  const storyboardBytes = toSevenColumnStoryboard(
    fs.readFileSync(new URL('leverage-video/src/topic4/assets/narration/storyboard-v2.md', ROOT)),
  );
  const directionBytes = fs.readFileSync(new URL('leverage-video/src/topic4/schema/per-shot-visual-direction-review-v3-approved-v2.json', ROOT));
  const storyboardChecksum = crypto.createHash('sha256').update(storyboardBytes).digest('hex');
  state.current_phase = 'storyboard_review_approved';
  state.storyboard_review.approved_checksum_sha256 = storyboardChecksum;
  state.active_storyboard.checksum_sha256 = storyboardChecksum;
  state.visual_asset_review.status = 'invalidated_by_visual_contract_change';
  state.visual_asset_review.queue_generation_allowed = false;
  state.visual_asset_review.queue = state.visual_asset_review.queue
    .filter((item) => item.visual_generation_route !== 'ink-doodle-knowledge-card')
    .map((item) => item.active_for_current_storyboard === false ? item : ({
      ...item,
      active_for_current_storyboard: false,
      status: 'blocked_pending_reapproved_storyboard',
      prior_status: 'pending_generation',
    }));
  const result = buildReconciledState({
    state,
    storyboardBytes,
    directionBytes,
    reconciledAt: '2026-08-17T21:54:36+08:00',
  });
  const active = result.visual_asset_review.queue.filter((item) => item.active_for_current_storyboard !== false);
  assert.equal(result.current_phase, 'visual_production');
  assert.equal(active.length, 48);
  assert.equal(active[0].asset_id, 'S01-ink-state-00-v01');
  assert.equal(active.at(-1).asset_id, 'S18-action-03-v01');
  assert.equal(active.filter((item) => item.shot_id === 'S01').length, 4);
  assert.equal(active.filter((item) => item.shot_id === 'S05').length, 3);
  assert.equal(active.some((item) => ['doodle-slides', 'comic-imagegen'].includes(item.visual_generation_route)), false);
});
