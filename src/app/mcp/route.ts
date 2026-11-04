import { recordFailure } from '../../server/attempts';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticate, checkOrigin } from '../../server/auth';
import { mcpServer } from '../../server/mcp';
import { SupabaseRepository } from '../../server/repository';
import { body, failure, json } from '../../server/http';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  let server;
  try {
    checkOrigin(request);
    const actor = await authenticate(request);
    const repo = new SupabaseRepository();
    let parsedBody: unknown;
    const started = performance.now();
    try {
      parsedBody = await body(request);
    } catch (e) {
      await recordFailure(repo, actor, { name: 'unknown.command', transport: 'mcp', started }, e);
      throw e;
    }
    server = mcpServer(repo, actor);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return await transport.handleRequest(request, { parsedBody });
  } catch (e) {
    return failure(e);
  } finally {
    await server?.close();
  }
}
export async function GET() {
  return json(
    { error: { code: 'method_not_allowed', message: 'Accord uses stateless MCP POST requests.' } },
    405,
  );
}
export const DELETE = GET;
