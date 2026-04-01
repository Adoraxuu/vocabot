import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function loadConfig(dir) {
  let envContent = '';
  try {
    envContent = await readFile(join(dir, '.env'), 'utf8');
  } catch {
    // .env may not exist
  }

  let configContent;
  try {
    configContent = await readFile(join(dir, '.vocabot.json'), 'utf8');
  } catch {
    throw new Error('.vocabot.json not found. Run `vocabot init` first.');
  }

  const token = envContent.match(/NOTION_TOKEN\s*=\s*(.+)/)?.[1]?.trim();
  if (!token) throw new Error('NOTION_TOKEN not found in .env. Run `vocabot init` first.');

  const config = JSON.parse(configContent);
  return { token, ...config };
}

async function notionFetch(token, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Notion API error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function findVocabDatabase(token, pageId) {
  let cursor;
  while (true) {
    const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`);
    if (cursor) url.searchParams.set('start_cursor', cursor);
    const data = await notionFetch(token, url.toString());
    const db = data.results.find(
      b => b.type === 'child_database' && b.child_database?.title === 'Vocab'
    );
    if (db) return db.id;
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  throw new Error('Vocab database not found. Run `/vocab <url>` in Claude Code first.');
}

export async function fetchAllPages(token, dbId) {
  const pages = [];
  let cursor;
  while (true) {
    const body = cursor ? JSON.stringify({ start_cursor: cursor }) : '{}';
    const data = await notionFetch(token, `https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      body,
    });
    pages.push(...data.results);
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return pages;
}

export async function fetchPageBlocks(token, pageId) {
  const blocks = [];
  let cursor;
  while (true) {
    const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`);
    if (cursor) url.searchParams.set('start_cursor', cursor);
    const data = await notionFetch(token, url.toString());
    blocks.push(...data.results);
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return blocks;
}

export async function fetchTableRows(token, tableBlockId) {
  const rows = [];
  let cursor;
  while (true) {
    const url = new URL(`https://api.notion.com/v1/blocks/${tableBlockId}/children`);
    if (cursor) url.searchParams.set('start_cursor', cursor);
    const data = await notionFetch(token, url.toString());
    rows.push(...data.results);
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return rows;
}

const defaultFetchers = { fetchPageBlocks, fetchTableRows };

// Returns IDs of table blocks that look like vocabulary tables (5 columns)
export function findVocabTables(blocks) {
  return blocks
    .filter(b => b.type === 'table' && b.table?.table_width === 5)
    .map(b => b.id);
}

// Extracts plain text from a table_row block's cells
export function parseRow(tableRowBlock) {
  const cells = tableRowBlock.table_row?.cells ?? [];
  return cells.map(cell => cell.map(t => t.plain_text ?? '').join(''));
}

export async function collectVocab(token, pages, fetchers = defaultFetchers) {
  const { fetchPageBlocks: fetchPageBlocksFn, fetchTableRows: fetchTableRowsFn } = fetchers;
  const allRows = [];
  for (const page of pages) {
    const blocks = await fetchPageBlocksFn(token, page.id);
    const tableIds = findVocabTables(blocks);
    for (const tableId of tableIds) {
      const rows = await fetchTableRowsFn(token, tableId);
      const tableBlock = blocks.find(b => b.id === tableId);
      const hasHeader = tableBlock?.table?.has_column_header;
      const dataRows = hasHeader ? rows.slice(1) : rows;
      for (const row of dataRows) {
        const cells = parseRow(row);
        if (cells.length >= 5 && cells[0]) {
          allRows.push({
            word: cells[0],
            pos: cells[1],
            translation: cells[2],
            level: cells[3],
            sentence: cells[4],
          });
        }
      }
    }
  }
  return allRows;
}

export function toCsv(rows) {
  const escape = v => {
    const s = String(v ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const header = ['Word/Phrase', 'POS', 'Translation', 'Level', 'Original Sentence'];
  const lines = [
    header.map(escape).join(','),
    ...rows.map(r =>
      [r.word, r.pos, r.translation, r.level, r.sentence].map(escape).join(',')
    ),
  ];
  return lines.join('\n') + '\n';
}

export async function runExport(dir, { format, output, deckName = 'vocabot' }) {
  const { token, pageId } = await loadConfig(dir);

  console.log('Finding Vocab database...');
  const dbId = await findVocabDatabase(token, pageId);

  console.log('Fetching vocabulary pages...');
  const pages = await fetchAllPages(token, dbId);

  if (pages.length === 0) {
    console.log('No vocabulary entries found.');
    return;
  }

  console.log(`Processing ${pages.length} page(s)...`);
  const rows = await collectVocab(token, pages);

  if (rows.length === 0) {
    console.log('No vocabulary rows found in pages.');
    return;
  }

  const outputPath = output || (format === 'csv' ? 'vocabot.csv' : 'vocabot.apkg');

  if (format === 'csv') {
    await writeFile(outputPath, toCsv(rows), 'utf8');
    console.log(`✅ Exported ${rows.length} words to ${outputPath}`);
  } else {
    const { createAnkiApkg } = await import('./anki.js');
    const apkg = await createAnkiApkg(rows, deckName);
    await writeFile(outputPath, apkg);
    console.log(`✅ Exported ${rows.length} words to ${outputPath}`);
  }
}
