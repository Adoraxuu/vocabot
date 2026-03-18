import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateToken, generateConfig, scaffold } from '../src/init.js';
import { replaceTemplate, appendGitignore, fileExists } from '../src/init.js';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

describe('validateToken', () => {
  it('accepts ntn_ prefix', () => {
    const result = validateToken('ntn_abc123');
    assert.equal(result.valid, true);
    assert.equal(result.warning, undefined);
  });

  it('accepts secret_ prefix', () => {
    const result = validateToken('secret_abc123');
    assert.equal(result.valid, true);
    assert.equal(result.warning, undefined);
  });

  it('warns on unrecognized format but still valid', () => {
    const result = validateToken('xyztoken');
    assert.equal(result.valid, true);
    assert.ok(result.warning);
  });

  it('rejects empty token', () => {
    const result = validateToken('');
    assert.equal(result.valid, false);
  });

  it('trims whitespace', () => {
    const result = validateToken('  ntn_abc123  ');
    assert.equal(result.valid, true);
    assert.equal(result.warning, undefined);
  });
});

describe('generateConfig', () => {
  it('generates valid JSON with all fields', () => {
    const result = generateConfig({
      pageId: 'abc123',
      originalLanguage: 'English',
      targetLanguage: 'Chinese(Tr)',
      targetLevel: 'B1',
    });
    const parsed = JSON.parse(result);
    assert.equal(parsed.pageId, 'abc123');
    assert.equal(parsed.originalLanguage, 'English');
    assert.equal(parsed.targetLanguage, 'Chinese(Tr)');
    assert.equal(parsed.targetLevel, 'B1');
  });

  it('output ends with newline', () => {
    const result = generateConfig({
      pageId: 'x',
      originalLanguage: 'English',
      targetLanguage: 'Japanese',
      targetLevel: 'N3',
    });
    assert.ok(result.endsWith('\n'));
  });
});

describe('replaceTemplate', () => {
  it('replaces single placeholder', () => {
    const result = replaceTemplate('Hello {{NAME}}!', { NAME: 'World' });
    assert.equal(result, 'Hello World!');
  });

  it('replaces multiple occurrences of same placeholder', () => {
    const result = replaceTemplate('{{X}} and {{X}}', { X: 'a' });
    assert.equal(result, 'a and a');
  });

  it('replaces multiple different placeholders', () => {
    const result = replaceTemplate('{{A}}-{{B}}', { A: '1', B: '2' });
    assert.equal(result, '1-2');
  });

  it('leaves unmatched placeholders as-is', () => {
    const result = replaceTemplate('{{A}} {{B}}', { A: '1' });
    assert.equal(result, '1 {{B}}');
  });
});

describe('appendGitignore', () => {
  let tmpDir;

  it('creates .gitignore if missing', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'vn-test-'));
    await appendGitignore(tmpDir, ['.env', 'node_modules/']);
    const content = await readFile(join(tmpDir, '.gitignore'), 'utf8');
    assert.equal(content, '.env\nnode_modules/\n');
    await rm(tmpDir, { recursive: true });
  });

  it('appends without duplicating existing entries', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'vn-test-'));
    await writeFile(join(tmpDir, '.gitignore'), '.env\n');
    await appendGitignore(tmpDir, ['.env', 'node_modules/']);
    const content = await readFile(join(tmpDir, '.gitignore'), 'utf8');
    assert.equal(content, '.env\nnode_modules/\n');
    await rm(tmpDir, { recursive: true });
  });

  it('handles file without trailing newline', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'vn-test-'));
    await writeFile(join(tmpDir, '.gitignore'), '.env');
    await appendGitignore(tmpDir, ['node_modules/']);
    const content = await readFile(join(tmpDir, '.gitignore'), 'utf8');
    assert.equal(content, '.env\nnode_modules/\n');
    await rm(tmpDir, { recursive: true });
  });
});

describe('fileExists', () => {
  it('returns true for existing file', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'vn-test-'));
    const filePath = join(tmpDir, 'test.txt');
    await writeFile(filePath, 'hello');
    assert.equal(await fileExists(filePath), true);
    await rm(tmpDir, { recursive: true });
  });

  it('returns false for non-existing file', async () => {
    assert.equal(await fileExists('/tmp/nonexistent-vn-test-file'), false);
  });
});

