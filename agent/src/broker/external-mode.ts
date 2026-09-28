// Wires BrokerGateway (and its dependencies) into "external" venue mode: the v1.1 hello
// handshake for the approval public key, the bridge's own market clock for approval expiry
// (never Date.now() -- see gateway-market-clock.test.ts), and reconciliation triggered from
// every point wave2-spec.md names: at startup (call `reconcile()` once before the loop starts),
// periodically (agent/src/loop.ts calls it every N decisions), and after an ambiguous broker
// response (wired here as the gateway's onAmbiguousOutcome). agent/src/cli.ts is the only
// production caller; tests build BrokerGateway/reconcileWithBroker directly instead of going
// through this factory, the same way agent/tests/broker/gateway.test.ts already does.
import { ed25519PublicKeyFromRaw } from "./crypto.js";
import { BrokerGateway, type GatewayConfig } from "./gateway.js";
import { reconcileWithBroker } from "./reconcile.js";
import type { McpClient } from "./mcp-client.js";
import type { AssetClass } from "./types.js";
import type { BridgeClient } from "../bridge.js";

export interface ExternalModeDeps {
  bridge: BridgeClient;
  mcp: McpClient;
  assetClass: AssetClass;
  instrument: string;
  journalPath?: string;
  requestTimeoutMs?: number;
  logPreview?: GatewayConfig["logPreview"];
}

export interface ExternalMode {
  gateway: BrokerGateway;
  /** Runs one reconciliation pass now. Call at startup and periodically (agent/src/loop.ts);
   *  also wired automatically below as the gateway's onAmbiguousOutcome trigger. */
  reconcile: () => Promise<void>;
}

/**
 * Performs the hello handshake and builds an external-venue-mode BrokerGateway wired to: the
 * bridge itself as its BridgeReporter (report_execution) and BridgeReconciler (reconcile), the
 * bridge's market clock (`marketNowNs()`) for approval expiry, and `reconcileWithBroker()`
 * triggered on every ambiguous broker response. Throws if the bridge reports venue_mode "sim" --
 * this factory is external-mode-only; sim mode needs no gateway at all (the bridge routes
 * straight to SimVenue and never returns an approval to verify).
 */
export async function createExternalModeGateway(deps: ExternalModeDeps): Promise<ExternalMode> {
  const helloResp = await deps.bridge.hello();
  if (!helloResp.ok || !helloResp.hello) {
    throw new Error(`bridge hello failed: ${helloResp.error?.code ?? "unknown"} ${helloResp.error?.message ?? ""}`);
  }
  if (helloResp.hello.venue_mode !== "external") {
    throw new Error(`createExternalModeGateway called but the bridge reported venue_mode ${helloResp.hello.venue_mode}`);
  }
  const approvalPublicKey = ed25519PublicKeyFromRaw(Buffer.from(helloResp.hello.approval_public_key, "base64"));

  const reconcile = (): Promise<void> =>
    reconcileWithBroker({
      mcp: deps.mcp,
      bridge: deps.bridge,
      assetClass: deps.assetClass,
      instrument: deps.instrument,
      callOpts: { timeoutMs: deps.requestTimeoutMs },
    });

  const gateway = new BrokerGateway({
    mcp: deps.mcp,
    reporter: deps.bridge,
    approvalPublicKey,
    now: () => deps.bridge.marketNowNs(),
    requestTimeoutMs: deps.requestTimeoutMs,
    journalPath: deps.journalPath,
    logPreview: deps.logPreview,
    onAmbiguousOutcome: () => {
      // Fire and forget: GatewayConfig's contract for this hook is that it must never itself
      // throw or be awaited (it runs inside a catch block that's about to throw the order's own
      // error). Log-and-continue is the right failure mode for a reconcile-trigger failure, not
      // crashing the whole loop over it.
      reconcile().catch((err: unknown) => {
        console.error("reconciliation after an ambiguous broker response failed:", err);
      });
    },
  });

  return { gateway, reconcile };
}
