import { z } from 'zod';
import type { State } from './types';

const text = z.string().trim().min(1).max(10000);
export const taskLinkSchema = z
  .object({
    id: z.guid(),
    title: text,
    url: z
      .string()
      .trim()
      .url()
      .refine((v) => /^https?:/.test(v), 'Use an HTTP or HTTPS URL.'),
    note: text.optional(),
  })
  .strict();
export const taskLinksSchema = z
  .array(taskLinkSchema)
  .refine(
    (links) => new Set(links.map((link) => link.id)).size === links.length,
    'Duplicate link identifier.',
  );

/** Upgrade legacy tasks in memory without changing the input or task versions. */
export function normalizeTaskLinks(s: State): State {
  return {
    ...s,
    workstreams: s.workstreams.map((w) => (w.links === undefined ? { ...w, links: [] } : w)),
  };
}
