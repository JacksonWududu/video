import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveTransitionRecommendation, validateUserApprovedTransition, applyTransitionRecommendationDiversity} from './contract.mjs';
import {FLIPBOOK_RENDERER} from '../flipbook-video/profile.mjs';
const context = {boundaryChangeClass:'route_change', sourceVisualGenerationRoute:'imagegen', nextVisualGenerationRoute:'ian-handdrawn-ppt', whiteCatVisualStyleId:'illustrated-flipbook'};
const row = () => ({
  contract_version:'scene-transition-v3', catalog_version:'scene-transition-catalog-v3', source_shot_id:'S01', next_shot_id:'S02',
  boundary_change_class:context.boundaryChangeClass, source_visual_generation_route:context.sourceVisualGenerationRoute, next_visual_generation_route:context.nextVisualGenerationRoute,
  source_white_cat_present:false, next_white_cat_present:false, white_cat_visual_style_id:'illustrated-flipbook',
  ...resolveTransitionRecommendation(context), kind:'book-page-turn',options:{},duration_seconds:0.5,duration_in_frames:15,
  source_intent:'完整书页翻至下一组双页',renderer:FLIPBOOK_RENDERER,
  user_selection:{status:'approved',exact_message:'确认翻页',decided_at:'2026-09-05T00:00:00+08:00',presented_map_sha256:'a'.repeat(64)},
});
const validate = value => validateUserApprovedTransition(value,{fps:30,sourceShotId:'S01',nextShotId:'S02'});
test('flipbook physical turn is catalogued and keeps its exact renderer and approved duration', () => {
  assert.equal(validate(row()).kind,'book-page-turn');
  assert.equal(applyTransitionRecommendationDiversity(Array.from({length:14},row)).rows.every(x=>x.proposed_transition.kind==='book-page-turn'),true);
});
test('flipbook rejects fake cut, wrong renderer, unapproved turn, cat, and normal-style use', () => {
  for (const change of [{kind:'cut',duration_seconds:0,duration_in_frames:0},{renderer:'leverage-video/src/shared/scene-transitions'},{duration_seconds:0.7,duration_in_frames:21},{user_selection:{status:'pending'}},{white_cat_visual_style_id:'loose-line-vivid-watercolor'}]) assert.throws(()=>validate({...row(),...change}));
  assert.throws(()=>resolveTransitionRecommendation({...context,sourceWhiteCatPresent:true}), /no-cat/);
});
