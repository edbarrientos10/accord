import { describe, it, expect } from 'vitest';
import {
  parseCSV,
  csvContacts,
  vcardContacts,
  duplicateCandidates,
} from '../src/domain/contact-import';
import { minimalPerson } from '../src/domain/people-schema';
describe('Contact import', () => {
  it('handles quoted commas, multiline notes and explicit CSV mapping', () => {
    const rows = parseCSV(
      'Full Name,Mail,Notes,Birth\r\n"Rivera, Jamie",jamie@example.com,"Likes gardens\nand trails",02-29',
    );
    const parsed = csvContacts(rows, {
      name: 'Full Name',
      email: 'Mail',
      notes: 'Notes',
      birthday: 'Birth',
    });
    expect(parsed[0].errors).toEqual([]);
    expect(parsed[0].contact.name).toBe('Rivera, Jamie');
    expect(parsed[0].contact.notes).toContain('\n');
    expect(parsed[0].contact.birthday).toEqual({ month: 2, day: 29, year: null });
  });
  it('surfaces malformed input, invalid dates and the row limit', () => {
    expect(() => parseCSV('name\n"bad')).toThrow(/unclosed/);
    expect(() => parseCSV('name\n' + Array(1001).fill('person').join('\n'))).toThrow(/1,000/);
    expect(
      csvContacts(parseCSV('name,birthday,email\nJamie,2026-02-30,bad'), {
        name: 'name',
        birthday: 'birthday',
        email: 'email',
      })[0].errors,
    ).toHaveLength(2);
  });
  it('parses vCard versions, folded lines, unknown birth year and reports omitted properties', () => {
    const rows = vcardContacts(
      'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Jamie Rivera\r\nEMAIL;TYPE=home:jamie@example.com\r\nBDAY:--0229\r\nNOTE:A long\r\n  note\\nSecond line\r\nPHOTO:data:image/png;base64,ignored\r\nEND:VCARD',
    );
    expect(rows[0].contact.birthday?.year).toBeNull();
    expect(rows[0].contact.notes).toBe('A long note\nSecond line');
    expect(rows[0].warnings).toContain('Omitted property: PHOTO');
    expect(rows[0].errors).toEqual([]);
    expect(vcardContacts('BEGIN:VCARD\nVERSION:2.1\nFN:Old\nEND:VCARD')[0].errors[0]).toContain(
      '3.0',
    );
    expect(() => vcardContacts('BEGIN:VCARD\nVERSION:3.0')).toThrow(/Unclosed/);
  });
  it('suggests duplicates by normalized address, phone, source ID and name without merging', () => {
    const p = minimalPerson(
      '00000000-0000-4000-8000-000000000001',
      'Jamie',
      '2026-01-01T00:00:00Z',
    );
    p.emails = [{ label: 'home', value: 'JAMIE@example.com' }];
    p.phones = [{ label: 'mobile', value: '+1 (555) 123-4567' }];
    p.externalIds = ['source-id'];
    for (const c of [
      { name: 'Another', emails: [{ label: '', value: 'jamie@EXAMPLE.COM' }] },
      { name: 'Another', phones: [{ label: '', value: '15551234567' }] },
      { name: 'Another', externalIds: ['source-id'] },
      { name: 'jamie' },
    ])
      expect(duplicateCandidates(c, [p])).toEqual([p]);
    expect(p.name).toBe('Jamie');
  });
});
