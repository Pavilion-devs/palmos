/**
 * Mint a fresh palmos_ SDK credential (bearer token) for an agent in a file-backed workspace,
 * so an external agent process can call the PalmOS SDK over HTTP (/api/sdk/v1/...).
 *
 * The stored credential only keeps a sha256 hash, so the plaintext token is printed ONCE here.
 *
 *   PALMOS_BASE_DIR=/tmp/palmos-live node --import tsx scripts/mint-agent-token.ts [agentId]
 *
 * With no agentId it picks the funded agent (one with a walletId), else the first agent.
 */
import { FileAgentRegistry } from '../src/store/AgentRegistry.js'
import { FileAgentCredentialRegistry } from '../src/store/AgentCredentialRegistry.js'
import { createAgentCredential } from '../src/app/createAgentCredential.js'

const baseDir = process.env.PALMOS_BASE_DIR ?? '/tmp/palmos-live'

async function main() {
  const agents = new FileAgentRegistry(baseDir)
  const credentials = new FileAgentCredentialRegistry(baseDir)

  const all = await agents.list()
  const wantedId = process.argv[2]
  const agent = wantedId
    ? all.find((a) => a.agentId === wantedId)
    : (all.find((a) => a.walletId) ?? all[0])
  if (!agent) {
    throw new Error(
      wantedId
        ? `No agent ${wantedId} in ${baseDir}`
        : `No agent found in ${baseDir}`,
    )
  }

  const { credential, token } = await createAgentCredential(
    { credentials },
    { agentId: agent.agentId, label: 'Byreal autonomy agent key' },
  )

  console.log(`agent      : ${agent.displayName} (${agent.agentId})`)
  console.log(`wallet     : ${agent.walletId ?? '(none)'}`)
  console.log(`credential : ${credential.credentialId}`)
  console.log(`status     : ${agent.status}`)
  console.log(`\nPALMOS_AGENT_TOKEN=${token}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
