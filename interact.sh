#!/usr/bin/env bash
# Evergreen demo script (testnet). Edit the 4 variables, then run sections one by one.
# Requires near-cli-rs:  https://github.com/near/near-cli-rs
set -e

VAULT=evergreen-demo.testnet      # contract account (create it first)
OWNER=your-owner.testnet          # admin
AGENT=your-agent.testnet          # AI agent account
PROVIDER=your-provider.testnet    # compute provider (receives payouts)
DEPOSITOR=your-depositor.testnet  # anyone depositing

NET="network-config testnet sign-with-keychain send"

call() { # call <method> <json> <deposit> <signer>
  near contract call-function as-transaction $VAULT "$1" json-args "$2" \
    prepaid-gas '30 Tgas' attached-deposit "$3" sign-as "$4" $NET
}
view() { # view <method> <json>
  near contract call-function as-read-only $VAULT "$1" json-args "$2" network-config testnet now
}

# 1. Deploy + init (rate: 1000 compute units per 1 NEAR)
near contract deploy $VAULT use-file build/evergreen.wasm with-init-call init \
  json-args "{\"owner_id\":\"$OWNER\",\"provider_id\":\"$PROVIDER\",\"units_per_near\":\"1000\"}" \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' $NET

# 2. Authorize the agent
call add_agent "{\"account_id\":\"$AGENT\"}" '0 NEAR' $OWNER

# 3. Deposit 5 NEAR -> expect 5000 compute units, shares = 5e24
call deposit '{}' '5 NEAR' $DEPOSITOR
view get_remaining_compute '{}'
view get_user_shares "{\"account_id\":\"$DEPOSITOR\"}"
view get_ownership_pct "{\"account_id\":\"$DEPOSITOR\"}"

# 4. Agent consumes 1000 units -> provider receives 1 NEAR
call consume_compute '{"amount":"1000"}' '0 NEAR' $AGENT
view get_remaining_compute '{}'
view get_locked_balance '{}'
view get_share_price '{}'
view get_runway_days '{}'

# 5. Negative tests (each should FAIL)
call consume_compute '{"amount":"1"}' '0 NEAR' $DEPOSITOR   # not an agent
call consume_compute '{"amount":"999999"}' '0 NEAR' $AGENT  # more than remaining
