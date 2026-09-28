import fs from 'node:fs';
import { ScreenSessionCarrier, launchDispatch } from '../../../dist/index.js';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error('Usage: launch-dispatch.mjs <input.json> <output.json>');
}

const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const carrier = new ScreenSessionCarrier('/usr/bin/screen');
const { attempt } = await launchDispatch(payload.attempt, payload.options, carrier);
fs.writeFileSync(outputPath, JSON.stringify(attempt), { mode: 0o600 });
