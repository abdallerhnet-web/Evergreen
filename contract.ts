import {
  NearBindgen,
  near,
  call,
  view,
  initialize,
  assert,
  LookupMap,
  UnorderedSet,
  NearPromise,
} from "near-sdk-js";

const YOCTO_PER_NEAR = 1_000_000_000_000_000_000_000_000n; // 1e24
const MIN_ELAPSED_NS = 3_600_000_000_000n; // 1 hour floor for burn-rate math
const DAY_NS = 86_400_000_000_000n;

function emit(event: string, data: Record<string, string>) {
  // NEP-297 style event log
  near.log(
    "EVENT_JSON:" +
      JSON.stringify({
        standard: "nearvault",
        version: "1.0.0",
        event,
        data,
      })
  );
}

@NearBindgen({})
class NearVault {
  owner_id: string = "";
  provider_id: string = "";
  units_per_near: bigint = 0n; // compute units minted per 1 NEAR deposited (admin-set)

  agents: UnorderedSet<string> = new UnorderedSet<string>("a");
  shares: LookupMap<bigint> = new LookupMap<bigint>("s");

  total_deposited: bigint = 0n; // lifetime yocto deposited
  balance_locked: bigint = 0n; // yocto still held by the vault
  total_shares: bigint = 0n;

  compute_remaining: bigint = 0n; // credits left
  compute_consumed: bigint = 0n; // credits burned so far

  created_at: bigint = 0n; // ns
  first_consume_ts: bigint = 0n; // ns, 0 = never consumed

  // ---------- init ----------

  @initialize({})
  init({
    owner_id,
    provider_id,
    units_per_near,
  }: {
    owner_id: string;
    provider_id: string;
    units_per_near: string;
  }) {
    this.owner_id = owner_id;
    this.provider_id = provider_id;
    const rate = BigInt(units_per_near);
    assert(rate > 0n, "rate must be > 0");
    this.units_per_near = rate;
    this.created_at = near.blockTimestamp();
  }

  // ---------- user actions ----------

  /** Attach NEAR. Mints shares 1:1 with yocto deposited and adds compute credits. */
  @call({ payableFunction: true })
  deposit({}: {}): { shares: string; compute_added: string } {
    const amount = near.attachedDeposit();
    assert(amount > 0n, "attach NEAR to deposit");

    const who = near.predecessorAccountId();
    const computeAdded = (amount * this.units_per_near) / YOCTO_PER_NEAR;
    assert(computeAdded > 0n, "deposit too small for current rate");

    const prev = this.shares.get(who) ?? 0n;
    this.shares.set(who, prev + amount);
    this.total_shares += amount;
    this.total_deposited += amount;
    this.balance_locked += amount;
    this.compute_remaining += computeAdded;

    emit("Deposit", {
      account: who,
      amount_yocto: amount.toString(),
      shares: amount.toString(),
      compute_added: computeAdded.toString(),
    });
    return { shares: amount.toString(), compute_added: computeAdded.toString() };
  }

  // ---------- agent action ----------

  /**
   * Authorized agent burns `amount` compute credits.
   * Payout to the compute provider is pro-rata: amount / compute_remaining of the locked NEAR.
   */
  @call({})
  consume_compute({ amount }: { amount: string }): NearPromise {
    const caller = near.predecessorAccountId();
    assert(this.agents.contains(caller), "caller is not an authorized agent");

    const units = BigInt(amount);
    assert(units > 0n, "amount must be > 0");
    assert(units <= this.compute_remaining, "not enough compute credits");

    const payout = (units * this.balance_locked) / this.compute_remaining;

    this.compute_remaining -= units;
    this.compute_consumed += units;
    this.balance_locked -= payout;
    if (this.first_consume_ts === 0n) this.first_consume_ts = near.blockTimestamp();

    emit("Consume", {
      agent: caller,
      units: units.toString(),
      payout_yocto: payout.toString(),
      provider: this.provider_id,
      compute_remaining: this.compute_remaining.toString(),
    });

    return NearPromise.new(this.provider_id).transfer(payout);
  }

  // ---------- admin ----------

  @call({})
  set_rate({ units_per_near }: { units_per_near: string }) {
    this.assertOwner();
    const rate = BigInt(units_per_near);
    assert(rate > 0n, "rate must be > 0");
    this.units_per_near = rate;
    emit("RateChanged", { units_per_near: rate.toString() });
  }

  @call({})
  add_agent({ account_id }: { account_id: string }) {
    this.assertOwner();
    this.agents.set(account_id);
    emit("AgentAdded", { account_id });
  }

  @call({})
  remove_agent({ account_id }: { account_id: string }) {
    this.assertOwner();
    this.agents.remove(account_id);
    emit("AgentRemoved", { account_id });
  }

  // ---------- views (all numbers returned as strings) ----------

  @view({})
  get_total_deposits(): string {
    return this.total_deposited.toString(); // yocto
  }

  @view({})
  get_remaining_compute(): string {
    return this.compute_remaining.toString();
  }

  @view({})
  get_locked_balance(): string {
    return this.balance_locked.toString(); // yocto
  }

  /** Remaining credits / average daily burn since first consume. "n/a" until first consume. */
  @view({})
  get_runway_days(): string {
    if (this.first_consume_ts === 0n || this.compute_consumed === 0n) return "n/a";
    let elapsed = near.blockTimestamp() - this.first_consume_ts;
    if (elapsed < MIN_ELAPSED_NS) elapsed = MIN_ELAPSED_NS;
    // burn per day = consumed * DAY / elapsed ; runway = remaining / burn_per_day
    const x100 = (this.compute_remaining * elapsed * 100n) / (this.compute_consumed * DAY_NS);
    const whole = x100 / 100n;
    const frac = (x100 % 100n).toString().padStart(2, "0");
    return `${whole}.${frac}`;
  }

  @view({})
  get_user_shares({ account_id }: { account_id: string }): string {
    return (this.shares.get(account_id) ?? 0n).toString();
  }

  /** Locked NEAR per share. Starts at 1.000000 and falls as compute is consumed. */
  @view({})
  get_share_price(): string {
    if (this.total_shares === 0n) return "1.000000";
    const x = (this.balance_locked * 1_000_000n) / this.total_shares;
    return `${x / 1_000_000n}.${(x % 1_000_000n).toString().padStart(6, "0")}`;
  }

  /** Ownership in percent with 2 decimals. */
  @view({})
  get_ownership_pct({ account_id }: { account_id: string }): string {
    if (this.total_shares === 0n) return "0.00";
    const mine = this.shares.get(account_id) ?? 0n;
    const x = (mine * 10_000n) / this.total_shares;
    return `${x / 100n}.${(x % 100n).toString().padStart(2, "0")}`;
  }

  @view({})
  get_config(): {
    owner_id: string;
    provider_id: string;
    units_per_near: string;
    agents: string[];
    total_shares: string;
    compute_consumed: string;
  } {
    return {
      owner_id: this.owner_id,
      provider_id: this.provider_id,
      units_per_near: this.units_per_near.toString(),
      agents: this.agents.toArray(),
      total_shares: this.total_shares.toString(),
      compute_consumed: this.compute_consumed.toString(),
    };
  }

  // ---------- internal ----------

  private assertOwner() {
    assert(near.predecessorAccountId() === this.owner_id, "owner only");
  }
}
