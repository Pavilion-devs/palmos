# PalmOS Execution Plan

## Product Direction Reset

PalmOS is a real product, not a fixture-driven showcase.

Definition:

> PalmOS is a Solana-native agent payment operating system where AI agents pay APIs and services in Palm USD under enforceable policies, approvals, and audit trails.

The operating model from this point forward:

- Users bring or create their own agents.
- PalmOS gives each agent a governed Solana/PUSD payment identity.
- PalmOS is the payment control plane, not the place where a few preloaded agents live.
- Dashboard state must be user-owned. It should not default to Research Agent, Ops Buyer, Growth Agent, or any other hardcoded product agents.
- Seeded/sample agents are not part of the product path. If they remain in code temporarily, they are only migration scaffolding and must be removed or unreachable from the normal app.
- Onboarding must create the user's first real PalmOS agent, wallet, policy, and SDK/API credentials.
- The SDK/API is how external agents actually use PalmOS.

Core product sentence:

> Connect any AI agent to PalmOS, give it a PUSD wallet, define what it can pay for, and audit every paid API call it makes.

## Strategy Shift

We are not building PalmOS from a blank repo anymore. We are adapting the SpendOS codebase directly.

SpendOS already has the hard parts we want:

- Agent wallet governance.
- Spend policies.
- Vendor allowlists.
- Approval gates.
- XMTP operator alerts.
- OWS wallet integration.
- Paid-call lifecycle tracking.
- Audit logs.
- Dashboard snapshot APIs.
- A strong frontend foundation.
- Existing scenario runner code that can be mined for runtime mechanics, but not used as the product model.

The new plan is to turn SpendOS into a user-owned PUSD/Solana product:

> SpendOS becomes PalmOS: a Solana-native agent payment operating system where AI agents pay APIs and services in Palm USD under enforceable policies, approvals, and audit trails.

## Product Positioning

The core message:

> Give AI agents PUSD wallets, not blank checks.

The product message:

> Bring your AI agent. PalmOS gives it a governed Solana payment identity for PUSD API commerce.

This is stronger than a basic payment middleware because it combines:

- PUSD settlement.
- Solana transaction verification.
- Bring-your-own-agent autonomy.
- Spend governance.
- OWS wallet infrastructure.
- XMTP approval workflows.
- Agent owner dashboard.
- Agent SDK/API credentials.
- Paid service registry.

## Product Mental Model

PalmOS has four first-class user jobs:

1. **Create or connect an agent**
   - User names the agent.
   - User describes what the agent should do.
   - PalmOS creates an agent payment identity.
   - PalmOS provisions or links a Solana/OWS wallet.
   - PalmOS issues SDK/API credentials for that agent.

2. **Define spend policy**
   - Session budget.
   - Max PUSD per API call.
   - Auto-approval threshold.
   - Vendor/service allowlist.
   - Approval destination through XMTP or dashboard.

3. **Let the external agent pay services**
   - Agent calls PalmOS SDK/API from its own runtime.
   - PalmOS checks policy before payment.
   - PalmOS pays PUSD only when allowed or approved.
   - PalmOS blocks unknown vendors, exhausted budgets, and invalid wallet states.
   - Later, the same policy engine can also route approved sensitive treasury movement through a private Umbra settlement rail without replacing the public PUSD API-payment path.

4. **Operate approvals and audit**
   - Dashboard shows agent wallets, budgets, calls, approvals, blocked attempts, and receipts.
   - Operators approve larger spends.
   - Every paid call becomes an audit record.

Core primitives:

- `Organization`
- `Treasury`
- `Agent`
- `AgentWallet`
- `AgentCredential`
- `Policy`
- `Service`
- `PaidCall`
- `Approval`
- `AuditEvent`
- `SettlementRail`
- `PrivacyProof`

## MVP Private Settlement Direction

PalmOS should remain the operating system. Umbra should become an optional privacy execution layer for the MVP submission without replacing or destabilizing the verified Palm/PUSD product path.

Reference plan:

```text
umbra-migration.md
```

Target mental model:

```text
agent -> PalmOS policy/approval -> Umbra private settlement -> PalmOS reconciliation/audit
```

This means agents can have a private settlement proof for the MVP, but only after PalmOS enforces the same controls it already applies to normal PUSD agent payments:

- agent identity
- policy limits
- session budget
- allowed destination/service
- approval threshold
- XMTP/dashboard approval where needed
- final audit and reconciliation

Implementation rules:

- Do not touch or destabilize the PUSD rail first.
- Add Umbra under `src/integrations/umbra/*`.
- Build one focused proof command first: `npm run palmos:umbra-private`.
- Route the private settlement through PalmOS policy before calling Umbra.
- Store Umbra proof fields in the same paid-call/audit model, including settlement rail, privacy path, final transaction, report id, and reconciliation result.

This is now an MVP submission add-on, not a replacement for the Palm USD rail. The priority is:

```text
PUSD agent payments -> backend deployment -> focused Umbra private settlement proof -> submission polish
```

## Product Rules Going Forward

- No hardcoded agents in normal dashboard state.
- No hardcoded payer, merchant, or test wallet addresses in product code or default UI state.
- No default Research Agent / Ops Buyer / Growth Agent product experience.
- No "Reset & Run" as the main interaction.
- No localStorage-only onboarding as the real source of truth.
- No frontend-created illusion of an agent. Backend must create and persist agents.
- Dashboard starts empty for a new workspace until onboarding creates an agent.
- Every dashboard agent must come from a persisted backend record.
- Any sample or service-test code must be behind an explicit development flag and must never look like the normal product.

## Settings And Wallet Model Correction

Latest product decision:

- The Settings page should not be the place where one global "agent wallet address" and one global "merchant wallet address" dominate the UI.
- PalmOS is multi-agent and multi-service. A workspace can have many agents, and every agent can have its own governed wallet identity.
- A workspace can also have many services/vendors, each with its own recipient/merchant wallet.
- Therefore, wallet readiness must be contextual, not global.

Correct product model:

- **Agent wallet readiness belongs on the agent detail page**, or behind a wallet/readiness panel scoped to a selected agent.
  - Show the agent's current payment identity.
  - Show whether that specific agent wallet can pay PUSD.
  - Show SOL/PUSD balances, PUSD ATA, wallet state, trust tier, dead-man status, and readiness checks for that specific agent.
  - If the agent uses OWS, show the OWS-derived Solana address.
  - If the agent uses an imported/runtime wallet, show that agent's configured runtime payer address.
- **Merchant/recipient wallet belongs on service detail**, not global Settings.
  - Each service should show its recipient wallet, token account readiness, price, chain, and vendor scope.
  - If multiple services share a vendor recipient, make that clear in the service detail UI.
- **Settings should serve workspace-level controls**, not pretend there is one wallet for the whole product.

Recommended Settings page purpose:

- Workspace / organization settings.
- Default policy templates for newly created agents.
- Default approval route and XMTP manager inbox.
- Default settlement mode preference where applicable.
- API/base URL configuration for SDK users.
- Danger zone actions such as revoke all credentials, archive workspace, or delete selected agent only if scoped clearly.
- Product/system health summary, with links to agent-specific wallet readiness and service-specific recipient readiness.

Do not implement:

- Do not hardcode the previously funded test wallet into `.env`, backend, frontend, or plan as product behavior.
- Do not make `PUSD_AGENT_WALLET` the global dashboard truth for all agents.
- Do not show one global merchant wallet as if it represents all services.

For local testing only:

