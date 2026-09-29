// External venue mode refuses to start for an account it may not trade in, before the bridge is
// asked anything (robinhood.ts's verifyAgenticAccount; the tools' own rule is that the account
// must come from the user and be agentic_allowed=true).
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import type { BridgeClient } from "../../src/bridge.js";
import { createExternalModeGateway } from "../../src/broker/external-mode.js";
import { connectRobinhoodMcp } from "../../src/broker/mcp-client.js";
import { createMockRobinhoodServer, MOCK_ACCOUNT_NUMBER, type MockRobinhoodOptions } from "../../src/testkit/mock-robinhood-mcp.js";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function start(opts: MockRobinhoodOptions, accountNumber = MOCK_ACCOUNT_NUMBER) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMockRobinhoodServer(opts);
  await server.connect(serverTransport);
  const mcp = await connectRobinhoodMcp({ transport: clientTransport });
  cleanup = async () => {
    await mcp.close();
    await server.close();
  };
  let hellos = 0;
  const bridge = {
    hello: async () => {
      hellos += 1;
      return { ok: false, error: { code: "unused", message: "the test bridge never answers hello" } };
    },
  } as unknown as BridgeClient;
  const result = createExternalModeGateway({ bridge, mcp, assetClass: "equity", instrument: "SPY", accountNumber });
  return { result, hellos: () => hellos };
}

describe("createExternalModeGateway account check", () => {
  it("refuses a non-agentic account before the bridge is asked anything", async () => {
    const { result, hellos } = await start({ accounts: [{ account_number: MOCK_ACCOUNT_NUMBER, agentic_allowed: false }] });
    await expect(result).rejects.toThrow(/agentic_allowed=true/);
    expect(hellos()).toBe(0);
  });

  it("refuses an account get_accounts does not list", async () => {
    const { result, hellos } = await start({}, "NOTMINE1");
    await expect(result).rejects.toThrow(/is not among/);
    expect(hellos()).toBe(0);
  });

  it("goes on to the bridge handshake for an agentic account", async () => {
    const { result, hellos } = await start({});
    await expect(result).rejects.toThrow(/bridge hello failed/);
    expect(hellos()).toBe(1);
  });
});
