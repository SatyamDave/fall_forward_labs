// JSON Lines client for qc-bridge (ADR-0040 protocol v1): spawns the bridge process, writes
// one BridgeRequest per line to its stdin, matches responses back to requests by `id` (not by
// arrival order), and validates every response against schemas/decision/v1 before trusting it.
import { randomUUID } from "node:crypto";
import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Writable } from "node:stream";
import { validateOrThrow } from "./schema.js";
import type { BridgeRequest, BridgeResponse, OrderIntent } from "./types.js";

export interface BridgeClientOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Per-request timeout; a request that gets no matching response by then rejects. */
  timeoutMs?: number;
}

interface Pending {
  resolve: (response: BridgeResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export class BridgeClient {
  private child: ChildProcess | undefined;
  private stdin: Writable | undefined;
  private readonly pending = new Map<string, Pending>();
  private readonly timeoutMs: number;
  private closed = false;

  constructor(private readonly opts: BridgeClientOptions) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  start(): void {
    if (this.child) throw new Error("BridgeClient.start() already called");
    const child = spawn(this.opts.command, this.opts.args ?? [], {
      cwd: this.opts.cwd,
      env: this.opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (!child.stdout || !child.stdin || !child.stderr) {
      throw new Error("spawned bridge process is missing a stdio pipe");
    }
    this.child = child;
    this.stdin = child.stdin;
    createInterface({ input: child.stdout }).on("line", (line) => this.onLine(line));
    child.stderr.pipe(process.stderr);
    child.on("exit", (code, signal) => {
      this.failEverything(new Error(`bridge process exited (code=${code}, signal=${signal})`));
    });
    child.on("error", (err) => this.failEverything(err));
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // No id to key off: the channel state is now ambiguous, so fail every outstanding
      // call rather than silently drop the line (fail closed, not fail silent).
      this.failEverything(new Error(`bridge sent a non-JSON line: ${trimmed.slice(0, 200)}`));
      return;
    }

    const maybeId = (parsed as { id?: unknown } | null)?.id;
    const id = typeof maybeId === "string" ? maybeId : undefined;

    try {
      validateOrThrow("bridge_response", parsed);
    } catch (err) {
      if (id && this.pending.has(id)) {
        this.reject(id, err as Error);
      } else {
        this.failEverything(err as Error);
      }
      return;
    }

    const response = parsed as BridgeResponse;
    if (!this.pending.has(response.id)) return; // already timed out, or unsolicited; ignore
    this.resolveOne(response.id, response);
  }

  private failEverything(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const id of [...this.pending.keys()]) this.reject(id, err);
  }

  private resolveOne(id: string, response: BridgeResponse): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(response);
  }

  private reject(id: string, err: Error): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.reject(err);
  }

  private send(req: BridgeRequest): Promise<BridgeResponse> {
    // Never throw synchronously from a Promise-returning method: reject instead, so every
    // caller can uniformly await/.catch() without also needing a try/catch.
    return new Promise<BridgeResponse>((resolve, reject) => {
      if (!this.stdin) {
        reject(new Error("BridgeClient.start() was not called"));
        return;
      }
      const stdin = this.stdin;
      validateOrThrow("bridge_request", req);
      const timer = setTimeout(() => {
        this.pending.delete(req.id);
        reject(new Error(`bridge request ${req.op} (id=${req.id}) timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(req.id, { resolve, reject, timer });
      stdin.write(`${JSON.stringify(req)}\n`);
    });
  }

  nextDecisionRequest(): Promise<BridgeResponse> {
    return this.send({ v: 1, id: randomUUID(), op: "next_decision_request" });
  }

  submitOrderIntent(intent: OrderIntent): Promise<BridgeResponse> {
    return this.send({ v: 1, id: randomUUID(), op: "submit_order_intent", intent });
  }

  noTrade(requestId: string, reason: string): Promise<BridgeResponse> {
    return this.send({ v: 1, id: randomUUID(), op: "no_trade", request_id: requestId, reason });
  }

  status(): Promise<BridgeResponse> {
    return this.send({ v: 1, id: randomUUID(), op: "status" });
  }

  async shutdown(): Promise<void> {
    if (this.child) {
      try {
        await this.send({ v: 1, id: randomUUID(), op: "shutdown" });
      } catch {
        // best effort: fall through to killing the process regardless
      }
      this.stdin?.end();
      this.child.kill();
    }
    this.failEverything(new Error("BridgeClient.shutdown() called"));
  }
}
