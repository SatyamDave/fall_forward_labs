// The door orders must pass through to reach the broker (#35) and the mock-Robinhood
// connection to it (#43, mock only). Covers exactly the scenarios wave-spec.md's gateway lane
// calls for: happy path, tampered approval refused, expired refused, duplicate client_order_id
// not resent, timeout -> status query -> no double order, reject -> report_execution rejected.
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrokerGateway, GatewayRejection } from "../../src/broker/gateway.js";
import { connectRobinhoodMcp } from "../../src/broker/mcp-client.js";
import { ed25519PublicKeyFromRaw } from "../../src/broker/crypto.js";
import type {
  Approval,
  ApprovalPayload,
  ApprovedOrder,
  BridgeReporter,
  CancelApprovalPayload,
  ReportExecutionOp,
} from "../../src/broker/types.js";
import { createMockRobinhoodServer, type MockScenario } from "../../src/testkit/mock-robinhood-mcp.js";

function tempJournalPath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "broker-gateway-journal-"));
  return path.join(dir, "broker-journal.jsonl");
}

// --- a tiny, local fake bridge reporter for THIS lane's tests only. Not
// agent/src/testkit/fake-bridge.ts (that fakes qc-bridge's v1 JSON-Lines process, and is a
// different lane's shared file); this just records report_execution calls in memory. ---
class RecordingReporter implements BridgeReporter {
  readonly calls: ReportExecutionOp[] = [];
  ok = true;
  async reportExecution(op: ReportExecutionOp) {
    this.calls.push(op);
    return this.ok ? { ok: true as const } : { ok: false as const, error: { code: "boom", message: "synthetic failure" } };
  }
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const rawPublicKey = (publicKey.export({ type: "spki", format: "der" }) as Buffer).subarray(-32);

const NOW_NS = 1_767_571_200_000_000_000; // arbitrary fixed instant

function canonicalPayload(fields: ApprovalPayload): string {
  // Mirrors the bridge's canonicalization: sorted keys, no whitespace. Order matters for the
  // signature to be reproducible the same way every time, not for correctness of what's
  // compared (gateway.ts re-parses and compares fields, never string-diffs the JSON).
  const sorted: ApprovalPayload = {
    client_order_id: fields.client_order_id,
    expires_ts_ns: fields.expires_ts_ns,
    instrument: fields.instrument,
    limit_price: fields.limit_price,
    qty: fields.qty,
    request_id: fields.request_id,
    side: fields.side,
    time_in_force: fields.time_in_force,
  };
  return JSON.stringify(sorted);
}

function approve(fields: ApprovalPayload): Approval {
  const payload = canonicalPayload(fields);
  const signature = cryptoSign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64");
  return { payload, signature };
}

function canonicalCancelPayload(fields: CancelApprovalPayload): string {
  // Sorted keys, no whitespace -- same canonicalization convention as canonicalPayload() above,
  // for protocol v1.2's distinct (smaller) cancel approval payload shape.
  const sorted: CancelApprovalPayload = {
    action: fields.action,
    client_order_id: fields.client_order_id,
    expires_ts_ns: fields.expires_ts_ns,
  };
  return JSON.stringify(sorted);
}

function approveCancel(fields: CancelApprovalPayload): Approval {
  const payload = canonicalCancelPayload(fields);
  const signature = cryptoSign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64");
  return { payload, signature };
}

function cancelFields(clientOrderId: number): CancelApprovalPayload {
  return { action: "cancel", client_order_id: clientOrderId, expires_ts_ns: NOW_NS + 5_000_000_000 };
}

function orderFrom(fields: ApprovalPayload): ApprovedOrder {
  return {
    client_order_id: fields.client_order_id,
    instrument: fields.instrument,
    side: fields.side,
    qty: fields.qty,
    limit_price: fields.limit_price,
    time_in_force: fields.time_in_force,
    request_id: fields.request_id,
  };
}

function baseFields(clientOrderId: number): ApprovalPayload {
  return {
    client_order_id: clientOrderId,
    expires_ts_ns: NOW_NS + 5_000_000_000, // +5s TTL, per protocol v1.1
    instrument: "SPY",
    limit_price: "500.00",
    qty: "10",
    request_id: `req-${clientOrderId}`,
    side: "buy",
    time_in_force: "ioc",
  };
}

describe("BrokerGateway", () => {
  let closers: Array<() => Promise<void>> = [];
  let reporter: RecordingReporter;

  beforeEach(() => {
    reporter = new RecordingReporter();
    closers = [];
  });

  afterEach(async () => {
    await Promise.all(closers.map((c) => c()));
  });

  // Every test gets its own journal file (like ledger.test.ts's tempLedgerPath()) -- otherwise
  // every gateway in this suite would replay every other test's client_order_ids from a shared
  // default out/agent/broker-journal.jsonl on disk, and would also litter the real repo tree.
  async function makeGateway(scenarios: Record<string, MockScenario>, onToolCall?: (name: string) => void): Promise<BrokerGateway> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMockRobinhoodServer({ scenarios, onToolCall });
    await server.connect(serverTransport);
    const client = await connectRobinhoodMcp({ transport: clientTransport });
    closers.push(async () => {
      await client.close();
      await server.close();
    });
    return new BrokerGateway({
      mcp: client,
      reporter,
      approvalPublicKey: ed25519PublicKeyFromRaw(rawPublicKey),
      now: () => NOW_NS,
      requestTimeoutMs: 200,
      journalPath: tempJournalPath(),
    });
  }

  /** A second client connected to the SAME mock server instance, sharing `journalPath` with an
   *  existing gateway -- simulates "a fresh process starts, journal on disk, same broker
   *  connection" without the first gateway's in-memory state being reachable at all. */
  async function reconnectGateway(server: Server, journalPath: string): Promise<BrokerGateway> {
    // The MCP Server type only accepts one live transport at a time; closing it doesn't touch
    // the mock's own `placed` order-state closure (createMockRobinhoodServer's Map lives outside
    // the transport), which is exactly what makes this a "same broker, new connection" restart.
    await server.close();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = await connectRobinhoodMcp({ transport: clientTransport });
    closers.push(async () => {
      await client.close();
    });
    return new BrokerGateway({
      mcp: client,
      reporter,
      approvalPublicKey: ed25519PublicKeyFromRaw(rawPublicKey),
      now: () => NOW_NS,
      requestTimeoutMs: 200,
      journalPath,
    });
  }

  it("happy path: a validly approved order is placed and the fill is reported back", async () => {
    const fields = baseFields(1);
    const gateway = await makeGateway({ "1": "filled" });

    const result = await gateway.submitOrder(orderFrom(fields), approve(fields), "equity");

    expect(result.status).toBe("filled");
    expect(reporter.calls).toHaveLength(1);
    expect(reporter.calls[0]!.execution).toMatchObject({ client_order_id: 1, event: "filled" });
  });

  it("refuses a tampered approval (order changed after approval) before any network call", async () => {
    const fields = baseFields(2);
    const gateway = await makeGateway({ "2": "filled" });
    const tamperedOrder = orderFrom({ ...fields, qty: "999" }); // different qty than what was approved

    await expect(gateway.submitOrder(tamperedOrder, approve(fields), "equity")).rejects.toThrow(GatewayRejection);
    expect(reporter.calls).toHaveLength(0); // no report_execution either: nothing was ever sent
  });

  it("refuses an approval whose payload bytes were edited (signature no longer verifies)", async () => {
    const fields = baseFields(3);
    const gateway = await makeGateway({ "3": "filled" });
    const approval = approve(fields);
    const edited: Approval = { ...approval, payload: canonicalPayload({ ...fields, qty: "999" }) };

    await expect(gateway.submitOrder(orderFrom(fields), edited, "equity")).rejects.toThrow(/signature/);
  });

  it("refuses a missing approval", async () => {
    const fields = baseFields(4);
    const gateway = await makeGateway({});
    await expect(gateway.submitOrder(orderFrom(fields), undefined, "equity")).rejects.toThrow(/missing approval/);
  });

  it("refuses an expired approval", async () => {
    const fields = baseFields(5);
    const expired = { ...fields, expires_ts_ns: NOW_NS - 1 };
    const gateway = await makeGateway({ "5": "filled" });

    await expect(gateway.submitOrder(orderFrom(expired), approve(expired), "equity")).rejects.toThrow(/expired/);
  });

  it("never resends a duplicate client_order_id once it has a terminal outcome", async () => {
    const fields = baseFields(6);
    const gateway = await makeGateway({ "6": "filled" });

    const first = await gateway.submitOrder(orderFrom(fields), approve(fields), "equity");
    const second = await gateway.submitOrder(orderFrom(fields), approve(fields), "equity");

    expect(second).toEqual(first);
    expect(reporter.calls).toHaveLength(1); // reported once, not twice
  });

  it("on an ambiguous outcome (timeout), queries status before ever trying again -- no double order", async () => {
    const fields = baseFields(7);
    const gateway = await makeGateway({ "7": "timeout" });

    await expect(gateway.submitOrder(orderFrom(fields), approve(fields), "equity")).rejects.toThrow(/outcome unknown/);
    expect(reporter.calls).toHaveLength(0); // nothing reported yet -- outcome is still unresolved

    // Reconciling call: the mock records the order as if the broker really did receive it, so
    // this must resolve via a status query, never a second place_equity_order call.
    const resolved = await gateway.submitOrder(orderFrom(fields), approve(fields), "equity");
    expect(resolved.status).toBe("filled");
    expect(reporter.calls).toHaveLength(1);
    expect(reporter.calls[0]!.execution.event).toBe("filled");
  });

  it("crash-after-send: a brand new BrokerGateway (simulated process restart) reconciles via the journal instead of blind-resubmitting", async () => {
    const fields = baseFields(11);
    const journalPath = tempJournalPath();
    let placeCalls = 0;
    const onToolCall = (name: string) => {
      if (name === "place_equity_order") placeCalls += 1;
    };

    const [clientTransportA, serverTransportA] = InMemoryTransport.createLinkedPair();
    const server = createMockRobinhoodServer({ scenarios: { "11": "timeout" }, onToolCall });
    await server.connect(serverTransportA);
    const clientA = await connectRobinhoodMcp({ transport: clientTransportA });
    closers.push(async () => {
      await clientA.close();
      await server.close();
    });
    const gatewayA = new BrokerGateway({
      mcp: clientA,
      reporter,
      approvalPublicKey: ed25519PublicKeyFromRaw(rawPublicKey),
      now: () => NOW_NS,
      requestTimeoutMs: 200,
      journalPath,
    });

    // gatewayA sends the order; the mock server truly receives it (it records it as "placed"),
    // but the response is lost (timeout) -- exactly the "outcome unknown after a real send"
    // case. This process's own in-memory map now says "unknown" for client_order_id 11 -- but
    // the point of this test is that the NEXT process must know that too, from disk alone.
    await expect(gatewayA.submitOrder(orderFrom(fields), approve(fields), "equity")).rejects.toThrow(/outcome unknown/);
    expect(placeCalls).toBe(1);
    expect(reporter.calls).toHaveLength(0);

    // Simulated restart: a brand new BrokerGateway, sharing nothing with gatewayA except the
    // journal file on disk and a connection to the same broker. Its in-memory map starts empty;
    // if the journal fix were missing, submitOrder would fall through to attemptSubmit and call
    // place_equity_order a second time for the same client_order_id -- a real duplicate order.
    const gatewayB = await reconnectGateway(server, journalPath);

    const resolved = await gatewayB.submitOrder(orderFrom(fields), approve(fields), "equity");

    expect(resolved.status).toBe("filled"); // reconciled via a status query, not a fresh place
    expect(placeCalls).toBe(1); // still 1: place_equity_order was NEVER called a second time
    expect(reporter.calls).toHaveLength(1);
    expect(reporter.calls[0]!.execution.event).toBe("filled");
  });

  it("reports an explicit broker rejection back to the bridge as rejected", async () => {
    const fields = baseFields(8);
    const gateway = await makeGateway({ "8": "rejected" });

    const result = await gateway.submitOrder(orderFrom(fields), approve(fields), "equity");

    expect(result.status).toBe("rejected");
    expect(reporter.calls).toHaveLength(1);
    expect(reporter.calls[0]!.execution).toMatchObject({ client_order_id: 8, event: "rejected" });
    expect(reporter.calls[0]!.execution.reason).toMatch(/SYNTHETIC/);
  });

  it("cancels a live order and reports the cancellation", async () => {
    const fields = baseFields(9);
    const gateway = await makeGateway({ "9": "accepted" });
    await gateway.submitOrder(orderFrom(fields), approve(fields), "equity");

    const result = await gateway.cancelOrder(9, fields.instrument, "equity", approveCancel(cancelFields(9)));

    expect(result.status).toBe("canceled");
    expect(reporter.calls[reporter.calls.length - 1]!.execution.event).toBe("canceled");
  });

  it("refuses to cancel an order it never placed, without calling the broker", async () => {
    const gateway = await makeGateway({});
    await expect(
      gateway.cancelOrder(12345, "SPY", "equity", approveCancel(cancelFields(12345))),
    ).rejects.toThrow(GatewayRejection);
  });

  it("refuses a cancel with a missing approval", async () => {
    const fields = baseFields(13);
    const gateway = await makeGateway({ "13": "accepted" });
    await gateway.submitOrder(orderFrom(fields), approve(fields), "equity");

    await expect(gateway.cancelOrder(13, fields.instrument, "equity", undefined)).rejects.toThrow(/missing approval/);
  });

  it("refuses a cancel approval for a different client_order_id than the one being cancelled", async () => {
    const fields = baseFields(14);
    const gateway = await makeGateway({ "14": "accepted" });
    await gateway.submitOrder(orderFrom(fields), approve(fields), "equity");

    await expect(
      gateway.cancelOrder(14, fields.instrument, "equity", approveCancel(cancelFields(999))),
    ).rejects.toThrow(/does not match/);
  });

  it("refuses an expired cancel approval", async () => {
    const fields = baseFields(15);
    const gateway = await makeGateway({ "15": "accepted" });
    await gateway.submitOrder(orderFrom(fields), approve(fields), "equity");
    const expired: CancelApprovalPayload = { ...cancelFields(15), expires_ts_ns: NOW_NS - 1 };

    await expect(
      gateway.cancelOrder(15, fields.instrument, "equity", approveCancel(expired)),
    ).rejects.toThrow(/expired/);
  });

  it("still returns the order's own outcome even if reporting the execution back fails", async () => {
    const fields = baseFields(10);
    const gateway = await makeGateway({ "10": "filled" });
    reporter.ok = false;

    const result = await gateway.submitOrder(orderFrom(fields), approve(fields), "equity");

    expect(result.status).toBe("filled"); // the trade happened; a books-sync failure doesn't hide that
    expect(reporter.calls).toHaveLength(1);
  });
});
