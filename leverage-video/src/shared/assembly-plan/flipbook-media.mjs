import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';
import {validateBrowserRecordingProof} from '../flipbook-video/contract.mjs';
import {measureBrowserCaptureClock} from '../flipbook-video/capture-clock.mjs';
import {sha256File, verifyFileChecksum, atomicWriteJson} from '../episode-tooling/file-integrity.mjs';
import {normalizeCaptionDisplayText} from '../audio-tools/caption-cues.mjs';
import {probeMedia, validateVideo} from '../render-qa/media-qa.mjs';
import {preflightSoundMix, buildSoundMixInputs} from '../../../../.agents/skills/assemble-video-master/scripts/preflight-sound-mix.mjs';
import {validateRenderSoundMix} from '../../../../.agents/skills/assemble-video-master/scripts/validate-render-sound-mix.mjs';
import {preflightFlipbookOpeningSound, validateFlipbookOpeningRenderAudio} from './flipbook-opening-sound.mjs';

export const FLIPBOOK_CAPTION_RENDERER = 'knowledge-video-flipbook-bottom-captions-v1';
const escape = text => text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const fail = message => {throw new Error(`flipbook media: ${message}`);};
const readBound = (root, binding) => {
  if (typeof binding?.path !== 'string' || path.isAbsolute(binding.path) || binding.path.split('/').includes('..')) fail('safe relative media binding required');
  let target = path.resolve(root);
  for (const part of binding.path.split('/')) {
    target = path.join(target, part);
    if (fs.lstatSync(target).isSymbolicLink()) fail('media bindings may not follow symlinks');
  }
  verifyFileChecksum(target,binding.checksum_sha256); return target;
};

export const prepareFlipbookCaptionImages = async ({cues, totalFrames, outputDirectory, firstCaptionFrame = 0}) => {
  if (!Array.isArray(cues) || !cues.length) fail('captioned role requires locked cues');
  if (fs.existsSync(outputDirectory)) fail('caption raster directory already exists');
  let end = 0; const ids = new Set();
  for (const cue of cues) {
    if (!/^[A-Za-z0-9_-]+$/.test(cue.cue_id ?? '') || ids.has(cue.cue_id)
      || !Number.isInteger(cue.start_frame) || !Number.isInteger(cue.end_frame)
      || cue.start_frame < end || cue.end_frame <= cue.start_frame || cue.end_frame > totalFrames
      || typeof cue.source_text !== 'string' || !cue.display_text
      || normalizeCaptionDisplayText(cue.source_text) !== cue.display_text) fail('caption bytes, order or timing differ from the locked cue contract');
    ids.add(cue.cue_id); end = cue.end_frame;
  }
  if (cues[0].start_frame !== firstCaptionFrame) fail('first caption must start with the locked narration');
  fs.mkdirSync(outputDirectory,{recursive:true});
  const images = [];
  for (const cue of cues) {
    const text = await sharp({text:{text:`<span foreground="#fffdf7">${escape(cue.display_text)}</span>`,
      font:'PingFang SC Semi-Bold 46',width:1620,align:'center',dpi:72,rgba:true,wrap:'word-char',spacing:15}})
      .png().toBuffer({resolveWithObject:true});
    if (text.info.height > 150) fail('caption exceeds two readable lines; split its locked cue upstream');
    const width = text.info.width+60; const height=text.info.height+32;
    const bg=Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" rx="14" fill="#18140f" fill-opacity="0.78"/></svg>`);
    const file=path.join(outputDirectory,`${cue.cue_id}.png`);
    await sharp(bg).composite([{input:text.data,left:30,top:15}]).png().toFile(file);
    images.push({...cue,path:file,width,height,checksum_sha256:sha256File(file)});
  }
  return images;
};

export const validateFlipbookCaptionSources = (cues, spreads) => {
  if (!Array.isArray(cues) || !cues.length) fail('captioned role requires locked cues');
  let cursor = 0;
  for (const spread of spreads) {
    const group = [];
    while (cues[cursor]?.shot_id === spread.shot_id) group.push(cues[cursor++]);
    if (!group.length || group.map(cue => cue.source_text).join('') !== spread.static_spread.source_text
      || group.some(cue => cue.start_frame < spread.start_frame
        || cue.end_frame > spread.start_frame + spread.duration_frames)) {
      fail('caption sources or timing do not cover the current ordered spread text');
    }
  }
  if (cursor !== cues.length) fail('caption sources contain extra or reordered shots');
};

