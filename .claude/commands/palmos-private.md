Toggle PalmOS private mode for an existing agent.

Arguments: $ARGUMENTS

Use this command to turn first-class private settlement mode on or off. It should not execute a payment by itself.

## Modes

- `disabled`: normal governed settlement only.
- `allowed`: private settlement can be requested when supported.
- `required`: public settlement fails closed unless a private route is available.

## Flow

1. Resolve the agent ID from `--agent <agentId>` or by listing agents:
   ```bash
   curl -s http://127.0.0.1:4030/api/dashboard/agents
   ```
2. Resolve mode from `--mode disabled|allowed|required`. Treat `on` / `enable` as `required`, because users expect `/private on` to make normal paid calls private by default. If missing, ask:
   ```
   Private mode for this agent? disabled, allowed, or required
   ```
3. Update PalmOS:
   ```bash
   curl -s -X PATCH http://127.0.0.1:4030/api/dashboard/agents/<agentId>/privacy \
     -H 'content-type: application/json' \
     -d '{"privacyMode":"<mode>"}'
   ```
4. Report the returned `privacyMode`, `readiness.status`, and any readiness check codes.

## Notes

- `required` means PalmOS blocks public SDK paid-service calls until a private route is configured.
- Private mode is operator-controlled policy. It does not hide activity from PalmOS audit records.
