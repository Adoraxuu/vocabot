#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const HELP = `vocabot - Language learning notes from content URLs to Notion

Usage:
  vocabot init    Set up vocabot in the current directory
  vocabot --help  Show this help message

After setup, open Claude Code and run:
  /vocab <url>`;

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  console.log(HELP);
  process.exit(0);
}

if (command === '--version' || command === '-v') {
  const pkg = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  );
  console.log(pkg.version);
  process.exit(0);
}

if (command === 'init') {
  const { runInit } = await import('../src/init.js');
  await runInit(process.cwd());
} else {
  console.error(`Unknown command: ${command}`);
  console.log(HELP);
  process.exit(1);
}