export const muxFlipbookCapture = async ({manifest, manifestPath, manifestChecksum, captureLock, captureRoot, repositoryRoot,
  outputPath, evidencePath, role, productionPreflight, captionBinding = null, captionImageDirectory = null}) => {
  if (fs.existsSync(outputPath) || fs.existsSync(evidencePath)) fail('outputs must be new versioned files');
  const maintenance=manifest.action_classification==='project_maintenance';
  if (maintenance && (role!=='maintenance-preview' || !manifest.narration.path.startsWith('leverage-video/src/shared/flipbook-video/fixtures/'))) fail('maintenance output is a synthetic preview only');
  const verified=maintenance ? null : productionPreflight?.({manifest,action:'render'});
  if (!maintenance && (!verified || verified.then || !verified.plan)) fail('production render requires executing current gates');
  if (typeof manifestPath !== 'string') fail('exact manifest file is required');
  verifyFileChecksum(manifestPath, manifestChecksum);
  if (JSON.stringify(JSON.parse(fs.readFileSync(manifestPath,'utf8'))) !== JSON.stringify(manifest)) fail('manifest object differs from its locked file');
  if (typeof role !== 'string') fail('explicit render role required');
  const plan=verified?.plan;
  const openingFrames=manifest.opening_cover ? manifest.opening_cover.hold_frames+manifest.opening_cover.open_frames : 0;
  if (!maintenance && openingFrames !== verified.opening_frames) fail('opening frames differ from the executed production gate');
  const prefix=role.endsWith('_opening')||role.endsWith('_first_shot_prefix');
  const captioned=role==='captioned_master'||role==='captioned_opening'||role==='captioned_first_shot_prefix';
  const targetFrames=prefix?plan?.timeline.first_sentence_end_frame+openingFrames:manifest.total_frames;
  if (!Number.isInteger(targetFrames) || targetFrames<1) fail('valid render frame count required');
  if (!maintenance && role!=='caption-neutral-base') {
    const selectedRoles=prefix?verified.required_internal_qa_roles:verified.required_delivery_roles;
    const modes={caption_free_only:['caption_free_master'],captioned_only:['captioned_master'],both:['caption_free_master','captioned_master']};
    const masterRole=prefix?(captioned?'captioned_master':'caption_free_master'):role;
    if (verified.caption_delivery?.status!=='selected' || !Array.isArray(selectedRoles)
      || !selectedRoles.includes(role) || !modes[verified.caption_delivery.mode]?.includes(masterRole)) fail('role was not explicitly selected');
  }
  if (captureLock.contract_version!=='knowledge-video-browser-capture-lock-v1' || captureLock.result!=='pass'
    || captureLock.manifest_checksum_sha256!==manifestChecksum) fail('capture lock is stale');
  const recording=readBound(captureRoot,captureLock.capture);
  const proofPath=readBound(captureRoot,captureLock.proof);
  const proof=JSON.parse(fs.readFileSync(proofPath,'utf8'));
  validateBrowserRecordingProof(proof,manifest,manifestChecksum);
  const sourceProbe=probeMedia(recording);
  const video=sourceProbe.streams.find(stream=>stream.codec_type==='video');
  if (!video || video.width<1920 || video.height<1080 || Math.abs(video.width/video.height-16/9)>0.002
    || sourceProbe.streams.some(stream=>stream.codec_type==='audio')) fail('source capture must be a 16:9 silent browser recording');
  const clock=measureBrowserCaptureClock({capturePath:recording,proofPath,manifestPath});
  if (clock.evidence.inputs.capture.checksum_sha256!==captureLock.capture.checksum_sha256
    || clock.evidence.inputs.proof.checksum_sha256!==captureLock.proof.checksum_sha256
    || clock.evidence.inputs.manifest.checksum_sha256!==manifestChecksum) fail('capture clock inputs differ from locked files');
  for (const input of Object.values(clock.evidence.inputs)) input.path=path.relative(repositoryRoot,input.path);
  const narration=readBound(repositoryRoot,manifest.narration);
  let preflight=null; let openingPreflight=null; let inputArgs; let filters;
  if (plan && openingFrames) {
    openingPreflight=preflightFlipbookOpeningSound({manifest,bodyPlan:plan,repositoryRoot,episodeWorkspace:manifest.episode_workspace});
    preflight=openingPreflight.evidence;
    ({inputArgs,filters}=openingPreflight);
  } else if (plan) {
    preflight=preflightSoundMix({plan,repositoryRoot});
    ({inputArgs,filters}=buildSoundMixInputs({narrationPath:narration,cues:plan.sound_effects.cues,
      sound:plan.sound_effects,fullMasterFrames:manifest.total_frames,repositoryRoot}));
  } else {
    inputArgs=['-i',narration];
    filters=[`[0:a]aresample=44100,volume=1,adelay=${openingFrames*1470}S:all=1,apad,atrim=end_sample=${manifest.total_frames*1470}[mix]`];
  }
  const videoIndex=inputArgs.filter(arg=>arg==='-i').length;
  inputArgs.push('-i',recording);
  const tailHold=clock.pad_last_frame_seconds>0?`,tpad=stop_mode=clone:stop_duration=${clock.pad_last_frame_seconds}`:'';
  filters.push(`[${videoIndex}:v]settb=AVTB,setpts=PTS-STARTPTS-${clock.offset_seconds}/TB${tailHold},fps=fps=30:start_time=0,scale=1920:1080:flags=lanczos,trim=end_frame=${manifest.total_frames}[base]`);
  let videoMap='[base]'; let captionImages=[];
  if (captioned) {
    const cueFile=readBound(repositoryRoot,captionBinding);
    const artifact=JSON.parse(fs.readFileSync(cueFile,'utf8'));
    if (verified.caption_delivery.cue_artifact?.checksum_sha256!==captionBinding.checksum_sha256 || verified.caption_delivery.cue_artifact?.path!==captionBinding.path) fail('caption cue hash differs from the selected delivery evidence');
    const presentationCues=artifact.cues.map(cue=>({...cue,start_frame:cue.start_frame+openingFrames,end_frame:cue.end_frame+openingFrames}));
    validateFlipbookCaptionSources(presentationCues,manifest.spreads);
    captionImages=await prepareFlipbookCaptionImages({cues:presentationCues,totalFrames:manifest.total_frames,outputDirectory:captionImageDirectory,firstCaptionFrame:openingFrames});
    for (const [i,image] of captionImages.entries()) {
      inputArgs.push('-loop','1','-framerate','30','-i',image.path);
      const output=`[caption${i}]`;
      filters.push(`${videoMap}[${videoIndex+1+i}:v]overlay=x=(W-w)/2:y=H-h-54:enable='gte(t,${image.start_frame/30})*lt(t,${image.end_frame/30})'${output}`);
      videoMap=output;
    }
  } else if (captionBinding) fail('caption-free output cannot consume caption rasters');
  fs.mkdirSync(path.dirname(outputPath),{recursive:true});
  const args=['-hide_banner','-nostdin','-n',...inputArgs,'-filter_complex',filters.join(';'),'-map',videoMap,'-map','[mix]',
    '-frames:v',String(targetFrames),'-t',String(targetFrames/30),'-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',outputPath];
  verifyFileChecksum(manifestPath, manifestChecksum);
  const result=spawnSync('ffmpeg',args,{encoding:'utf8',maxBuffer:16*1024*1024});
  if(result.status!==0) fail(`ffmpeg failed: ${result.stderr}`);
  const media=validateVideo(outputPath,{codec:'h264',width:1920,height:1080,fps:'30/1',frames:targetFrames,requireAudio:true});
  const mix=openingPreflight?validateFlipbookOpeningRenderAudio({renderPath:outputPath,preflight:openingPreflight,renderFrames:targetFrames})
    :plan?validateRenderSoundMix({plan,preflightEvidence:preflight,renderPath:outputPath}):null;
  const evidence={contract_version:'knowledge-video-flipbook-media-v1',action_classification:manifest.action_classification,
    role,internal_only:prefix,render_frames:targetFrames,narration_offset_frames:openingFrames,manifest_path:path.relative(repositoryRoot,manifestPath),manifest_checksum_sha256:manifestChecksum,capture:captureLock.capture,narration:manifest.narration,
    assembly_plan_sha256:verified?.assembly_plan_sha256??null,preflight,mix,media,capture_clock:clock.evidence,
    caption_layer:captioned?'present_once':'absent',
    caption_renderer:captioned?FLIPBOOK_CAPTION_RENDERER:null,
    caption_binding:captionBinding,caption_images:captionImages.map(({path:file,...rest})=>({...rest,path:path.relative(repositoryRoot,file)})),
    output_path:path.relative(repositoryRoot,outputPath),result:'pass'};
  atomicWriteJson(evidencePath,evidence); return evidence;
};
