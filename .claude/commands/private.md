Toggle PalmOS private settlement mode for an external agent.

Arguments: $ARGUMENTS

Use this command when the user says `/private`, `/private on`, `/private required`, `/private off`, or asks to check private mode.

This command changes PalmOS policy. It does not execute a payment by itself.

## Modes

- `on` / `enable`: require private settlement for normal PalmOS paid-service calls.
- `allowed`: private settlement may be requested when supported, while public settlement remains allowed.
- `required`: public paid-service calls fail closed unless a private route is available.
- `off` / `disabled`: normal governed settlement only.
- `status`: show the agent's current privacy mode and readiness checks.

## Important honesty check

Do not claim every normal PUSD service call is privately settled yet.

Current behavior:

- Private mode is first-class agent policy.
- Umbra private settlement records and approval flow exist.
- `required` mode blocks public SDK paid-service calls unless a private route is configured.
- Explicit private settlement can still be run with `/palmos-private-pay`.

## Flow

1. Resolve `PALMOS_API_URL`, defaulting to `http://127.0.0.1:4030`.

2. Resolve the target agent:
   - Prefer `--agent <agentId>` from the arguments.
   - If missing, call:
     ```bash
     curl -s "$PALMOS_API_URL/api/dashboard/agents"
     ```
   - Present agents as a numbered list with name, ID, status, settlement mode, and privacy mode.
   - Accept a number, partial name, or full ID.

3. Resolve mode:
   - `on`, `enable`, `private` -> `required`
   - `allowed` -> `allowed`
   - `required`, `strict`, `force` -> `required`
   - `off`, `disable`, `disabled`, `public` -> `disabled`
   - `status`, `check`, `show` -> status only
   - If missing, ask:
     ```text
     Private mode for this agent? on, required, off, or status
     ```

4. If mode is `status`, report:
   - current privacy mode,
   - whether Umbra policy is attached,
   - private settlement readiness status,
   - relevant readiness check codes.

5. If updating mode, PATCH the agent privacy endpoint:
   ```bash
   curl -s -X PATCH "$PALMOS_API_URL/api/dashboard/agents/<agentId>/privacy" \
     -H 'content-type: application/json' \
     -d '{"privacyMode":"<mode>"}'
   ```

6. Report the result clearly:
   - privacy mode,
   - whether the mode changed,
   - readiness status,
   - any blocking/warning readiness checks,
   - dashboard link: `#dashboard/agents/<agentId>`.

## Production / remote backend note

The shared-passcode access gate (judge/operator-login) has been **removed** (P0 of
the operator-auth migration — see `docs/operator-auth-plan.md`). There is no
passcode-cookie path anymore.

- **Local/dev backend:** run with `PALMOS_DISABLE_DASHBOARD_AUTH=1` (the default in
  `.env.example`). Dashboard GET/PATCH calls need no auth cookie — just a valid
  `origin` header:

  ```bash
  curl -s -X PATCH \
    -H 'origin: http://localhost:4030' \
    -H 'content-type: application/json' \
    -d '{"privacyMode":"allowed"}' \
    "$PALMOS_API_URL/api/dashboard/agents/<agentId>/privacy"
  ```

- **Production backend (`https://api.getpalmos.xyz`):** dashboard mutations require a
  real Sign-In With Solana operator session (added in P1/P2). Until that lands there
  is no scriptable curl auth path against production — drive these mutations from the
  authenticated dashboard UI instead.

## Suggested responses

Enabled:

```text
Private mode enabled for <agent name>.
Mode: required
Readiness: ready
Dashboard: #dashboard/agents/<agentId>
```

Required:

```text
Private mode is now required for <agent name>.
Public paid-service calls will fail closed unless a private route is available.
Readiness: <status>
Dashboard: #dashboard/agents/<agentId>
```

Disabled:

```text
Private mode disabled for <agent name>.
The agent will use normal governed settlement.
Dashboard: #dashboard/agents/<agentId>
```
