import '../scripts/env';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { randomUUID } from 'node:crypto';
const url = process.env.ACCORD_MCP_URL,
  token = process.env.ACCORD_AGENT_TOKEN;
if (!url || !token)
  throw new Error('Set ACCORD_MCP_URL and ACCORD_AGENT_TOKEN in your environment.');
const client = new Client({ name: 'accord-example', version: '0.1.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }),
);
const command = process.argv[2] ?? 'query',
  input = process.argv[3] ? JSON.parse(process.argv[3]) : {};
// Example: npm run agent:example -- action_propose '{...bounded action fields...}'
// Approval is performed by the owner through Today, never by this client.
const result = await client.callTool({
  name: `accord_${command}`,
  arguments:
    command === 'query' || command === 'attention'
      ? input
      : { input, idempotencyKey: process.env.ACCORD_RETRY_KEY ?? randomUUID() },
});
console.log(JSON.stringify(result, null, 2));
await client.close();
