# NearVault

**An endowment layer for AI compute on NEAR.** Deposit once; an authorized AI agent draws down compute credits over time, so it keeps running after its creator stops paying.

Built for NEAR Hackathon 2026. Tracks: Agent Economy, Unstoppable DeFi, Autonomous Business.

## The problem
AI agents and services die when the humans who fund inference stop paying. There is no simple onchain primitive to endow future compute.

## How it works
1. Anyone calls `deposit()` with NEAR. They receive **vault shares** (1 share = 1 yoctoNEAR deposited) and the vault mints **compute credits** at an admin-set rate.
2. An **authorized agent** calls `consume_compute(amount)`. Credits are burned and a pro-rata slice of the locked NEAR is paid to the **compute provider** account.
3. Anyone can read remaining credits, runway, ownership and share price onchain.

There are **no withdrawals**. Deposits are permanent endowments. Shares are an onchain ownership/attribution record; share price (locked NEAR per share) falls as compute is consumed.

## Design decisions (read these, judges)
- **Payout is pro-rata**: `payout = amount * balance_locked / compute_remaining`. This stays consistent even if the admin changes the rate later. The rate only affects credits minted by *future* deposits.
- **Conversion rate is admin-set and trusted.** There is no oracle. This is a deliberate MVP simplification.
- **NEAR only.** USDC (NEP-141) is out of scope for the MVP.
- **Runway** = `compute_remaining / average daily burn since first consume` (burn window floored at 1 hour). Returns `"n/a"` before the first consume.
- All numeric view results are **strings** (u128-safe).

## Contract interface

| Method | Who | What |
|---|---|---|
| `init(owner_id, provider_id, units_per_near)` | deploy | Initialize |
| `deposit()` (payable) | anyone | Mint shares + credits |
| `consume_compute(amount)` | agents | Burn credits, pay provider |
| `set_rate(units_per_near)` | owner | Rate for future deposits |
| `add_agent(account_id)` / `remove_agent(account_id)` | owner | Manage agents |
| `get_total_deposits()` | view | Lifetime yocto deposited |
| `get_remaining_compute()` | view | Credits left |
| `get_locked_balance()` | view | Yocto still in vault |
| `get_runway_days()` | view | Estimated runway |
| `get_user_shares(account_id)` | view | Shares |
| `get_ownership_pct(account_id)` | view | % of total shares |
| `get_share_price()` | view | Locked NEAR per share |
| `get_config()` | view | Rate, agents, provider |

**Events** (NEP-297 style `EVENT_JSON:` logs): `Deposit`, `Consume`, `RateChanged`, `AgentAdded`, `AgentRemoved`.

## Build
```bash
npm install
npm run build        # outputs build/nearvault.wasm
```

## Test it on testnet (do X → see Y)
Install [near-cli-rs](https://github.com/near/near-cli-rs). Use `interact.sh` (edit the account variables at the top), or run these by hand. Rate used below: `1000` units per NEAR.

| Step | Action | Expected result |
|---|---|---|
| 1 | Deploy + `init` with `units_per_near="1000"` | Contract live, `get_config` shows owner, provider, rate 1000 |
| 2 | Owner calls `add_agent` for the agent account | `AgentAdded` event; agent appears in `get_config` |
| 3 | Depositor calls `deposit` attaching **5 NEAR** | `Deposit` event; `get_remaining_compute` = `5000`; `get_user_shares` = `5000000000000000000000000`; `get_ownership_pct` = `100.00` |
| 4 | Agent calls `consume_compute {"amount":"1000"}` | `Consume` event; provider balance up by **1 NEAR**; `get_remaining_compute` = `4000`; `get_locked_balance` = 4 NEAR in yocto; `get_share_price` = `0.800000` |
| 5 | Wait, then call `get_runway_days` | A decimal number of days (not `n/a`) |
| 6 | Non-agent calls `consume_compute` | **Fails**: "caller is not an authorized agent" |
| 7 | Agent calls `consume_compute {"amount":"999999"}` | **Fails**: "not enough compute credits" |
| 8 | Owner calls `set_rate "2000"`, depositor deposits 1 NEAR | Credits +2000 for that deposit only; step-4 style consume still pays pro-rata |

## Limitations (honest list)
- Compute credits are an onchain accounting unit; the provider/agent integration off-chain is out of scope for the MVP.
- Rate is trusted admin input, no oracle.
- No withdrawals by design.
- No audit. Testnet only.

## Inspiration
Corpus (Monad Metropolis Grand Champion): "software that outlives its owners." NearVault brings the compute-endowment idea to NEAR.
