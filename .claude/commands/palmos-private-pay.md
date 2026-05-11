Execute an explicit PalmOS Umbra private settlement proof for a registered external agent.

Arguments: $ARGUMENTS

## What to do

1. Check that `UMBRA_SECRET_KEY_BASE64` is available in the environment. If it is not set, tell the user to add it to `.env` before running a private settlement proof.

2. Identify the registered PalmOS agent:
   - Prefer an explicit `--agent <agentId>` argument.
   - If no agent is provided, use `PALMOS_UMBRA_AGENT_ID`.
   - If neither exists, ask the user to register an agent in PalmOS first and copy its agent ID from the dashboard.

3. Parse optional arguments:
   - `--recipient <solanaAddress>` for the private payout recipient.
   - `--amount <decimal>` for the Umbra proof amount.
   - `--token <symbol>` for the proof asset, usually `wSOL` on devnet.
   - `--base-dir <path>` when testing against a non-default local workspace.

4. Run the private proof command with the existing-agent guard:
   ```bash
   npm run palmos:private -- --agent <agentId> --require-existing-agent [--recipient <address>] [--amount <amount>] [--token <symbol>] [--base-dir <path>]
   ```

5. Parse the JSON output and report:
   - `ok === true` and `execution.status === "executed"` -> Private settlement executed. Show the amount, token, privacy path, report ID, final transaction link, and dashboard link `#dashboard/transactions/<executionId>`.
   - `ok === true` but not executed -> Show the execution status and reconciliation status.
   - `ok === false` or command failure -> Show the error and confirm the agent exists, Umbra env vars are loaded, and the devnet wallet has SOL.

## Notes

- This is an explicit private settlement workflow. It does not replace the normal PUSD payment command.
- `--require-existing-agent` prevents the command from silently creating a synthetic proof agent during dashboard demos.
- The first successful run attaches the minimum Umbra proof policy to the existing PalmOS agent identity and records the result in the dashboard.
- Current MVP proofs use the Umbra devnet mixer/UTXO path and write audit metadata for reconciliation, report ID, privacy path, and final transaction.
