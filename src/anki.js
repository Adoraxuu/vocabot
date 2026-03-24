import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Minimal ZIP writer using stored (no compression) method
export function createZip(entries) {
  const parts = [];
  const localHeaders = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const checksum = crc32(data);
    const size = data.length;

    const lh = Buffer.alloc(30 + nameBytes.length);
    lh.writeUInt32LE(0x04034b50, 0);       // local file header signature
    lh.writeUInt16LE(20, 4);               // version needed
    lh.writeUInt16LE(0, 6);               // flags
    lh.writeUInt16LE(0, 8);               // compression: stored
    lh.writeUInt16LE(0, 10);              // mod time
    lh.writeUInt16LE(0, 12);              // mod date
    lh.writeUInt32LE(checksum, 14);        // CRC-32
    lh.writeUInt32LE(size, 18);           // compressed size
    lh.writeUInt32LE(size, 22);           // uncompressed size
    lh.writeUInt16LE(nameBytes.length, 26); // filename length
    lh.writeUInt16LE(0, 28);              // extra field length
    nameBytes.copy(lh, 30);

    localHeaders.push({ nameBytes, checksum, size, offset });
    offset += lh.length + size;
    parts.push(lh, data);
  }

  // Central directory
  const cdParts = [];
  for (let i = 0; i < entries.length; i++) {
    const { nameBytes, checksum, size, offset: lhOffset } = localHeaders[i];
    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0);         // central dir signature
    cd.writeUInt16LE(0x031e, 4);             // version made by (Unix 3.0)
    cd.writeUInt16LE(20, 6);                 // version needed
    cd.writeUInt16LE(0, 8);                  // flags
    cd.writeUInt16LE(0, 10);                 // compression
    cd.writeUInt16LE(0, 12);                 // mod time
    cd.writeUInt16LE(0, 14);                 // mod date
    cd.writeUInt32LE(checksum, 16);          // CRC-32
    cd.writeUInt32LE(size, 20);              // compressed size
    cd.writeUInt32LE(size, 24);              // uncompressed size
    cd.writeUInt16LE(nameBytes.length, 28);  // filename length
    cd.writeUInt16LE(0, 30);                 // extra length
    cd.writeUInt16LE(0, 32);                 // comment length
    cd.writeUInt16LE(0, 34);                 // disk start
    cd.writeUInt16LE(0, 36);                 // internal attrs
    cd.writeUInt32LE(0, 38);                 // external attrs
    cd.writeUInt32LE(lhOffset, 42);          // local header offset
    nameBytes.copy(cd, 46);
    cdParts.push(cd);
  }

  const cdBuffer = Buffer.concat(cdParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);          // end of central dir signature
  eocd.writeUInt16LE(0, 4);                   // disk number
  eocd.writeUInt16LE(0, 6);                   // disk with CD
  eocd.writeUInt16LE(entries.length, 8);      // entries on this disk
  eocd.writeUInt16LE(entries.length, 10);     // total entries
  eocd.writeUInt32LE(cdBuffer.length, 12);    // CD size
  eocd.writeUInt32LE(offset, 16);             // CD offset
  eocd.writeUInt16LE(0, 20);                  // comment length

  return Buffer.concat([...parts, cdBuffer, eocd]);
}

function fieldChecksum(sfld) {
  const hash = createHash('sha1').update(sfld, 'utf8').digest('hex');
  return parseInt(hash.substring(0, 8), 16);
}

function makeGuid() {
  return randomBytes(8).toString('base64url').substring(0, 10);
}

