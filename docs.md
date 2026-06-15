# PalmOS Documentation

> **Governance for agentic wallets.** PalmOS lets an autonomous AI agent move real money on-chain —
> but only within policy, with human-in-the-loop approval for larger moves, vault custody the agent
> can't drain, and an on-chain audit trail of every decision.

---

## 1. Overview

### The problem
Giving an AI agent a wallet is easy. *Trusting what it does with the money* — and proving it
afterward — is the hard part. An autonomous agent with real funds is one bad decision away from
draining them, and today there's no neutral record of what it did.

### What PalmOS does
PalmOS is the **brakes and the black box** for agentic finance:
- **Policy guardrails** the agent can't override (allowed assets, per-transaction limits, approval
  thresholds, vetted pools).
- **Custody the agent never holds** — keys live in an OWS vault; the agent can only *ask* PalmOS to
  act, and PalmOS signs.
- **An on-chain audit trail** — every governed decision and its outcome (including *denied* ones) is
  recorded on-chain.

### The one-liner
> Byreal gives an AI agent hands to trade on Solana; PalmOS gives it guardrails; and Mantle keeps the
> receipts.

---

## 2. Architecture — one OWS vault, two chains

```
  AI agent (e.g. a live Claude session)
        │  tools over HTTP / MCP
        ▼
  PalmOS SDK  →  Policy gate  →  build (Byreal)  →  OWS vault signs  →  settle (Solana)
                     │                                                        │
                     └──────────── every decision + outcome ─────────────────┴──► record (Mantle)
```

- **Solana** = execution. Byreal (a CLMM DEX) builds the transaction; PalmOS signs and broadcasts it.
- **Mantle** = identity + audit. The agent's **ERC-8004 identity** and a **decision/outcome log**
  live here.
- **One OWS vault** signs *both* chains — the same key that signs a Byreal swap on Solana also owns
  the agent's Mantle identity and signs every decision record. The identity, the action, and the
  audit record are cryptographically the same actor.

The agent holds **no keys** on either chain. It proposes; PalmOS governs and signs.

---

## 3. Core concepts

| Concept | What it is |
|---|---|
| **Agent** | An external AI runtime (Claude Code, a worker, etc.) with a treasury mandate and a PalmOS credential. It never holds keys. |
| **Governed action kind** | The verbs PalmOS governs: `service.pay`, `asset.transfer`, `asset.swap`, `asset.liquidity`. |
| **Policy** | Per-agent limits the action is evaluated against before anything can settle. |
| **OWS vault** | Server-side custody (Open Wallet Standard). Derives a Solana *and* an EVM address from one seed; signs on request. |
| **Action request** | The lifecycle record for one governed action: `created → policy_checked → (approved \| approval_pending \| blocked) → executed \| failed`. |
| **Decision log** | An on-chain (Mantle) `AgentActionLog` event per governed decision — including denials. |

---

## 4. The governance flow

Every governed action runs the same spine:

1. **Request** — the agent calls a tool (e.g. `request_asset_swap`).
2. **Policy gate** — PalmOS evaluates it:
   - within the auto-approve threshold → **auto-approved**, settles autonomously;
   - larger but allowed → **approval-pending**, routed to a human operator;
   - over a limit / off-policy → **denied**, no funds move.
3. **Build** — for a swap/LP, Byreal builds the unsigned transaction (`--unsigned-tx`); Byreal never
   sees a key.
4. **Sign** — the OWS vault adds the owner signature inside custody.
5. **Settle** — broadcast to Solana mainnet; reconcile the on-chain signature.
6. **Record** — the verdict + outcome (and the Solana settlement signature) are written to the
   Mantle decision log.

A **denied** decision is a first-class artifact: "the agent was stopped, and you can prove it
on-chain."

---

## 5. Byreal integration (Solana execution)

PalmOS wires Byreal Agent Skills in as governed action kinds.

**Capabilities**
- **Spot swaps** (AMM) — `asset.swap`.
- **CLMM liquidity** — open / increase / decrease / close positions — `asset.liquidity`.
- **Read-only** quotes, pools, tokens, position listing (keyless).

