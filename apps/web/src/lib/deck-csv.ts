import { packById, type Card, type Category } from '@chamly/shared';

export const CSV_COLUMNS = [
  'packId',
  'id',
  'title',
  'category',
  'description',
  'penalty',
  'drinksCount',
  'hasTimer',
  'timerSeconds',
  'highlight',
  'answer',
  'keepable',
] as const;

const maxFileBytes = 1_000_000;

const newCardId = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (part) => {
    const value = Math.floor(Math.random() * 16);
    return (part === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });

// Prefix spreadsheet formula characters on export. Undo only our prefix on import.
const safeCell = (value: string) => (/^[=+@-]/.test(value) ? `'${value}` : value);
const encodeCell = (value: string) => `"${safeCell(value).replace(/"/g, '""')}"`;
const row = (cells: string[]) => cells.map(encodeCell).join(',');

export function exportDeckCsv(packId: string, cards: Card[]): string {
  const lines = [row([...CSV_COLUMNS])];
  for (const card of cards)
    lines.push(
      row([
        packId,
        card.id,
        card.title,
        card.category,
        card.description,
        card.penalty,
        String(card.drinksCount),
        card.hasTimer ? 'true' : 'false',
        card.timerSeconds ? String(card.timerSeconds) : '',
        card.highlight ?? '',
        card.answer ?? '',
        card.keepable ? 'true' : 'false',
      ]),
    );
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Same header for empty templates and exported decks. Fill 2–200 rows before importing. */
export function deckCsvTemplate(): string {
  return `\uFEFF${row([...CSV_COLUMNS])}\r\n`;
}

type CsvRow = { cells: string[]; line: number };

function parseRows(csv: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  let line = 1;
  let rowLine = 1;
  const finish = () => {
    cells.push(field);
    if (cells.some((cell) => cell.trim())) rows.push({ cells, line: rowLine });
    cells = [];
    field = '';
    closedQuote = false;
    rowLine = line;
  };
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else if (ch === '\r' && csv[i + 1] === '\n') {
        field += '\n';
        i++;
        line++;
      } else {
        field += ch;
        if (ch === '\n') line++;
      }
    } else if (ch === ',') {
      cells.push(field);
      field = '';
      closedQuote = false;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      line++;
      finish();
    } else if (ch === '"' && !field && !closedQuote) {
      quoted = true;
    } else if (closedQuote || ch === '"') {
      throw new Error(`Dòng ${line}: dấu nháy kép CSV không hợp lệ.`);
    } else {
      field += ch;
    }
  }
  if (quoted) throw new Error(`Dòng ${rowLine}: chưa đóng dấu nháy kép.`);
  if (field || cells.length || closedQuote) finish();
  return rows;
}

const clean = (text: string) => {
  const value = text.trim();
  return /^'[=+@-]/.test(value) ? value.slice(1) : value;
};

export function importDeckCsv(csv: string, packId: string): Card[] {
  if (new TextEncoder().encode(csv).length > maxFileBytes)
    throw new Error('File CSV vượt quá 1 MB. Hãy rút gọn nội dung.');
  const rows = parseRows(csv.replace(/^\uFEFF/, ''));
  if (!rows.length || rows[0].cells.join(',') !== CSV_COLUMNS.join(','))
    throw new Error(`Header CSV không đúng mẫu. Các cột phải là: ${CSV_COLUMNS.join(', ')}.`);
  if (rows.length < 3 || rows.length > 201)
    throw new Error('File CSV cần từ 2 đến 200 lá bài (không tính dòng header).');
  const allowed = packById(packId).categories;
  const ids = new Set<string>();
  const errors: string[] = [];
  const cards: Card[] = [];
  const addError = (line: number, message: string) => {
    if (errors.length < 8) errors.push(`Dòng ${line}: ${message}`);
  };
  for (const { cells, line } of rows.slice(1)) {
    if (cells.length !== CSV_COLUMNS.length) {
      addError(line, `cần đủ ${CSV_COLUMNS.length} cột (đang có ${cells.length}).`);
      continue;
    }
    const [
      pack,
      rawId,
      title,
      category,
      description,
      penalty,
      drinksCount,
      hasTimer,
      timerSeconds,
      highlight,
      answer,
      keepable,
    ] = cells.map(clean);
    const id = rawId || newCardId();
    if (pack !== packId) addError(line, `packId phải là ${packId}.`);
    if (id.length > 80 || ids.has(id)) addError(line, 'id trùng hoặc dài quá 80 ký tự.');
    ids.add(id);
    for (const [label, value, max] of [
      ['title', title, 100],
      ['description', description, 1500],
      ['penalty', penalty, 500],
    ] as const)
      if (!value || value.length > max) addError(line, `${label} phải có 1–${max} ký tự.`);
    if (highlight.length > 300 || answer.length > 500)
      addError(line, 'highlight tối đa 300 và answer tối đa 500 ký tự.');
    if (!allowed.includes(category as Category))
      addError(line, `category không hợp lệ; dùng: ${allowed.join(', ')}.`);
    if (!/^(0|[1-9]\d*)$/.test(drinksCount) || Number(drinksCount) > 20)
      addError(line, 'drinksCount phải là số nguyên 0–20.');
    if (!['true', 'false'].includes(hasTimer) || !['true', 'false'].includes(keepable))
      addError(line, 'hasTimer và keepable chỉ nhận true/false.');
    if (hasTimer === 'true' && (!/^[1-9]\d*$/.test(timerSeconds) || Number(timerSeconds) > 600))
      addError(line, 'timerSeconds cần là số nguyên 1–600 khi hasTimer=true.');
    if (hasTimer === 'false' && timerSeconds)
      addError(line, 'timerSeconds phải để trống khi hasTimer=false.');
    cards.push({
      id,
      title,
      category: category as Category,
      description,
      penalty,
      drinksCount: Number(drinksCount),
      ...(hasTimer === 'true' ? { hasTimer: true, timerSeconds: Number(timerSeconds) } : {}),
      ...(highlight ? { highlight } : {}),
      ...(answer ? { answer } : {}),
      ...(keepable === 'true' ? { keepable: true } : {}),
    });
  }
  if (errors.length) throw new Error(`${errors.join('\n')}${errors.length === 8 ? '\n…' : ''}`);
  return cards;
}
