// Entry point for `just robinhood-login`: the one interactive step. Signs in to the MCP server
// at ROBINHOOD_MCP_URL in the desktop browser, stores the result at tokenPath(), then lists
// tools once to confirm. It never calls a tool. Exit 0 on success, 1 on any error.
import { ROBINHOOD_MCP_URL_ENV } from "./mcp-client.js";
import { login, openInBrowser, tokenPath } from "./robinhood-oauth.js";

async function main(): Promise<number> {
  const serverUrl = process.env[ROBINHOOD_MCP_URL_ENV];
  if (!serverUrl) throw new Error(`${ROBINHOOD_MCP_URL_ENV} is not set -- refusing to guess a broker URL`);
  const file = tokenPath();
  const toolCount = await login({
    serverUrl,
    file,
    openUrl: async (url) => {
      console.log(`Opening your browser to sign in. If it does not open, visit:\n  ${url.href}`);
      await openInBrowser(url);
    },
  });
  console.log(`signed in; sign-in stored at ${file} (mode 0600); the server lists ${toolCount} tools`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`robinhood login failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  },
);
