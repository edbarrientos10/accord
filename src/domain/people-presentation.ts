import type { State, ImportantDate } from './types';
export function localDate(now: number, timezone = 'America/Monterrey') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function addDays(day: string, days: number) {
  return new Date(Date.parse(day + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
export function occasionDate(d: ImportantDate, year: number) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return `${String(year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.month === 2 && d.day === 29 && !leap ? 28 : d.day).padStart(2, '0')}`;
}
export interface PeopleQueueItem {
  id: string;
  subjectId: string;
  version: number;
  personId: string;
  commitmentId?: string;
  taskId?: string;
  occurrenceKey: string;
  category: 'occasion' | 'contact' | 'commitment';
  title: string;
  reasons: string[];
  at: string;
  ownerId: string;
  priority: number;
  snoozedUntil?: string;
  acknowledged?: boolean;
}
const priorities = { none: 0, low: 1, medium: 2, high: 3, urgent: 4 };
export function nextContactDate(s: State, personId: string) {
  const p = (s.people ?? []).find((p) => p.id === personId);
  if (!p || p.status === 'archived' || p.cadenceMode === 'paused') return null;
  const days =
    p.cadenceMode === 'custom'
      ? p.cadenceDays
      : (s.relationshipGroups ?? []).find((g) => g.id === p.groupId)?.cadenceDays;
  if (!days) return null;
  const last =
    (s.interactions ?? [])
      .filter((i) => i.personId === p.id && i.meaningful && !i.voided)
      .map((i) => i.occurredAt)
      .sort()
      .at(-1) ?? p.createdAt;
  return addDays(localDate(Date.parse(last), s.timezone), days);
}
export function upcomingDates(s: State, now = Date.now()) {
  const today = localDate(now, s.timezone),
    year = Number(today.slice(0, 4));
  return (s.importantDates ?? [])
    .filter((d) => d.active && s.people.some((p) => p.id === d.personId && p.status === 'active'))
    .map((d) => {
      let date = occasionDate(d, d.annual ? year : d.year!);
      if (d.annual && date < today) date = occasionDate(d, year + 1);
      return { ...d, date };
    })
    .filter((d) => d.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
}
export function peopleQueue(s: State, now = Date.now()): PeopleQueueItem[] {
  const today = localDate(now, s.timezone),
    year = Number(today.slice(0, 4)),
    out: PeopleQueueItem[] = [];
  const human = s.identities.find((i) => i.kind === 'human')?.id ?? '';
  for (const p of s.people ?? []) {
    if (p.status === 'archived') continue;
    const due = nextContactDate(s, p.id),
      group = s.relationshipGroups.find((g) => g.id === p.groupId);
    if (due && due <= today)
      out.push({
        id: `contact:${p.id}`,
        subjectId: p.id,
        version: p.version,
        personId: p.id,
        occurrenceKey: `contact:${p.id}:${due}:${p.version}:${group?.version ?? 0}`,
        category: 'contact',
        title: `Stay in touch with ${p.name}`,
        reasons: ['Time to reconnect'],
        at: due,
        ownerId: human,
        priority: 0,
      });
    for (const d of (s.importantDates ?? []).filter((d) => d.personId === p.id && d.active))
      for (const y of d.annual ? [year, year + 1] : [d.year!]) {
        if (d.year && y < d.year) continue;
        const date = occasionDate(d, y),
          phase =
            date === today
              ? 'day'
              : d.advance && today >= addDays(date, -7) && today < date
                ? 'advance'
                : null;
        if (phase)
          out.push({
            id: `occasion:${d.id}:${y}:${phase}`,
            subjectId: d.id,
            version: d.version,
            personId: p.id,
            occurrenceKey: `occasion:${d.id}:${y}:${phase}`,
            category: 'occasion',
            title: `${p.name} · ${d.title}`,
            reasons: [phase === 'day' ? 'Today' : `Coming up ${date}`],
            at: date,
            ownerId: human,
            priority: 0,
          });
      }
  }
  for (const c of s.commitments ?? []) {
    if (['fulfilled', 'declined', 'cancelled', 'waived'].includes(c.status)) continue;
    const reasons = [];
    if (c.status === 'reported_done') reasons.push('Reported done · confirm fulfillment');
    if (c.promisedDate && c.promisedDate <= today) reasons.push('Promised date due');
    if (c.followUpAt && Date.parse(c.followUpAt) <= now) reasons.push('Follow-up due');
    if (reasons.length)
      out.push({
        id: `commitment:${c.id}`,
        subjectId: c.id,
        version: c.version,
        personId: c.personId,
        commitmentId: c.id,
        taskId: c.workstreamId ?? undefined,
        occurrenceKey: `commitment:${c.id}:${c.version}`,
        category: 'commitment',
        title: c.title,
        reasons,
        at: c.followUpAt ?? (c.promisedDate ? `${c.promisedDate}T00:00:00Z` : c.updatedAt),
        ownerId: c.coordinatorId,
        priority: priorities[c.priority],
      });
  }
  return out
    .map((q) => {
      const r = (s.peopleResponses ?? []).find(
        (r) => r.occurrenceKey === q.occurrenceKey && r.subjectVersion === q.version,
      );
      return {
        ...q,
        acknowledged: r?.response === 'acknowledged',
        snoozedUntil:
          r?.response === 'snoozed' && r.until && Date.parse(r.until) > now ? r.until : undefined,
      };
    })
    .filter((q) => !q.acknowledged)
    .sort(
      (a, b) => b.priority - a.priority || a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
    );
}
