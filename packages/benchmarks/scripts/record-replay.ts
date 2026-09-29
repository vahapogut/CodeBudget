import { mkdir, writeFile } from 'node:fs/promises';
import { replayBenchmark, createTaskBenchmarkPlan } from '../src/index.js';

const directory = new URL('../results/', import.meta.url);
await mkdir(directory, { recursive: true });
const replay = { recordedAt: new Date().toISOString(), platform: process.platform, node: process.version, ...replayBenchmark() };
await writeFile(new URL('replay.local.json', directory), JSON.stringify(replay, null, 2) + '\n');
await writeFile(new URL('task-plan.local.json', directory), JSON.stringify(createTaskBenchmarkPlan(), null, 2) + '\n');
process.stdout.write(JSON.stringify({ originalBytes: replay.originalBytes, reducedBytes: replay.reducedBytes, byteReductionFraction: replay.byteReductionFraction, preservationPassed: replay.preservationPassed, realModelRuns: 0 }) + '\n');
