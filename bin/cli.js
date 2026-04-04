#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const HELP = `vocabot - Language learning notes from content URLs to Notion

Usage:
  vocabot init              Set up vocabot in the current directory
  vocabot export            Export vocabulary to Anki or CSV
  vocabot --help            Show this help message

Export options:
  --format <csv|anki>       Output format (required)
  --output <file>           Output file (default: vocabot.csv or vocabot.apkg)
  --deck <name>             Anki deck name (default: vocabot)

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
} else if (command === 'export') {
  let format, output, deckName;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--format' && args[i + 1]) format = args[++i];
    else if (args[i] === '--output' && args[i + 1]) output = args[++i];
    else if (args[i] === '--deck' && args[i + 1]) deckName = args[++i];
  }
  if (!format) {
    console.error('Error: --format is required (csv or anki)');
    console.log(HELP);
    process.exit(1);
  }
  if (format !== 'csv' && format !== 'anki') {
    console.error(`Error: Unknown format "${format}". Use csv or anki.`);
    process.exit(1);
  }
  const { runExport } = await import('../src/export.js');
  await runExport(process.cwd(), { format, output, deckName });
} else {
  console.error(`Unknown command: ${command}`);
  console.log(HELP);
  process.exit(1);
}