- The funded test payer wallet can be used in a development/test workspace, but it should be attached to a specific agent as that agent's wallet backend or runtime wallet configuration.
- The merchant test wallet can be attached to a specific registered service as that service's recipient address.
- If a shortcut is needed, create explicit dev tooling such as "attach funded test wallet to this agent" instead of silently overriding product semantics.

## Current Build Status

As of May 9, 2026, PalmOS is roughly 90-92% solid for the Superteam/Palm USD track.

The product is no longer a thin demo. It now has the core control-plane shape:

- Users can create persisted backend agents instead of relying on seeded dashboard fixtures.
- Agents have policies, governed wallet identity, allowed services, SDK credentials, paid-call history, approval state, and audit events.
- External agents can authenticate with PalmOS credentials and execute governed paid PUSD service calls through the same policy/payment pipeline as dashboard-triggered runs.
- The dashboard has moved from a single-board demo to a multi-page product shell: Dashboard, My Agents, Services, Transactions, Approvals, and Settings.
- Wallet readiness is now scoped correctly: agent payment readiness belongs on agent detail, and service recipient readiness belongs on service detail.

What is already working:

- TypeScript baseline is clean with `npm run check`.
- Frontend lint and production build are clean with `npm run lint` and `npm run build` inside `frontend/`.
- `npm run palmos:wallet` generates Solana wallets for PUSD testing.
- `npm run palmos:worker` runs a backend worker that performs a governed paid PUSD service call for a selected agent.
- Local PalmOS service-test server returns PUSD payment-required instructions.
- Small PUSD calls auto-execute under policy.
- Higher-value PUSD calls enter approval pending and can resume after approval.
- Unknown vendor/destination requests are blocked before payment execution.
- Session budget and max-per-call policies are enforced before vendor payment.
- Paid-call records store PalmOS/PUSD/Solana metadata.
- Settlement records distinguish real Solana signatures from local service-test receipts.
- OWS-backed agent wallets are provisioned and tracked.
- OWS Solana payment execution exists behind `PALMOS_USE_OWS_SOLANA_PAYMENTS=1`.
- Real-payment readiness checks verify payer, recipient, SOL fee balance, PUSD ATA, PUSD balance, official PUSD mint, and Token-2022 program identity.
- Dashboard API exposes worker run/status, service registry, approvals, transactions, agent management, credential management, and scoped PUSD readiness routes.
- Primary CLI paths are PalmOS-first; legacy x402 paths are explicitly quarantined as `x402:*`.
- Intent-aware conversational onboarding works and can collect task, policy, wallet mode, manager route, service access, and credential context.
- Onboarding creates a persisted backend agent instead of only storing browser state.
- Each created agent receives persisted SDK credential records and a one-time `palmos_...` token.
- The dashboard lists backend-persisted agents instead of creating seeded Research/Ops/Growth agents in the normal product path.
- The primary worker run requires a selected/user-created agent.
- Authenticated SDK routes exist:
  - `GET /api/sdk/v1/me`
  - `GET /api/sdk/v1/services`
  - `POST /api/sdk/v1/pay`
- SDK tokens are verified by stored credential hash, not by trusting browser state.
- External SDK payment calls reuse the same policy, session budget, approval, PUSD execution, and audit pipeline as dashboard-triggered calls.
- External agent SDK client exists at `src/sdk/PalmosAgentClient.ts`.
- External agent CLI exists:
  - `npm run agent:external`
  - `npm run palmos:external-agent`
- External agent smoke testing confirmed a separate agent process can authenticate with a `palmos_...` token and execute a governed PUSD paid service call.
- SDK usage documentation exists in `sdk.md`.
- Persisted paid-service registry exists at `src/store/PalmosServiceRegistry.ts`.
- Registered service definitions merge into the runtime PalmOS service catalog.
- Dashboard service routes exist:
  - `GET /api/dashboard/services`
  - `POST /api/dashboard/services`
  - `POST /api/dashboard/agents/:agentId/services/:serviceId/allow`
  - `DELETE /api/dashboard/agents/:agentId/services/:serviceId/allow`
- Custom service smoke testing confirmed: register service -> attach to agent policy -> external agent pays custom service through SDK -> paid call is executed and audited.
- App shell and routing are implemented:
  - persistent sidebar/topbar shell
  - mobile navigation
  - hash-route pages
  - no whole-page horizontal scroll
  - command board horizontal scroll isolated to board lanes
- Command board is now a product overview, not the place where every detail panel lives.
- My Agents page exists with real persisted agents, budget/status cards, and active/archived filtering.
- Agent detail page exists with:
  - run control
  - lifecycle status
  - policy editing
  - wallet identity
  - scoped PUSD readiness
  - SDK credentials
  - allowed service management
  - recent paid calls
  - recent audit events
- Agent lifecycle routes and UI exist:
  - suspend
  - reactivate
  - archive
  - run guard for suspended/archived agents
- Services page exists with registered and built-in services.
- Service detail page exists with endpoint details, settlement/recipient wallet details, scoped service readiness, and agent allowlist controls.
- Transactions page exists as the proof layer with filters, settlement badges, PUSD totals, transaction detail, Solscan links, and local-vs-real settlement clarity.
- Approvals page exists as the operator control layer with pending approvals, approve/deny actions, resolved history, and XMTP visibility.
- Settings page has been corrected to workspace-level controls/system summary instead of pretending there is one global agent wallet and one global merchant wallet.
- SDK credential management UI is implemented:
  - list credentials
  - create labeled credential
  - one-time token reveal
  - active/revoked counts
  - created/last-used timestamps
  - rename credential
  - rotate credential
  - revoke credential
- Dashboard credential management routes exist:
  - `GET /api/dashboard/agents/:agentId/credentials`
  - `POST /api/dashboard/agents/:agentId/credentials`
  - `PATCH /api/dashboard/agent-credentials/:credentialId`
  - `POST /api/dashboard/agent-credentials/:credentialId/rotate`
  - `POST /api/dashboard/agent-credentials/:credentialId/revoke`
- Credential lifecycle smoke testing confirmed: create temp agent -> create key -> rename key -> rotate key -> revoke rotated key -> archive temp agent.
- Browser QA from the agent-management pass confirmed:
  - archived agents are hidden from the normal My Agents list
  - suspended agents cannot run paid calls from the UI
  - policy edits persist and preserve numeric formatting
  - unallowing a service blocks future SDK paid calls
  - blocked SDK calls return `403 ok:false`
  - invalid policy input shows inline errors
- Project logo asset exists in `assets/logo.png` with transparent background.
- Public landing access has been corrected for hackathon submission:
  - public CTAs open a waitlist modal instead of routing directly into the dashboard
  - waitlist submissions now go directly to Formspree at `https://formspree.io/f/xbdwzpao`
  - judge/demo access route exists behind a backend passcode check
  - judge session cookies are signed server-side
  - frontend dashboard API calls include credentials for deployed frontend/backend split
  - cross-site backend cookies can use `SameSite=None; Secure` through `PALMOS_CROSS_SITE_COOKIES=1` or Render mode
- Latest product milestone has been pushed to GitHub:
  - branch: `main`
  - commit: `ff2356e`
  - remote: `https://github.com/Pavilion-devs/palmos.git`
- GitHub-facing cleanup is done for this milestone:
  - internal handoff/proof `.md` files are ignored
  - generated concept images are ignored
  - final transparent logo remains tracked at `assets/logo.png`
- Local stack has been verified on:
  - API: `http://127.0.0.1:4030`
  - Frontend: `http://127.0.0.1:5173/`
  - Workspace: `/tmp/palmos-real-product-test`
