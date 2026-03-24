import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, findVocabTables, parseRow } from '../src/export.js';
import { createZip } from '../src/anki.js';

describe('toCsv', () => {
  it('includes header row', () => {
    const csv = toCsv([]);
    assert.ok(csv.startsWith('Word/Phrase,POS,Translation,Level,Original Sentence'));
  });

  it('exports rows correctly', () => {
    const rows = [{
      word: 'resilient', pos: 'adj.', translation: '有韌性的', level: 'B2',
      sentence: 'She is resilient.',
    }];
    const csv = toCsv(rows);
    assert.ok(csv.includes('resilient'));
    assert.ok(csv.includes('adj.'));
    assert.ok(csv.includes('有韌性的'));
    assert.ok(csv.includes('B2'));
    assert.ok(csv.includes('She is resilient.'));
  });

  it('escapes fields containing commas', () => {
    const rows = [{
      word: 'hello, world', pos: 'n.', translation: '你好，世界', level: 'A1',
      sentence: 'Say hello, world.',
    }];
    const csv = toCsv(rows);
    assert.ok(csv.includes('"hello, world"'));
  });

  it('escapes fields containing double quotes', () => {
    const rows = [{
      word: 'so-called', pos: 'adj.', translation: '所謂的', level: 'B1',
      sentence: 'The "experts" disagree.',
    }];
    const csv = toCsv(rows);
    assert.ok(csv.includes('""experts""'));
  });

  it('ends with newline', () => {
    assert.ok(toCsv([]).endsWith('\n'));
    assert.ok(toCsv([{ word: 'a', pos: 'n.', translation: 'b', level: 'A1', sentence: 'c' }]).endsWith('\n'));
  });

  it('each row has 5 comma-separated fields', () => {
    const rows = [{
      word: 'test', pos: 'n.', translation: '測試', level: 'A1', sentence: 'A test.',
    }];
    const lines = toCsv(rows).trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[1].split(',').length, 5);
  });
});

describe('findVocabTables', () => {
  it('returns IDs of table blocks with table_width 5', () => {
    const blocks = [
      { type: 'paragraph', id: 'p1' },
      { type: 'table', id: 't1', table: { table_width: 5, has_column_header: true } },
      { type: 'table', id: 't2', table: { table_width: 3, has_column_header: true } },
      { type: 'table', id: 't3', table: { table_width: 5, has_column_header: false } },
    ];
    assert.deepEqual(findVocabTables(blocks), ['t1', 't3']);
  });

  it('returns empty array when no vocab tables', () => {
    const blocks = [
      { type: 'paragraph', id: 'p1' },
      { type: 'table', id: 't1', table: { table_width: 3 } },
    ];
    assert.deepEqual(findVocabTables(blocks), []);
  });

  it('returns empty array for empty blocks list', () => {
    assert.deepEqual(findVocabTables([]), []);
  });

  it('ignores non-table blocks', () => {
    const blocks = [
      { type: 'heading_2', id: 'h1' },
      { type: 'callout', id: 'c1' },
    ];
    assert.deepEqual(findVocabTables(blocks), []);
  });
});

describe('parseRow', () => {
  it('extracts plain text from each cell', () => {
    const row = {
      type: 'table_row',
      table_row: {
        cells: [
          [{ plain_text: 'resilient' }],
          [{ plain_text: 'adj.' }],
          [{ plain_text: '有韌性的' }],
          [{ plain_text: 'B2' }],
          [{ plain_text: 'She is resilient.' }],
        ],
      },
    };
    assert.deepEqual(parseRow(row), ['resilient', 'adj.', '有韌性的', 'B2', 'She is resilient.']);
  });

  it('concatenates multiple rich text pieces in a cell', () => {
    const row = {
      type: 'table_row',
      table_row: {
        cells: [[{ plain_text: 'come ' }, { plain_text: 'across' }]],
      },
    };
    assert.equal(parseRow(row)[0], 'come across');
  });

  it('returns empty string for empty cells', () => {
    const row = {
      type: 'table_row',
      table_row: { cells: [[], [{ plain_text: 'n.' }], [], [], []] },
    };
    const result = parseRow(row);
    assert.equal(result[0], '');
    assert.equal(result[1], 'n.');
    assert.equal(result[2], '');
  });

  it('handles missing table_row property', () => {
    assert.deepEqual(parseRow({ type: 'table_row' }), []);
  });
});

describe('createZip', () => {
  it('produces a buffer starting with ZIP local file header signature', () => {
    const zip = createZip([{ name: 'test.txt', data: Buffer.from('hello') }]);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
  });

  it('produces a buffer ending with end-of-central-directory signature', () => {
    const zip = createZip([{ name: 'test.txt', data: Buffer.from('hello') }]);
    assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  });

  it('encodes the correct number of entries in end-of-central-directory', () => {
    const zip = createZip([
      { name: 'a.txt', data: Buffer.from('aaa') },
      { name: 'b.txt', data: Buffer.from('bbb') },
    ]);
    // total entries field is at eocd offset + 10
    assert.equal(zip.readUInt16LE(zip.length - 22 + 10), 2);
  });

  it('handles empty entries array', () => {
    const zip = createZip([]);
    assert.equal(zip.readUInt32LE(0), 0x06054b50); // only eocd
    assert.equal(zip.readUInt16LE(10), 0);          // 0 entries
  });

  it('includes file data in the output', () => {
    const data = Buffer.from('vocabot');
    const zip = createZip([{ name: 'test.txt', data }]);
    // The data should appear somewhere in the zip after the local header
    const idx = zip.indexOf(data);
    assert.ok(idx > 0);
  });
});
