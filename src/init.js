import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

export function validateToken(token) {
  if (typeof token !== 'string' || !token.trim()) {
    return { valid: false, warning: 'Token cannot be empty' };
  }
  const trimmed = token.trim();
  if (trimmed.startsWith('ntn_') || trimmed.startsWith('secret_')) {
    return { valid: true };
  }
  return {
    valid: true,
    warning: 'Token format not recognized (expected ntn_... or secret_...). Proceeding anyway.',
  };
}

export function generateConfig({ pageId, originalLanguage, targetLanguage, targetLevel }) {
  return JSON.stringify({ pageId, originalLanguage, targetLanguage, targetLevel }, null, 2) + '\n';
}

export function replaceTemplate(template, values) {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

export async function appendGitignore(targetDir, entries) {
  const gitignorePath = join(targetDir, '.gitignore');
  let existing = '';
  try {
    existing = await readFile(gitignorePath, 'utf8');
  } catch {
    // file doesn't exist
  }
  const existingLines = existing.split('\n').map(l => l.trim());
  const newEntries = entries.filter(e => !existingLines.includes(e));
  if (newEntries.length === 0) return;
  const suffix = existing.endsWith('\n') || existing === '' ? '' : '\n';
  await writeFile(gitignorePath, existing + suffix + newEntries.join('\n') + '\n');
}

export async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function extractPageId(input) {
  const trimmed = input.trim();
  // Extract 32-char hex ID from Notion URL or raw input
  const match = trimmed.match(/([a-f0-9]{32})\s*$/i) || trimmed.match(/([a-f0-9-]{36})\s*$/i);
  if (match) {
    return match[1].replace(/-/g, '');
  }
  return trimmed;
}

export async function validatePageId(token, pageId) {
  const url = `https://api.notion.com/v1/pages/${pageId}`;
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      },
    });
    if (res.ok) {
      const data = await res.json();
      const title = data.properties?.title?.title?.[0]?.plain_text || '';
      return { valid: true, title };
    }
    if (res.status === 404) {
      return { valid: false, error: 'Page not found. Check the ID and make sure your integration has access.' };
    }
    return { valid: false, error: `Notion API error: ${res.status}` };
  } catch (err) {
    return { valid: false, error: `Network error: ${err.message}` };
  }
}

export function checkPrerequisite(command) {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function scaffold(targetDir, config) {
  const { token, pageId, originalLanguage, targetLanguage, targetLevel, skipFiles } = config;

  // Read templates in parallel
  const [claudeTemplate, vocabTemplate, envTemplate, settingsTemplate] = await Promise.all([
    readFile(join(TEMPLATES_DIR, 'CLAUDE.md'), 'utf8'),
    readFile(join(TEMPLATES_DIR, 'vocab.md'), 'utf8'),
    readFile(join(TEMPLATES_DIR, 'env.template'), 'utf8'),
    readFile(join(TEMPLATES_DIR, 'settings.local.json'), 'utf8'),
  ]);

  // Replace placeholders
  const envContent = replaceTemplate(envTemplate, { NOTION_TOKEN: token });
  const settingsContent = replaceTemplate(settingsTemplate, { NOTION_TOKEN: token });
  const configContent = generateConfig({ pageId, originalLanguage, targetLanguage, targetLevel });

  // Write files (secret files get 0600 permissions)
  const files = [
    { path: join(targetDir, '.env'), content: envContent, secret: true },
    { path: join(targetDir, '.vocabot.json'), content: configContent },
    { path: join(targetDir, 'CLAUDE.md'), content: claudeTemplate },
    { path: join(targetDir, '.claude', 'commands', 'vocab.md'), content: vocabTemplate },
    { path: join(targetDir, '.claude', 'settings.local.json'), content: settingsContent, secret: true },
  ];

  const written = [];
  for (const file of files) {
    if (skipFiles && skipFiles.has(file.path)) continue;
    await mkdir(dirname(file.path), { recursive: true });
    const opts = file.secret ? { mode: 0o600 } : undefined;
    await writeFile(file.path, file.content, opts);
    written.push(file.path);
  }

  // Gitignore
  await appendGitignore(targetDir, ['.env', '.claude/settings.local.json']);

  return written;
}

async function prompt(rl, question, defaultValue) {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  const answer = await rl.question(`${question}${suffix}: `);
  return answer.trim() || defaultValue || '';
}

export async function runInit(targetDir) {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    console.log('\nWelcome to vocabot!\n');

    // Step 1: Token
    const token = await prompt(rl, 'Paste your Notion API token (starts with ntn_)');
    const tokenResult = validateToken(token);
    if (!tokenResult.valid) {
      console.error(`Error: ${tokenResult.warning}`);
      process.exit(1);
    }
    if (tokenResult.warning) {
      console.warn(`Warning: ${tokenResult.warning}`);
    }

    // Step 2: Page
    console.log('\nCreate a Notion page where vocab entries will be stored.');
    console.log('The database will be created automatically inside this page.\n');
    const pageInput = await prompt(rl, 'Paste your Notion page URL or ID');
    if (!pageInput) {
      console.error('Error: Page ID cannot be empty');
      process.exit(1);
    }
    const pageId = extractPageId(pageInput);

    // Validate page via Notion API
    console.log(`Verifying page access (${pageId})...`);
    const pageResult = await validatePageId(token, pageId);
    if (!pageResult.valid) {
      console.error(`Error: ${pageResult.error}`);
      process.exit(1);
    }
    console.log(`✓ Page found: "${pageResult.title || '(untitled)'}"\n`);

    // Step 3: Language
    const originalLanguage = await prompt(rl, 'Source language of your content?', 'English');
    const targetLanguage = await prompt(rl, 'Your native language for translations?', 'Chinese(Tr)');
    const targetLevel = await prompt(rl, 'Your proficiency level? (e.g., B1, N3, TOPIK 4)', 'B1');

    // Step 4: Check for existing files, ask before overwrite
    const checkFiles = [
      join(targetDir, 'CLAUDE.md'),
      join(targetDir, '.claude', 'commands', 'vocab.md'),
      join(targetDir, '.env'),
      join(targetDir, '.vocabot.json'),
    ];
    const skipFiles = new Set();
    for (const file of checkFiles) {
      if (await fileExists(file)) {
        const answer = await prompt(rl, `${file} already exists. Overwrite? (y/N)`, 'N');
        if (answer.toLowerCase() !== 'y') {
          skipFiles.add(file);
        }
      }
    }

    // Step 5: Scaffold
    const config = { token, pageId, originalLanguage, targetLanguage, targetLevel, skipFiles };
    await scaffold(targetDir, config);

    // Step 6: Prerequisites
    if (!checkPrerequisite('yt-dlp')) {
      const installYtdlp = await prompt(rl, '\nyt-dlp not found. Install now for YouTube transcript support? (Y/n)', 'Y');
      if (installYtdlp.toLowerCase() !== 'n') {
        console.log('Installing yt-dlp...');
        try {
          execFileSync('pip3', ['install', 'yt-dlp'], { stdio: 'inherit' });
          console.log('✓ yt-dlp installed');
        } catch {
          console.warn('Warning: yt-dlp installation failed. You can install it later:');
          console.warn('  pip3 install yt-dlp');
        }
      }
    }

    // Done
    console.log('\n✅ Setup complete! Open Claude Code and run:');
    console.log('  /vocab <url>\n');
  } finally {
    rl.close();
  }
}