- Real PUSD mainnet proof has been verified and documented in `real-pusd-proof.md`:
  - direct smoke transfer: `0.01 PUSD`
  - product-path SDK transfer: `0.005 PUSD`
  - fresh OWS-settled product run: `0.005 PUSD`
  - XMTP-approved fresh OWS-settled product run: `0.005 PUSD`
  - official PUSD mint: `CZzgUBvxaMLwMhVSLgqJn3npmxoTo6nzMNQPAnwtHF3s`
  - payer: `Dc12XGCWDcnxpjDsYuz89vFqYJ4YHxYb3dvGFBC22MdL`
  - merchant: `6FbHwNMMnSZiFtGq7nWJQrv71Bo5NkgC4Maywu7PWBU`
  - readiness check for a new `0.005 PUSD` payment passes against Solana mainnet
  - OWS adapter now signs with OWS and broadcasts/confirms through Solana web3 after the OWS CLI `send-tx` path returned `BlockhashNotFound`
- XMTP live approval proof has been verified on XMTP `dev`:
  - generated a PalmOS XMTP sender identity
  - generated and initialized a manager XMTP inbox
  - sent a standalone PalmOS approval test alert
  - triggered an actual approval-required `live_pusd_agent` paid call
  - confirmed the manager inbox received the approval request
  - approved the pending call and confirmed the manager inbox received the approval resolution

What is not done yet:

- Production hardening for arbitrary registered service endpoints is not complete.
- Service registration needs stronger URL, method, recipient, chain, and SSRF/unsafe-network validation.
- Credential UI is functional, but can still be polished with clearer copyable SDK snippets and better "last used by" context.
- Agent creation/management UI is now functional, but still needs product polish around connecting existing agents, default policy templates, and empty/error states.
- Real production security hardening is not complete:
  - secret handling review
  - credential storage review
  - endpoint abuse controls
  - rate limiting
  - dangerous URL blocking
  - audit/export integrity
- README, setup docs, architecture walkthrough, demo script, and submission assets are not prepared yet.
- Demo video and final Superteam submission answers are not prepared yet.
- Backend deployment is not done yet. Vercel can host the frontend now, but the full private dashboard needs a separate backend URL before judges can use the real app remotely.
- Production deployment envs are not finalized yet, especially persistent backend storage, PUSD/OWS/XMTP secrets, and backend CORS/domain config.
- Umbra private settlement mode is not implemented in PalmOS yet. It is documented in `umbra-migration.md` as an MVP private-settlement proof path that must keep the verified Palm/PUSD core stable.

## Existing Codebase Baseline

The SpendOS codebase is now the base project in this workspace.

Important existing modules:

- `runtime/` - session kernel, intents, policy resolution, approvals, signing, simulation, reconciliation.
- `src/policies/compileAgentPolicy.ts` - agent spend-policy model and decision logic.
- `src/app/requestPaidAction.ts` - policy-gated paid action request flow.
- `src/app/executePaidServiceCall.ts` - paid-service execution lifecycle.
- `src/store/PaidCallRegistry.ts` - paid-call records and persistence.
- `src/server/dashboardApi.ts` - backend API for dashboard, onboarding, worker, approvals, and product agent management.
- `src/integrations/x402/` - current Base/USDC/x402 payment integration.
- `src/integrations/ows/` - OWS integration.
- `src/integrations/xmtp/` - XMTP approval alerts.
- `frontend/` - current dashboard/frontend.

## What We Are Keeping

### Keep The Runtime

The runtime is valuable and should remain the control plane:

- Sessions.
- Runs.
- Intents.
- Policy evaluation.
- Approval states.
- Signature lifecycle.
- Audit-oriented records.

We will adapt labels and asset/chain assumptions instead of replacing the runtime.

### Keep OWS

We are not skipping OWS. The OWS path gives the product a stronger wallet-governance story:

- Agent wallets can be provisioned/scoped.
- Policy registration stays meaningful.
- Spend authority is not an uncontrolled hot wallet.
- The Palm/PUSD pitch becomes more credible for teams and operators.

The OWS integration may need Solana capability checks and naming updates, but the product should continue treating OWS as the governed wallet layer.

### Keep XMTP

We are not skipping XMTP. High-value PUSD spends should still trigger operator approval.

XMTP remains useful for:

- Approval requests.
- Approval resolution notices.
- Demo drama and credibility.
- Showing that agents do not get unlimited autonomous spend.

### Keep The Frontend Foundation

We will use the existing frontend instead of building UI from scratch. UI polish comes later, but the frontend data model and dashboard components should be adapted to:

- PUSD balances.
- Solana addresses.
- Agent worker activity.
- Payment requests.
- PUSD paid-call status.
- Merchant/API revenue.

### Remove Demo Fixtures From The Product Path

The existing seeded scenario machinery is useful only as migration scaffolding while we build the real product lifecycle.

Product behavior must become:

- Empty workspace starts with no agents.
- Onboarding creates the first persisted agent.
- "Create Agent" creates additional persisted agents.
- Dashboard lists only user-created or user-connected agents.
- Worker runs against the selected user agent, not a hardcoded `research_agent`.
- Any sample services or sample calls are optional tools the user can attach, not default fake agents.

Temporary development-only behavior:

- `seedDemo` may stay briefly for regression testing.
- It must be moved behind explicit dev/test commands or flags.
- It must not run automatically in dashboard startup or normal user flows.

## What We Are Changing

### 1. Product Naming And Copy

Change from SpendOS / OWS Hackathon framing to PalmOS / Palm USD framing.

Files likely affected:

- `README.md`
- `package.json`
- `frontend/src/content.js`
- `frontend/src/components/*`
- `src/projections/buildShowcaseSnapshot.ts`
- Demo scripts and CLI names where appropriate.

New language:

- PalmOS.
- Palm USD.
- Solana.
- Agent payment operating system.
- PUSD spend governance.
- Paid API commerce for agents.

### 2. Payment Rail

Current:

- x402.
- USDC.
- Base/Base Sepolia.
- `viem`.
- `x402-fetch`.
- `x402-express`.

Target:

- PUSD.
- Solana.
- SPL token transfers.
- `@solana/web3.js`.
- `@solana/spl-token`.
- PUSD payment-required flow inspired by HTTP 402.

Core replacement:

```text
src/integrations/x402/*
```

becomes either:

```text
src/integrations/pusd/*
```

or:

```text
src/integrations/palmos/*
```

Recommended new modules:

- `src/integrations/pusd/constants.ts`
- `src/integrations/pusd/amount.ts`
- `src/integrations/pusd/paymentInstructions.ts`
- `src/integrations/pusd/client.ts`
- `src/integrations/pusd/verifier.ts`
- `src/integrations/pusd/demoServer.ts` - existing service-test server; rename to `serviceServer.ts`.
- `src/integrations/pusd/serviceCatalog.ts`

Official PUSD Solana mint:

```text
CZzgUBvxaMLwMhVSLgqJn3npmxoTo6nzMNQPAnwtHF3s
```

PUSD decimals:

```text
6
```

### 3. Paid Call Lifecycle

Current paid-call lifecycle is good. We will keep it and generalize it.

Current:

```ts
paymentRail: 'x402'
assetSymbol: 'USDC'
chainId: 'base-sepolia'
```

Target:

```ts
paymentRail: 'palmos'
assetSymbol: 'PUSD'
chainId: 'solana-mainnet' | 'solana-devnet' | 'solana-local'
```

Likely changes:

- `src/store/PaidCallRegistry.ts`
- `src/app/executePaidServiceCall.ts`
- `src/app/requestPaidAction.ts`
- `src/projections/buildShowcaseSnapshot.ts`
- `frontend/src/dashboardSnapshot.js`

