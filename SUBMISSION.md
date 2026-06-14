# PalmOS × Byreal — Submission

**One-sentence description.** PalmOS is a governance layer for agentic wallets: an autonomous AI
agent swaps and provides liquidity on Byreal (Solana) but only within policy, with human-in-the-loop
approval and vault custody it can't drain — and its **identity (ERC-8004)** plus **every governed
decision and outcome** are recorded on **Mantle**, signed by the same vault that signs its Solana
trades.

**The wedge.** Byreal gives an AI agent hands; PalmOS gives it guardrails. Everyone else in this
track is "an agent that trades on Byreal." We are the only one with **governance + a verifiable
on-chain audit of the agent's behavior** — one agent, one OWS vault, two chains (Solana = execution,
Mantle = identity + decision log).

---

## Rubric mapping

### Part A · Mantle general (50 pts)

| Criterion | How we hit it | Proof |
|---|---|---|
| **Technical** | The core governed flow runs on Mantle end-to-end: deploy + mint + a `recordDecision` write per governed action, all signed by the OWS vault's EVM key. Two contracts, source-verified. | [IdentityRegistry](https://sepolia.mantlescan.xyz/address/0xed9317a4b16d275c59bd2bcfa7336d28efcebe41) · [AgentActionLog](https://sepolia.mantlescan.xyz/address/0x67f76b19141228c339f3c0b241af0c1c9f9b1772) |
| **Ecosystem fit** | Native Mantle stack — `viem` + Mantle Sepolia + ERC-8004; the agent's canonical identity lives on Mantle as an NFT with an on-chain agent card. | [Identity NFT #1](https://sepolia.mantlescan.xyz/nft/0xed9317a4b16d275c59bd2bcfa7336d28efcebe41/1) |
| **Business** | Makes agentic DeFi *deployable* for treasuries/funds — the missing governance + audit layer that lets institutions put agents on-chain, not another trading bot. | — |
| **Innovation** | One OWS vault signing two chains; a **denied** decision recorded on-chain as a first-class governance artifact ("the agent was stopped, provably"). | [DENIED record](https://sepolia.mantlescan.xyz/tx/0x2c7898988899b8c9787b9c92d16e808963d651fa68c7104874e342199f15be3a) |
| **UX** | Operator dashboard shows the ERC-8004 identity card and a "Recorded on Mantle" link on every governed action, next to the Solana settlement link. | dashboard (`frontend/`) |

### Part B · Byreal (50 pts)

| Criterion | How we hit it | Proof |
|---|---|---|
| **Integration depth** | Byreal Agent Skills as governed action kinds — swap + LP (open/increase/decrease/close) — through the full policy → sign → broadcast → audit spine, with real mainnet settlement. | [agent-decided swap](https://solscan.io/tx/svWHonoFh3ozzaWxF6ioxsVYfxTGvBwQUxraB7wzKDWVyfFaET3K4Vu1cLxKztvB1EBcwunnXnZDK8vM8QSb3Hf) |
| **Agent autonomy** | Claude Sonnet 4.6 (on Bedrock) decides whether/how much to trade and acts via the SDK; PalmOS governs the outcome. | `scripts/agent-autonomy.ts` |
| **Use-case** | Policy-bounded autonomous DeFi treasury management — a real product with real users (teams/funds deploying agents). | — |
| **Verifiability** | Every "it works" claim carries a clickable Solscan/Mantlescan proof; both contracts source-verified; vault custody is non-drainable (agent holds no keys on either chain). | this appendix |

---

## The 3 Defining Features

1. **Every decision + outcome recorded on Mantle — including denied.** `AgentActionLog` logs each
   governed action's kind, verdict, outcome, amount, and the Solana settlement signature
   (cross-chain link). Blocked actions are recorded too, so "the agent was stopped" is provable
   on-chain. ([executed](https://sepolia.mantlescan.xyz/tx/0xd365dfd8acb79367993f80b66d6a8d34372339266cd5cbe0ff4043ecf81a00c4) ·
   [denied](https://sepolia.mantlescan.xyz/tx/0x2c7898988899b8c9787b9c92d16e808963d651fa68c7104874e342199f15be3a))
2. **ERC-8004 agent identity.** A soulbound identity NFT whose tokenURI is the agent's on-chain
   agent card — its Byreal functionalities, `@getpalmos` MCP/agent endpoints, and Solana payment
   address. ([NFT #1](https://sepolia.mantlescan.xyz/nft/0xed9317a4b16d275c59bd2bcfa7336d28efcebe41/1))
3. **Transparency.** Every action has a clickable on-chain proof; both contracts' source is verified
   on Mantlescan; and the *same* OWS vault is provably the actor on both chains — the identity, the
   trade, and the audit record are one cryptographic identity.

---

## Byreal — the four submission questions

**1. Which Byreal capabilities are used.** Byreal Agent Skills via `@byreal-io/byreal-cli`: AMM spot
swaps (`swap execute`); CLMM liquidity — open / increase / decrease / close positions; and read-only
quotes, pools, tokens, and position listing (keyless). Every write uses
`--unsigned-tx --wallet-address <vault pubkey> -o json`.

**2. How they're integrated.** As new **governed action kinds** (`asset.swap`, `asset.liquidity`)
through the existing PalmOS policy → approval → OWS-sign → reconcile → audit spine. Byreal returns a
base64 Solana `VersionedTransaction`; the OWS vault signs it as owner (preserving Byreal's
pre-applied position-NFT co-signature on `positions open`) and broadcasts. After each decision
resolves, the verdict + outcome is recorded on Mantle. Agent/SDK tools — `get_byreal_quote`,
`request_asset_swap`, `request_liquidity_action`, `list_byreal_positions` — expose this over HTTP.
(Code: `src/integrations/byreal/`, `src/app/requestAssetSwap.ts`, `src/app/requestLiquidityAction.ts`.)

**3. What user problem it solves.** Teams, treasuries, and funds want to deploy autonomous agents
into on-chain DeFi but can't, because an agent with funds and no governance is a liability. PalmOS
makes agentic DeFi deployable: policy limits, human approval for large moves, vault custody the agent
can't drain, and an on-chain audit trail an operator (or an auditor) can verify independently.

**4. Which actions the agent executes autonomously.** The agent autonomously reads its wallet,
fetches Byreal quotes, decides whether and how much to rebalance, and submits swap / liquidity
actions. PalmOS then governs the outcome: within the auto-approve threshold it settles
**autonomously**; a larger but allowed move becomes **approval-pending** for a human; anything over
the limit or off-policy is **denied**. The agent cannot bypass any of this.

---

## Proof appendix (all links resolve)

**Solana mainnet — Byreal execution**
- Governed agent wallet: [`4LermEmh8qcN5Kq8wk6ALFHT1PaKFDcLK3a1PcPk3XW6`](https://solscan.io/account/4LermEmh8qcN5Kq8wk6ALFHT1PaKFDcLK3a1PcPk3XW6)
- Agent-decided swap (executed): [`svWHono…b3Hf`](https://solscan.io/tx/svWHonoFh3ozzaWxF6ioxsVYfxTGvBwQUxraB7wzKDWVyfFaET3K4Vu1cLxKztvB1EBcwunnXnZDK8vM8QSb3Hf)
- First governed swap (executed): [`5FSBF5ks…nJ1H88`](https://solscan.io/tx/5FSBF5ks4vTxjQbraKxMT2nCx5p3AxHf6qaLMtTGZNqwYQ6ATapwXN2h2X3D5Tkpq3XwskXUiG4xWMbLXnJ1H88)
- Out-of-policy attempt: denied (`policy.swap_amount_exceeds_limit`, never broadcast)

**Mantle Sepolia — identity + decision log** (chainId 5003, explorer sepolia.mantlescan.xyz)
- OWS EVM vault (deployer / identity owner / decision signer): [`0x868C23dbfd439d3c9477FE6B192dA2265c3c31f5`](https://sepolia.mantlescan.xyz/address/0x868C23dbfd439d3c9477FE6B192dA2265c3c31f5)
- IdentityRegistry (ERC-8004, verified): [`0xed9317a4b16d275c59bd2bcfa7336d28efcebe41`](https://sepolia.mantlescan.xyz/address/0xed9317a4b16d275c59bd2bcfa7336d28efcebe41)
- AgentActionLog (decision log, verified): [`0x67f76b19141228c339f3c0b241af0c1c9f9b1772`](https://sepolia.mantlescan.xyz/address/0x67f76b19141228c339f3c0b241af0c1c9f9b1772)
- Agent identity NFT #1: [`/nft/…/1`](https://sepolia.mantlescan.xyz/nft/0xed9317a4b16d275c59bd2bcfa7336d28efcebe41/1)
- Decision recorded — executed: [`0xd365df…81a00c4`](https://sepolia.mantlescan.xyz/tx/0xd365dfd8acb79367993f80b66d6a8d34372339266cd5cbe0ff4043ecf81a00c4)
- Decision recorded — **denied** (governed swap stopped by policy): [`0x2c7898…f15be3a`](https://sepolia.mantlescan.xyz/tx/0x2c7898988899b8c9787b9c92d16e808963d651fa68c7104874e342199f15be3a)

*Solana = execution; Mantle = identity + audit; one OWS vault signs both.*
