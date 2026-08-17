#!/usr/bin/env node
import {prepareAlphaBandProof} from './asset-hardening-proof-lib.mjs';

try {
  const report = await prepareAlphaBandProof();
  console.log(
    `✓ F037 alpha-band proof: ${report.results
      .map(({kind, actualPassed}) => `${kind}=${actualPassed ? 'pass' : 'detected'}`)
      .join(', ')}`,
  );
} catch (error) {
  console.error(`proof:alpha-bands failed: ${error.message}`);
  process.exitCode = 1;
}
