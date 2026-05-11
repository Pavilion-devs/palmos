import { ArrowLeft, ArrowRight, CheckCircle2, Copy } from 'lucide-react'
import { useState } from 'react'

const installCommand = 'npm install @palmos/agent'

const envSnippet = `PALMOS_API_URL=http://127.0.0.1:4030
PALMOS_AGENT_TOKEN=palmos_YOUR_AGENT_TOKEN
PALMOS_SERVICE_ID=local.pusd.spot_price
PALMOS_AGENT_REQUEST_JSON={"base":"BTC","quote":"USD"}`

const currentCliCommand = 'npm run palmos:external-agent'

const nodeSnippet = `import { PalmosAgentClient } from '@palmos/agent'

const palmos = PalmosAgentClient.fromEnv()

const result = await palmos.pay({
  serviceId: process.env.PALMOS_SERVICE_ID,
  request: { base: 'BTC', quote: 'USD' },
})

console.log(result)`

function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!navigator.clipboard) return
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex min-h-9 items-center gap-2 border border-neutral-700 bg-neutral-900 px-3 text-[10px] uppercase tracking-widest text-white transition-colors hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
    >
      <Copy className="h-3 w-3" aria-hidden="true" />
      {copied ? 'Copied' : label}
    </button>
  )
}

function CodeBlock({ value, title }) {
  return (
    <div className="border border-neutral-800 bg-black">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-900 px-4 py-3">
        <span className="text-[10px] uppercase tracking-widest text-neutral-600">
          {title}
        </span>
        <CopyButton value={value} />
      </div>
      <pre className="overflow-x-auto p-4 text-left font-mono text-xs leading-6 text-neutral-300">
        <code>{value}</code>
      </pre>
    </div>
  )
}

function Step({ number, title, children }) {
  return (
    <div className="border border-neutral-800 bg-neutral-950 p-5">
      <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-700">
        {number}
      </div>
      <h2 className="mt-3 text-base font-medium text-white">{title}</h2>
      <div className="mt-3 text-sm leading-6 text-neutral-400">{children}</div>
    </div>
  )
}

function FlowItem({ children }) {
  return (
    <li className="flex items-start gap-3">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-400" aria-hidden="true" />
      <span>{children}</span>
    </li>
  )
}

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-black text-white antialiased">
      <header className="border-b border-neutral-900 px-6 py-5 md:px-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <a
            href="#"
            className="inline-flex items-center gap-2 text-sm text-neutral-400 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            PalmOS
          </a>
          <a
            href="#dashboard"
            className="inline-flex min-h-9 items-center gap-2 border border-neutral-700 bg-neutral-900 px-3 text-[10px] uppercase tracking-widest text-white transition-colors hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
          >
            Open dashboard
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12 md:px-10">
        <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <div className="text-[10px] uppercase tracking-[0.32em] text-neutral-600">
              Developer docs
            </div>
            <h1 className="mt-5 max-w-3xl text-4xl font-medium tracking-tight text-white md:text-6xl">
              Connect an external agent to PalmOS.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-neutral-400">
              PalmOS is the control plane for autonomous payments. Your agent runs
              anywhere, calls PalmOS with its agent credential, and PalmOS handles
              policy checks, approvals, PUSD settlement, and audit records.
            </p>
          </div>

          <div className="border border-neutral-800 bg-neutral-950 p-5">
            <div className="text-[10px] uppercase tracking-widest text-neutral-600">
              Package target
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 border border-neutral-800 bg-black px-4 py-3">
              <code className="min-w-0 overflow-x-auto whitespace-nowrap font-mono text-sm text-white">
                {installCommand}
              </code>
              <CopyButton value={installCommand} label="Copy" />
            </div>
            <p className="mt-4 text-xs leading-5 text-neutral-500">
              The package name is the intended publish target. Until it is published,
              use the repo CLI/API path below for the MVP demo.
            </p>
          </div>
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-3">
          <Step number="01" title="Register external agent">
            Use the PalmOS dashboard to register the agent's payment profile,
            budget, vendor allowlist, and approval threshold.
          </Step>
          <Step number="02" title="Issue credentials">
            Open the agent detail page and create an SDK credential. PalmOS shows
            the token once, then stores only its hash.
          </Step>
          <Step number="03" title="Run outside PalmOS">
            Put the credential in your agent runtime. The agent requests paid
            services through PalmOS instead of holding an unrestricted wallet.
          </Step>
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-2">
          <CodeBlock title="MVP environment" value={envSnippet} />
          <CodeBlock title="Current repo command" value={currentCliCommand} />
        </section>

        <section className="mt-6">
          <CodeBlock title="Node/TypeScript shape" value={nodeSnippet} />
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-2">
          <div className="border border-neutral-800 bg-neutral-950 p-5">
            <h2 className="text-base font-medium text-white">What PalmOS enforces</h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-neutral-400">
              <FlowItem>Agent identity and credential scope.</FlowItem>
              <FlowItem>Session budget and max-per-call limits.</FlowItem>
              <FlowItem>Vendor/service allowlists and recipient wallets.</FlowItem>
              <FlowItem>Approval gates for higher-value payments.</FlowItem>
              <FlowItem>PUSD payment records and dashboard audit trail.</FlowItem>
            </ul>
          </div>

          <div className="border border-neutral-800 bg-neutral-950 p-5">
            <h2 className="text-base font-medium text-white">Coding-agent path</h2>
            <p className="mt-4 text-sm leading-6 text-neutral-400">
              The same SDK/API path can become a tool for Claude Code, Codex, or
              MCP-enabled agents. A coding agent can ask PalmOS to request a
              governed payment, while PalmOS decides whether to auto-approve,
              block, or route it to the operator.
            </p>
            <div className="mt-5 border border-neutral-900 bg-black p-4 font-mono text-xs leading-6 text-neutral-400">
              agent asks: pay service<br />
              PalmOS checks: policy + budget + vendor<br />
              result: paid, pending approval, or blocked
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