### 4. Policy Model

Keep the existing policy model, but tune defaults and labels.

Current policy concepts:

- `allowedChains`
- `allowedAssets`
- `allowedVendors`
- `autoApproveUnder`
- `maxPerTransaction`
- `heartbeatTimeoutSeconds`
- `trustTier`

These map well to PalmOS.

Target defaults:

- Allowed chain: `solana-mainnet` or `solana-devnet`.
- Allowed asset: `PUSD`.
- Allowed vendors: paid API/service endpoints.
- Auto-approve small PUSD calls.
- Escalate larger PUSD calls through XMTP.
- Deny unknown vendors/endpoints.

Important file:

- `src/policies/compileAgentPolicy.ts`

### 5. Real Agent Lifecycle

We must replace seeded/hardcoded agents with a real user agent lifecycle.

Target product flow:

1. User completes conversational onboarding.
2. Backend creates an `AgentRecord`.
3. Backend provisions or links a wallet.
4. Backend stores policy config.
5. Backend issues an agent API key/SDK credential.
6. Dashboard opens to that newly created agent.
7. User can create more agents from the dashboard.
8. External agents call PalmOS with their agent credential.

Required backend endpoints:

```text
POST /api/dashboard/agents
GET /api/dashboard/agents
GET /api/dashboard/agents/:agentId
PATCH /api/dashboard/agents/:agentId/policy
POST /api/dashboard/agents/:agentId/credentials
POST /api/dashboard/agents/:agentId/run
```

Required behavior:

- `POST /api/dashboard/agents` creates an agent from onboarding fields.
- Agent IDs are generated, not assumed.
- Wallet provisioning is tied to the created agent.
- The created agent stores `sessionBudget`, `maxPerTransaction`, `autoApproveUnder`, vendor allowlist, wallet mode, and manager approval route.
- `POST /api/dashboard/agents/:agentId/run` runs against that specific agent.
- No backend route should silently seed sample agents for normal dashboard use.

New/updated files:

- `src/app/createAgentFromOnboarding.ts`
- `src/app/createAgentCredential.ts`
- `src/server/dashboardApi.ts`
- `src/store/AgentRegistry.ts`
- `src/store/AgentCredentialRegistry.ts`
- `frontend/src/components/dashboard/DashboardOnboarding.jsx`
- `frontend/src/components/dashboard/AgentSidebar.jsx`

Acceptance criteria:

- A fresh workspace has zero agents.
- Completing onboarding creates exactly one backend agent.
- Refreshing the page still shows that agent because it is persisted backend state.
- Creating a second agent produces a second backend record.
- Dashboard never relies on three preloaded agents.

### 6. SDK / Bring-Your-Own-Agent Path

PalmOS becomes real when external agents can use it from their own runtime.

Target SDK shape:

```ts
const palmos = new PalmOS({
  agentId: process.env.PALMOS_AGENT_ID,
  apiKey: process.env.PALMOS_AGENT_KEY,
})

const result = await palmos.payFetch("https://vendor.example/research", {
  method: "POST",
  body: JSON.stringify({ query: "BTC liquidity today" }),
})
```

Alternative service call shape:

```ts
await palmos.requestPaidService({
  serviceId: "palm.market.btc_spot",
  input: { base: "BTC", quote: "USD" },
})
```

Required backend/API endpoints:

```text
POST /api/agents/:agentId/paid-fetch
POST /api/agents/:agentId/services/:serviceId/call
GET /api/agents/:agentId/policy
GET /api/agents/:agentId/calls
```

Required SDK package surface:

- `PalmOS`
- `payFetch`
- `requestPaidService`
- `getPolicy`
- `listPaidCalls`

Acceptance criteria:

- A developer can copy an agent ID/API key from the dashboard.
- A simple Node script can call PalmOS as an external agent.
- The external call creates the same paid-call, policy, approval, and audit records as the dashboard worker.

### 7. Product Worker Runner

The worker is no longer the product. It is a sample consumer of PalmOS.

Product worker behavior:

1. Receives a task, such as "produce a market-ops brief."
2. Decides it needs a paid data/API service.
3. Calls the paid service.
4. Uses PalmOS SDK/API with a real agent credential.
5. Receives a PUSD payment-required response.
6. Pays automatically if under policy threshold.
7. Escalates to XMTP if above threshold.
8. Retries the service after payment.
9. Writes final output and audit records.

New/updated files:

- `src/workers/PusdResearchWorker.ts`
- `src/cli/runPusdWorker.ts`
- `src/sdk/*`
- `src/app/executePaidServiceCall.ts`
- `src/server/dashboardApi.ts`

Dashboard should be able to start/observe a worker run for a selected user-created agent, but the bigger product path is SDK/API usage by external agents.

### 8. Paid Service Registry

PalmOS must know what services an agent is allowed to pay.

Target service model:

- `serviceId`
- `name`
- `baseUrl` or `endpointUrl`
- `method`
- `pricePusd`
- `recipientWallet`
- `chainId`
- `description`
- `ownerOrganizationId`
- `status`

Required backend endpoints:

```text
POST /api/dashboard/services
GET /api/dashboard/services
GET /api/dashboard/services/:serviceId
PATCH /api/dashboard/services/:serviceId
POST /api/dashboard/agents/:agentId/services/:serviceId/allow
DELETE /api/dashboard/agents/:agentId/services/:serviceId/allow
```

For the hackathon, we can ship with built-in PalmOS sample services, but they must be services, not fake agents.

Current local service scaffolding:

- Local x402 service-test server protects `/api/premium/spot-price` and `/api/premium/ops-brief`.

Target:

- Local PalmOS service server protects endpoints with PUSD payment instructions.
- Services can be registered/allowlisted for a real user agent.

Recommended endpoints:

```text
GET /api/premium/spot-price
GET /api/premium/ops-brief
POST /api/premium/research-brief
```

Unpaid response:

```json
{
  "error": "payment_required",
  "amount": "0.05",
  "currency": "PUSD",
  "mint": "CZzgUBvxaMLwMhVSLgqJn3npmxoTo6nzMNQPAnwtHF3s",
  "recipient": "MERCHANT_SOLANA_WALLET",
  "reference": "pay_req_...",
  "expiresAt": "..."
}
```

Paid retry should include:

```text
X-PUSD-Payment: <solana_transaction_signature>
```

or a JSON body field:

```json
{
  "paymentSignature": "..."
}
```

### 9. Solana Transaction Verifier

This is the most important new backend logic.

Verifier must check:

- Transaction exists.
- Transaction is confirmed/finalized.
- Token transfer uses the official PUSD mint.
- Amount is correct using 6 decimals.
- Recipient owner/token account matches merchant.
- Request reference/memo matches the payment request.
- Transaction signature has not been reused.

Recommended module:

```text
src/integrations/pusd/verifier.ts
```

Required dependencies:

- `@solana/web3.js`
- `@solana/spl-token`

### 10. Agent Payment Client

Replace the existing x402 client behavior with a PUSD client.

Current:

- `wrapFetchWithPayment`
- EVM wallet client.
- USDC max payment.

Target:

- Agent client detects PUSD payment requirement.
- Policy gate runs before payment.
- OWS or configured Solana signer submits payment.
- Client retries request with Solana signature.

Recommended module:

```text
src/integrations/pusd/client.ts
```

### 11. OWS Solana Path

We need to inspect what OWS supports in this repo and adapt carefully.

Target behavior:

