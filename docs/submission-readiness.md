# Submission Readiness

## Current Proof

PalmOS now has fresh mainnet proof for both real settlement paths:

- OWS-settled agent payment:
  `https://solscan.io/tx/6fBfavJEvN4oYbH9kuGLHkCiZsL6vga4U1aJHK3a9VoSiiC33Nhw9xKB9drPBkt824wubY492nPTpozSnWH8iB9`
- Direct real-solana agent payment:
  `https://solscan.io/tx/2xzkxPi5246gnMSaTH3wqkpEWd1CQF3PsLcBNP2dB7HbzXS1wT3ZBpCL2PFWazTJxieuUfrqFHjTihneV3XtwUnp`

Both were executed from freshly created PalmOS agents after readiness checks passed.

## What Is Ready

- Backend dashboard API.
- Frontend dashboard.
- Agent onboarding.
- SDK credentials.
- External agent CLI.
- Policy checks.
- Auto-approved real PUSD settlement.
- Approval-pending dashboard flow.
- Blocked policy flow.
- OWS settlement mode.
- Direct real-solana settlement mode.
- Readiness checks.
- Solscan links in transaction records.

## What Still Needs Final Handling

- VPS backend deployment with persistent storage.
- Final frontend env pointing at deployed backend.
- README final copy pass after deployment URL exists.
- Optional `@palmos/agent` npm publish.
- XMTP native runtime fix if alerts are part of the live judge demo.
- Curated workspace state for the judge walkthrough.
- Optional QVAC/Tether repo.
- Optional Umbra proof path.

## Recommended Priority

1. Deploy backend to VPS using `docs/deployment.md`.
2. Point frontend at backend.
3. Create a curated judge workspace.
4. Run one readiness check.
5. Execute one tiny real payment.
6. Confirm the dashboard transaction and Solscan link.
7. Freeze the demo state.
