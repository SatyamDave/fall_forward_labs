// One of the two processes in robinhood-oauth-lock.test.ts: connects with the stored sign-in
// (refreshing it if needed) and lists tools, which only succeeds with a token the mock accepts.
import { connectRobinhoodMcp } from "../../src/broker/mcp-client.js";

const client = await connectRobinhoodMcp();
try {
  process.stdout.write(JSON.stringify({ tools: (await client.listTools()).tools.length }));
} finally {
  await client.close();
}
