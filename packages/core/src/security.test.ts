import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite, classifyRepositoryPath, ensurePrivateDirectory, redact, redactArguments, sanitize } from './security.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('credential redaction', () => {
  it.each([
    ['AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'wJalr'],
    ['aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'wJalr'],
    ['GITHUB_TOKEN=abcdef0123456789abcdef0123456789', 'abcdef0123'],
    // Token-shaped fixtures are assembled at runtime so repository secret scanners do not report them as leaks.
    [`//registry.npmjs.org/:_authToken=${['npm', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'].join('_')}`, 'AbCdEf'],
    [`STRIPE=${['sk', 'live', '51HqLyjWDarjtT1zdp7dcXXXXXXXXXXXX'].join('_')}`, '51HqL'],
    [`token: ${['xoxb', '123456789012', '1234567890123', 'AbCdEfGhIjKlMnOpQrStUvWx'].join('-')}`, 'AbCdEf'],
    [`key ${['AIza', 'SyA-1234567890abcdefghijklmnopqrstu'].join('')}`, 'AIzaSyA'],
    ['DATABASE_URL=postgres://admin:S3cr3tPass@db.internal:5432/app', 'S3cr3t'],
    ['mongodb+srv://user:hunter2@cluster0.example.net/db', 'hunter2'],
    ['REDIS_URL=redis://:hunter2@cache:6379/0', 'hunter2'],
    ['AUTH_TOKEN=9f8e7d6c5b4a39281706f5e4d3c2b1a0', '9f8e7d'],
    ['{"pwd": "SuperSecretValue123", "passphrase": "open sesame"}', 'sesame'],
    ['x-api-key: 0123456789abcdef', '0123456789abcdef'],
    ['-----BEGIN PGP PRIVATE KEY BLOCK-----\nabc123\n-----END PGP PRIVATE KEY BLOCK-----', 'abc123'],
  ])('masks %s', (text, secret) => {
    expect(redact(text)).not.toContain(secret);
  });

  it('keeps identifiers, counters and non-secret shell state readable', () => {
    for (const text of ['src/token.ts:4 function accessTokenCount()', 'max_tokens=4096 temperature=0.2', 'tokenizer: o200k_base', 'PWD=/home/user/project',
      'git@github.com:owner/repo.git', 'https://user@example.com/x', '{"password": null}', 'Tokens: 1500 input, 300 output', 'risk-assessment-tool-v2']) {
      expect(redact(text)).toBe(text);
    }
  });

  it('does not garble an already masked value and keeps JSON valid', () => {
    expect(redact('OPENAI_API_KEY=sk-proj-abcdefghijklmnop')).toBe('OPENAI_API_KEY=[REDACTED TOKEN]');
    expect(JSON.parse(redact('{"password": 12345, "token": "abc", "ok": true}'))).toEqual({ password: '[REDACTED]', token: '[REDACTED]', ok: true });
  });

  it('masks sensitive flags and URL credentials in argv but not ordinary options', () => {
    expect(redactArguments(['--db-password', 'x', '--client-secret=y', '--db-url=postgres://u:p@h/db', '--cwd', 'src', '--private-key-file', 'k.pem']))
      .toEqual(['--db-password', '[REDACTED ARGUMENT]', '--client-secret=[REDACTED ARGUMENT]', '--db-url=postgres://[REDACTED]@h/db', '--cwd', 'src', '--private-key-file', 'k.pem']);
  });

  it('sanitizes credential-named keys without hiding identifiers or measurements', () => {
    expect(sanitize({ sessionId: 'keep', tokenizer: 'o200k_base', commandKey: 'keep', apiKey: 'x', clientSecret: 'y', nested: { estimatedTokens: { original: 3 } } }))
      .toEqual({ sessionId: 'keep', tokenizer: 'o200k_base', commandKey: 'keep', apiKey: '[REDACTED]', clientSecret: '[REDACTED]', nested: { estimatedTokens: { original: 3 } } });
  });

  it('stays linear on long adversarial lines', () => {
    for (const text of ['a'.repeat(1_000_000), 'token='.repeat(160_000), 'password="'.repeat(100_000), 'x://a:'.repeat(160_000)]) {
      const started = performance.now(); redact(text);
      expect(performance.now() - started).toBeLessThan(3000);
    }
  });
});

describe('repository path classification', () => {
  const packageRoots = new Set(['packages/app', 'app']);
  it.each([
    ['src/build/token.ts', null], ['build/out.js', 'generated_output'], ['packages/app/dist/x.js', 'generated_output'], ['node_modules/a/b.js', 'dependency'],
    ['.env.local', 'secret'], ['config/secrets.json', 'secret'], ['src/secrets.ts', null], ['.codebudget/state.sqlite', 'local_state'], ['.codebudget.json', null],
    ['infra/main.tfstate', 'secret'], ['deploy/key.pem', 'secret'], ['vendor/lib.go', 'generated_output'], ['lib/vendor/rotate.ts', null], ['.venv/lib/site.py', 'dependency'],
  ])('%s -> %s', (path, expected) => {
    expect(classifyRepositoryPath(path, { isPackageRoot: directory => packageRoots.has(directory) })).toBe(expected);
  });
});

describe('atomic writes', () => {
  const root = () => { const dir = mkdtempSync(join(tmpdir(), 'cb-atomic-')); dirs.push(dir); return dir; };
  it.skipIf(process.platform === 'win32')('preserves the mode of shared files and uses 0644/0600 for new ones', () => {
    const dir = root();
    const shared = join(dir, '.gitignore'); writeFileSync(shared, 'a\n'); chmodSync(shared, 0o664);
    atomicWrite(shared, 'a\nb\n');
    expect(statSync(shared).mode & 0o777).toBe(0o664); expect(readFileSync(shared, 'utf8')).toBe('a\nb\n');
    const executable = join(dir, 'tool.sh'); writeFileSync(executable, '#!/bin/sh\n'); chmodSync(executable, 0o755);
    atomicWrite(executable, '#!/bin/sh\necho ok\n'); expect(statSync(executable).mode & 0o777).toBe(0o755);
    atomicWrite(join(dir, 'new.json'), '{}\n'); expect(statSync(join(dir, 'new.json')).mode & 0o777).toBe(0o644);
    atomicWrite(join(dir, 'receipt.json'), '{}\n', { private: true }); expect(statSync(join(dir, 'receipt.json')).mode & 0o777).toBe(0o600);
  });
  it('creates a self-ignoring private data directory', () => {
    const dir = join(root(), '.codebudget'); ensurePrivateDirectory(dir);
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('*');
  });
});
