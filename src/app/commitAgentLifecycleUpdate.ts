import type { WalletRecord } from '../../runtime/contracts/wallet.js'
import type { AgentRecord } from '../store/AgentRegistry.js'
import { readAgentPrivacyMode } from './agentPrivacyMode.js'
import type { AgentSpendWorkspace } from '../workspace/loadWorkspace.js'

export type CommitAgentLifecycleUpdateResult =
  | {
      ok: true
    }
  | {
      ok: false
      code: 'agent_conflict' | 'wallet_conflict'
      currentAgent?: AgentRecord
      currentWallet?: WalletRecord
    }

function toJson(value: unknown): string {
  return JSON.stringify(value)
}

export async function commitAgentLifecycleUpdate(input: {
  workspace: AgentSpendWorkspace
  previousAgent: AgentRecord
  nextAgent: AgentRecord
  previousWallet?: WalletRecord
  nextWallet?: WalletRecord
}): Promise<CommitAgentLifecycleUpdateResult> {
  const pool = input.workspace.postgresPool
  if (!pool) {
    if (input.nextWallet && input.previousWallet) {
      const currentWallet = await input.workspace.walletRegistry.get(
        input.previousWallet.walletId,
      )
      if (currentWallet?.updatedAt !== input.previousWallet.updatedAt) {
        return {
          ok: false,
          code: 'wallet_conflict',
          currentAgent: await input.workspace.agentRegistry.get(
            input.previousAgent.agentId,
          ),
          currentWallet,
        }
      }
    }

    const savedAgent = await input.workspace.agentRegistry.putIfUpdatedAt(
      input.nextAgent,
      input.previousAgent.updatedAt,
    )
    if (!savedAgent) {
      return {
        ok: false,
        code: 'agent_conflict',
        currentAgent: await input.workspace.agentRegistry.get(
          input.previousAgent.agentId,
        ),
      }
    }

    if (input.nextWallet && input.previousWallet) {
      const savedWallet = await input.workspace.walletRegistry.putIfUpdatedAt(
        input.nextWallet,
        input.previousWallet.updatedAt,
      )
      if (!savedWallet) {
        return {
          ok: false,
          code: 'wallet_conflict',
          currentAgent: await input.workspace.agentRegistry.get(
            input.previousAgent.agentId,
          ),
          currentWallet: await input.workspace.walletRegistry.get(
            input.previousWallet.walletId,
          ),
        }
      }
    }

    return { ok: true }
  }

  const client = await pool.connect()
  try {
    await client.query('begin')
    const agentResult = await client.query(
      `update agents set
        actor_id = $2,
        wallet_id = $3,
        status = $4,
        privacy_mode = $5,
        updated_at = $6,
        record = $7::jsonb
      where agent_id = $1 and updated_at = $8::timestamptz`,
      [
        input.nextAgent.agentId,
        input.nextAgent.actorId,
        input.nextAgent.walletId ?? null,
        input.nextAgent.status,
        readAgentPrivacyMode(input.nextAgent.policyConfig),
        input.nextAgent.updatedAt,
        toJson(input.nextAgent),
        input.previousAgent.updatedAt,
      ],
    )
    if (agentResult.rowCount !== 1) {
      await client.query('rollback')
      return {
        ok: false,
        code: 'agent_conflict',
        currentAgent: await input.workspace.agentRegistry.get(
          input.previousAgent.agentId,
        ),
      }
    }

    if (input.nextWallet && input.previousWallet) {
      const walletResult = await client.query(
        `update wallets set
          organization_id = $2,
          treasury_id = $3,
          subject_id = $4,
          address = $5,
          updated_at = $6,
          record = $7::jsonb
        where wallet_id = $1 and updated_at = $8::timestamptz`,
        [
          input.nextWallet.walletId,
          input.nextWallet.organizationId ?? null,
          input.nextWallet.treasuryId ?? null,
          input.nextWallet.subjectId ?? null,
          input.nextWallet.address ?? null,
          input.nextWallet.updatedAt,
          toJson(input.nextWallet),
          input.previousWallet.updatedAt,
        ],
      )
      if (walletResult.rowCount !== 1) {
        await client.query('rollback')
        return {
          ok: false,
          code: 'wallet_conflict',
          currentAgent: await input.workspace.agentRegistry.get(
            input.previousAgent.agentId,
          ),
          currentWallet: await input.workspace.walletRegistry.get(
            input.previousWallet.walletId,
          ),
        }
      }
    }

    await client.query('commit')
    return { ok: true }
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