- OWS provisions governed multi-chain agent wallets and remains visible in the agent records.
- If `PALMOS_USE_OWS_SOLANA_PAYMENTS=1`, PalmOS builds an unsigned PUSD SPL transfer and sends it through `ows sign send-tx --chain solana`.
- If the flag is off, local service tests use PalmOS service-test settlement while keeping the same PUSD payment-required interface.
- Do not remove OWS. If necessary, wrap Solana payment execution behind an adapter so OWS can be plugged in cleanly.

Likely files:

- `src/integrations/ows/client.ts`
- `runtime/signing/*`
- `runtime/wallets/*`
- `src/app/executePaidServiceCall.ts`

### 12. Frontend Adaptation

The existing frontend should be retained visually, but the dashboard structure must change to match the real product.

Frontend changes:

- Replace OWS hackathon copy with PalmOS / Palm USD copy.
- Replace USDC/Base labels with PUSD/Solana.
- Replace x402 labels with PalmOS.
- Replace seeded agent registry with user-created agent registry.
- Add empty workspace state.
- Add create/connect agent action.
- Add SDK/API key panel for each agent.
- Add service allowlist management.
- Add worker status only as an optional way to test a selected agent.
- Add PUSD spend and service payment records.
- Add Solana transaction links.
- Add payment-required / paid / approval-pending states.
- Add paid service endpoint view.

Likely files:

- `frontend/src/content.js`
- `frontend/src/dashboardSnapshot.js`
- `frontend/src/components/dashboard/*`
- `frontend/src/App.jsx`
- `frontend/src/index.css`

## Execution Phases

### Phase 0: Repo Conversion

Goal: Make the SpendOS codebase officially become the Palm/PUSD project base.

Tasks:

- Rename project metadata from SpendOS to PalmOS.
- Update README framing.
- Update env names where safe.
- Add Solana/PUSD dependencies.
- Keep existing dashboard/API scripts working.
- Run TypeScript check before major changes.

Acceptance criteria:

- Existing app still starts or typechecks after metadata updates.
- PUSD constants exist.
- Plan and PRD reflect the SpendOS-based approach.

### Phase 1: Generalize Payment Rail Types

Goal: Remove hard assumptions that every paid call is x402/USDC/Base.

Tasks:

- Change paid-call types to support `palmos`.
- Change service catalog types from x402-specific names to paid-service names.
- Introduce generic `PaidServiceDefinition`.
- Keep backward compatibility only where useful during migration.
- Update dashboard snapshot mapping.

Acceptance criteria:

- TypeScript supports PUSD paid calls.
- Existing x402-specific naming is isolated or removed.
- Paid-call records can represent Solana/PUSD transactions.

### Phase 2: Build PUSD Payment Core

Goal: Implement the Solana/PUSD payment rail.

Tasks:

- Add PUSD constants.
- Add decimal parsing/formatting for 6-decimal PUSD.
- Add payment request creation.
- Add payment instruction response builder.
- Add payment request registry if needed.
- Add transaction verifier.
- Add replay protection.
- Add explorer URL helpers.

Acceptance criteria:

- Backend can create a PUSD payment request.
- Backend can verify a matching Solana transaction signature.
- Backend rejects wrong mint, amount, recipient, expired request, and reused signature.

### Phase 3: Replace x402 Demo Server With PalmOS Service Server

Goal: Create a local paid API service protected by PUSD payment requirements.

Tasks:

- Replace `src/integrations/x402/demoServer.ts` with PUSD equivalent, then rename the PalmOS file away from "demo" terminology.
- Keep premium spot-price and ops-brief endpoints.
- Add one worker-friendly paid endpoint.
- Register these endpoints as services that user-created agents can allowlist.
- Return payment-required payload before payment.
- Verify payment on retry.
- Emit records usable by the dashboard.

Acceptance criteria:

- A request without payment receives PUSD instructions.
- A request with valid payment gets the paid response.
- Failed payment attempts produce clear errors.

### Phase 4: Adapt Paid Service Execution

Goal: Make `executePaidServiceCall` run the PUSD payment flow under policy control.

Tasks:

- Replace `X402Client` dependency with `PalmOSClient`.
- Preserve policy checks through `requestPaidAction`.
- Preserve approval-pending flow.
- Preserve XMTP notifications.
- Preserve paid-call status records.
- Store Solana transaction signature on successful execution.

Acceptance criteria:

- Small PUSD call auto-executes under policy.
- High-value PUSD call enters approval pending and sends XMTP alert.
- Unknown vendor is blocked.
- Paid-call registry reflects all outcomes.

### Phase 5: User Agent Lifecycle And Backend Persistence

Goal: Make onboarding create real backend agents instead of localStorage-only setup and seeded records.

Tasks:

- Add backend `POST /api/dashboard/agents`.
- Add backend `GET /api/dashboard/agents`.
- Add backend `GET /api/dashboard/agents/:agentId`.
- Add backend `PATCH /api/dashboard/agents/:agentId/policy`.
- Add backend `POST /api/dashboard/agents/:agentId/credentials`.
- Add persistent `AgentCredentialRegistry`.
- Move onboarding completion from localStorage-only to backend agent creation.
- Store only selected agent/workspace UI state in localStorage.
- Remove automatic `seedDemo` calls from dashboard startup and worker run.
- Make fresh workspace display an empty state.
- Add "Create Agent" flow after first onboarding.
- Generate agent IDs instead of assuming `research_agent`.
- Persist `sessionBudget`, `maxPerTransaction`, `autoApproveUnder`, vendor allowlist, wallet mode, and manager approval route.

Acceptance criteria:

- New workspace starts with no agents.
- Onboarding creates one persisted agent.
- Reloading dashboard preserves the created agent.
- Dashboard can create a second agent.
- Worker/run endpoints operate on selected agent IDs.
- No product route creates Research Agent, Ops Buyer, or Growth Agent automatically.

### Phase 6: SDK And External Agent API

Goal: Let real external agents use PalmOS.

Tasks:

- Add `src/sdk/PalmOS.ts`.
- Add `payFetch` helper.
- Add `requestPaidService` helper.
- Add agent API key validation middleware.
- Add `POST /api/agents/:agentId/services/:serviceId/call`.
- Add `POST /api/agents/:agentId/paid-fetch`.
- Add `GET /api/agents/:agentId/policy`.
- Add `GET /api/agents/:agentId/calls`.
- Add dashboard SDK connection panel.
- Add a copyable `.env`/Node snippet for the selected agent.

Acceptance criteria:

- A developer can create an agent in the dashboard.
- Dashboard shows `PALMOS_AGENT_ID` and masked/revealable API key.
- A Node script outside the dashboard can trigger a governed PUSD paid call.
- The paid call appears in the dashboard audit trail.

### Phase 6.5: Product Worker Runner

Goal: Convert the current worker into a sample consumer of real user-created agents.

Tasks:

- Keep `PusdResearchWorker`, but treat it as a sample agent runner.
- Change worker APIs to require/select a real agent ID.
- Remove fallback to hardcoded `research_agent` in product paths.
- Make sample worker optional, not the core product interface.
- Ensure `POST /api/dashboard/agents/:agentId/run` runs against that selected user-created agent.

Acceptance criteria:

- Worker can complete a paid PUSD service call for a selected user-created agent.
- Worker can trigger approval flow for that selected agent.
- External SDK/API usage can perform the same paid-call flow without using the dashboard worker.

### Phase 7: OWS/XMTP Hardening

Goal: Keep OWS and XMTP as first-class parts of the product.

Tasks:

