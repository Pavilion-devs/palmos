import type { ShowcaseSnapshot } from '../projections/buildShowcaseSnapshot.js'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatCurrency(value: string | number | undefined): string {
  if (typeof value === 'number') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: value >= 100 ? 0 : 2,
    }).format(value)
  }

  if (typeof value === 'string') {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      return formatCurrency(numeric)
    }
  }

  return 'n/a'
}

function renderTimeline(snapshot: ShowcaseSnapshot): string {
  const timelineItems = snapshot.agents
    .flatMap((agentSnapshot) =>
      agentSnapshot.audit.timeline.slice(-4).map((entry) => ({
        ...entry,
        displayName: agentSnapshot.agent.displayName,
      })),
    )
    .sort((left, right) => left.at.localeCompare(right.at))
    .slice(-12)

  return timelineItems
    .map(
      (entry) => `
        <article class="timeline-entry timeline-${entry.status}">
          <div class="timeline-meta">
            <span>${escapeHtml(entry.displayName)}</span>
            <time>${escapeHtml(entry.at)}</time>
          </div>
          <h4>${escapeHtml(entry.title)}</h4>
          <p>${escapeHtml(entry.detail)}</p>
        </article>
      `,
    )
    .join('')
}

export function renderDashboardHtml(snapshot: ShowcaseSnapshot): string {
  const agentCards = snapshot.agents
    .map((agentSnapshot) => {
      const latestPaidCall = agentSnapshot.paidCalls.at(-1)
      const portfolioNote = agentSnapshot.portfolio
        ? agentSnapshot.portfolio.sync.kind === 'synced'
          ? `<p class="agent-note">Portfolio positions: ${agentSnapshot.portfolio.positions.length}; transactions: ${agentSnapshot.portfolio.transactions.length}</p>`
          : `<p class="agent-note">Portfolio sync: ${escapeHtml(agentSnapshot.portfolio.sync.message)}</p>`
        : '<p class="agent-note">Portfolio enrichment not configured for this export.</p>'
      const owsNote = agentSnapshot.owsAccess
        ? `<p class="agent-note">OWS wallet: ${escapeHtml(agentSnapshot.owsAccess.owsWalletName)} · API key: ${escapeHtml(agentSnapshot.owsAccess.apiKeyId ?? 'n/a')}</p>`
        : '<p class="agent-note">OWS access not attached for this agent.</p>'

      return `
        <section class="agent-card">
          <div class="agent-heading">
            <div>
              <p class="eyebrow">${escapeHtml(agentSnapshot.agent.walletType)} agent</p>
              <h3>${escapeHtml(agentSnapshot.agent.displayName)}</h3>
            </div>
            <span class="status-pill status-${escapeHtml(agentSnapshot.agent.status)}">${escapeHtml(agentSnapshot.agent.status)}</span>
          </div>
          <dl class="agent-grid">
            <div><dt>Wallet State</dt><dd>${escapeHtml(agentSnapshot.agent.walletState ?? 'n/a')}</dd></div>
            <div><dt>Trust Tier</dt><dd>${escapeHtml(agentSnapshot.agent.trustTier)}</dd></div>
            <div><dt>Latest Spend</dt><dd>${formatCurrency(latestPaidCall?.amount)} ${escapeHtml(latestPaidCall?.assetSymbol ?? '')}</dd></div>
            <div><dt>Latest Outcome</dt><dd>${escapeHtml(latestPaidCall?.status ?? 'no paid calls')}</dd></div>
            <div><dt>XMTP Alerts</dt><dd>${agentSnapshot.xmtpAlerts.length}</dd></div>
            <div><dt>Latest XMTP</dt><dd>${escapeHtml(agentSnapshot.xmtpAlerts.at(-1)?.type ?? 'none')}</dd></div>
            <div><dt>Wallet Backend</dt><dd>${escapeHtml(agentSnapshot.agent.walletBackend ?? 'runtime')}</dd></div>
            <div><dt>OWS Wallet</dt><dd>${escapeHtml(agentSnapshot.agent.owsWalletName ?? 'none')}</dd></div>
          </dl>
          ${owsNote}
          ${portfolioNote}
        </section>
      `
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agent SpendOS Showcase</title>
    <style>
      :root {
        --paper: oklch(0.97 0.01 95);
        --ink: oklch(0.22 0.03 240);
        --muted: oklch(0.57 0.02 230);
        --accent: oklch(0.63 0.14 152);
        --warn: oklch(0.74 0.14 72);
        --danger: oklch(0.61 0.17 28);
        --panel: oklch(0.99 0.005 95 / 0.96);
        --line: oklch(0.83 0.02 85);
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, oklch(0.92 0.05 150 / 0.9), transparent 32%),
          linear-gradient(180deg, oklch(0.985 0.01 95), oklch(0.94 0.02 94));
      }

      main {
        width: min(1120px, calc(100vw - 2rem));
        margin: 0 auto;
        padding: 2rem 0 4rem;
      }

      .hero {
        display: grid;
        gap: 1rem;
        padding: 1.5rem;
        border: 1px solid var(--line);
        background: color-mix(in oklab, var(--panel) 86%, white);
        box-shadow: 0 24px 80px oklch(0.23 0.04 240 / 0.08);
      }

      .hero h1 {
        margin: 0;
        font-size: clamp(2.6rem, 7vw, 5rem);
        line-height: 0.94;
        letter-spacing: -0.05em;
      }

      .hero p {
        margin: 0;
        color: var(--muted);
        max-width: 56rem;
        font-size: 1.05rem;
      }

      .summary-grid, .agent-list {
        display: grid;
        gap: 1rem;
      }

      .summary-grid {
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        margin-top: 1.5rem;
      }

      .summary-card, .timeline-shell, .agent-card {
        border: 1px solid var(--line);
        background: color-mix(in oklab, var(--panel) 92%, white);
      }

      .summary-card {
        padding: 1rem;
      }

      .summary-card strong {
        display: block;
        font-size: 2rem;
        line-height: 1;
      }

      .summary-card span {
        color: var(--muted);
        font-size: 0.95rem;
      }

      .section-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 1rem;
        margin: 2rem 0 1rem;
      }

      .section-header h2 {
        margin: 0;
        font-size: 1.5rem;
      }

      .section-header p {
        margin: 0;
        color: var(--muted);
      }

      .timeline-shell {
        padding: 1rem;
      }

      .timeline-entry {
        padding: 0.9rem 0;
        border-top: 1px solid var(--line);
      }

      .timeline-entry:first-child { border-top: 0; padding-top: 0; }
      .timeline-meta {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        color: var(--muted);
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .timeline-entry h4 {
        margin: 0.25rem 0;
        font-size: 1rem;
      }

      .timeline-entry p {
        margin: 0;
        color: var(--muted);
      }

      .agent-list {
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      }

      .agent-card {
        padding: 1rem;
      }

      .agent-heading {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 1rem;
      }

      .eyebrow {
        margin: 0 0 0.25rem;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-size: 0.72rem;
      }

      .agent-heading h3 {
        margin: 0;
        font-size: 1.5rem;
      }

      .status-pill {
        padding: 0.35rem 0.65rem;
        border-radius: 999px;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        background: color-mix(in oklab, var(--accent) 12%, white);
      }

      .status-approval_pending { background: color-mix(in oklab, var(--warn) 18%, white); }
      .status-restricted, .status-stale, .timeline-error { background: color-mix(in oklab, var(--danger) 14%, white); }

      .agent-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.85rem;
        margin: 1rem 0 0;
      }

      .agent-grid dt {
        color: var(--muted);
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .agent-grid dd {
        margin: 0.2rem 0 0;
        font-size: 1rem;
      }

      .agent-note {
        margin: 1rem 0 0;
        color: var(--muted);
        font-size: 0.95rem;
      }

      @media (max-width: 640px) {
        .timeline-meta, .section-header, .agent-heading {
          flex-direction: column;
          align-items: flex-start;
        }
        .agent-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <p class="eyebrow">Agent SpendOS Showcase</p>
        <h1>${escapeHtml(snapshot.headline)}</h1>
        <p>
          Operator-grade spend control for AI agents. This export packages the live runtime artifacts
          into one judge-facing board: real x402 calls, approval pauses, denials, and dead-man’s-switch control.
        </p>
      </section>

      <section class="summary-grid">
        <article class="summary-card"><strong>${snapshot.summary.agentCount}</strong><span>Agents Issued</span></article>
        <article class="summary-card"><strong>${snapshot.summary.executedCalls}</strong><span>Executed Paid Calls</span></article>
        <article class="summary-card"><strong>${snapshot.summary.approvalPendingCalls}</strong><span>Pending Approvals</span></article>
        <article class="summary-card"><strong>${snapshot.summary.blockedOrFailedCalls}</strong><span>Denied or Failed Runs</span></article>
        <article class="summary-card"><strong>${snapshot.summary.staleAgents}</strong><span>Stale or Revoked Agents</span></article>
        <article class="summary-card"><strong>${snapshot.summary.xmtpAlertsSent}</strong><span>XMTP Alerts Sent</span></article>
        <article class="summary-card"><strong>${snapshot.summary.owsBackedAgents}</strong><span>OWS-backed Agents</span></article>
      </section>

      <div class="section-header">
        <h2>Operator Timeline</h2>
        <p>${escapeHtml(snapshot.generatedAt)}</p>
      </div>
      <section class="timeline-shell">
        ${renderTimeline(snapshot)}
      </section>

      <div class="section-header">
        <h2>Agent States</h2>
        <p>Wallet posture, spend outcome, and optional portfolio enrichment.</p>
      </div>
      <section class="agent-list">
        ${agentCards}
      </section>
    </main>
  </body>
</html>`
}
