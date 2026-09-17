// Weighted charge against the rate_limit bucket, expressed with the EXISTING
// check_and_increment_rate_limit(p_key, p_hour_limit, p_day_limit) RPC and no
// schema or signature change.
//
// WHY WEIGHTS. Guest spend is driven by model tier, not call count: the
// pro-tier actions (isolate-subject, restyle, edit-image) are roughly twice
// the price of a flash generation. Charging them 2 units makes an expensive
// action consume the allowance twice as fast while the model stays the same.
//
// HOW A 2-UNIT CHARGE IS EXPRESSED. The RPC counts rows per key inside a
// sliding hour and day, allows iff count < limit on both, and then inserts
// exactly ONE row. So:
//
//   1. GATE — one call with each limit reduced by (units - 1). The function
//      allows iff  count < limit - (units - 1),  i.e.  count + units <= limit:
//      exactly "is there room for `units` more". If not, nothing is inserted
//      and nothing is charged. If yes, that call has already inserted the
//      first unit.
//   2. TOP-UP — (units - 1) further calls with both limits at PG_INT_MAX.
//      count < 2^31-1 always holds, so each is guaranteed to insert one row.
//      They cannot refuse, so a gated action is never charged partially by
//      the limiter's own logic (only by an infra error, which is logged).
//
// PRUNING IS UNCHANGED. Every call, gate or top-up, runs the function's own
// DELETE of this key's rows older than a day after its insert, so the extra
// rows age out exactly like single-unit rows do.
//
// KEPT DENO-FREE on purpose: no Deno or esm.sh imports, so vitest can run it
// against a simulated and a real (PGlite) limiter from the repo's test suite.

export const PG_INT_MAX = 2147483647;

export interface RpcResult {
  data: unknown;
  error: unknown;
}

export interface RateLimitArgs {
  p_key: string;
  p_hour_limit: number;
  p_day_limit: number;
}

export type RateLimitRpc = (
  fn: "check_and_increment_rate_limit",
  args: RateLimitArgs,
) => Promise<RpcResult>;

export interface ChargeOptions {
  key: string;
  hourLimit: number;
  dayLimit: number;
  /** Units this action costs. Anything below 1 is treated as 1. */
  units: number;
}

export interface ChargeResult {
  /** true = proceed. Also true on an infra error (fail open), with `error` set. */
  allowed: boolean;
  /** The gate call's error, when it failed and we are failing open. */
  error: unknown;
  /** Rows actually inserted. Equals `units` on a clean allow. */
  charged: number;
  /** A top-up call failed after the gate allowed; the action still proceeds. */
  topUpError: unknown;
}

export async function chargeRateLimit(rpc: RateLimitRpc, opts: ChargeOptions): Promise<ChargeResult> {
  const units = Math.max(1, Math.floor(opts.units));
  const gateHour = opts.hourLimit - (units - 1);
  const gateDay = opts.dayLimit - (units - 1);

  // The action costs more than the whole allowance: it can never fit, and
  // there is no point spending an RPC to be told so.
  if (gateHour <= 0 || gateDay <= 0) {
    return { allowed: false, error: null, charged: 0, topUpError: null };
  }

  const gate = await rpc("check_and_increment_rate_limit", {
    p_key: opts.key,
    p_hour_limit: gateHour,
    p_day_limit: gateDay,
  });
  if (gate.error) {
    // Fail open, exactly as the single-unit path always has.
    return { allowed: true, error: gate.error, charged: 0, topUpError: null };
  }
  if (gate.data !== true) {
    return { allowed: false, error: null, charged: 0, topUpError: null };
  }

  let charged = 1;
  let topUpError: unknown = null;
  for (let i = 1; i < units; i++) {
    const top = await rpc("check_and_increment_rate_limit", {
      p_key: opts.key,
      p_hour_limit: PG_INT_MAX,
      p_day_limit: PG_INT_MAX,
    });
    if (top.error) {
      topUpError = top.error;
      break;
    }
    charged += 1;
  }
  return { allowed: true, error: null, charged, topUpError };
}
