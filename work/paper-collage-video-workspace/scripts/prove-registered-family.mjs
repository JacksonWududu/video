#!/usr/bin/env node
import {prepareRegisteredFamilyProof} from './asset-hardening-proof-lib.mjs';

try {
  if (process.argv.slice(2).length > 0) {
    throw new Error(
      'proof:registered-family 是仓库内置 fixture 证明，不接受项目参数；项目请使用 project:composition-proof -- <slug>。',
    );
  }
  const {proof} = await prepareRegisteredFamilyProof();
  console.log(
    `✓ F035 registered-family proof: ${proof.localDerivatives} local derivatives, ` +
    `${proof.providerImageCalls} provider image calls, ${proof.avoidedCalls} avoided calls`,
  );
  console.log(`✓ proof sample: ${proof.proofSample}`);
} catch (error) {
  console.error(`proof:registered-family failed: ${error.message}`);
  process.exitCode = 1;
}
