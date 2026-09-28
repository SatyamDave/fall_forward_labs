// Fixed-point decimal helpers for DecimalString fields, scale 1e8 to match qc-core's
// `Price`/`Qty` convention (docs/ARCHITECTURE.md). Money and quantity are never JS floats.

const SCALE = 100_000_000n; // 1e8
const DECIMAL_PATTERN = /^(-?)([0-9]+)(?:\.([0-9]{1,8}))?$/;

export function toFixed(value: string): bigint {
  const match = DECIMAL_PATTERN.exec(value);
  if (!match) throw new Error(`not a decimal string: ${JSON.stringify(value)}`);
  const sign = match[1] ?? "";
  const whole = match[2] ?? "0";
  const frac = match[3] ?? "";
  const paddedFrac = frac.padEnd(8, "0");
  const magnitude = BigInt(whole) * SCALE + BigInt(paddedFrac === "" ? "0" : paddedFrac);
  return sign === "-" && magnitude !== 0n ? -magnitude : magnitude;
}

export function fromFixed(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / SCALE;
  const frac = abs % SCALE;
  const fracStr = frac.toString().padStart(8, "0").replace(/0+$/, "");
  const body = fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
  return negative && abs !== 0n ? `-${body}` : body;
}

export function absFixed(value: bigint): bigint {
  return value < 0n ? -value : value;
}
