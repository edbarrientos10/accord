import type { Person } from './types';
export interface ContactDraft {
  name: string;
  organization?: string;
  role?: string;
  notes?: string;
  emails?: { label: string; value: string }[];
  phones?: { label: string; value: string }[];
  links?: { label: string; value: string }[];
  externalIds?: string[];
  birthday?: { month: number; day: number; year: number | null };
}
export interface ImportRow {
  row: number;
  contact: ContactDraft;
  warnings: string[];
  errors: string[];
}
export const importColumns = [
  'name',
  'organization',
  'role',
  'email',
  'phone',
  'link',
  'notes',
  'birthday',
  'externalId',
] as const;
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!quoted && cell !== '') throw new Error('Unexpected quote in CSV.');
      else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(cell);
      cell = '';
      if (c !== ',') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else cell += c;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  if (rows.length > 1001) throw new Error('Import at most 1,000 contacts.');
  return rows;
}
function birthday(value: string) {
  const v = value.trim();
  let m: RegExpMatchArray | null;
  if ((m = v.match(/^(\d{4})-?(\d{2})-?(\d{2})$/)))
    return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  if ((m = v.match(/^(?:--)?(\d{2})-?(\d{2})$/)))
    return { year: null, month: Number(m[1]), day: Number(m[2]) };
  throw new Error('Birthday must be YYYY-MM-DD or MM-DD.');
}
function validate(row: ImportRow) {
  if (!row.contact.name.trim()) row.errors.push('Name is required.');
  for (const e of row.contact.emails ?? [])
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.value)) row.errors.push('Invalid email address.');
  for (const l of row.contact.links ?? [])
    try {
      if (!['http:', 'https:'].includes(new URL(l.value).protocol)) throw new Error();
    } catch {
      row.errors.push('Links must use HTTP or HTTPS.');
    }
  const b = row.contact.birthday;
  if (b) {
    const d = new Date(
      `${String(b.year ?? 2000).padStart(4, '0')}-${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}T12:00:00Z`,
    );
    if (d.getUTCMonth() + 1 !== b.month || d.getUTCDate() !== b.day)
      row.errors.push('Invalid birthday.');
  }
  return row;
}
export function csvContacts(rows: string[][], mapping: Record<string, string>): ImportRow[] {
  const headers = rows[0] ?? [];
  return rows.slice(1).map((cells, index) => {
    const value = (key: string) => cells[headers.indexOf(mapping[key] ?? '')]?.trim() ?? '';
    const contact: ContactDraft = { name: value('name') };
    const result: ImportRow = { row: index + 2, contact, warnings: [], errors: [] };
    for (const key of ['organization', 'role', 'notes'] as const)
      if (value(key)) contact[key] = value(key);
    for (const [key, field] of [
      ['email', 'emails'],
      ['phone', 'phones'],
      ['link', 'links'],
    ] as const)
      if (value(key)) contact[field] = [{ label: 'Other', value: value(key) }];
    if (value('externalId')) contact.externalIds = [value('externalId')];
    if (value('birthday'))
      try {
        contact.birthday = birthday(value('birthday'));
      } catch (e) {
        result.errors.push((e as Error).message);
      }
    if (cells.length !== headers.length)
      result.warnings.push('Column count differs from the header.');
    return validate(result);
  });
}
const unescape = (s: string) => s.replace(/\\[nN]/g, '\n').replace(/\\([,;\\])/g, '$1');
export function vcardContacts(text: string): ImportRow[] {
  const lines = text
      .replace(/\r\n/g, '\n')
      .replace(/\n[ \t]/g, '')
      .split('\n'),
    out: ImportRow[] = [];
  let row: ImportRow | undefined;
  let version = '';
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.toUpperCase() === 'BEGIN:VCARD') {
      if (row) throw new Error('Nested vCard.');
      row = { row: out.length + 1, contact: { name: '' }, warnings: [], errors: [] };
      version = '';
      continue;
    }
    if (line.toUpperCase() === 'END:VCARD') {
      if (!row) throw new Error('Invalid vCard.');
      if (!['3.0', '4.0'].includes(version))
        row.errors.push('Only vCard 3.0 and 4.0 are supported.');
      out.push(validate(row));
      row = undefined;
      continue;
    }
    if (!row || !line) continue;
    const pos = line.indexOf(':');
    if (pos < 0) {
      row.warnings.push('Ignored malformed property.');
      continue;
    }
    const meta = line.slice(0, pos),
      key = meta.split(';')[0].split('.').at(-1)!.toUpperCase(),
      value = unescape(line.slice(pos + 1)),
      type = meta.match(/TYPE=([^;:]+)/i)?.[1]?.replaceAll('"', '') ?? 'Other';
    if (/ENCODING=|CHARSET=(?!UTF-8)/i.test(meta)) {
      row.warnings.push(`Unsupported encoding: ${key}`);
      continue;
    }
    switch (key) {
      case 'VERSION':
        version = value;
        break;
      case 'FN':
        row.contact.name = value;
        break;
      case 'N':
        if (!row.contact.name)
          row.contact.name = value.split(';').filter(Boolean).reverse().join(' ');
        break;
      case 'ORG':
        row.contact.organization = value.split(';').filter(Boolean).join(' · ');
        break;
      case 'TITLE':
        row.contact.role = value;
        break;
      case 'NOTE':
        row.contact.notes = value;
        break;
      case 'UID':
        row.contact.externalIds = [value];
        break;
      case 'EMAIL':
        (row.contact.emails ??= []).push({ label: type, value });
        break;
      case 'TEL':
        (row.contact.phones ??= []).push({ label: type, value: value.replace(/^tel:/, '') });
        break;
      case 'URL':
        (row.contact.links ??= []).push({ label: type, value });
        break;
      case 'BDAY':
        try {
          row.contact.birthday = birthday(value);
        } catch (e) {
          row.errors.push((e as Error).message);
        }
        break;
      case 'PRODID':
      case 'REV':
        break;
      default:
        row.warnings.push(`Omitted property: ${key}`);
    }
  }
  if (row) throw new Error('Unclosed vCard.');
  if (!out.length) throw new Error('No vCard contacts found.');
  if (out.length > 1000) throw new Error('Import at most 1,000 contacts.');
  return out;
}
export const normalizeEmail = (v: string) => v.trim().toLowerCase();
export const normalizePhone = (v: string) => v.replace(/\D/g, '');
export function duplicateCandidates(c: ContactDraft, people: Person[]) {
  return people.filter(
    (p) =>
      (c.emails ?? []).some((e) =>
        p.emails.some((x) => normalizeEmail(e.value) === normalizeEmail(x.value)),
      ) ||
      (c.phones ?? []).some(
        (e) =>
          normalizePhone(e.value).length >= 7 &&
          p.phones.some((x) => normalizePhone(e.value) === normalizePhone(x.value)),
      ) ||
      (c.externalIds ?? []).some((e) => p.externalIds.includes(e)) ||
      c.name.trim().toLowerCase() === p.name.trim().toLowerCase(),
  );
}

function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortedValue(v)]),
    );
  return value;
}
export function sameImportValue(left: unknown, right: unknown) {
  return JSON.stringify(sortedValue(left)) === JSON.stringify(sortedValue(right));
}
