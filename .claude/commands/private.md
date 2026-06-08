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

## Production / judge backend note

If `PALMOS_API_URL` points at `https://api.getpalmos.xyz`, dashboard mutations require a dashboard access cookie and a valid origin header.

If `PALMOS_JUDGE_ACCESS_CODE` is available, create a temporary cookie jar first:

```bash
PALMOS_COOKIE_JAR="$(mktemp)"
curl -s -c "$PALMOS_COOKIE_JAR" \
  -H 'content-type: application/json' \
  -H 'origin: https://www.getpalmos.xyz' \
  -d "{\"passcode\":\"$PALMOS_JUDGE_ACCESS_CODE\"}" \
  "$PALMOS_API_URL/api/dashboard/judge-access"
```

Then include the cookie jar and origin on dashboard GET/PATCH calls:

```bash
curl -s -b "$PALMOS_COOKIE_JAR" \
  -H 'origin: https://www.getpalmos.xyz' \
  "$PALMOS_API_URL/api/dashboard/agents"

curl -s -X PATCH -b "$PALMOS_COOKIE_JAR" \
  -H 'origin: https://www.getpalmos.xyz' \
  -H 'content-type: application/json' \
  -d '{"privacyMode":"allowed"}' \
  "$PALMOS_API_URL/api/dashboard/agents/<agentId>/privacy"
```

Never print the judge access code in the response.

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
