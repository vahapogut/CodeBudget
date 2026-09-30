import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configWarnings, initialize, loadConfig, setMode } from './config.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const project = () => { const root = mkdtempSync(join(tmpdir(), 'codebudget-config-')); dirs.push(root); return root; };

describe('configuration sources', () => {
  it('ignores privacy-sensitive settings in the committed project file and warns', () => {
    const root = project();
    writeFileSync(join(root, '.codebudget.json'), JSON.stringify({ rawArchive: true, experimental: { apiRouting: true } }));
    expect(loadConfig(root, {}, {}).rawArchive).toBe(false);
    expect(loadConfig(root, {}, {}).experimental.apiRouting).toBe(false);
    expect(configWarnings(root).join(' ')).toMatch(/rawArchive.*ignored/);
  });

  it('honors local-only settings from the ignored data directory or the environment', () => {
    const root = project(); mkdirSync(join(root, '.codebudget'));
    writeFileSync(join(root, '.codebudget/local.json'), JSON.stringify({ rawArchive: true }));
    expect(loadConfig(root, {}, {}).rawArchive).toBe(true);
    rmSync(join(root, '.codebudget/local.json'));
    expect(loadConfig(root, {}, { CODEBUDGET_RAW_ARCHIVE: '1' }).rawArchive).toBe(true);
    writeFileSync(join(root, '.codebudget/local.json'), JSON.stringify({ mode: 'balanced' }));
    expect(() => loadConfig(root, {}, {})).toThrow(/local\.json/);
  });

  it('parses environment values strictly and names the variable in errors', () => {
    const root = project();
    expect(loadConfig(root, {}, { CODEBUDGET_CONTEXT_BUDGET: '', CODEBUDGET_MODE: '' }).contextBudget).toBe(8000);
    expect(loadConfig(root, {}, { CODEBUDGET_CONTEXT_BUDGET: '4096' }).contextBudget).toBe(4096);
    for (const value of ['0x2000', '1e4', '50', 'abc']) expect(() => loadConfig(root, {}, { CODEBUDGET_CONTEXT_BUDGET: value })).toThrow('CODEBUDGET_CONTEXT_BUDGET');
    expect(() => loadConfig(root, {}, { CODEBUDGET_MODE: 'turbo' })).toThrow('CODEBUDGET_MODE must be observe, balanced or experimental');
  });

  it('reports readable schema errors without quoting file content', () => {
    const root = project();
    writeFileSync(join(root, '.codebudget.json'), '{"mode":"turbo"}');
    expect(() => loadConfig(root, {}, {})).toThrow(/Invalid \.codebudget\.json: mode: /);
    writeFileSync(join(root, '.codebudget.json'), '{"token": "do-not-echo-me",');
    expect(() => loadConfig(root, {}, {})).toThrow('Invalid .codebudget.json: not valid JSON');
    try { loadConfig(root, {}, {}); } catch (error) { expect(String(error)).not.toContain('do-not-echo-me'); }
  });

  it.skipIf(process.platform === 'win32')('changes only the mode and keeps the project file and its permissions', () => {
    const root = project();
    writeFileSync(join(root, '.codebudget.json'), JSON.stringify({ contextBudget: 4096, dataDir: '.codebudget' }, null, 2)); chmodSync(join(root, '.codebudget.json'), 0o664);
    expect(setMode(root, 'balanced').mode).toBe('balanced');
    expect(JSON.parse(readFileSync(join(root, '.codebudget.json'), 'utf8'))).toEqual({ contextBudget: 4096, dataDir: '.codebudget', mode: 'balanced' });
    expect(statSync(join(root, '.codebudget.json')).mode & 0o777).toBe(0o664);
  });

  it.skipIf(process.platform === 'win32')('initializes shared files with normal permissions and no local-only keys', () => {
    const root = project(); writeFileSync(join(root, '.gitignore'), 'mine/\n'); chmodSync(join(root, '.gitignore'), 0o644);
    initialize(root);
    expect(statSync(join(root, '.gitignore')).mode & 0o777).toBe(0o644);
    expect(statSync(join(root, '.codebudget.json')).mode & 0o777).toBe(0o644);
    const written = JSON.parse(readFileSync(join(root, '.codebudget.json'), 'utf8')) as Record<string, unknown>;
    expect(written).not.toHaveProperty('rawArchive'); expect(written).not.toHaveProperty('experimental');
  });
});