- Verify OWS payment-chain support assumptions.
- Add Solana chain identifiers to policies.
- Keep OWS wallet/access records in agent snapshots.
- Ensure XMTP approval alerts still fire for PUSD calls.
- Update alert copy from x402/USDC to PUSD/Solana.

Acceptance criteria:

- OWS remains visible in code and dashboard.
- XMTP alert path works for approval-required calls.
- Approval resolution can resume/complete a PUSD paid call.

### Phase 8: Product Dashboard Tailoring

Goal: Adapt the existing frontend to the real PalmOS product model.

Tasks:

- Replace content and labels from SpendOS/USDC/x402/Base to PalmOS/PUSD/Solana.
- Replace seeded agent list with user-created agents.
- Add empty state for no agents.
- Add create/connect agent entry point.
- Add SDK connection panel.
- Add service allowlist panel.
- Update dashboard metrics for PUSD spend, approvals, blocked requests, readiness, and external agent calls.
- Add Solana transaction links for real signatures.
- Add PUSD service payment display.
- Add optional worker status panel powered by selected-agent run APIs.
- Add optional worker run control for selected user-created agent.
- Add PUSD readiness panel powered by `GET /api/dashboard/pusd/readiness`.
- Add service endpoint panel showing PUSD-protected API routes and prices.
- Make approval flow visually obvious: requested, approved/rejected, resumed, completed.
- Update frontend snapshot adapters to prefer PalmOS/PUSD fields and hide legacy x402 language.
- Keep the polished SpendOS UI structure.

Acceptance criteria:

- UI clearly reads as PalmOS.
- Dashboard supports user-owned agents.
- Judges can understand policy, approval, payment, and audit states visually.
- No first-screen copy suggests Base, USDC, x402, or SpendOS as the primary product.
- No normal dashboard state shows hardcoded Research Agent / Ops Buyer / Growth Agent.

### Phase 8.5: Real PUSD And XMTP Test Pass

Goal: Verify the system against real external rails after the frontend is ready enough to present.

Tasks:

- Acquire a small amount of real PUSD on Solana.
- Fund the OWS Solana payer with SOL for fees.
- Run `npm run palmos:readiness`.
- Set `PALMOS_USE_OWS_SOLANA_PAYMENTS=1`.
- Execute one low-value PUSD worker payment on Solana mainnet.
- Verify Solscan transaction, recipient balance delta, memo/reference, and paid-call record.
- Configure `XMTP_WALLET_KEY` and `XMTP_MANAGER_ADDRESS` or manager inbox.
- Trigger one approval-required spend and verify XMTP delivery.
- Approve/reject through dashboard API or CLI and verify the resolution alert.

Acceptance criteria:

- At least one real PUSD transfer is observed and verified.
- Readiness panel correctly changes from failing to ready after funding.
- XMTP sends at least one approval request and one resolution notice.
- The product walkthrough can truthfully say local service-test mode exists, but real settlement path has been tested.

### Phase 8.6: Backend Hardening Before Submission

Goal: Make the backend product path reliable and defensible.

Tasks:

- Next implementation order:
  1. Done: Bind PUSD 402 payment instructions to the approved PalmOS policy before signing or broadcasting. Before `PalmosClient` or the OWS Solana path pays a service, verify the returned payment instruction matches the approved service call: expected amount, allowed recipient wallet, official PUSD mint, and expected Solana network. This preserves the verified real-payment happy path while closing the gap where a registered service could return a different payment instruction after policy approval.
  2. Done: Gate or disable `/api/dashboard/showcase/run` outside an explicit development/showcase flag. The route now requires `PALMOS_ENABLE_SHOWCASE_RUN=1`, so it is not reachable from the judge/product dashboard path by default.
  3. Done: Restrict credentialed CORS to configured frontend origins such as localhost and the deployed judge frontend URL instead of reflecting arbitrary request origins. Backend now uses `PALMOS_ALLOWED_ORIGINS`/frontend-origin envs plus local development defaults.
  4. Done: Harden registered service input for production mode. Registered services now reject obvious localhost/private-network/metadata endpoints unless `PALMOS_ALLOW_UNSAFE_SERVICE_ENDPOINTS=1`, validate Solana recipient addresses, and execute with redirect following disabled.
  5. Done: Stop persisting one-time SDK tokens in browser `localStorage`; reveal them once after creation/rotation and rely on backend hash storage plus credential rotation/revocation.
- Done: Persist readiness reports and surface the latest readiness data in the dashboard snapshot. The readiness endpoint now records completed PUSD readiness checks under the workspace and `buildShowcaseSnapshot` exposes the latest/recent reports without forcing large readiness panels into the main product UI.
- Done: Add Solscan explorer URL construction for real transaction signatures. Paid-call records now persist `transactionExplorerUrl` for non-local Solana signatures, and the dashboard consumes the backend URL when available.
- Done: Add clearer status for local/service-test signatures versus real Solana signatures. The transaction detail view now uses the real explorer URL only for real Solana signatures while keeping local receipts clearly labeled as service-test receipts.
- Done: Add a spend cap guard around real OWS Solana settlement. `PALMOS_REAL_PUSD_MAX_PER_CALL` now guards real PUSD sends in both the OWS path and direct `PalmosClient` path, with `PUSD_MAX_PER_CALL` as a fallback.
- Done: Add better error display for failed payment verification and failed OWS signing. Payment instruction mismatches, real-payment cap failures, and OWS payment failures now get specific backend error codes for the dashboard.
- Done: Make onboarding settlement mode authoritative. Agents now persist `local-demo`, `ows`, or `real-solana`; PUSD execution routes through that selected mode; OWS and direct Solana modes fail explicitly instead of falling back to local service-test settlement.
- Done: Wire funded Solana payer configuration into real rails. OWS-mode onboarding imports `OWS_WALLET_PRIVATE_KEY` as a Solana OWS wallet, direct real-solana settlement can use `PUSD_AGENT_PRIVATE_KEY`/`PUSD_AGENT_KEYPAIR_PATH` or the funded `OWS_WALLET_PRIVATE_KEY` fallback, and readiness/agent CLIs load `.env`.
- Done: Make XMTP startup non-fatal. If the local native XMTP binding is unavailable, the dashboard API starts and disables XMTP notifier instead of blocking payment validation.
- Done: Add focused tests for PUSD amount parsing, payment request creation/policy binding, and readiness failure formatting.
- Decide whether to keep x402 modules in the repo or move them under a clearly labeled legacy folder after migration.

Acceptance criteria:

- Product failures are legible and recoverable.
- Real-payment mode cannot accidentally spend more than configured policy allows.
- Judges can see exactly where local service-test mode ends and real PUSD settlement begins.

### Phase 9: Submission Polish

Goal: Package the project for Frontier/Superteam.

Tasks:

- Update README.
- Add architecture diagram or text walkthrough.
- Record product walkthrough video.
- Prepare pitch deck.
- Prepare Colosseum submission.
- Prepare Superteam submission answers.

Acceptance criteria:

- Product walkthrough shows agent creation, SDK connection, PUSD payment, policy decision, XMTP approval path, and dashboard record.
- README explains setup clearly.
- Pitch ties directly to Palm USD utility.

## Key Files To Change First

Start here:

```text
package.json
.env.example
README.md
src/store/PaidCallRegistry.ts
src/policies/compileAgentPolicy.ts
src/app/requestPaidAction.ts
src/app/executePaidServiceCall.ts
src/integrations/x402/*
src/server/dashboardApi.ts
src/projections/buildShowcaseSnapshot.ts
frontend/src/content.js
frontend/src/dashboardSnapshot.js
```

Add:

