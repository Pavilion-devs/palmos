# PalmOS × Byreal — Mantle Turing Test Hackathon Integration Plan

> **One-liner:** PalmOS is a governance layer for agentic wallets. Byreal gives an agent
> hands to swap and provide liquidity on Solana; PalmOS gives it guardrails — policy limits,
> human-in-the-loop approval, and an on-chain audit trail. **Byreal proposes the transaction;
> PalmOS governs and signs it.**

Status: **planning** · Branch: hackathon integration branch (keep `main` PalmOS untouched)
Last updated: 2026-06-13

---

## 0. TL;DR strategy

- **Do NOT re-platform to Mantle.** Byreal is a **Solana** CLMM DEX. PalmOS is already
  Solana-native. The hackathon eligibility explicitly allows "Mantle, **Solana, or both**."
  Adding EVM settlement would be ~2–3 weeks of refactor for near-zero scoring benefit.
- **Core scope:** integrate **Byreal Agent Skills** (`@byreal-io/byreal-cli`) as new
  *governed action kinds* in PalmOS — `asset.swap` and `asset.liquidity` — flowing through the
  existing policy → approval → OWS-sign → reconcile → audit spine. This fills PalmOS's missing
  swap/DeFi gap AND satisfies "deep integration + agent autonomy."
- **The wedge:** every other entry is "an agent that trades on Byreal." Ours is the only one
  with **governance** — policy-bounded autonomous DeFi with on-chain audit. That maps directly
  to the judging panel (Nansen → auditability, BGA → safety, VC/institutional → governance).