describe('scaffold', () => {
  it('creates all expected files', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'vn-scaffold-'));
    const config = {
      token: 'ntn_test123',
      pageId: 'db_abc',
      originalLanguage: 'English',
      targetLanguage: 'Japanese',
      targetLevel: 'N3',
    };

    await scaffold(tmpDir, config);

    assert.equal(await fileExists(join(tmpDir, '.env')), true);
    assert.equal(await fileExists(join(tmpDir, '.vocabot.json')), true);
    assert.equal(await fileExists(join(tmpDir, 'CLAUDE.md')), true);
    assert.equal(await fileExists(join(tmpDir, '.claude', 'commands', 'vocab.md')), true);
    assert.equal(await fileExists(join(tmpDir, '.claude', 'settings.local.json')), true);
    assert.equal(await fileExists(join(tmpDir, '.gitignore')), true);

    await rm(tmpDir, { recursive: true });
  });

  it('.env contains the token', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'vn-scaffold-'));
    await scaffold(tmpDir, {
      token: 'ntn_mytoken',
      pageId: 'db1',
      originalLanguage: 'English',
      targetLanguage: 'Chinese(Tr)',
      targetLevel: 'B1',
    });

    const env = await readFile(join(tmpDir, '.env'), 'utf8');
    assert.ok(env.includes('ntn_mytoken'));

    await rm(tmpDir, { recursive: true });
  });

  it('.vocabot.json contains correct config', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'vn-scaffold-'));
    await scaffold(tmpDir, {
      token: 'ntn_x',
      pageId: 'mydb',
      originalLanguage: 'Korean',
      targetLanguage: 'English',
      targetLevel: 'TOPIK 4',
    });

    const config = JSON.parse(await readFile(join(tmpDir, '.vocabot.json'), 'utf8'));
    assert.equal(config.pageId, 'mydb');
    assert.equal(config.originalLanguage, 'Korean');
    assert.equal(config.targetLanguage, 'English');
    assert.equal(config.targetLevel, 'TOPIK 4');

    await rm(tmpDir, { recursive: true });
  });

  it('settings.local.json contains token (not placeholder)', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'vn-scaffold-'));
    await scaffold(tmpDir, {
      token: 'ntn_real',
      pageId: 'db1',
      originalLanguage: 'English',
      targetLanguage: 'Chinese(Tr)',
      targetLevel: 'B1',
    });

    const settings = await readFile(join(tmpDir, '.claude', 'settings.local.json'), 'utf8');
    assert.ok(settings.includes('ntn_real'));
    assert.ok(!settings.includes('{{NOTION_TOKEN}}'));

    await rm(tmpDir, { recursive: true });
  });

  it('.gitignore contains expected entries', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'vn-scaffold-'));
    await scaffold(tmpDir, {
      token: 'ntn_x',
      pageId: 'db1',
      originalLanguage: 'English',
      targetLanguage: 'Chinese(Tr)',
      targetLevel: 'B1',
    });

    const gitignore = await readFile(join(tmpDir, '.gitignore'), 'utf8');
    assert.ok(gitignore.includes('.env'));
    assert.ok(gitignore.includes('.claude/settings.local.json'));

    await rm(tmpDir, { recursive: true });
  });
});

describe('CLI', () => {
  const cli = join(import.meta.dirname, '..', 'bin', 'cli.js');

  it('prints help with no arguments', () => {
    const output = execFileSync('node', [cli], { encoding: 'utf8' });
    assert.ok(output.includes('vocabot'));
    assert.ok(output.includes('init'));
  });

  it('prints help with --help flag', () => {
    const output = execFileSync('node', [cli, '--help'], { encoding: 'utf8' });
    assert.ok(output.includes('vocabot'));
  });

  it('exits with error for unknown command', () => {
    assert.throws(
      () => execFileSync('node', [cli, 'foo'], { encoding: 'utf8', stdio: 'pipe' }),
      (err) => {
        assert.ok(err.stderr.includes('Unknown command'));
        return true;
      }
    );
  });
});
