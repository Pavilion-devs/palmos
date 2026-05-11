# Security Notes

PalmOS is an MVP. The demo is not intended for unrestricted public access.

## Demo-Mode Custody

The current demo can use `OWS_WALLET_PRIVATE_KEY` as a funded Solana payer fallback for:

- OWS settlement-mode agents.
- Direct `real-solana` settlement-mode agents.
- Readiness CLI payer derivation.

This is acceptable for a controlled hackathon demo, but it means multiple agents can pay from the same funded wallet. Do not run parallel live payment demos from multiple agents unless the wallet accounting and per-agent funding model are scoped.

Production direction:

- Bind each agent to an explicit wallet.
- Fund and readiness-check that wallet per agent.
- Avoid shared private-key fallback.
- Record payer wallet identity in every real-settlement record.

## Real Payment Guards

The real-payment path has these MVP guards:

- policy check before settlement
- vendor allowlist
- max per call
- session budget
- payment instruction validation
- real-payment cap via `PALMOS_REAL_PUSD_MAX_PER_CALL` or `PUSD_MAX_PER_CALL`
- readiness check command

Keep `PALMOS_REAL_PUSD_MAX_PER_CALL` low during demos.

## Service Registration

In production mode, keep:

```text
PALMOS_ALLOW_UNSAFE_SERVICE_ENDPOINTS=0
```

Only register services with validated recipient addresses and known payment amounts.

## XMTP

XMTP notification startup is non-fatal. If native bindings fail, PalmOS disables XMTP notifications while keeping dashboard approval flows available.

For a production deployment, fix the runtime/dependency issue instead of relying on the non-fatal fallback.
