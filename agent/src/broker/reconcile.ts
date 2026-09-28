// Issue #45 (TS side): "check every day that our books match Robinhood's." This module pulls
// what the broker itself reports -- every order, this instrument's position, and account cash
// (mocked, per this build's hard limits) -- and hands it to the bridge's protocol v1.2
// `reconcile` op. The bridge owns the actual comparison (it holds the OMS's ground truth); this
// module's job is to gather the venue-side snapshot honestly and to fail loudly, never silently,
// when the bridge reports a mismatch -- root CLAUDE.md rule 10: "neither side is silently
// trusted over the other."
import type { CallOptions } from "./robinhood.js";
import * as robinhood from "./robinhood.js";
import type { McpClient } from "./mcp-client.js";
import type { AssetClass } from "./types.js";
import type { VenueOrderSnapshot, VenueSnapshot } from "../types.js";

/** Thrown when the bridge reports the reconcile call did not come back clean. By the time this
 *  throws, the bridge has already engaged its own halt (wave2-spec.md's reconcile op: "any
 *  discrepancy ... engages halt via the bridge"); this exception is what stops the TS side from
 *  treating a mismatch as fine and continuing to trade regardless. */
export class ReconciliationHalted extends Error {
  constructor(
    message: string,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(`reconciliation mismatch: ${message}`);
    this.name = "ReconciliationHalted";
  }
}

/** The subset of BridgeClient this module needs -- narrowed so a test can hand in a trivial
 *  double instead of a real bridge process, same convention as broker/types.ts's
 *  BridgeReporter. */
export interface BridgeReconciler {
  reconcile(venue: VenueSnapshot): Promise<{
    ok: boolean;
    error?: { code: string; message: string };
    status?: Record<string, unknown>;
  }>;
}

export interface ReconcileDeps {
  mcp: McpClient;
  bridge: BridgeReconciler;
  assetClass: AssetClass;
  instrument: string;
  callOpts?: CallOptions;
}

/** The bridge's reconcile schema only knows about live ("open") or terminal venue states;
 *  "not_found" isn't a venue order at all, so it's dropped rather than mapped into something
 *  that would look like a phantom order the bridge has never heard of. */
function toVenueOrderSnapshot(order: robinhood.VenueOrder): VenueOrderSnapshot | null {
  if (order.status === "not_found") return null;
  const state = order.status === "accepted" || order.status === "partially_filled" ? "open" : order.status;
  return {
    client_order_id: order.client_order_id,
    venue_order_id: order.venue_order_id ?? "",
    state,
    filled_qty: order.filled_qty ?? "0",
  };
}

/** Runs one reconciliation pass. Call this at loop startup, periodically, and after any
 *  ambiguous broker response (wave2-spec.md) -- `agent/src/broker/external-mode.ts` wires all
 *  three trigger points to this same function, so there is exactly one place that decides what
 *  "reconciled" means. */
export async function reconcileWithBroker(deps: ReconcileDeps): Promise<void> {
  const [orders, account] = await Promise.all([
    robinhood.listOrders(deps.mcp, deps.assetClass, deps.callOpts),
    robinhood.getAccountState(deps.mcp, deps.assetClass, deps.instrument, deps.callOpts),
  ]);

  const venue: VenueSnapshot = {
    orders: orders.map(toVenueOrderSnapshot).filter((o): o is VenueOrderSnapshot => o !== null),
    position: account.position,
    cash: account.cash,
  };

  const resp = await deps.bridge.reconcile(venue);
  if (!resp.ok) {
    throw new ReconciliationHalted(resp.error?.message ?? "the bridge reported a discrepancy", resp.status);
  }
}
