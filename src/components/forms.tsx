'use client';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
export interface Field {
  name: string;
  label: string;
  type?:
    'text' | 'textarea' | 'number' | 'datetime-local' | 'date' | 'select' | 'multiselect' | 'file';
  value?: string | string[];
  required?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
  disabledWhen?: { field: string; value: string };
  when?: { field: string; value: string };
}
export interface FormSpec {
  title: string;
  description?: string;
  fields: Field[];
  submit: string;
  run: (data: FormData) => Promise<void>;
}
export function CommandForm({ spec, onClose }: { spec: FormSpec; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [values, setValues] = useState<Record<string, string>>(() =>
      Object.fromEntries(
        spec.fields.map((f) => [f.name, typeof f.value === 'string' ? f.value : '']),
      ),
    );
  useEffect(() => {
    const d = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    d?.showModal();
    return () => {
      d?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="command-dialog"
      aria-label={spec.title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) {
          dialog.current?.close();
          onClose();
        }
      }}
    >
      <form
        onChange={(e) => {
          const target = e.target as unknown as HTMLInputElement;
          setValues((v) => ({ ...v, [target.name]: target.value }));
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            const data = new FormData(e.currentTarget);
            const missing = spec.fields.find(
              (f) =>
                f.type === 'multiselect' &&
                f.required !== false &&
                (!f.disabledWhen || values[f.disabledWhen.field] !== f.disabledWhen.value) &&
                (!f.when || values[f.when.field] === f.when.value) &&
                data.getAll(f.name).length === 0,
            );
            if (missing)
              throw new Error(`Choose at least one option for ${missing.label.toLowerCase()}.`);
            await spec.run(data);
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Request failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">ACCORD</span>
            <h2 id="command-title">{spec.title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
            disabled={busy}
          >
            <X size={20} />
          </button>
        </div>
        {spec.description && <p className="muted prewrap">{spec.description}</p>}
        <div className="form-fields">
          {spec.fields
            .filter((f) => !f.when || values[f.when.field] === f.when.value)
            .map((f) => (
              <label key={f.name}>
                {f.label}
                {f.type === 'textarea' ? (
                  <textarea
                    aria-label={f.label}
                    name={f.name}
                    defaultValue={f.value}
                    required={f.required ?? true}
                    rows={4}
                  />
                ) : f.type === 'multiselect' ? (
                  <fieldset
                    className="check-options"
                    aria-label={f.label}
                    disabled={Boolean(
                      f.disabledWhen && values[f.disabledWhen.field] === f.disabledWhen.value,
                    )}
                  >
                    {f.options?.map((o) => (
                      <span key={o.value} className="check-option">
                        <input
                          aria-label={o.label}
                          type="checkbox"
                          name={f.name}
                          value={o.value}
                          defaultChecked={Array.isArray(f.value) && f.value.includes(o.value)}
                        />
                        <span>{o.label}</span>
                      </span>
                    ))}
                  </fieldset>
                ) : f.type === 'select' ? (
                  <select
                    aria-label={f.label}
                    name={f.name}

                    defaultValue={f.value}
                    required={f.required ?? true}
                  >
                    {f.required === false && <option value="">None</option>}
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label={f.label}
                    name={f.name}
                    type={f.type ?? 'text'}
                    defaultValue={f.type === 'file' ? undefined : f.value}
                    required={f.required ?? true}
                    min={f.type === 'number' ? 0 : undefined}
                    step={f.type === 'number' ? 'any' : undefined}
                  />
                )}{' '}
                {f.hint && <small>{f.hint}</small>}
              </label>
            ))}
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="button" disabled={busy}>
            {busy ? 'Saving…' : spec.submit}
          </button>
        </div>
      </form>
    </dialog>
  );
}
