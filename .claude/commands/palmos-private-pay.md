Legacy fallback: execute an explicit PalmOS Umbra private settlement proof for a registered external agent.

Prefer enabling first-class private mode for the agent instead of treating private payment as a separate product path:

```bash
curl -s -X PATCH http://127.0.0.1:4030/api/dashboard/agents/<agentId>/privacy \
  -H 'content-type: application/json' \
  -d '{"privacyMode":"allowed"}'
```

Use `{"privacyMode":"required"}` when public settlement should fail closed unless a private route is available.

This command is conversational. If arguments are missing, ask for them one step at a time before running anything.

Arguments: $ARGUMENTS

## Step-by-step flow

### Step 1 — Check Umbra env
Check that `UMBRA_SECRET_KEY_BASE64` is available in the environment (either exported or in `.env`). If it is not set, stop and tell the user to add it to `.env` before continuing.

### Step 2 — Identify the agent
- If `--agent <agentId>` was provided in the arguments, use it directly.
- If no agent argument was given, fetch the registered agents from the backend:
  ```bash
  curl -s http://127.0.0.1:4030/api/dashboard/agents
  ```
  Present them as a numbered list showing name, ID, settlement mode, and status:
  ```
  I found these agents registered in PalmOS:

  [1] Claude Code Agent — OWS — active
  [2] Research Agent — real-solana — active

  Which agent should execute the private settlement? (name, number, or ID)
  ```
  Accept the user's reply as a name, a number, or a full agent ID. Resolve it to the agent ID before continuing. If the name matches partially (e.g. "Claude Code" matches "Claude Code Agent"), accept it.

### Step 3 — Confirm amount and token
- If `--amount` and `--token` were provided in the arguments, use them.
- If not, ask:
  ```
  Amount and token for the private settlement? (default: 0.001 wSOL)
  ```
  Accept the user's reply. If they press enter or say "default", use `0.001` and `wSOL`.

### Step 4 — Run the command
```bash
npm run palmos:private -- --agent <agentId> --require-existing-agent --amount <amount> --token <token>
```

### Step 5 — Report the result
- `execution.status === "executed"` → Settlement executed. Show: amount, token, privacy path (`umbra_mixer_utxo`), report ID, dashboard link `#dashboard/transactions/<executionId>`, and if `execution.explorer` exists, render it as a Markdown link: `[Open Umbra transaction](<url>)`.
- `execution.status === "approval_pending"` → Paused for operator approval. Show the execution ID and tell the user to approve from `#dashboard/approvals`.
- `ok === false` or failure → Show the error. Check that the agent exists, Umbra env vars are loaded, and the devnet wallet has SOL for fees.

## Notes

- `--require-existing-agent` prevents the command from silently creating a synthetic proof agent.
- The Umbra path runs through PalmOS policy and approval first — funds do not move until the operator approves.
- Current proofs use the Umbra devnet mixer/UTXO path.
