#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildFlipbook, resolveInput} from '../../../../leverage-video/src/shared/flipbook-video/build-flipbook.mjs';
import {createFlipbookServer} from '../../../../leverage-video/src/shared/flipbook-video/serve-flipbook.mjs';
import {verifyFlipbookProduction} from '../../../../leverage-video/src/shared/assembly-plan/flipbook-gates.mjs';
import {muxFlipbookCapture} from '../../../../leverage-video/src/shared/assembly-plan/flipbook-media.mjs';
import {sha256File, verifyFileChecksum} from '../../../../leverage-video/src/shared/episode-tooling/file-integrity.mjs';
import {assertNoSymlinkAncestors, validateFlipbookBuildTarget, validateFlipbookMuxPaths, validateFlipbookProductionDirectories} from '../../../../leverage-video/src/shared/flipbook-video/cli-paths.mjs';
const repositoryRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const productionPreflight=({manifest})=>{
 validateFlipbookProductionDirectories(manifest,{repositoryRoot});
 return verifyFlipbookProduction({manifest,repositoryRoot});
};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const [action,source,target]=process.argv.slice(2);
if(action==='build'&&source&&target){
 const input=read(assertNoSymlinkAncestors(source,{repositoryRoot,label:'manifest source'}));
 const result=buildFlipbook(input,validateFlipbookBuildTarget(input,target,{repositoryRoot}),{repositoryRoot,productionPreflight});
 console.log(JSON.stringify({output:result.output,build_descriptor:result.build_descriptor,manifest_checksum_sha256:result.build.manifest_checksum_sha256}));
}else if(action==='serve'&&source){
 const port=target===undefined?0:Number(target);
 if(!Number.isInteger(port)||port<0||port>65535)throw new Error('invalid local port');
 const selected=assertNoSymlinkAncestors(source,{repositoryRoot,label:'build descriptor'});
 if(fs.statSync(selected).isDirectory())assertNoSymlinkAncestors(path.join(selected,'recordings'),{repositoryRoot,label:'recordings directory'});
 const server=createFlipbookServer(selected,{repositoryRoot,productionPreflight});
 server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}`})));
}else if(action==='mux'&&source){
 const config=read(assertNoSymlinkAncestors(source,{repositoryRoot,label:'mux config'}));
 const manifestPath=assertNoSymlinkAncestors(config.manifest_path,{repositoryRoot,label:'manifest_path'});
 verifyFileChecksum(manifestPath,config.manifest_checksum_sha256);
 const manifest=read(manifestPath);
 const paths=validateFlipbookMuxPaths(config,manifest,{repositoryRoot});
 const captureRoot=paths.captureRoot;
 const lockPath=resolveInput(config.capture_lock.path,captureRoot);
 verifyFileChecksum(lockPath,config.capture_lock.checksum_sha256);
 if(paths.outputPath===lockPath||paths.evidencePath===lockPath)throw new Error('output must not replace the immutable capture lock');
 const result=await muxFlipbookCapture({manifest,manifestPath,manifestChecksum:sha256File(manifestPath),captureLock:read(lockPath),captureRoot,repositoryRoot,
  outputPath:paths.outputPath,evidencePath:paths.evidencePath,role:config.role,productionPreflight,
  captionBinding:config.caption_binding??null,captionImageDirectory:paths.captionImageDirectory});
 console.log(JSON.stringify(result));
}else throw new Error('usage: flipbook-video.mjs build <manifest.json> <new-docs-directory> | serve <build-descriptor-or-fixture-directory> [port] | mux <config.json>');
