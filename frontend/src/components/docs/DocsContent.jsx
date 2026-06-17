import {
  Section,
  SubHeading,
  Callout,
  CodeBlock,
  DocTable,
  Code,
} from './docsPrimitives'

const B = ({ children }) => (
  <strong className="font-medium text-white/90">{children}</strong>
)
const UL = ({ children }) => (
  <ul className="space-y-2 pl-5 list-disc marker:text-lime/40">{children}</ul>
)

const ARCH_DIAGRAM = `  AI agent (e.g. a live Claude session)
        │  tools over HTTP / MCP
        ▼
  PalmOS SDK  →  Policy gate  →  build (Byreal)  →  OWS vault signs  →  settle (Solana)
                     │                                                        │
                     └──────────── every decision + outcome ─────────────────┴──► record (Mantle)`

export default function DocsContent() {
  return (
    <div className="docs-content">
      {/* 1 — Overview */}
      <Section id="overview" eyebrow="Getting started" title="Overview">
        <p>
          <B>Governance for agentic wallets.</B> PalmOS lets an autonomous AI
          agent move real money on-chain — but only within policy, with
          human-in-the-loop approval for larger moves, vault custody the agent
          can&apos;t drain, and an audit trail for every governed decision.
        </p>

        <SubHeading id="the-problem">The problem</SubHeading>
        <p>
          Giving an AI agent a wallet is easy. <i>Trusting what it does with the
          money</i> — and proving it afterward — is the hard part. An autonomous
          agent with real funds is one bad decision away from draining them, and
          today there&apos;s no neutral record of what it did.
        </p>

        <SubHeading id="what-palmos-does">What PalmOS does</SubHeading>
        <p>
          PalmOS is the <B>brakes and the black box</B> for agentic finance:
        </p>
        <UL>
          <li>
            <B>Policy guardrails</B> the agent can&apos;t override — allowed
            assets, per-transaction limits, approval thresholds, vetted pools.
          </li>
          <li>
            <B>Custody the agent never holds</B> — keys live in an OWS vault; the
            agent can only <i>ask</i> PalmOS to act, and PalmOS signs.
          </li>
          <li>
            <B>An on-chain audit trail</B> — live deployments record governed
            decisions and outcomes on Mantle, including <i>denied</i> ones.
          </li>
        </UL>

        <SubHeading id="the-one-liner">The one-liner</SubHeading>
        <Callout title="In one sentence">
          Byreal gives an AI agent hands to trade on Solana; PalmOS gives it
          guardrails; and Mantle keeps the receipts.
        </Callout>
      </Section>

      {/* 2 — Architecture */}
      <Section
        id="architecture"
        eyebrow="Getting started"
        title="Architecture — one OWS vault, two chains"
      >
        <CodeBlock title="request → govern → settle → record" code={ARCH_DIAGRAM} copy={false} />
        <UL>
          <li>
            <B>Solana</B> = execution. Byreal (a CLMM DEX) builds the
            transaction; PalmOS signs and broadcasts it.
          </li>
          <li>
            <B>Mantle</B> = identity + audit. The agent&apos;s{' '}
            <B>ERC-8004 identity</B> and a <B>decision/outcome log</B> live here.
          </li>
          <li>
            <B>One OWS vault</B> signs <i>both</i> chains — its Solana key signs
            Byreal transactions, and its EVM key owns the agent&apos;s Mantle
            identity and signs decision records. The identity, the action, and
            the audit record are controlled by the same vault.
          </li>
        </UL>
        <p>
          The agent holds <B>no keys</B> on either chain. It proposes; PalmOS
          governs and signs.
        </p>
      </Section>

      {/* 3 — Core concepts */}
      <Section id="concepts" eyebrow="Concepts" title="Core concepts">
        <DocTable
          head={['Concept', 'What it is']}
          rows={[
            [
              <B key="t">Agent</B>,
              'An external AI runtime (Claude Code, a worker, etc.) with a treasury mandate and a PalmOS credential. It never holds keys.',
            ],
            [
              <B key="t">Governed action kind</B>,
              <>
                The verbs PalmOS governs: <Code>service.pay</Code>,{' '}
                <Code>asset.transfer</Code>, <Code>asset.swap</Code>,{' '}
                <Code>asset.liquidity</Code>.
              </>,
            ],
            [
              <B key="t">Policy</B>,
              'Per-agent limits the action is evaluated against before anything can settle.',
            ],
            [
              <B key="t">OWS vault</B>,
              'Server-side custody (Open Wallet Standard). Derives a Solana and an EVM address from one seed; signs on request.',
            ],
            [
              <B key="t">Action request</B>,
              <>
                The lifecycle record for one governed action:{' '}
                <Code>{'created → policy_checked → (approved | approval_pending | blocked) → executed | failed'}</Code>
                .
              </>,
            ],
            [
              <B key="t">Decision log</B>,
              <>
                An on-chain (Mantle) <Code>AgentActionLog</Code> event per
                governed decision — including denials.
              </>,
            ],
          ]}
        />
      </Section>

      {/* 4 — Governance flow */}
      <Section id="governance" eyebrow="Concepts" title="The governance flow">
        <p>Every governed action runs the same spine:</p>
        <ol className="space-y-3 pl-5 list-decimal marker:font-mono marker:text-white/30">
          <li>
            <B>Request</B> — the agent calls a tool (e.g.{' '}
            <Code>request_asset_swap</Code>).
          </li>
          <li>
            <B>Policy gate</B> — PalmOS evaluates it:
            <UL>
              <li>
                within the auto-approve threshold → <B>auto-approved</B>, settles
                autonomously;
              </li>
              <li>
                larger but allowed → <B>approval-pending</B>, routed to a human
                operator;
              </li>
              <li>over a limit / off-policy → <B>denied</B>, no funds move.</li>
            </UL>
          </li>
          <li>
            <B>Build</B> — for a swap/LP, Byreal builds the unsigned transaction
            (<Code>--unsigned-tx</Code>); Byreal never sees a key.
          </li>
          <li>
            <B>Sign</B> — the OWS vault adds the owner signature inside custody.
          </li>
          <li>
            <B>Settle</B> — broadcast to Solana mainnet; reconcile the on-chain
            signature.
          </li>
          <li>
            <B>Record</B> — the verdict + outcome (and the Solana settlement
            signature) are written to the Mantle decision log.
          </li>
        </ol>
        <Callout title="Denial is a feature, not an error">
          A <B>denied</B> decision is a first-class artifact: &ldquo;the agent was
          stopped, and you can prove it on-chain.&rdquo;
        </Callout>
      </Section>

      {/* 5 — Byreal integration */}
      <Section
        id="byreal"
        eyebrow="Integrations"
        title="Byreal integration — Solana execution"
      >
        <p>PalmOS wires Byreal Agent Skills in as governed action kinds.</p>

        <SubHeading id="byreal-capabilities">Capabilities</SubHeading>
        <UL>
          <li>
            <B>Spot swaps</B> (AMM) — <Code>asset.swap</Code>.
          </li>
          <li>
            <B>CLMM liquidity</B> — open / increase / decrease / close positions
            — <Code>asset.liquidity</Code>.
          </li>
          <li>
            <B>Read-only</B> quotes, pool discovery, and position listing
            (keyless).
          </li>
        </UL>

        <SubHeading id="byreal-custody">Custody path</SubHeading>
        <p>
          Every write uses{' '}
          <Code>{'byreal-cli … --unsigned-tx --wallet-address <vault pubkey>'}</Code>
          , which returns a base64 Solana <Code>VersionedTransaction</Code>. The
          OWS vault signs it as owner (preserving Byreal&apos;s pre-applied
          position-NFT co-signature on <Code>positions open</Code>) and
          broadcasts it.
        </p>

        <SubHeading id="byreal-tools">Agent tools</SubHeading>
        <DocTable
          head={['Tool', 'Purpose']}
          rows={[
            [<Code key="c">get_byreal_quote</Code>, 'Quote a swap (read-only).'],
            [
              <Code key="c">list_byreal_pools</Code>,
              'Discover Byreal CLMM pools, token mints, live price, and policy allowlist status.',
            ],
            [<Code key="c">request_asset_swap</Code>, 'Governed AMM swap.'],
            [
              <Code key="c">request_liquidity_action</Code>,
              'Governed LP open / increase / decrease / close.',
            ],
            [
              <Code key="c">list_byreal_positions</Code>,
              "List the agent's CLMM positions.",
            ],
          ]}
        />
        <Callout>
          For an LP <Code>open</Code> with auto-swap (zap), supply{' '}
          <Code>amount</Code> + <Code>base</Code> (a pool <B>mint</B>) — not{' '}
          <Code>amountUsd</Code>.
        </Callout>
      </Section>

      {/* 6 — Mantle layer */}
      <Section
        id="mantle"
        eyebrow="Integrations"
        title="Mantle layer — identity + audit"
      >
        <SubHeading id="mantle-identity">ERC-8004 identity</SubHeading>
        <p>
          <Code>IdentityRegistry</Code> mints each agent a soulbound identity NFT
          whose <Code>tokenURI</Code> is its <B>agent card</B> — its
          functionalities, service endpoints, and Solana payment address —
          stored fully on-chain.
        </p>

        <SubHeading id="mantle-log">Decision / outcome log</SubHeading>
        <p>
          <Code>AgentActionLog</Code> emits one indexable{' '}
          <Code>DecisionRecorded</Code> event per governed action: kind, policy{' '}
          <B>verdict</B>, <B>outcome</B>, the Solana settlement signature (the
          cross-chain link), and amount. Denied/blocked actions are recorded too.
        </p>

        <SubHeading id="mantle-vault">Same-vault signing</SubHeading>
        <p>
          Built on <Code>viem</Code>; the OWS vault&apos;s EVM account (secp256k1,
          same seed as the Solana key) deploys, mints, and signs every record. No
          separate key, no separate identity.
        </p>
      </Section>

      {/* 7 — Policy reference */}
      <Section id="policy" eyebrow="Reference" title="Policy reference">
        <p>
          A per-agent policy (<Code>policyConfig</Code>) governs every action:
        </p>
        <DocTable
          head={['Field', 'Meaning']}
          rows={[
            [
              <Code key="c">allowedAssets</Code>,
              <>
                Asset symbols the agent may touch (e.g.{' '}
                <Code>{'["SOL","USDC"]'}</Code>).
              </>,
            ],
            [
              <Code key="c">allowedChains</Code>,
              <>
                Settlement chains (e.g. <Code>{'["solana-mainnet"]'}</Code>).
              </>,
            ],
            [
              <Code key="c">maxPerTransaction</Code>,
              'Hard cap per action; above it → denied.',
            ],
            [
              <Code key="c">autoApproveUnder</Code>,
              'Below this, settles autonomously; above it (but under the cap) → approval-pending.',
            ],
            [
              <Code key="c">allowedPools</Code>,
              <>
                <B>Byreal risk control</B> — a CLMM pool allowlist. A liquidity
                deposit into any other pool is denied (
                <Code>policy.liquidity_pool_not_allowed</Code>).
              </>,
            ],
            [
              <Code key="c">maxSlippageBps</Code>,
              <>
                <B>Byreal risk control</B> — caps the slippage a swap/LP route may
                carry.
              </>,
            ],
            [
              <Code key="c">trustTier</Code>,
              <>
                <Code>{'new | healthy | trusted | restricted'}</Code> — scales the
                effective limit. A policy <B>denial flips an agent to{' '}
                <Code>restricted</Code></B> until an operator clears it.
              </>,
            ],
          ]}
        />
      </Section>

      {/* 8 — Connecting an agent */}
      <Section
        id="connect"
        eyebrow="Reference"
        title="Connecting an agent"
      >
        <p>
          PalmOS is agent-agnostic — the brain stays <i>outside</i> PalmOS (Claude
          Code, a custom worker, Claude on Bedrock). Three ways to bring an agent
          online and reach the governed tools:
        </p>

        <SubHeading id="connect-cli">A. CLI — one command</SubHeading>
        <p>Create an agent in the dashboard, then from any terminal:</p>
        <CodeBlock title="connect" code={`npx @getpalmos/agent connect`} />
        <p>
          Paste the token from the agent&apos;s{' '}
          <B>&ldquo;Bring it online&rdquo;</B> screen. It authenticates against the
          live API, brings the agent online, and lists the governed tools it can
          call — no keys ever touch your machine.
        </p>

        <SubHeading id="connect-http">B. HTTP SDK</SubHeading>
        <p>Mint a credential, then call the API directly:</p>
        <CodeBlock
          title="SDK endpoints — base https://api.getpalmos.xyz"
          code={`GET  /api/sdk/v1/tools            # list governed tools + schemas
POST /api/sdk/v1/tools/:toolName  # invoke one (bearer-authenticated)`}
        />

        <SubHeading id="connect-mcp">C. MCP — for Claude Code / MCP clients</SubHeading>
        <p>
          The published <Code>@getpalmos/mcp</Code> server exposes the governed
          Byreal tools to any MCP client. Add it in one command:
        </p>
        <CodeBlock
          title="Claude Code"
          code={`claude mcp add palmos --env PALMOS_AGENT_TOKEN=palmos_... -- npx -y @getpalmos/mcp`}
        />
        <p>
          Or drop it into <Code>.mcp.json</Code> (set <Code>PALMOS_API_URL</Code>{' '}
          to point at a self-hosted backend):
        </p>
        <CodeBlock
          title=".mcp.json"
          code={`{
  "mcpServers": {
    "palmos": {
      "command": "npx",
      "args": ["-y", "@getpalmos/mcp"],
      "env": { "PALMOS_AGENT_TOKEN": "palmos_..." }
    }
  }
}`}
        />
        <p>PalmOS governs every call the agent makes.</p>
      </Section>

      {/* 9 — Running PalmOS */}
      <Section id="running" eyebrow="Reference" title="Running PalmOS">
        <p>
          <B>Entry point:</B>{' '}
          <Code>{'npm start → node --import tsx src/server/dashboardApi.ts'}</Code>{' '}
          (Node 22+).
        </p>
        <SubHeading id="running-env">Key environment flags</SubHeading>
        <DocTable
          head={['Var', 'Effect']}
          rows={[
            [
              <Code key="c">AGENT_SPEND_OS_BASE_DIR</Code>,
              <>
                Workspace + vault path. <B>Set this to a persistent path</B> — it
                defaults to <Code>/tmp/palmos-live</Code>, which the OS can wipe.
              </>,
            ],
            [
              <Code key="c">BYREAL_SETTLE_LIVE</Code>,
              <>
                <Code>1</Code> = broadcast real Solana settlement. Default off →
                sign-only (nothing spends).
              </>,
            ],
            [
              <Code key="c">MANTLE_RECORD_LIVE</Code>,
              <>
                <Code>1</Code> = write decisions to Mantle (costs test MNT gas).
                Default off → simulate.
              </>,
            ],
            [
              <Code key="c">START_LOCAL_PUSD_SERVER</Code>,
              <>
                <Code>0</Code> in production (the local demo PUSD server starts by
                default otherwise).
              </>,
            ],
            [
              <Code key="c">PALMOS_DISABLE_DASHBOARD_AUTH</Code>,
              'Operator-auth posture for a public server (with PALMOS_PUBLIC_ACCESS_MODE).',
            ],
          ]}
        />
        <Callout variant="warn" title="Live flags are server-side only">
          The two <Code>*_LIVE</Code> flags are <B>server-side</B> — an agent
          cannot flip them, so a tool call can never accidentally spend.
        </Callout>
      </Section>

      {/* 10 — Custody & security */}
      <Section id="custody" eyebrow="Security" title="Custody & security">
        <UL>
          <li>
            <B>The agent never holds keys.</B> Keys live in the OWS vault; the
            agent can only request actions. This is the core safety property —
            the agent <i>can&apos;t</i> drain a wallet it has no keys to.
          </li>
          <li>
            <B>Server-side custody.</B> The OWS vault is the trust anchor. For
            production it must live on a persistent, encrypted, backed-up path
            (never <Code>/tmp</Code>), and operators should expose a
            recovery/export path for the wallet&apos;s seed so funds are never
            stranded if the host is lost.
          </li>
          <li>
            <B>Gated settlement.</B> Live Solana settlement and live Mantle writes
            are off by default and only enabled by the operator.
          </li>
        </UL>
      </Section>

      {/* 11 — Verifiability */}
      <Section id="verifiability" eyebrow="Security" title="Verifiability">
        <p>Every &ldquo;it works&rdquo; claim carries a clickable on-chain proof:</p>
        <UL>
          <li>
            <B>Solana</B> settlements on Solscan.
          </li>
          <li>
            <B>Mantle</B> identity + decision records on Mantlescan; both
            contracts have <B>verified source</B>.
          </li>
          <li>The same OWS vault is provably the actor on both chains.</li>
        </UL>
        <p>
          See <Code>SUBMISSION.md</Code> for the live proof appendix (addresses,
          txns, the denied record).
        </p>
      </Section>
    </div>
  )
}
