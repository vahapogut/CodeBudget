import { mkdir, writeFile } from 'node:fs/promises';
import { capturedReplayCases, replayBenchmark, createTaskBenchmarkPlan } from '../src/index.js';

const directory = new URL('../results/', import.meta.url);
await mkdir(directory, { recursive: true });
const recorded = { recordedAt: new Date().toISOString(), platform: process.platform, node: process.version };
const replay = { ...recorded, ...replayBenchmark() };
// Replays the committed captures only; scripts/capture-fixtures.mjs is the command that re-executes the tools.
const captured = { ...recorded, source: 'Replay of the committed captures in tests/fixtures/reducers/captured; tools were not re-executed.', ...replayBenchmark(capturedReplayCases) };
await writeFile(new URL('replay.local.json', directory), JSON.stringify(replay, null, 2) + '\n');
await writeFile(new URL('replay.captured.json', directory), JSON.stringify(captured, null, 2) + '\n');
await writeFile(new URL('task-plan.local.json', directory), JSON.stringify(createTaskBenchmarkPlan(), null, 2) + '\n');
// Automatic detection is the primary figure; labeled-format hints are reported separately and never blended in.
const summary = (report: typeof replay) => ({ originalBytes: report.originalBytes, reducedBytes: report.reducedBytes, byteReductionFraction: report.byteReductionFraction, hintedReducedBytes: report.hinted.reducedBytes, hintedByteReductionFraction: report.hinted.byteReductionFraction, preservationPassed: report.preservationPassed });
process.stdout.write(JSON.stringify({ detection: replay.detection, synthetic: summary(replay), captured: summary(captured), realModelRuns: 0 }) + '\n');
