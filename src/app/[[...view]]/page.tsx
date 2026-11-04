import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { Workspace } from '../../components/workspace';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ view?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { view = [] } = await params;
  const aliases: Record<string, string> = {
    workstreams: 'tasks',
    operations: 'routines',
    inbox: '',
    overview: '',
  };
  if (view[0] in aliases) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(await searchParams))
      if (v !== undefined) {
        for (const x of Array.isArray(v) ? v : [v]) query.append(k, x);
      }
    redirect(
      '/' +
        [aliases[view[0]], ...view.slice(1)].filter(Boolean).join('/') +
        (query.size ? '?' + query : ''),
    );
  }
  return (
    <Suspense
      fallback={
        <p className="muted" role="status">
          Opening page…
        </p>
      }
    >
      <Workspace />
    </Suspense>
  );
}
