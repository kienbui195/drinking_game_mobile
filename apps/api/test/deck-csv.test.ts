import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deckCsvTemplate, exportDeckCsv, importDeckCsv } from '../../web/src/lib/deck-csv';
import { DEFAULT_CARDS } from '../src/default-cards';

test('CSV round-trip keeps ids, Unicode, commas, quotes and line breaks', () => {
  const cards = DEFAULT_CARDS.slice(0, 2).map((card, index) => ({
    ...card,
    title: index ? 'Kể "chuyện"' : '=SUM(1,2)',
    description: 'Một dòng, hai dòng\nKết thúc "vui".',
    highlight: 'Điểm sáng',
    answer: 'Có, đúng',
    keepable: true,
  }));
  const csv = exportDeckCsv('chamly-50', cards);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.deepEqual(importDeckCsv(csv, 'chamly-50'), cards);
  assert.equal(importDeckCsv(csv.replace(/\r\n/g, '\n'), 'chamly-50')[0].id, cards[0].id);
});

test('blank ids create new cards; a header-only template cannot erase a deck', () => {
  const csv = exportDeckCsv('chamly-50', DEFAULT_CARDS.slice(0, 2));
  const withoutIds = csv.replaceAll('"card-1"', '""').replaceAll('"card-2"', '""');
  const parsed = importDeckCsv(withoutIds, 'chamly-50');
  assert.notEqual(parsed[0].id, parsed[1].id);
  assert.match(parsed[0].id, /^[0-9a-f-]{36}$/);
  assert.throws(() => importDeckCsv(deckCsvTemplate(), 'chamly-50'), /2 đến 200/);
});

test('invalid category, duplicate ids, wrong pack, bounds and broken quoting reject all rows', () => {
  const csv = exportDeckCsv('chamly-50', DEFAULT_CARDS.slice(0, 2));
  assert.throws(() => importDeckCsv(csv, 'kien-thuc'), /packId|category/);
  assert.throws(
    () => importDeckCsv(csv.replace('"card-2"', '"card-1"'), 'chamly-50'),
    /Dòng 3: id trùng/,
  );
  assert.throws(
    () => importDeckCsv(csv.replace('"1","true"', '"21","true"'), 'chamly-50'),
    /drinksCount/,
  );
  assert.throws(() => importDeckCsv(csv.replace('"15"', '"601"'), 'chamly-50'), /timerSeconds/);
  assert.throws(() => importDeckCsv(csv.replace('"card-1"', '"card-1'), 'chamly-50'), /nháy kép/);
  assert.throws(
    () => importDeckCsv(csv.replace('"card-1",', '"card-1",extra,'), 'chamly-50'),
    /12 cột/,
  );
});