async function buildAnkiDb(cards, deckName) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    throw new Error(
      `Anki export requires Node.js >= 22.5.0 (current: ${process.version}).\n` +
      'Use --format csv instead, or upgrade Node.js.'
    );
  }

  const dir = await mkdtemp(join(tmpdir(), 'vocabot-anki-'));
  const dbPath = join(dir, 'collection.anki2');

  try {
    const db = new DatabaseSync(dbPath);

    const MODEL_ID = 1700000000000;
    const DECK_ID = 1700000000001;
    const now = Math.floor(Date.now() / 1000);

    db.exec(`
      CREATE TABLE col (
        id integer primary key, crt integer not null, mod integer not null,
        scm integer not null, ver integer not null, dty integer not null,
        usn integer not null, ls integer not null, conf text not null,
        models text not null, decks text not null, dconf text not null, tags text not null
      );
      CREATE TABLE notes (
        id integer primary key, guid text not null, mid integer not null,
        mod integer not null, usn integer not null, tags text not null,
        flds text not null, sfld integer not null, csum integer not null,
        flags integer not null, data text not null
      );
      CREATE TABLE cards (
        id integer primary key, nid integer not null, did integer not null,
        ord integer not null, mod integer not null, usn integer not null,
        type integer not null, queue integer not null, due integer not null,
        ivl integer not null, factor integer not null, reps integer not null,
        lapses integer not null, left integer not null, odue integer not null,
        odid integer not null, flags integer not null, data text not null
      );
      CREATE TABLE revlog (
        id integer primary key, cid integer not null, usn integer not null,
        ease integer not null, ivl integer not null, lastIvl integer not null,
        factor integer not null, time integer not null, type integer not null
      );
      CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
    `);

    const models = {
      [MODEL_ID]: {
        id: MODEL_ID, name: 'vocabot', type: 0, mod: 0, usn: 0, sortf: 0, did: null,
        tmpls: [{
          name: 'Card 1', ord: 0,
          qfmt: '{{Front}}',
          afmt: '{{FrontSide}}<hr id=answer>{{Back}}',
          did: null, bqfmt: '', bafmt: '',
        }],
        flds: [
          { name: 'Front', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
          { name: 'Back', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
        ],
        css: '.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }',
        latexPre: '\\documentclass[12pt]{article}\\special{papersize=3in,5in}\\usepackage[utf8]{inputenc}\\usepackage{amssymb,amsmath}\\pagestyle{empty}\\setlength{\\parindent}{0in}\\begin{document}',
        latexPost: '\\end{document}',
        latexsvg: false,
        req: [[0, 'any', [0]]],
      },
    };

    const decks = {
      [DECK_ID]: {
        id: DECK_ID, name: deckName, desc: '', usn: 0, mod: 0,
        collapsed: false, newToday: [0, 0], timeToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0],
        dyn: 0, conf: 1, extendNew: 10, extendRev: 50,
      },
    };

    const dconf = {
      1: {
        id: 1, name: 'Default', replayq: true,
        lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
        rev: { perDay: 100, ease4: 1.3, fuzz: 0.05, minSpace: 1, ivlFct: 1, maxIvl: 36500, bury: false, hardFactor: 1.2 },
        timer: 0, maxTaken: 60, usn: 0,
        new: { bury: false, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
        mod: 0, autoplay: true,
      },
    };

    const conf = JSON.stringify({
      nextPos: 1, estTimes: true, activeDecks: [DECK_ID], sortType: 'noteFld',
      timeLim: 0, dueCounts: true, curModel: String(MODEL_ID), newSpread: 0,
      dayLearnFirst: false, curDeck: DECK_ID, collapseTime: 1200, addToCur: true,
    });

    db.prepare('INSERT INTO col VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      1, now, now, 0, 11, 0, 0, 0, conf,
      JSON.stringify(models), JSON.stringify(decks), JSON.stringify(dconf), '{}'
    );

    const insertNote = db.prepare('INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    const insertCard = db.prepare('INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');

    for (let i = 0; i < cards.length; i++) {
      const { word, pos, translation, sentence } = cards[i];
      const front = `<b>${word}</b><br>(${pos})`;
      const back = `${translation}<br><br><i>${sentence}</i>`;
      const flds = front + '\x1f' + back;
      const noteId = now * 1000 + i;
      const cardId = now * 1000 + i + 1000000;

      insertNote.run(noteId, makeGuid(), MODEL_ID, now, 0, '', flds, word, fieldChecksum(word), 0, '');
      insertCard.run(cardId, noteId, DECK_ID, 0, now, 0, 0, 0, i + 1, 0, 0, 0, 0, 0, 0, 0, 0, '');
    }

    db.close();
    return await readFile(dbPath);
  } finally {
    await rm(dir, { recursive: true });
  }
}

export async function createAnkiApkg(rows, deckName = 'vocabot') {
  const dbBuffer = await buildAnkiDb(rows, deckName);
  return createZip([
    { name: 'collection.anki2', data: dbBuffer },
    { name: 'media', data: Buffer.from('{}', 'utf8') },
  ]);
}
