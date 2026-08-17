import fs from 'node:fs/promises';

const base = JSON.parse(await fs.readFile('projects/tom-cat-chases-mouse/requests/story-style-sample.json', 'utf8'));
const common = 'Use rounded hand-cut paper shapes with warm watercolor grain and soft child-friendly proportions. Keep faces, silhouettes, and foreground actions simple, readable, and emotionally clear. Avoid: Photorealism, hard 3D plastic surfaces, and dense adult editorial detail. Composition: Favor broad color blocks and generous breathing room around the main action. Composition: Use three clearly separated paper depths without hiding the character silhouette. Use the attached approved style image only as the identity and material reference. Preserve the exact original blue-gray cat design and original brown mouse design with red scarf. Cozy kitchen, harmless visual comedy. No text, logo, watermark, or resemblance to known copyrighted cartoon characters. ';
const scenes = [
  ['01', 'Quiet suspense: the small brown mouse peeks from behind a table leg and reaches toward a yellow cheese wedge while the blue-gray cat sleeps in the distant background. Wide establishing composition, generous breathing room.'],
  ['02', 'Inciting action: the blue-gray cat opens amber eyes and springs forward while the mouse hugs the cheese and starts running. Dynamic left-to-right diagonal, paper scraps lifting, no collision.'],
  ['03', 'Fast kitchen chase: the mouse runs ahead holding cheese, the blue-gray cat follows, passing chair legs, a fluttering napkin and one rolling bowl. Strong readable motion arcs and layered foreground occlusion.'],
  ['04', 'Comic climax: the mouse makes a sharp turn toward a wall opening; the blue-gray cat tries to brake and harmlessly tumbles into a collapsible cardboard box. Expressive surprise, no injury, no contact with mouse.'],
  ['05', 'Warm resolution: the mouse stands safely at the wall opening and waves with the cheese; the blue-gray cat peeks from the crumpled cardboard box and blinks. Friendly eye contact, calm final tableau.'],
];

await fs.mkdir('projects/tom-cat-chases-mouse/requests/scenes', {recursive: true});
for (const [number, description] of scenes) {
  const request = {
    ...base,
    assetId: `scene-plate-${number}`,
    output: `public/projects/tom-cat-chases-mouse/assets/plates/scene-${number}-native.png`,
    prompt: common + description,
    providerSource: {
      mode: 'provider-native',
      minimumWidth: 1200,
      minimumHeight: 1100,
      aspectRatioTolerance: 0.1,
      normalization: {method: 'deterministic-resize', targetCanvas: {width: 1280, height: 1152}},
    },
    compositionBinding: {
      sceneId: `full-scene-${number}`,
      nodeId: `scene-plate-${number}`,
      pattern: 'free',
      outputRole: 'scene-plate',
      canvas: {width: 1280, height: 1152},
      derivation: {method: 'provider-generation'},
    },
    semanticBinding: {
      riskClass: 'identity-critical',
      contractIds: ['hero-identities'],
      generationFamily: {
        familyId: 'hero-scene-family',
        identityMemberIds: ['blue-gray-cat', 'brown-mouse'],
        referenceAssetIds: ['story-style-sample-v3-normalized'],
      },
    },
    quality: {
      kind: 'image',
      requiredChecks: ['no-text', 'no-watermark', 'style-consistent', 'style-profile-conformant', 'subject-complete', 'identity-family-consistent', 'identity-distinct-within-frame'],
    },
  };
  await fs.writeFile(`projects/tom-cat-chases-mouse/requests/scenes/scene-${number}.json`, `${JSON.stringify(request, null, 2)}\n`);
}
