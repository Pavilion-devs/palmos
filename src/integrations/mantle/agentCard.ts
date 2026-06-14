/**
 * ERC-8004 agent card for a PalmOS agent. The card is the tokenURI of the identity NFT — it
 * declares who the agent is and what it can do: name, functionalities (its governed Byreal skills),
 * service endpoints (the published @getpalmos packages), and its payment address (the OWS Solana
 * wallet that actually settles). Stored fully on-chain as a base64 data: URI (no hosting needed).
 */
export type AgentCardInput = {
  name: string
  description?: string
  /** The agent's OWS Solana wallet — where it receives/settles (mainnet-beta). */
  solanaPaymentAddress: string
  /** The OWS EVM address that owns this identity (same vault as the Solana key). */
  evmIdentityAddress?: string
  identityRegistry?: string
  chainId?: number
}

export type AgentCard = ReturnType<typeof buildAgentCard>

export function buildAgentCard(input: AgentCardInput) {
  return {
    schemaVersion: '0.1',
    type: 'ERC-8004 AgentCard',
    name: input.name,
    description:
      input.description ??
      'PalmOS governed agentic wallet — Byreal DeFi execution on Solana under PalmOS policy ' +
        'guardrails: budget limits, human-in-the-loop approval, and an on-chain decision log.',
    functionalities: [
      { id: 'asset.swap', name: 'Token swap', protocol: 'byreal', chain: 'solana' },
      { id: 'asset.liquidity.open', name: 'Open LP position', protocol: 'byreal', chain: 'solana' },
      { id: 'asset.liquidity.increase', name: 'Increase LP position', protocol: 'byreal', chain: 'solana' },
      { id: 'asset.liquidity.decrease', name: 'Decrease LP position', protocol: 'byreal', chain: 'solana' },
      { id: 'asset.liquidity.close', name: 'Close LP position', protocol: 'byreal', chain: 'solana' },
    ],
    serviceEndpoints: [
      { type: 'mcp', name: 'PalmOS MCP', uri: 'npm:@getpalmos/mcp' },
      { type: 'agent', name: 'PalmOS Agent', uri: 'npm:@getpalmos/agent' },
    ],
    paymentAddresses: [
      { chain: 'solana', network: 'mainnet-beta', address: input.solanaPaymentAddress },
    ],
    governance: {
      framework: 'PalmOS',
      model:
        'policy-bounded autonomy + human-in-the-loop approval + on-chain decision log (Mantle)',
    },
    identity: input.evmIdentityAddress
      ? {
          chain: 'mantle-sepolia',
          chainId: input.chainId ?? 5003,
          owner: input.evmIdentityAddress,
          registry: input.identityRegistry,
        }
      : undefined,
  }
}

export function agentCardToDataUri(card: unknown): string {
  const json = JSON.stringify(card)
  const base64 = Buffer.from(json, 'utf8').toString('base64')
  return `data:application/json;base64,${base64}`
}

/** Parse a data:application/json[;base64] URI back into an object (for the dashboard). */
export function parseAgentCardDataUri(uri: string): unknown | undefined {
  const match = /^data:application\/json(;base64)?,(.*)$/s.exec(uri)
  const payload = match?.[2]
  if (payload == null) return undefined
  try {
    const raw = match![1] ? Buffer.from(payload, 'base64').toString('utf8') : decodeURIComponent(payload)
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}
