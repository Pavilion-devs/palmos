# Workspace Curation

The local workspace now contains useful proof records and some validation noise. Do not delete it blindly.

## Current Storage

Default local backend storage:

```text
/tmp/palmos-live
```

## Safe Curation Approach

1. Preserve the current proof workspace:

```bash
cp -R /tmp/palmos-live /tmp/palmos-live-proof-backup
```

2. Start a clean judge workspace:

```bash
AGENT_SPEND_OS_BASE_DIR=/tmp/palmos-judge npm run dashboard:api
```

3. Create only the agents needed for the walkthrough:

- one local-demo agent
- one OWS settlement agent
- one real-solana settlement agent
- optionally one approval-required agent

4. Run one readiness check.
5. Execute only the calls you want judges to see.
6. Keep the old proof workspace intact until after submission.

## What Not To Do Before Submission

- Do not wipe `/tmp/palmos-live` unless you have copied it.
- Do not run multiple real-settlement agents in parallel while using the shared `OWS_WALLET_PRIVATE_KEY` fallback.
- Do not delete the Solscan proof records from `real-pusd-proof.md`.

## Judge Workspace Goal

The judge workspace should show:

- clean agent names
- one or two real paid calls
- one blocked policy call
- one approval-pending/resolved dashboard flow
- no confusing old validation agents unless they are part of the proof story
