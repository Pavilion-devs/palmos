# Umbra Private Settlement Workflow

PalmOS keeps the normal PUSD rail as the default governed payment path. Umbra is an explicit private settlement proof that can be attached to a registered PalmOS agent when the demo or integration needs private payout visibility.

## Required Environment

Add these to `.env` in the workspace running the backend or CLI:

```bash
UMBRA_SECRET_KEY_BASE64=...
UMBRA_NETWORK=devnet
UMBRA_INDEXER_API_URL=https://utxo-indexer.api-devnet.umbraprivacy.com
UMBRA_RELAYER_API_URL=https://relayer.api-devnet.umbraprivacy.com
UMBRA_TOKEN=wSOL
UMBRA_PRIVATE_AMOUNT=0.001
```

The Umbra key must have enough devnet SOL to pay fees. Do not commit `.env`.

## Registered Agent Proof

Use an agent that already exists in the PalmOS dashboard:

```bash
npm run palmos:private -- --agent <agent-id> --require-existing-agent --amount 0.001 --token wSOL
```

Optional recipient:

```bash
npm run palmos:private -- --agent <agent-id> --require-existing-agent --recipient <solana-address>
```

The command returns JSON with the proof source, policy attachment state, privacy path, report ID, reconciliation status, final transaction signature, and explorer URL.

## Claude Code / Codex Demo

Use the slash command guide:

```text
/palmos-private-pay --agent <agent-id> --amount 0.001 --token wSOL
```

This keeps the story clean: the external agent has the brain, PalmOS controls policy, and Umbra is the private settlement rail for explicit private payouts.

## Dashboard Behavior

The agent detail page shows whether Umbra private settlement policy is attached. Normal PUSD settlement remains unchanged. Umbra paid calls also appear in Transactions with the private rail, privacy path, proof source, report ID, reconciliation status, and explorer link.
