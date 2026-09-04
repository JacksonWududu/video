import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {prepareFlipbookCaptionImages,muxFlipbookCapture,validateFlipbookCaptionSources} from './flipbook-media.mjs';
import {deriveSoundDesignCandidateEvents} from '../sound-effects/sound-design.mjs';
const cue={cue_id:'S01-C01',source_text:'这是一句测试。',display_text:'这是一句测试',start_frame:0,end_frame:45};
test('caption sources bind exact current spread words, order and timing',()=>{
 const spreads=[{shot_id:'S01',start_frame:0,duration_frames:60,static_spread:{source_text:cue.source_text}}];
 const cues=[{...cue,shot_id:'S01'}];
 validateFlipbookCaptionSources(cues,spreads);
 assert.throws(()=>validateFlipbookCaptionSources([{...cues[0],source_text:'换成别的文案。'}],spreads),/current ordered spread/);
 assert.throws(()=>validateFlipbookCaptionSources([{...cues[0],end_frame:61}],spreads),/current ordered spread/);
 assert.throws(()=>validateFlipbookCaptionSources([...cues,{...cues[0],shot_id:'S02'}],spreads),/extra or reordered/);
});
test('locked captions render once as readable transparent images and reject changed words',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flipbook-caption-test-'));
 try {
  const images=await prepareFlipbookCaptionImages({cues:[cue],totalFrames:60,outputDirectory:path.join(root,'accepted')});
  const metadata=await sharp(images[0].path).metadata();
  assert.equal(metadata.hasAlpha,true);assert.ok(metadata.width<=1680);assert.ok(metadata.height<200);
  await assert.rejects(()=>prepareFlipbookCaptionImages({cues:[{...cue,display_text:'偷换文案'}],totalFrames:60,outputDirectory:path.join(root,'rejected')}),/caption bytes/);
  assert.equal(fs.existsSync(path.join(root,'rejected')),false);
 } finally {fs.rmSync(root,{recursive:true});}
});
test('browser media cannot render production from self-reported pass fields',async()=>{
 await assert.rejects(()=>muxFlipbookCapture({manifest:{action_classification:'new_video'},outputPath:'/private/tmp/flipbook-not-created.mp4',evidencePath:'/private/tmp/flipbook-not-created.json',role:'caption_free_master',productionPreflight:()=>({result:'pass'})}),/executing current gates/);
});
test('static spread sound design retains opening and page turn coverage without fictitious Ian layers',()=>{
 const shots=[{shot_id:'S01',start_frame:0,end_frame:120,presentation_mode:'illustrated-flipbook',text_reveals:[{id:'R1',start_frame:0,end_frame:6}],transition:{kind:'book-page-turn',duration_in_frames:15}},{shot_id:'S02',start_frame:120,end_frame:240,presentation_mode:'illustrated-flipbook',text_reveals:[{id:'R1',start_frame:120,end_frame:126}],transition:null}];
 const events=deriveSoundDesignCandidateEvents(shots);
 assert.deepEqual(events.filter(e=>e.required_audible).map(e=>[e.anchor_kind,e.cue_frame]),[['shot-opening',0],['shot-boundary',105]]);
 assert.equal(events.filter(e=>e.anchor_kind==='flipbook-text-reveal'&&!e.required_audible).length,2);
 assert.throws(()=>deriveSoundDesignCandidateEvents([{...shots[0],ian_layered_scene:{entry_effects:{layers:[]}}}]),/cannot invent/);
});
