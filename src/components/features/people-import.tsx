'use client';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useWorkspace } from '../workspace/context';
import {
  parseCSV,
  csvContacts,
  vcardContacts,
  duplicateCandidates,
  importColumns,
  sameImportValue,
  type ImportRow,
} from '../../domain/contact-import';
interface Choice {
  action: 'create' | 'update' | 'skip';
  target: string;
  fields: Record<string, string>;
  key: string;
  status?: string;
  done?: boolean;
  version?: number;
}
export function PeopleImport({ onClose }: { onClose: () => void }) {
  const c = useWorkspace(),
    ref = useRef<HTMLDialogElement>(null),
    [rows, setRows] = useState<ImportRow[]>([]),
    [csv, setCsv] = useState<string[][]>(),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [choices, setChoices] = useState<Choice[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const prepare = (list: ImportRow[]) => {
    setRows(list);
    setChoices(
      list.map((r) => {
        const candidates = duplicateCandidates(r.contact, c.state.people);
        return {
          action: r.errors.length || candidates.length ? 'skip' : 'create',
          target: candidates[0]?.id ?? '',
          version: candidates[0]?.version,
          fields: {},
          key: crypto.randomUUID(),
        };
      }),
    );
  };
  const change = (i: number, patch: Partial<Choice>) =>
    setChoices((prev) =>
      prev.map((v, n) =>
        n === i ? { ...v, ...patch, key: crypto.randomUUID(), status: undefined } : v,
      ),
    );
  async function load(file?: File) {
    if (!file) return;
    setError('');
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Maximum upload size is 2 MiB.');
      const text = new TextDecoder('utf-8', { fatal: true })
        .decode(await file.arrayBuffer())
        .replace(/^\uFEFF/, '');
      if (/^BEGIN:VCARD/im.test(text)) {
        setCsv(undefined);
        prepare(vcardContacts(text));
      } else {
        const parsed = parseCSV(text);
        const next = Object.fromEntries(
          importColumns.map((k) => [
            k,
            parsed[0]?.find((h) => h.toLowerCase() === k.toLowerCase()) ?? '',
          ]),
        );
        setCsv(parsed);
        setMapping(next);
        prepare(csvContacts(parsed, next));
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const retryPayloads = useRef(new Map<string, unknown>());
  async function commit() {
    if (c.demo) {
      setError('The fictional preview cannot import contacts.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i],
          choice = choices[i];
        if (choice.action === 'skip' || choice.done || row.errors.length) continue;
        try {
          const cached = retryPayloads.current.get(choice.key);
          if (cached) {
            await c.request('/api/v1/commands/person.import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Idempotency-Key': choice.key },
              body: JSON.stringify(cached),
            });
            setChoices((prev) =>
              prev.map((v, n) => (n === i ? { ...v, done: true, status: 'Imported' } : v)),
            );
            continue;
          }
          if (
            choice.action === 'create' &&
            rows.slice(0, i).some(
              (r) =>
                duplicateCandidates(row.contact, [
                  {
                    ...r.contact,
                    emails: r.contact.emails ?? [],
                    phones: r.contact.phones ?? [],
                    externalIds: r.contact.externalIds ?? [],
                  } as import('../../domain/types').Person,
                ]).length,
            ) &&
            choice.fields.duplicate !== 'confirmed'
          )
            throw new Error('Confirm creating a separate contact for the duplicate in this file.');
          const target = c.state.people.find((p) => p.id === choice.target),
            profile: Record<string, unknown> = {},
            existingDate = c.state.importantDates.find(
              (d) => d.personId === target?.id && d.kind === 'birthday',
            );
          let birthday: unknown;
          for (const [key, value] of Object.entries(row.contact)) {
            if (value === '' || (Array.isArray(value) && !value.length)) continue;
            const current =
              key === 'birthday'
                ? existingDate
                  ? { month: existingDate.month, day: existingDate.day, year: existingDate.year }
                  : undefined
                : target?.[key as keyof typeof target];
            const conflict =
              choice.action === 'update' &&
              current !== undefined &&
              current !== '' &&
              (!Array.isArray(current) || current.length > 0) &&
              !sameImportValue(current, value);
            if (conflict && !choice.fields[key]) throw new Error(`Choose which ${key} to keep.`);
            if (conflict && choice.fields[key] === 'keep') continue;
            if (key === 'birthday')
              birthday = {
                ...(value as object),
                ...(existingDate && choice.action === 'update'
                  ? { entityId: existingDate.id, expectedVersion: existingDate.version }
                  : {}),
              };
            else profile[key] = value;
          }
          const payload = {
            profile,
            ...(birthday ? { birthday } : {}),
            ...(choice.action === 'update'
              ? { entityId: choice.target, expectedVersion: choice.version }
              : {}),
            reason: 'Imported reviewed contact',
          };
          if (new TextEncoder().encode(JSON.stringify(payload)).length > 250000)
            throw new Error('This contact is too large to import.');
          if (!retryPayloads.current.has(choice.key))
            retryPayloads.current.set(choice.key, payload);
          await c.request('/api/v1/commands/person.import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': choice.key },
            body: JSON.stringify(retryPayloads.current.get(choice.key) ?? payload),
          });
          setChoices((prev) =>
            prev.map((v, n) => (n === i ? { ...v, done: true, status: 'Imported' } : v)),
          );
        } catch (e) {
          setChoices((prev) =>
            prev.map((v, n) => (n === i ? { ...v, status: (e as Error).message } : v)),
          );
        }
      }
      await c.reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="command-dialog import-dialog"
      aria-label="Import contacts"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-heading">
        <div>
          <span className="eyebrow">REVIEW BEFORE SAVING</span>
          <h2>Import contacts</h2>
        </div>
        <button aria-label="Close import" className="icon-button" disabled={busy} onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <p className="muted">
        UTF-8 CSV or vCard 3.0/4.0 · up to 1,000 contacts and 2 MiB. Photos and attachments are
        omitted.
      </p>
      <label>
        Contact file
        <input
          type="file"
          accept=".csv,.vcf,.vcard,text/csv,text/vcard"
          disabled={busy}
          onChange={(e) => void load(e.target.files?.[0])}
        />
      </label>
      {csv && (
        <details open>
          <summary>Map CSV columns</summary>
          <div className="import-mapping">
            {importColumns.map((k) => (
              <label key={k}>
                {k}
                <select
                  aria-label={`Map ${k}`}
                  value={mapping[k] ?? ''}
                  disabled={busy || choices.some((c) => c.done)}
                  onChange={(e) => {
                    const next = { ...mapping, [k]: e.target.value };
                    setMapping(next);
                    prepare(csvContacts(csv, next));
                  }}
                >
                  <option value="">Not included</option>
                  {csv[0].map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="import-preview">
        {rows.map((row, i) => {
          const choice = choices[i],
            target = c.state.people.find((p) => p.id === choice?.target),
            candidates = duplicateCandidates(row.contact, c.state.people),
            birthday = c.state.importantDates.find(
              (d) => d.personId === target?.id && d.kind === 'birthday',
            );
          const within = rows
            .slice(0, i)
            .some(
              (other) =>
                other.contact.name.toLowerCase() === row.contact.name.toLowerCase() ||
                (other.contact.emails ?? []).some((e) =>
                  (row.contact.emails ?? []).some(
                    (x) => x.value.toLowerCase() === e.value.toLowerCase(),
                  ),
                ) ||
                (other.contact.phones ?? []).some((e) =>
                  (row.contact.phones ?? []).some(
                    (x) => x.value.replace(/\D/g, '') === e.value.replace(/\D/g, ''),
                  ),
                ) ||
                (other.contact.externalIds ?? []).some((x) => row.contact.externalIds?.includes(x)),
            );
          return (
            <article className="compact-card" key={i}>
              <div className="row-between">
                <h3>{row.contact.name || `Row ${row.row}`}</h3>
                <select
                  aria-label={`Import action for row ${row.row}`}
                  disabled={busy || choice?.done || !!row.errors.length}
                  value={choice?.action ?? 'skip'}
                  onChange={(e) => change(i, { action: e.target.value as Choice['action'] })}
                >
                  <option value="skip">Skip</option>
                  <option value="create">Create new person</option>
                  <option value="update">Update existing person</option>
                </select>
              </div>
              {(candidates.length > 0 || within) && (
                <p className="notice">
                  Possible duplicate{within ? ' within this file' : ''}. Review before creating
                  another contact.
                </p>
              )}
              {within && choice?.action === 'create' && (
                <label className="check-option">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={choice.fields.duplicate === 'confirmed'}
                    onChange={(e) =>
                      change(i, {
                        fields: {
                          ...choice.fields,
                          duplicate: e.target.checked ? 'confirmed' : '',
                        },
                      })
                    }
                  />
                  Create this repeated contact as a separate person
                </label>
              )}
              {choice?.action === 'update' && (
                <label>
                  Existing person
                  <select
                    aria-label={`Existing person for row ${row.row}`}
                    value={choice.target}
                    disabled={busy || choice.done}
                    onChange={(e) =>
                      change(i, {
                        target: e.target.value,
                        version: c.state.people.find((p) => p.id === e.target.value)?.version,
                        fields: {},
                      })
                    }
                  >
                    <option value="">Choose a person</option>
                    {c.state.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {candidates.some((x) => x.id === p.id) ? ' · possible match' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {Object.entries(row.contact).map(([key, value]) => {
                const current =
                  key === 'birthday'
                    ? birthday
                      ? { month: birthday.month, day: birthday.day, year: birthday.year }
                      : undefined
                    : target?.[key as keyof typeof target];
                const conflict =
                  choice?.action === 'update' &&
                  current !== undefined &&
                  current !== '' &&
                  (!Array.isArray(current) || current.length > 0) &&
                  !sameImportValue(current, value);
                return (
                  <div className="import-field" key={key}>
                    <strong>{key}</strong>
                    <span className="prewrap">
                      {typeof value === 'string' ? value : JSON.stringify(value)}
                    </span>
                    {conflict && (
                      <label>
                        Existing: {typeof current === 'string' ? current : JSON.stringify(current)}
                        <select
                          aria-label={`${key} conflict for row ${row.row}`}
                          value={choice.fields[key] ?? ''}
                          disabled={busy || choice.done}
                          onChange={(e) =>
                            change(i, { fields: { ...choice.fields, [key]: e.target.value } })
                          }
                        >
                          <option value="">Choose a value</option>
                          <option value="keep">Keep existing</option>
                          <option value="import">Use imported</option>
                        </select>
                      </label>
                    )}
                  </div>
                );
              })}
              {row.warnings.map((w, n) => (
                <p className="muted" key={n}>
                  {w}
                </p>
              ))}
              {row.errors.map((e, n) => (
                <p className="error" key={n}>
                  {e}
                </p>
              ))}
              {choice?.status && (
                <p role="status" className={choice.done ? 'notice' : 'error'}>
                  {choice.status}
                  {!choice.done && (
                    <button
                      className="text-link"
                      onClick={() => change(i, { version: target?.version, fields: {} })}
                    >
                      Review refreshed record
                    </button>
                  )}
                </p>
              )}
            </article>
          );
        })}
      </div>
      <div className="dialog-actions">
        <span>
          {choices.filter((c) => c.done).length} imported · {rows.length} rows
        </span>
        <button className="button secondary" disabled={busy} onClick={onClose}>
          Close
        </button>
        <button className="button" disabled={busy || !rows.length} onClick={() => void commit()}>
          {busy ? 'Importing…' : 'Import reviewed contacts'}
        </button>
      </div>
    </dialog>
  );
}
