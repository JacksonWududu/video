import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertAudibleEntryPeak,
  effectivePeakDbfs,
  reviseIanEntryEffectsSoundDesign,
  reviseIanEntryEffectsSoundAssets,
} from './sfx-revision.mjs';

test('effective peak accounts for the fixed entry gain', () => {
  assert.equal(Math.round(effectivePeakDbfs(-2.8, 0.23) * 10) / 10, -15.6);
  assert.equal(assertAudibleEntryPeak(-15.6), -15.6);
  assert.throws(() => assertAudibleEntryPeak(-49.8), /outside/);
});

test('selective sound design keeps unselected layers silent and binds real assets', () => {
  const plan = {
    layers: [
      {layer_id: 'L01', entry_frame: 0, sound_effect: {}},
      {layer_id: 'L02', entry_frame: 60, sound_effect: {}},
    ],
    presented_map_sha256: 'b'.repeat(64),
  };
  const revised = reviseIanEntryEffectsSoundDesign(plan, {
    selectionsByLayer: {
      L01: {asset_id: 'select-click-mixkit-1109', reason: '关键状态切换'},
    },
    profilesByAssetId: {
      'select-click-mixkit-1109': {
        asset_id: 'select-click-mixkit-1109',
        role: 'select_click',
        source_path: 'leverage-video/src/shared/sound-effects/assets/select-click-mixkit-1109.wav',
        source_checksum_sha256: 'a'.repeat(64),
        trim_start_sample: 0,
        trim_end_sample_exclusive: 8820,
        gain_multiplier: 0.25,
        derived_asset: {
          asset: 'topic7/assets/audio/sfx/select-click-v3.wav',
          checksum_sha256: 'c'.repeat(64),
          sample_rate_hz: 44100,
          channels: 2,
        },
      },
    },
  });
  assert.equal(revised.layers[0].sound_effect.contract_version, 'ian-layer-entry-sfx-cue-v2');
  assert.equal(revised.layers[0].sound_effect.cue_sample, 0);
  assert.equal(revised.layers[1].sound_effect, null);
  assert.notEqual(revised.presented_map_sha256, plan.presented_map_sha256);
});

test('sound revision preserves gain and refreshes trim, asset, and map hash', () => {
  const plan = {
    layers: [{
      sound_effect: {
        role: 'short_sweep',
        gain_multiplier: 0.23,
        source: {trim_start_sample: 0, trim_end_sample_exclusive: 8820},
        derived_asset: {asset: 'old.wav', checksum_sha256: 'a'.repeat(64)},
      },
    }],
    presented_map_sha256: 'b'.repeat(64),
  };
  const revised = reviseIanEntryEffectsSoundAssets(plan, {
    short_sweep: {
      gain_multiplier: 0.23,
      trim_start_sample: 17640,
      trim_end_sample_exclusive: 26460,
      derived_asset: {asset: 'new.wav', checksum_sha256: 'c'.repeat(64)},
    },
  });
  assert.equal(revised.layers[0].sound_effect.source.trim_start_sample, 17640);
  assert.equal(revised.layers[0].sound_effect.derived_asset.asset, 'new.wav');
  assert.notEqual(revised.presented_map_sha256, plan.presented_map_sha256);
  assert.equal(plan.layers[0].sound_effect.derived_asset.asset, 'old.wav');
});