```text
src/integrations/pusd/constants.ts
src/integrations/pusd/amount.ts
src/integrations/pusd/paymentInstructions.ts
src/integrations/pusd/verifier.ts
src/integrations/pusd/client.ts
src/integrations/pusd/demoServer.ts
src/integrations/pusd/serviceCatalog.ts
src/app/createAgentFromOnboarding.ts
src/app/createAgentCredential.ts
src/store/AgentCredentialRegistry.ts
src/sdk/PalmOS.ts
src/workers/PusdResearchWorker.ts
src/cli/runPusdWorker.ts
```

Remove or isolate after migration:

```text
src/integrations/x402/*
src/demo/seedDemo.ts
```

Only remove once no live code imports them. `seedDemo` must not be called from normal dashboard/product paths.

## Environment Variables

Current x402 variables should be replaced or deprecated:

```text
X402_BUYER_PRIVATE_KEY
X402_BUYER_RPC_URL
X402_BUYER_CHAIN
X402_MAX_USDC_PER_CALL
X402_DEMO_SERVER_BASE_URL
X402_PAY_TO_ADDRESS
```

New PUSD/Solana variables:

```text
PUSD_SOLANA_RPC_URL=
PUSD_SOLANA_NETWORK=mainnet-beta
PUSD_MINT=CZzgUBvxaMLwMhVSLgqJn3npmxoTo6nzMNQPAnwtHF3s
PUSD_DECIMALS=6
PUSD_AGENT_WALLET=
PUSD_AGENT_KEYPAIR_PATH=
PUSD_AGENT_PRIVATE_KEY=
PUSD_MERCHANT_WALLET=
PUSD_MAX_PER_CALL=0.05
PUSD_READINESS_AMOUNT=0.01
PUSD_DEMO_SERVER_BASE_URL=http://127.0.0.1:4021
PUSD_DEMO_SERVER_PORT=4021
PALMOS_ACCEPT_LOCAL_DEMO_PAYMENTS=1
PALMOS_ALLOW_LOCAL_DEMO_PAYMENTS=1
PALMOS_USE_OWS_SOLANA_PAYMENTS=0
PALMOS_READINESS_OWS_WALLET=<user-created-agent-wallet-name>
PALMOS_AGENT_ID=
PALMOS_AGENT_KEY=
```

`PALMOS_USE_OWS_SOLANA_PAYMENTS` is intentionally off for local service testing until the OWS Solana wallet has real SOL for fees and PUSD for settlement. OWS still provisions and governs the agent wallet by default; this switch only controls whether execution broadcasts a real Solana transfer through `ows sign send-tx`.

`PUSD_DEMO_*` env names are legacy names from the imported codebase. Rename them to `PUSD_SERVICE_TEST_*` after the product agent lifecycle is stable.

Readiness command:

```text
npm run palmos:readiness -- --base-dir /tmp/palmos-live --wallet <agent-wallet-name> --recipient <merchant-wallet> --amount 0.01
```

This checks the payer Solana account, SOL fee balance, PUSD ATA, PUSD balance, recipient wallet, and recipient PUSD ATA before real OWS settlement is enabled.

Keep:

```text
OPENAI_API_KEY
XMTP_*
ZERION_API_KEY
AGENT_SPEND_OS_BASE_DIR
DASHBOARD_API_PORT
```

We may later rename `AGENT_SPEND_OS_BASE_DIR`, but it is not urgent.

Frontend/Vercel variables for the current hackathon landing:

```text
VITE_PALMOS_PUBLIC_ACCESS_MODE=1
VITE_FORMSPREE_WAITLIST_ENDPOINT=https://formspree.io/f/xbdwzpao
```

`VITE_FORMSPREE_WAITLIST_ENDPOINT` is optional because the Formspree URL is currently the frontend default, but setting it in Vercel makes future form changes safer.

Only add this after backend deployment:

```text
VITE_DASHBOARD_API_BASE_URL=https://<palmos-backend-domain>
```

VPS backend variables should follow `docs/deployment.md`. Expected backend envs include:

```text
PALMOS_PUBLIC_ACCESS_MODE=1
PALMOS_CROSS_SITE_COOKIES=1
PALMOS_JUDGE_ACCESS_CODE=<private-judge-code>
AGENT_SPEND_OS_BASE_DIR=/var/data/palmos-live
PUSD_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
OWS_WALLET_PRIVATE_KEY=<funded-solana-private-key>
PUSD_MERCHANT_WALLET=<service-recipient-wallet>
PALMOS_REAL_PUSD_MAX_PER_CALL=0.05
PALMOS_ENABLE_SHOWCASE_RUN=0
PALMOS_ALLOW_UNSAFE_SERVICE_ENDPOINTS=0
PALMOS_ALLOWED_ORIGINS=https://<frontend-domain>
PALMOS_USE_OWS_SOLANA_PAYMENTS=0
PALMOS_ACCEPT_LOCAL_DEMO_PAYMENTS=1
XMTP_ENV=dev
XMTP_WALLET_KEY=<sender-wallet-key>
XMTP_MANAGER_ADDRESS=<manager-evm-address>
XMTP_MANAGER_INBOX_ID=<manager-inbox-id>
ANTHROPIC_API_KEY=<key-if-onboarding-ai-is-enabled>
```

Do not put backend secrets in Vercel frontend env vars.

## Product Walkthrough

### Main Product Flow

1. User opens PalmOS.
2. User completes conversational onboarding.
3. PalmOS creates the user's first backend agent.
4. PalmOS provisions or links the agent wallet.
5. PalmOS stores the agent policy: session budget, max call, auto-approval threshold, vendor/service allowlist, and approval route.
6. PalmOS issues SDK/API credentials.
7. Dashboard opens to the user's created agent, not seeded agents.
8. User copies SDK credentials into their external AI agent runtime.
9. External agent calls a paid PUSD-protected service through PalmOS.
10. PalmOS checks policy.
11. Small payment auto-executes.
12. Larger payment requires approval through dashboard/XMTP.
13. Dashboard shows the paid call, policy decision, transaction signature, approval status, and audit trail.

### Service-Test Flow

If real PUSD liquidity or OWS Solana signing is blocked:

- Use clearly labeled local service-test settlement.
- Keep the same PUSD instruction/verification interfaces intact.
- Keep the same user-created agent/policy/SDK flow.
- Show where real Solana transaction verification plugs in.
- Prefer real Solana verification whenever possible.

## What "Badass Execution" Means Here

Badass does not mean adding every feature. It means the system feels real:

- A real user-created agent has a governed PUSD wallet.
- A real external agent can connect through SDK/API credentials.
- A real worker can exist, but only as one consumer of PalmOS.
- Agent autonomy is constrained by policy.
- PUSD is the actual settlement unit.
- Unknown vendors are denied.
- Session budgets are enforced.
- High-value spends require approval.
- XMTP creates operator visibility.
- Dashboard shows an audit trail.
- The dashboard is user-owned, not seeded with hardcoded agents.
- The codebase has a coherent architecture, not a one-off script.

## Phase Status Snapshot