- **Track fit:** Byreal docs frame two tracks — Track A (DeFi Strategy) and **Track B (RealClaw
  Expansion)**. PalmOS = a real product with clear users → **Track B** ("real-world relevance,
  meaningful on-chain capabilities, clear target users, practical value"). In the broader Mantle
  announcement this is the **"Agentic Wallets & Economy (sponsored by Byreal)"** framing.
- **Stretch:** mint an **ERC-8004 agent-identity NFT on Mantle testnet** from PalmOS's existing
  agent metadata (identity only, not settlement) → unlocks "deploy on both" + aligns with the
  hackathon's flagship narrative at low cost.

---

## 1. Verified facts (from source inspection of `byreal-git/byreal-agent-skills` @ v0.3.6)

### 1.1 The clean custody path EXISTS and is universal ✅
Every write command supports **`--unsigned-tx --wallet-address <pubkey> -o json`**, which builds
the transaction server-side, requires **no local keypair**, and prints:
```json
{ "unsignedTransactions": ["<base64 VersionedTransaction>"], "extraSignerPublicKey": "<optional>" }
```
Confirmed on: `swap execute`, `positions open / increase / decrease / close / claim /
claim-rewards / claim-bonus / copy`, and the auto-swap (zap) flows.
(`src/cli/commands/swap.ts:81`, `positions.ts` throughout, `positions-zap.ts:327,502,713`,
mode logic in `src/core/confirm.ts`.)

**This is exactly the integration seam we want.** Byreal returns an unsigned base64 Solana
`VersionedTransaction`; PalmOS signs it with the OWS vault and broadcasts. The OWS key never
leaves the vault; Byreal never sees a private key.

### 1.2 The signing primitive already exists in PalmOS ✅
`src/integrations/ows/client.ts` already imports `signTransaction` and calls
`connection.sendRawTransaction(...)` for transfers (`paySolanaTransfer:336`, `paySplTransfer:410`).
We generalize this into one method: *deserialize → OWS-sign as owner → broadcast*.

### 1.3 The action-kinds are already stubbed ✅
`src/store/ActionRequestRegistry.ts:24-25` already declares `'asset.swap'` and `'asset.bridge'`
in `ActionRequestKind` (currently unimplemented). We implement `asset.swap` and add
`asset.liquidity`.

### 1.4 Network & auth reality ⚠️
- Byreal API base = `https://api2.byreal.io`, **public / no API key** (only a User-Agent header).
  Read-only (pools, tokens, prices, quotes, dry-runs) is **free and keyless**.
- Default RPC + cluster = **Solana mainnet-beta** (Helius). **There is no devnet.** Real swaps/LP
  settle on **mainnet with real funds**. RPC is overridable via `SOLANA_RPC_URL` /
  `BYREAL_API_URL` env, but pools only exist on mainnet.
- Defaults: slippage 100–200 bps, max 500 bps; priority fee 50000 µlamports;
  auto-confirm threshold $10; >$1000 needs explicit confirm; >200 bps slippage warns.

### 1.5 Execution nuances to handle ⚠️
- In `--unsigned-tx` mode the CLI **does not broadcast** — it emits the tx and exits. PalmOS
  must broadcast. For **AMM swaps and all LP position ops** the tx is a self-contained on-chain
  CLMM-program transaction → broadcast directly via Solana RPC (we already do this).
- **RFQ-routed swaps** are different: `--confirm` POSTs the signed tx back to Byreal's
  `/byreal/api/rfq/v1/swap` with `quoteId`/`orderId` (`swap.ts:254-266`). A raw broadcast won't
  settle an RFQ order. **Mitigation:** prefer AMM routing; if the quote's `routerType === 'RFQ'`,
  either fall back to AMM or replicate the executeSwapRfq POST after OWS signs. (See Risk R1.)
- **`positions open`** mints a position-NFT needing an ephemeral extra signer. The CLI
  pre-signs with that ephemeral keypair and returns the tx partially-signed plus
  `extraSignerPublicKey` (`positions-zap.ts:332`). OWS only needs to add the owner signature —
  handled cleanly, just preserve the partial signature when we sign+broadcast.

### 1.6 Capability discovery for agent tooling ✅
`byreal-cli skill`, `byreal-cli catalog list`, `byreal-cli catalog show <id>` emit structured
JSON describing every capability + params — ideal for auto-generating PalmOS agent/MCP tools and
for the "agent autonomy" story. There is also an underlying SDK dependency
`@byreal-io/byreal-clmm-sdk` (fallback if we ever want to skip the CLI).

### 1.7 Install
`npm i -g @byreal-io/byreal-cli` (bin: `byreal-cli`) or, as an OpenClaw skill,
`npx skills add byreal-git/byreal-agent-skills`. Read-only needs no wallet; write needs wallet —
but we bypass wallet setup entirely by using `--unsigned-tx --wallet-address`.

---

## 2. Target architecture (reuses the entire existing PalmOS spine)

```
Agent  ──(MCP tool: request_asset_swap / request_liquidity_action)──▶  PalmOS
   │
   ▼
ActionRequest created  (kind: asset.swap | asset.liquidity)            [stub exists]
   │
   ▼
Policy engine evaluates  (budget, allowed tokens/pools, max size, slippage cap, recipient=self)
   │   approved ─┐                 needs-approval ─┐
   │             ▼                                 ▼
   │     ByrealPlanner: byreal-cli <op> --unsigned-tx --wallet-address <OWS pubkey> -o json
   │             │
   │             ▼   { unsignedTransactions: [base64], extraSignerPublicKey? }
   │     OWS vault signs (owner)  →  broadcast to Solana RPC   (or POST-back for RFQ)
   │             │
   ▼             ▼
Reconciliation verifies signature on-chain   [existing reconcileSettlements path]
   │
   ▼
Dashboard: governed swap/LP action + Byreal positions, full audit trail
```

**Byreal is a new *action planner / settlement source*, not a new chain.** No changes to the
policy engine core, the OWS custody model, reconciliation, or the dashboard framework — only
additive surfaces.

---

## 3. CORE scope (must-have for submission)

| # | Work item | Where | Notes |
|---|-----------|-------|-------|
| C1 | `ByrealClient` wrapping the CLI (`--unsigned-tx` / `-o json` / `catalog`) | new `src/integrations/byreal/client.ts` | quote, build-unsigned, list pools/tokens; thin subprocess wrapper |
| C2 | Generalize OWS signer to "sign + broadcast arbitrary `VersionedTransaction`" | `src/integrations/ows/client.ts` | extract from `paySolanaTransfer`; preserve pre-applied partial sigs |
| C3 | Implement `asset.swap` action kind end-to-end | `src/app/` (mirror `requestAssetTransfer.ts`), `ActionRequestRegistry.ts` | new `requestAssetSwap.ts` |
| C4 | Add + implement `asset.liquidity` action kind (open/increase/decrease/close) | `ActionRequestRegistry.ts:21`, `src/app/` | extends the stubbed enum |
| C5 | Policy extensions: slippage cap, allowed tokens/pools, max swap notional | `src/policies/compileAgentPolicy.ts` | chain-agnostic already |
| C6 | New agent/MCP tools | `src/server/dashboard/sdkTools.ts` (+ `@getpalmos/mcp`) | `request_asset_swap`, `request_liquidity_action`, read-only `get_byreal_quote`, `list_byreal_pools` |
| C7 | Dashboard surfaces: swap/LP action requests + Byreal positions | `frontend/src/components/redesign/*`, portfolio reader | show governed DeFi + audit |
| C8 | Reconciliation for AMM/LP txns (verify sig like existing) | `src/app/reconcileSettlements.ts` | RFQ path flagged in R1 |

**Definition of done (core):** an agent calls `request_asset_swap`, PalmOS evaluates policy,
(auto-approves or routes to human), Byreal builds the tx, OWS signs + broadcasts, the swap
settles on Solana mainnet, and the dashboard shows the governed action with the on-chain
signature. Same loop for an LP `positions open`.

---

## 4. STRETCH scope (high-signal, do after core is demoable)

- **S1 — ERC-8004 agent identity on Mantle testnet.** Mint an ERC-721 identity NFT per PalmOS
  agent whose agent-card JSON is generated from existing agent metadata (name, functionalities =
  its tools/skills, MCP endpoint = `@getpalmos/mcp`, payment address = OWS wallet). Use `viem`
  (already a dep). **Identity only — not settlement.** Unlocks "deploy on both" + the flagship
  narrative. New `src/integrations/mantle/agentIdentity.ts`.
- **S2 — Byreal Perps Agent Skills.** A second eligible integration (perp futures) if we want
  more "depth of integration" surface. Lower priority than spot swap/LP.
- **S3 — Autonomous strategy demo.** A policy-bounded auto-rebalance / auto-LP loop that shows
  the agent acting independently within guardrails — strongest "agent autonomy" evidence.
- **S4 — `copyfarmer` / copy-position** as a governed action (Byreal has `positions copy`).

---

## 5. Risks & open decisions

| ID | Risk / decision | Recommendation |
|----|------------------|----------------|
| R1 | RFQ-routed swaps can't be raw-broadcast (need POST-back with quoteId/orderId) | Prefer AMM routing; detect `routerType==='RFQ'` and either fall back or replicate the `executeSwapRfq` POST after OWS signs. Start AMM-only for the demo. |
| R2 | **Mainnet-only** — real funds, no devnet pools | Demo plan: run the full governed flow (policy + OWS signature + audit) end-to-end, and do at least one **real mainnet swap with small USDC** ($5–20) as the money shot. Use dry-run/unsigned-tx for repeatable rehearsal. Fund a dedicated OWS mainnet wallet. |
| R3 | CLI subprocess vs direct SDK/API | Use the **CLI** (`--unsigned-tx`) — it's the blessed "Byreal Agent Skills" path and scores "depth of integration." Keep `@byreal-io/byreal-clmm-sdk` as a fallback. |
| R4 | `positions open` extra signer | Handled by CLI (partial-signs with NFT-mint keypair); just don't strip the partial signature when OWS co-signs + broadcasts. |
| R5 | PalmOS settlement modes don't include Byreal | Add a settlement source tag (e.g. `'ows-byreal'`) or reuse `'ows'` with a `via: 'byreal'` field on the action context. Keep `AgentSettlementMode` (`AgentRegistry.ts:15`) backward-compatible. |
| R6 | ERC-8004 required for Phase 2 Byreal track? | Not in the Byreal eligibility list (Byreal/RealClaw integration + Mantle/Solana/both + OSS + demo). Treat ERC-8004 as **stretch**, not a gate. |

---

## 6. Demo narrative (what the judges see)

1. An agent (in chat) says *"move some USDC into the SOL/USDC pool."*
2. PalmOS shows the **action request** + the **policy check** (within budget, allowed token,
   slippage under cap) → auto-approved, or one-tap human approval for a large size.
3. Byreal builds the LP transaction; **OWS signs it inside the vault**; it settles on Solana.
4. Dashboard shows the governed action, the **on-chain signature**, and the live Byreal position.
5. Contrast slide: *"Byreal gives the agent hands. PalmOS gives it guardrails."* — show a
   **denied** out-of-policy swap to prove the governance is real.
6. (Stretch) The agent's **ERC-8004 identity NFT** on Mantle, its agent-card listing these exact
   capabilities.

---

## 7. Submission checklist (from eligibility criteria)

- [ ] Functionally integrates **Byreal Agent Skills** (swap + LP via `byreal-cli`). 
- [ ] Deployed on **Solana** (+ optional Mantle testnet for ERC-8004 identity → "both").
- [ ] Open-source repo (hackathon branch/fork of PalmOS).
- [ ] Working demo (recorded + live).
- [ ] One-sentence product description.
- [ ] Submission write-up answering: which Byreal capabilities are used · how they're integrated
      · what user problem it solves · which actions the agent executes autonomously.

---

## 8. References

- Byreal Agent Skills: https://github.com/byreal-git/byreal-agent-skills (`@byreal-io/byreal-cli` v0.3.6)
- Evaluation criteria: https://docs.byreal.io/turing-test-hackathon/evaluation-criteria
- Hackathon page: https://dorahacks.io/hackathon/mantleturingtesthackathon2026/detail
- ERC-8004 (trustless agent identity): https://eips.ethereum.org/EIPS/eip-8004
- RealClaw launch context: https://www.prnewswire.com/news-releases/bringing-agentic-finance-to-telegram-byreal-debuts-realclaw-transitioning-onchain-finance-to-an-agent-first-economy-302740561.html

### Key source anchors verified
- `byreal-agent-skills`: `src/cli/commands/swap.ts:81-211`, `src/core/confirm.ts`,
  `src/core/transaction.ts`, `src/core/constants.ts` (mainnet, public API), `skills/byreal-cli/SKILL.md`.
- PalmOS: `src/store/ActionRequestRegistry.ts:24-25` (swap/bridge stubs),
  `src/integrations/ows/client.ts:336,410` (sign+broadcast primitive),
  `src/server/dashboard/sdkTools.ts:56-121` (6 current agent tools),
  `src/store/AgentRegistry.ts:15` (settlement modes).

---

## Appendix A — C1/C2 interface contracts (the concrete seam)

This is what we build first so the rest snaps in. Grounded in the real OWS signing code at
`src/integrations/ows/client.ts:269-402`.

### A.0 The OWS signing contract we must bridge (discovered)
OWS does **not** sign a `VersionedTransaction` object. The vault primitive is:
```ts
// from @open-wallet-standard/core, as used in paySolanaTransfer / payPusdRequest:
const signed = signTransaction(
  walletName,          // e.g. agent.owsWalletName
  'solana',            // chain
  unsignedHex,         // hex of the UNSIGNED, serialized transaction
  passphrase,          // this.config.passphrase
  0,                   // address index
  vaultPath,           // this.config.vaultPath
)                      // -> { signature: string }   (hex, may be '0x'-prefixed)

// caller then attaches the ed25519 sig and broadcasts:
tx.addSignature(ownerPubkey, Buffer.from(sigHex, 'hex'))
tx.verifySignatures()
connection.sendRawTransaction(tx.serialize())
```
Today `transactionToUnsignedHex()` (`client.ts:123`) only handles legacy `Transaction`
(`serialize({ requireAllSignatures:false, verifySignatures:false })`). Byreal returns a
**base64 `VersionedTransaction`**. The C2 method must produce the unsigned hex from a versioned
tx (`Buffer.from(vtx.serialize()).toString('hex')`) and re-attach the owner sig.

> **✅ Spike 0 — RESOLVED (PASS), 2026-06-13.** `signTransaction('solana', <versioned-tx hex>)`
> from `@open-wallet-standard/core` produces a signature **valid over the VersionedTransaction's
> message**. Verified offline in `scripts/spike0-ows-versioned-sign.ts` (throwaway vault, no RPC,
> no funds): a legacy tx (the production-path control) and a v0 versioned tx both signed, and the
> returned sig verified via tweetnacl against `message.serialize()`. **Path B works as-is — no
> custody compromise, no fallback needed.** (Had it failed, fallbacks were: raw `signMessage` over
> the message bytes, or a funded local-key DeFi sub-wallet.)

### A.1 C1 — `ByrealClient` (new: `src/integrations/byreal/client.ts`)
Thin, typed wrapper over `byreal-cli` (subprocess, `-o json`). Read-only methods need no wallet;
build methods use `--unsigned-tx --wallet-address <ownerPubkey>` and **never** touch a key.

```ts
export type ByrealUnsignedTxResult = {
  unsignedTransactions: string[]      // base64 VersionedTransaction(s)
  extraSignerPublicKey?: string       // present for `positions open` (NFT mint, pre-signed by CLI)
}

export type ByrealSwapQuote = {
  inputMint: string; outputMint: string
  inAmount: string; outAmount: string         // raw base units
  uiInAmount: string; uiOutAmount: string
  priceImpactPct?: number
  routerType: 'AMM' | 'RFQ'                    // RFQ => see R1 (can't raw-broadcast)
  quoteId?: string; orderId?: string
}

export interface ByrealClient {
  // ---- read-only (keyless, free) ----
  listPools(opts?: { limit?: number; search?: string }): Promise<ByrealPool[]>
  listTokens(opts?: { search?: string }): Promise<ByrealToken[]>
  quoteSwap(p: { inputMint: string; outputMint: string; amount: string;
                 swapMode?: 'in' | 'out'; slippageBps?: number;
                 ownerPubkey: string }): Promise<ByrealSwapQuote>     // wraps `swap execute --dry-run`
  catalog(): Promise<ByrealCapability[]>      // `catalog list` -> auto-generate agent tools

  // ---- build unsigned (no key; owner = OWS wallet pubkey) ----
  buildSwapUnsigned(p: { inputMint: string; outputMint: string; amount: string;
                         swapMode?: 'in' | 'out'; slippageBps?: number;
                         ownerPubkey: string }): Promise<ByrealUnsignedTxResult & { quote: ByrealSwapQuote }>
  buildPositionUnsigned(p: { op: 'open' | 'increase' | 'decrease' | 'close';
                             poolId: string; ownerPubkey: string; /* op-specific params */ })
                       : Promise<ByrealUnsignedTxResult>
}
```
Impl notes: spawn via `execFile('byreal-cli', [cmd, ...args, '-o', 'json', '--unsigned-tx',
'--wallet-address', ownerPubkey])`; parse stdout JSON; map CLI error JSON → typed errors.
Env passthrough: `BYREAL_API_URL`, `SOLANA_RPC_URL` (mainnet). Prefer AMM routing (R1).

### A.2 C2 — generic OWS signer (extend `src/integrations/ows/client.ts`)
One new method; the existing `paySolanaTransfer`/`paySplTransfer` are special cases of it.

```ts
// Sign an externally-built Solana tx (e.g. from Byreal) with the OWS vault and broadcast it.
// `partiallySignedBase64` may already carry signatures (e.g. Byreal's position-NFT-mint sig);
// we ONLY add the owner signature and preserve the rest.
async signAndBroadcastSolanaTx(input: {
  wallet: string                       // agent.owsWalletName
  base64Tx: string                     // Byreal unsignedTransactions[0]
  rpcUrl?: string                      // defaults to PUSD_SOLANA_NETWORK / env (mainnet)
}): Promise<OwsSolanaPaymentResult> {
  const vtx = VersionedTransaction.deserialize(Buffer.from(input.base64Tx, 'base64'))
  const ownerPubkey = new PublicKey(readSolanaAddress(this.getWallet(input.wallet))!)
  const unsignedHex = Buffer.from(vtx.serialize()).toString('hex')   // see Spike 0
  const { signature } = signTransaction(input.wallet, 'solana', unsignedHex,
                                        this.config.passphrase, 0, this.config.vaultPath)
  vtx.addSignature(ownerPubkey, Buffer.from(signature.replace(/^0x/, ''), 'hex'))
  if (!vtx.verifySignatures()) throw new Error('OWS produced an invalid signature for Byreal tx.')
  const connection = new Connection(rpcUrl, 'confirmed')
  const sig = await connection.sendRawTransaction(vtx.serialize())
  await connection.confirmTransaction(sig, 'confirmed')
  return { stdout: JSON.stringify({ signature: sig }), parsedBody: { signature: sig }, signature: sig }
}
```
Returns the same `OwsSolanaPaymentResult` shape the transfer path already uses → reconciliation
and audit work unchanged.

### A.3 Orchestration — `requestAssetSwap.ts` (mirror `requestAssetTransfer.ts`)
Same skeleton as `settleAssetTransferViaOws` (`requestAssetTransfer.ts:60-166`):
1. Create `asset.swap` ActionRequest (value = inputMint/outputMint/amount/slippage).
2. `evaluateTransferRequest`-style policy check (extended: slippage cap, allowed tokens, max notional).
3. On approve + `walletBackend==='ows'`: `quote = byreal.quoteSwap(...)` (show in approval card);
   then `{ unsignedTransactions } = byreal.buildSwapUnsigned({ ownerPubkey })`.
4. `owsClient.signAndBroadcastSolanaTx({ wallet, base64Tx: unsignedTransactions[0] })`.
5. Stamp `requestContext.settlementBackend='ows'`, `settlementVia='byreal'`, `settlementSignature`,
   `settlementRouter=quote.routerType` (so reconciliation/audit see it). Failure → `status:'failed'`
   with `errorCode:'byreal.settlement_failed'` (never a faked success — same contract as transfers).

`asset.liquidity` is the same flow with `buildPositionUnsigned` and an `op` discriminator;
`positions open` carries Byreal's pre-applied NFT-mint signature through C2 untouched.

### A.4 Build order (de-risked)
**Spike 0 ✅ DONE (PASS)** → **C1 ✅ DONE** `ByrealClient` (`src/integrations/byreal/client.ts`;
`listPools`/`listTokens`/`quoteSwap`/`buildSwapUnsigned`, verified live in
`scripts/verify-byreal-client.ts`) → **C2** `signAndBroadcastSolanaTx` ← *next* → **C3**
`requestAssetSwap` → **C5** policy fields → **C6** MCP tools → **C4** `asset.liquidity` →
**C7/C8** dashboard + reconcile.

> C1 requires `byreal-cli` on PATH (`npm i -g @byreal-io/byreal-cli`, or pass `bin` in config).
> Read-only methods are keyless against `api2.byreal.io` (mainnet); `buildSwapUnsigned` emits an
> unsigned base64 v0 tx and signs nothing.

> Note for C2: `VersionedTransaction` in `@solana/web3.js` v1 has no `verifySignatures()`; use
> `nacl.sign.detached.verify(vtx.message.serialize(), sig, ownerPubkey.toBytes())` (tweetnacl is
> already a dep) as the integrity check before broadcast, as Spike 0 does.
