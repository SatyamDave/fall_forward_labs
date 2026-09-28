// Issue #45 (TS side): reconcileWithBroker() pulls what the mock Robinhood server reports and
// hands it to a BridgeReconciler double, proving a deliberately-injected mismatch (our "OMS" via
// the bridge double disagreeing with the mock's own get_equity_positions/get_accounts) is
// flagged rather than resolved by trusting either side.
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { connectRobinhoodMcp } from "../../src/broker/mcp-client.js";
import { ReconciliationHalted, reconcileWithBroker } from "../../src/broker/reconcile.js";
import { createMockRobinhoodServer } from "../../src/testkit/mock-robinhood-mcp.js";
import type { VenueSnapshot } from "../../src/types.js";

describe("reconcileWithBroker", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((c) => c()));
  });

  async function connectToMock(position: string, cash: string | null) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMockRobinhoodServer({ position, cash });
    await server.connect(serverTransport);
    const mcp = await connectRobinhoodMcp({ transport: clientTransport });
    closers.push(async () => {
      await mcp.close();
      await server.close();
    });
    return mcp;
  }

  it("passes the broker's reported orders/position/cash straight through to the bridge, unmodified", async () => {
    const mcp = await connectToMock("3", "12345.67");
    let seen: VenueSnapshot | undefined;
    const bridge = {
      reconcile: async (venue: VenueSnapshot) => {
        seen = venue;
        return { ok: true };
      },
    };

    await reconcileWithBroker({ mcp, bridge, assetClass: "equity", instrument: "SPY" });

    expect(seen).toBeDefined();
    expect(seen!.position).toBe("3");
    expect(seen!.cash).toBe("12345.67");
    expect(seen!.orders).toEqual([]);
  });

  it("throws ReconciliationHalted when the bridge reports a mismatch -- never silently continues", async () => {
    const mcp = await connectToMock("3", "12345.67");
    const bridge = {
      reconcile: async () => ({
        ok: false,
        error: { code: "reconciliation", message: "position mismatch: our OMS has 5, broker reports 3" },
      }),
    };

    await expect(reconcileWithBroker({ mcp, bridge, assetClass: "equity", instrument: "SPY" })).rejects.toThrow(
      ReconciliationHalted,
    );
    await expect(reconcileWithBroker({ mcp, bridge, assetClass: "equity", instrument: "SPY" })).rejects.toThrow(
      /position mismatch/,
    );
  });

  it("clean compare (ok:true) resolves without throwing", async () => {
    const mcp = await connectToMock("0", "10000.00");
    const bridge = { reconcile: async () => ({ ok: true }) };

    await expect(reconcileWithBroker({ mcp, bridge, assetClass: "equity", instrument: "SPY" })).resolves.toBeUndefined();
  });
});