Current phase status as of May 9, 2026:

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0: Repo Conversion | Done | SpendOS has been converted into PalmOS product framing and Palm/PUSD constants/scripts exist. |
| Phase 1: Generalize Payment Rail Types | Done | Paid-call and snapshot data now support PalmOS/PUSD/Solana semantics. |
| Phase 2: Build PUSD Payment Core | Done for MVP | Local service-test flow, PUSD amount handling, readiness, settlement metadata, and verified real mainnet PUSD proof are working. |
| Phase 3: PalmOS Service Server | Done for local/service-test | PUSD-protected local service flow exists; production endpoint hardening remains. |
| Phase 4: Paid Service Execution | Done | Policy-gated paid execution, approval pending, blocked calls, and audit records are working. |
| Phase 5: User Agent Lifecycle | Done | Persisted backend agents, onboarding creation, policy editing, lifecycle actions, and run guards are in place. |
| Phase 6: SDK And External Agent API | Done | Authenticated SDK routes, SDK client, external agent CLI, and governed SDK payment calls are working. |
| Phase 6.5: Product Worker Runner | Done | Worker now runs against selected user-created agents and is a sample consumer, not the core product model. |
| Phase 7: OWS/XMTP Hardening | Done for MVP | OWS restored the funded wallet, signed live Solana PUSD transfers, and XMTP request/resolution messages were verified on XMTP dev. Production-grade hardening remains. |
| Phase 8: Product Dashboard Tailoring | Mostly done | App shell, agents, services, transactions, approvals, settings correction, and scoped readiness are in place. Remaining work is polish, hardening, and developer handoff snippets. |
| Phase 8.5: Real PUSD And XMTP Test Pass | Done for MVP | Fresh OWS-settled and direct real-solana PUSD payments are verified and documented in `real-pusd-proof.md`. XMTP approval request/resolution has prior proof, but current local native binding is non-fatal and should be fixed separately before relying on live alerts. |
| Phase 8.7: Public Landing And Judge Gate | Done for frontend MVP | Public CTAs open Formspree waitlist, judge access is backend-passcode gated, signed cookies are used, and frontend was pushed for Vercel pickup. Backend deployment remains separate. |
| Phase 8.6: Backend Hardening Before Submission | In progress | Important guards exist; service endpoint hardening, abuse controls, and security review remain. |
| Phase 9: Submission Polish | In progress | Deployment, security, package publishing, XMTP runtime, workspace curation, and submission readiness docs exist. Demo script/video and final submission copy remain. |
| Phase 10: Umbra Private Settlement Mode | MVP add-on planned | Use `umbra-migration.md` as the source of truth. Keep PalmOS as the policy/approval/audit OS, keep the verified PUSD rail stable, and add Umbra as a focused private settlement proof under `src/integrations/umbra/*`. |

## Immediate Next Steps

1. External-agent developer story.
   - Add a public `/docs` experience that shows how to connect an outside agent to PalmOS.
   - Lead with the target package install command, `npm install @palmos/agent`, while keeping the current MVP CLI/API path explicit until the package is published.
   - Point developers to dashboard-issued agent credentials, service IDs, and required environment variables.
   - Show the demo story as an external agent requesting a paid service while PalmOS enforces policy, approvals, PUSD settlement, and audit.

2. Polish the external agent demo path.
   - Done: Make `npm run palmos:external-agent` reliable and demo-friendly with concise human output plus `--json` for coding-agent shells.
   - Done: Add `examples/external-agent-demo.md` with auto-approved, approval-pending, and policy-block demo flows.
   - Done: Add `examples/codex-claude-agent.md` for Codex/Claude-style usage of PalmOS as the governed payment tool.
   - Add copyable `.env` and Node/TypeScript snippets per agent/service pair.
   - Clarify token rotation, revocation, and one-time-token rules.

3. Update README and architecture walkthrough.
   - Done: README frames PalmOS as infrastructure for external agents, not just a dashboard.
   - Done: Architecture walkthrough documents `Agent -> SDK/API -> Policy -> Approval -> PUSD payment -> Audit trail`.
   - Done: Local service-test, OWS, and direct real-solana settlement modes are documented.
   - Keep Umbra as a planned MVP private-settlement add-on, not the core PalmOS/PUSD rail.

4. MCP / coding-agent integration track.
   - Design a future `palmos-mcp` tool surface with `list_services`, `request_paid_service`, `check_policy`, and `get_agent_status`.
   - Keep this behind the main SDK/API path unless time allows a clean MVP.
   - Position it as the way Claude Code, Codex, and other coding agents can ask PalmOS for governed payments.

5. QVAC/Tether external-agent bridge.
   - Done: Add `docs/qvac-tether-integration.md` as the cross-repo contract.
   - Keep the QVAC/Tether app in its own repo and call PalmOS through SDK/API credentials.
   - Use QVAC for local/private reasoning and PalmOS for policy, approval, settlement, and audit.
   - Treat USDT/Tether as an additional future settlement asset beside the proven PUSD/Solana rail.

6. Deploy backend for judge demo access.
   - Done: Add Dockerfile hardening and `render.yaml` with persistent disk defaults.
   - Done: Add `docs/deployment.md`.
   - Set backend env vars for public access, signed judge access, PUSD, OWS, and XMTP.
   - Set `VITE_DASHBOARD_API_BASE_URL` in Vercel after backend URL exists.
   - Smoke test `#judge-access -> #dashboard` from the deployed Vercel URL.

7. Harden service registration.
   - Validate URLs and methods strictly.
   - Block localhost/private-network/unsafe endpoint registration in production mode.
   - Validate Solana recipient addresses and Token-2022/PUSD assumptions.
   - Make service readiness first-class before a service can be used for real settlement.

8. Product/security review pass.
   - Done: Add `docs/security-notes.md` documenting shared demo payer caveat, real-payment guards, and production direction.
   - Review secret handling and credential persistence.
   - Add rate limits or abuse guards around SDK payment endpoints.
   - Confirm suspended/archived/blocked states cannot pay through any path.
   - Confirm real-payment mode cannot spend above policy.
   - Confirm audit records are complete for allowed, blocked, approval-pending, approved, denied, and failed calls.

9. Submission polish.
   - Done: Update README and setup docs.
   - Done: Add architecture walkthrough and submission readiness docs.
   - Prepare demo script.
   - Record product walkthrough video.
   - Prepare Superteam submission copy.

10. MVP add-on: Umbra private settlement proof.
   - Use `umbra-migration.md` as the migration source of truth.
   - Keep the PUSD rail untouched at first.
   - Done: Add `src/integrations/umbra/*`.
   - Done: Build `npm run palmos:umbra-private` as the first proof.
   - Done: Route the Umbra call through PalmOS policy before execution.
   - Done: Store privacy proof fields in the paid-call/audit model.
   - Done: Add read-only dashboard visibility for Umbra settlement rail, privacy path, report id, final transaction, reconciliation, and disclosure posture.
   - Done: Support running `npm run palmos:umbra-private -- --require-existing-agent` against a dashboard-registered agent by attaching the minimum Umbra proof policy to that existing agent identity. Live devnet validation succeeded with `proofSource=existing`, `syntheticProofAgent=false`, `privacyPath=umbra_mixer_utxo`, and `reconciliationStatus=matched`.
   - Done: Add `npm run palmos:private`, `/palmos-private-pay`, and `docs/umbra-private-workflow.md` as the explicit private-settlement workflow for Claude Code/Codex demos.
   - Done: Add read-only agent detail visibility for whether Umbra private settlement policy is attached to a registered external agent.

## Superteam Submission Angle

Project title:

```text
PalmOS
```

Short description:

```text
PalmOS is a Solana-native agent payment operating system. It lets developers connect their own AI agents, give them governed PUSD wallets, pay APIs and services in Palm USD, and enforce budgets, vendor allowlists, approval gates, OWS wallet controls, XMTP alerts, and full audit trails.
```

Why Palm USD:

```text
PUSD is the settlement asset for autonomous API commerce. Every paid request creates PUSD payment instructions, every approved agent spend settles in PUSD on Solana, and every service receipt is verified against the official PUSD SPL mint.
```
