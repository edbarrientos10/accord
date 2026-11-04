import { z } from 'zod';
import { authenticate, checkOrigin } from '../../../../server/auth';
import { SupabaseRepository } from '../../../../server/repository';
import { makeArchive } from '../../../../server/export';
import { assert } from '../../../../domain/errors';
import { body, failure } from '../../../../server/http';
export const maxDuration = 60;
export async function POST(r: Request) {
  try {
    checkOrigin(r);
    const actor = await authenticate(r);
    assert(
      actor.kind === 'human',
      'human_required',
      'Only the owner exports private workspace records.',
      403,
    );
    const { ids } = z
      .object({ ids: z.array(z.guid()).min(1) })
      .strict()
      .parse(await body(r));
    const archive = await makeArchive(await new SupabaseRepository().load(actor.workspaceId), ids);
    const bytes = new TextEncoder().encode(JSON.stringify(archive));
    let offset = 0;
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (offset >= bytes.length) {
            controller.close();
            return;
          }
          controller.enqueue(bytes.slice(offset, offset + 16384));
          offset += 16384;
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Content-Disposition': 'attachment; filename="accord-export.json"',
        },
      },
    );
  } catch (e) {
    return failure(e);
  }
}