**Custody path.** Every write uses `byreal-cli ... --unsigned-tx --wallet-address <vault pubkey>`,
which returns a base64 Solana `VersionedTransaction`. The OWS vault signs it as owner (preserving
Byreal's pre-applied position-NFT co-signature on `positions open`) and broadcasts it.

**Agent tools**
| Tool | Purpose |
|---|---|
| `get_byreal_quote` | Quote a swap (read-only). |
| `request_asset_swap` | Governed AMM swap. |
| `request_liquidity_action` | Governed LP open/increase/decrease/close. |
| `list_byreal_positions` | List the agent's CLMM positions. |

> For an LP `open` with auto-swap (zap), supply `amount` + `base` (a pool **mint**) — not `amountUsd`.

---

## 6. Mantle layer (identity + audit)

**ERC-8004 identity.** `IdentityRegistry` mints each agent a soulbound identity NFT whose `tokenURI`
is its **agent card** — its functionalities, service endpoints, and Solana payment address — stored
fully on-chain.

**Decision/outcome log.** `AgentActionLog` emits one indexable `DecisionRecorded` event per governed
action: kind, policy **verdict**, **outcome**, the Solana settlement signature (the cross-chain
link), and amount. Denied/blocked actions are recorded too.

**Same-vault signing.** Built on `viem`; the OWS vault's EVM account (secp256k1, same seed as the
Solana key) deploys, mints, and signs every record. No separate key, no separate identity.

---

## 7. Policy reference

A per-agent policy (`policyConfig`) governs every action:

| Field | Meaning |
|---|---|
| `allowedAssets` | Asset symbols the agent may touch (e.g. `["SOL","USDC"]`). |
| `allowedChains` | Settlement chains (e.g. `["solana-mainnet"]`). |
| `maxPerTransaction` | Hard cap per action; above it → denied. |
| `autoApproveUnder` | Below this, settles autonomously; above it (but under the cap) → approval-pending. |
| `allowedPools` | **Byreal risk control** — a CLMM pool allowlist. A liquidity deposit into any other pool is denied (`policy.liquidity_pool_not_allowed`). |
| `maxSlippageBps` | **Byreal risk control** — caps the slippage a swap/LP route may carry. |
| `trustTier` | `new \| healthy \| trusted \| restricted` — scales the effective limit. A policy **denial flips an agent to `restricted`** until an operator clears it. |

---

## 8. Connecting an agent

PalmOS is agent-agnostic — the brain stays *outside* PalmOS (Claude Code, a custom worker, Claude on
Bedrock). Two ways to reach the governed tools:

**A. HTTP SDK.** Mint a credential, then call:
- `GET  /api/sdk/v1/tools` — list the governed tools + schemas.
- `POST /api/sdk/v1/tools/:toolName` — invoke one (bearer-authenticated).

**B. MCP (for Claude Code / MCP clients).** A local MCP server bridges the SDK to MCP: it reads the
tool catalog and proxies each call. Configure it in `.mcp.json` and run `npm run mcp:byreal`. A live
Claude Code session can then drive the governed Byreal tools directly — and PalmOS governs every call.

---

## 9. Running PalmOS

**Entry point:** `npm start` → `node --import tsx src/server/dashboardApi.ts` (Node 22+).

**Key environment flags**
| Var | Effect |
|---|---|
| `AGENT_SPEND_OS_BASE_DIR` | Workspace + vault path. **Set this to a persistent path** — it defaults to `/tmp/palmos-live`, which the OS can wipe. |
| `BYREAL_SETTLE_LIVE` | `1` = broadcast real Solana settlement. Default off → sign-only (nothing spends). |
| `MANTLE_RECORD_LIVE` | `1` = write decisions to Mantle (costs test MNT gas). Default off → simulate. |
| `START_LOCAL_PUSD_SERVER` | `0` in production (the local demo PUSD server starts by default otherwise). |
| `PALMOS_DISABLE_DASHBOARD_AUTH` / `PALMOS_PUBLIC_ACCESS_MODE` | Operator-auth posture for a public server. |

The two `*_LIVE` flags are **server-side** — an agent cannot flip them, so a tool call can never
accidentally spend.

---

## 10. Custody & security

- **The agent never holds keys.** Keys live in the OWS vault; the agent can only request actions.
  This is the core safety property — the agent *can't* drain a wallet it has no keys to.
- **Server-side custody.** The OWS vault is the trust anchor. For production it must live on a
  persistent, encrypted, backed-up path (never `/tmp`), and operators should expose a recovery/export
  path for the wallet's seed so funds are never stranded if the host is lost.
- **Gated settlement.** Live Solana settlement and live Mantle writes are off by default and only
  enabled by the operator.

---

## 11. Verifiability

Every "it works" claim carries a clickable on-chain proof:
- **Solana** settlements on Solscan.
- **Mantle** identity + decision records on Mantlescan; both contracts have **verified source**.
- The same OWS vault is provably the actor on both chains.

See [`SUBMISSION.md`](./SUBMISSION.md) for the live proof appendix (addresses, txns, the denied
record).
