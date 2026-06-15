# PalmOS × Byreal — Governance for Agentic Wallets

> **Byreal gives an AI agent hands. PalmOS gives it guardrails.**
> One agent, one vault, two chains: it **acts on Solana** (Byreal DeFi), and its **identity + every
> governed decision live on Mantle** — signed by the same vault.

PalmOS is a **governance layer for agentic wallets**. An autonomous AI agent swaps and provides
liquidity on [Byreal](https://byreal.io) (Solana's CLMM DEX) — but only within policy, with
human-in-the-loop approval for larger moves, vault custody the agent **cannot drain**, and an
on-chain audit trail. Its on-chain **identity (ERC-8004)** and a tamper-proof **decision/outcome
log** live on **Mantle**, signed by the *same* vault that signs its Solana trades.

*Mantle "Turing Test" Hackathon — Byreal-sponsored "Agentic Wallets & Economy" track.*
Rubric-by-rubric write-up + full proof appendix: **[SUBMISSION.md](./SUBMISSION.md)**.

---

## The gap we close

Everyone is racing to hand AI agents wallets and let them move real money on-chain. The hard part
isn't giving an agent a wallet — it's being able to **trust what it does with it**, and to **prove**
it afterward. An autonomous agent with real funds is one bad decision away from draining them, and
today there are no brakes and no neutral record.

PalmOS is the brakes **and** the black box. Byreal proposes a transaction; **PalmOS governs it and
signs it** inside a vault the agent never holds keys to; then it **records the decision and its
outcome on Mantle** — including the ones it *blocked*. Every other entry in this track is "an agent
that trades on Byreal." Ours is the only one with **governance + a verifiable on-chain audit of the
agent's behavior**.

---

## Architecture: one OWS vault, two chains

```
  Claude Sonnet 4.6                 ┌──────────────── PalmOS governance ─────────────────┐
  (the brain — decides)            │   policy gate            OWS vault (one key set)     │
        │   tools / HTTP            │   limits · approval ·    ├─ Solana acct → Byreal txns│
        ▼                          │   auto-approve           └─ EVM acct → Mantle txns   │
  request_asset_swap ──────────────┤        │                                             │
  request_liquidity_action         │   allowed → Byreal builds unsigned tx                │
                                   │            → OWS(Solana) signs → SETTLE on Solana     │
                                   │   every decision + outcome                            │
                                   │            → OWS(EVM) signs → RECORD on Mantle        │
                                   └──────────────────────────────────────────────────────┘
     SOLANA = execution (Byreal CLMM DEX)        MANTLE = identity (ERC-8004) + decision log
```

The agent holds no keys. **The same OWS vault** that signs a Byreal swap on Solana also owns the
agent's ERC-8004 identity NFT on Mantle and signs every decision record — so the identity, the
action, and the audit trail are cryptographically the **same actor**.

---

## What you can see, live

A real AI agent — **Claude Sonnet 4.6** (the "brain") — is given a treasury mandate and
PalmOS-governed tools. It inspects its own wallet, **decides on its own** whether and how to
rebalance, and acts. PalmOS evaluates every move *before* it can settle — and records every outcome
on Mantle.

**1. Autonomous, in-policy → settles on Solana, recorded on Mantle.**

> *"The wallet is at 42.23% SOL vs. the 50% target … exactly at the auto-approve threshold, so it
> should settle autonomously. Submitting now."*

→ PalmOS auto-approved, Byreal built the AMM swap, the OWS vault signed it, it **settled on Solana**,
and the decision was **logged on Mantle**.

**2. Out-of-policy → denied instantly, and the denial is on-chain.**

> *"My job is to submit it faithfully and let PalmOS enforce policy."*

→ PalmOS **denied** it (`policy.swap_amount_exceeds_limit`). No funds moved — and the *blocked*
decision is recorded on Mantle. *The agent was stopped, and you can prove it.*

That contrast — *autonomous when safe, blocked the instant it crosses a line, every outcome on-chain*
— is the whole pitch.

---

## Live on-chain evidence

**Solana mainnet — Byreal execution.**
Governed wallet [`Crc86vh…RXv2Gz`](https://solscan.io/account/Crc86vhXFrYBwN5rwccX9sVKixcnHFHuWkPkJyRXv2Gz)

| What | Outcome | Proof |
|---|---|---|
| Agent-decided swap (LLM chose size + direction), 0.1 USDC → ~0.001409 SOL | ✅ executed | [`bwWUdd…MJLcbX`](https://solscan.io/tx/bwWUddCjbY5WwJenGTQGd7iiA7VkcqcBLhMCYhgg8e7LSxsgqSX2usxzvJRNgG15rW5FdCApd3ajjyLv2MJLcbX) |
| First governed swap (custody/flow proof), 0.05 USDC → ~0.000701 SOL | ✅ executed | [`2Ndsfi…6JzG4wR`](https://solscan.io/tx/2Ndsfiert66StuxV95WXEkTuuZuELnZLHnEiey9dJxspjqAtjvhSXPPcT7N2MQtd1bSv9jgf16UGHqnuc6JzG4wR) |
| Out-of-policy attempt, 2.5 USDC → SOL | 🛑 denied by policy | `policy.swap_amount_exceeds_limit` (never broadcast) |

**Mantle Sepolia — identity + decision log.**
OWS EVM vault [`0x7b8534…5c54Bb`](https://sepolia.mantlescan.xyz/address/0x7b85349ef33A9751f3DAfdF9006Fe242595c54Bb) (the same vault, EVM side)

| What | Proof |
|---|---|
| ERC-8004 **IdentityRegistry** (source-verified) | [`0xcdaf24…41302c`](https://sepolia.mantlescan.xyz/address/0xcdaf244b315bc8af1249e6689a2f9f6d8d41302c) |
| **AgentActionLog** decision log (source-verified) | [`0x1c1099…581922`](https://sepolia.mantlescan.xyz/address/0x1c1099805e5ca8182569c3a4110de36a6c581922) |
| Agent **identity NFT #1** — agent card on-chain (Byreal skills + Solana payment address) | [`nft/…/1`](https://sepolia.mantlescan.xyz/nft/0xcdaf244b315bc8af1249e6689a2f9f6d8d41302c/1) |
| Governed swap **DENIED**, recorded on-chain | [tx `0xc689e1…c6863d`](https://sepolia.mantlescan.xyz/tx/0xc689e1bc1b14c4c4d852f7009594ac90ac4e5a9cc025f7ad1cd12e885ac6863d) |
| Governed swap **executed**, recorded on-chain | [tx `0x246f45…7dbc12`](https://sepolia.mantlescan.xyz/tx/0x246f4552dad71b3a2466942fa5d48f4bc4a5d864372515a0db7c7c1c087dbc12) |

Both Solana swaps route through Byreal's AMM; the OWS vault adds the owner signature to Byreal's
unsigned transaction (including its address-lookup-tables) and broadcasts via Helius. The same
vault's **EVM key** — proven to sign Mantle transactions in `scripts/spike-e-ows-evm-sign.ts` — owns
the identity NFT and signs each decision record. The agent never sees a private key on either chain.

---

## How it works

```
 Claude Sonnet 4.6 (the brain — decides whether & how much to trade)
   │  tools over HTTP: get_wallet_context · get_byreal_quote · request_asset_swap · request_liquidity_action
   ▼
 PalmOS SDK (/api/sdk/v1/*)
   ▼
 Policy gate (allowed assets · per-tx limit · auto-approve threshold · trust tier)
   │  allowed ───────┐      needs-approval ──┐      over limit / off-policy ──┐
   ▼                 ▼                        ▼                               ▼
 Byreal builds   settles autonomously   operator approval queue          DENIED (no funds move)
 unsigned tx         │                   (human-in-the-loop)                  │
   │          OWS(Solana) signs → broadcast → reconcile                      │
   ▼                 ▼                                                        ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ every governed decision + outcome (executed | pending | DENIED | failed)       │
 │   → OWS(EVM) signs → AgentActionLog.recordDecision() on Mantle                  │
 └──────────────────────────────────────────────────────────────────────────────┘
   ▼
 Dashboard: governed action + Solscan link + "Recorded on Mantle" (Mantlescan) + full audit trail
```

The agent only decides. The hands (Byreal), the guardrails + custody (PalmOS/OWS), and the audit
(Mantle) are separate — so the agent can be autonomous without being trusted with keys, limits, or
the record of its own behavior. The autonomy loop lives in
[`scripts/agent-autonomy.ts`](./scripts/agent-autonomy.ts): a tool-use loop where Claude is given a
mandate ("keep ≈50% of the treasury in SOL") and the governed tools, and chooses its own actions.

---

## The Byreal integration (Part B)

Byreal Agent Skills via [`@byreal-io/byreal-cli`](https://github.com/byreal-git/byreal-agent-skills),
wired into PalmOS as new **governed action kinds** — `asset.swap` and `asset.liquidity` — flowing
through the existing policy → approval → OWS-sign → reconcile → audit spine:

- **AMM spot swaps** (`swap execute`) and **CLMM liquidity** (open / increase / decrease / close).
- Every write uses `--unsigned-tx --wallet-address <vault pubkey> -o json` — the "Byreal proposes,
  you sign" custody path. Byreal builds a base64 Solana `VersionedTransaction` and never touches a
  key; the OWS vault signs it as owner (preserving Byreal's pre-applied position-NFT co-signature on
  `positions open`) and broadcasts.
- New agent/SDK tools — `get_byreal_quote`, `request_asset_swap`, `request_liquidity_action`,
  `list_byreal_positions` — expose this to any agent runtime over HTTP.

Code: `src/integrations/byreal/`, `src/app/requestAssetSwap.ts`, `src/app/requestLiquidityAction.ts`,
`src/server/dashboard/`. The four formal submission answers are in [SUBMISSION.md](./SUBMISSION.md).

---

## The Mantle layer (Part A)

PalmOS records the agent's **identity** and its **governed behavior** on Mantle — the chain's
"on-chain benchmarking of AI", made real:

- **ERC-8004 identity** — `IdentityRegistry` mints the agent a soulbound identity NFT whose tokenURI
  is its **agent card** (name, its Byreal functionalities, the `@getpalmos` MCP/agent endpoints, and
  its Solana payment address) — stored fully on-chain.
- **Decision/outcome log** — `AgentActionLog` emits one cheap, indexable `DecisionRecorded` event
  per governed action: kind, policy **verdict**, **outcome**, the Solana settlement signature
  (cross-chain link), and amount. **Denied/blocked actions are recorded too** — the money-shot.
- **Same-vault signing** — built on `viem`; the OWS vault's EVM account (secp256k1, same vault as the
  Solana key) deploys, mints, and signs every record. No separate key, no separate identity.

Contracts in [`contracts/`](./contracts) (deployed + source-verified on Mantle Sepolia); integration
in `src/integrations/mantle/`; both orchestrators gain an optional `mantleRecorder` that writes after
each decision (best-effort — a Mantle hiccup can never break a Solana settlement — and gated by
`MANTLE_RECORD_LIVE`, default off). The operator dashboard surfaces the **ERC-8004 identity card**
and a **"Recorded on Mantle"** link on every governed action.

---

## Run it yourself

Prerequisites: Node 22+, npm, and `byreal-cli` on PATH (`npm i -g @byreal-io/byreal-cli`).

```bash
npm install && (cd frontend && npm install)
cp .env.example .env      # fill in: AWS_BEARER_TOKEN_BEDROCK, AWS_REGION, PALMOS_AGENT_TOKEN,
                          # PALMOS_API_URL=http://localhost:4030, HELIUS_API_KEY
```

```bash
# governed backend + dashboard (sign-only by default)
npm run dashboard:api                  # SDK + dashboard API on :4030
cd frontend && npm run dev             # dashboard on :5173

# the autonomous agent (sign-only — nothing broadcasts)
node --import tsx scripts/agent-autonomy.ts --scenario rebalance   # in-policy → settles (signed)
node --import tsx scripts/agent-autonomy.ts --scenario overlimit   # out-of-policy → DENIED
```

**Live Solana settlement** is gated server-side by `BYREAL_SETTLE_LIVE=1` on the API (default off, so
a tool call can never accidentally spend). **Mantle layer** (testnet, gas-gated):

```bash
node --import tsx scripts/mantle-deploy.ts            # deploy IdentityRegistry + AgentActionLog
node --import tsx scripts/mantle-mint-identity.ts     # mint the agent's ERC-8004 identity (idempotent)
ETHERSCAN_API_KEY=<key> node --import tsx scripts/mantle-verify.ts       # verify source on Mantlescan
MANTLE_RECORD_LIVE=1 node --import tsx scripts/mantle-verify-record.ts   # record real decisions on-chain
```

Mantle writes are gated by `MANTLE_RECORD_LIVE` (default off → simulate, no gas).

---

## Repo guide (branch: `byreal-integration`)

- `scripts/agent-autonomy.ts` — the autonomous agent loop (Claude on Bedrock + governed tools).
- `src/integrations/byreal/client.ts` — `ByrealClient` wrapping `byreal-cli` (quote / build-unsigned / positions).
- `src/integrations/ows/client.ts` — the OWS vault: `signAndBroadcastSolanaTx` (Solana) + `signEvmHash` (Mantle).
- `src/integrations/mantle/` — Mantle layer: viem account bridge, recorder, agent card, deployment store.
- `contracts/` — ERC-8004 `IdentityRegistry` + `AgentActionLog` (Solidity, deployed + verified).
- `src/app/requestAssetSwap.ts`, `src/app/requestLiquidityAction.ts` — governed `asset.swap` / `asset.liquidity` (+ `mantleRecorder`).
- `src/policies/compileAgentPolicy.ts` — `evaluateSwapRequest` / `evaluateLiquidityRequest` policy gates.
- `scripts/mantle-*.ts` — deploy / mint / verify / record on Mantle.
- [`byrealintegration.md`](./byrealintegration.md) — the full integration plan (§9 = Mantle layer).

PalmOS owns policy, custody, approvals, settlement, and audit; the agent brain always stays outside
it. The agent reaches PalmOS via the published [`@getpalmos/agent`](https://www.npmjs.com/package/@getpalmos/agent)
SDK. More at [getpalmos.xyz](https://www.getpalmos.xyz).

---

## Status

Live and proven end-to-end on **both chains**: governed Byreal swaps settle on Solana mainnet
(including a real agent-decided swap), out-of-policy attempts are denied, and the agent's ERC-8004
identity + decision log (including denied records) are deployed and **source-verified** on Mantle
Sepolia. Backend `tsc` + tests green; dashboard surfaces both. Storage in the demo is file-backed
(ephemeral); PalmOS also supports Postgres.
