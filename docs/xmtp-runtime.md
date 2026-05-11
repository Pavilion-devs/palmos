# XMTP Runtime Notes

XMTP approval alerts are useful, but they are not required for the core payment proof. Dashboard approvals remain the primary MVP approval path.

## Current Behavior

If `XMTP_WALLET_KEY` is configured, the backend attempts to initialize `@xmtp/node-sdk`.

If the local native binding fails to load, the backend now:

- logs the XMTP issue
- disables the XMTP notifier
- continues serving dashboard and SDK API routes

This prevents a native dependency issue from blocking payment demos.

## Local Issue Observed

On this machine, Node `v24.15.0` failed to load the XMTP native binding because the native module referenced a missing `libiconv` path.

## Fix Path

Use a cleaner runtime before relying on XMTP alerts live:

1. Use Node 22.
2. Reinstall dependencies on that runtime.
3. Confirm `@xmtp/node-sdk` native bindings load.
4. Start the backend with `XMTP_WALLET_KEY` configured.
5. Trigger an approval-required payment.
6. Confirm request and resolution messages arrive in the manager inbox.

Until this is verified, demo approvals through the dashboard.
