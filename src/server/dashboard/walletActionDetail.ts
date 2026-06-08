import type { WalletRecord } from '../../../runtime/contracts/wallet.js'
import type { ActionRequestRecord } from '../../store/ActionRequestRegistry.js'
import type { AgentRecord } from '../../store/AgentRegistry.js'
import type { AgentSpendWorkspace } from '../../workspace/loadWorkspace.js'
import {
  buildDashboardActionRequestDetail,
  type DashboardActionRequestDetail,
} from './actionRequestDetail.js'
import {
  buildDashboardAgentWalletCycle,
  type DashboardAgentWalletCycle,
} from './agentWalletCycle.js'
import {
  isNativeWalletActionRequest,
  projectWalletAction,
  type DashboardWalletAction,
} from './walletActions.js'

export type DashboardWalletActionWalletSummary = {
  walletId: string
  address?: string
  state?: WalletRecord['state'] | AgentRecord['walletState']
  walletType?: WalletRecord['walletType'] | AgentRecord['walletType']
  backend?: AgentRecord['walletBackend']
  settlementMode?: AgentRecord['settlementMode']
  complianceStatus?: WalletRecord['complianceStatus']
  policyAttachmentStatus?: WalletRecord['policyAttachmentStatus']
  signerHealthStatus?: WalletRecord['signerHealthStatus']
  trustStatus?: WalletRecord['trustStatus']
  supportedChains: string[]
}

export type DashboardWalletActionDetail = {
  projectionMode: 'shadow' | 'transactional_mirror'
  walletAction: DashboardWalletAction
  actionRequest?: DashboardActionRequestDetail
  agent?: DashboardActionRequestDetail['agent']
  wallet?: DashboardWalletActionWalletSummary
  walletCycle?: DashboardAgentWalletCycle
  provenance: {
    nativeActionRequest: boolean
    legacyPaidCallDerived: boolean
    sourceActionRequestId: string
  }
}

function projectWalletSummary(input: {
  record: ActionRequestRecord
  agent?: AgentRecord
  wallet?: WalletRecord
}): DashboardWalletActionWalletSummary | undefined {
  const walletId =
    input.record.walletId ?? input.wallet?.walletId ?? input.agent?.walletId
  if (!walletId) {
    return undefined
  }

  return {
    walletId,
    address: input.wallet?.address,
    state: input.wallet?.state ?? input.agent?.walletState,
    walletType: input.wallet?.walletType ?? input.agent?.walletType,
    backend: input.agent?.walletBackend,
    settlementMode: input.agent?.settlementMode,
    complianceStatus: input.wallet?.complianceStatus,
    policyAttachmentStatus: input.wallet?.policyAttachmentStatus,
    signerHealthStatus: input.wallet?.signerHealthStatus,
    trustStatus: input.wallet?.trustStatus,
    supportedChains: input.wallet?.supportedChains ?? [],
  }
}

export async function buildDashboardWalletActionDetail(input: {
  workspace: AgentSpendWorkspace
  walletActionId: string
}): Promise<DashboardWalletActionDetail | undefined> {
  const registry = input.workspace.actionRequestRegistry
  if (!registry) {
    throw new Error('ActionRequest registry is not available in this workspace.')
  }

  const record = await registry.get(input.walletActionId)
  if (!record || !isNativeWalletActionRequest(record)) {
    // 404 for missing ids and for legacy service.pay rows that are not
    // native wallet actions.
    return undefined
  }

  const [actionRequest, agent, wallet, walletCycle] = await Promise.all([
    buildDashboardActionRequestDetail({
      workspace: input.workspace,
      actionRequestId: record.actionRequestId,
    }),
    input.workspace.agentRegistry.get(record.agentId),
    record.walletId
      ? input.workspace.walletRegistry.get(record.walletId)
      : Promise.resolve(undefined),
    buildDashboardAgentWalletCycle({
      workspace: input.workspace,
      agentId: record.agentId,
    }),
  ])

  const legacyRecordType =
    typeof record.requestContext?.legacyRecordType === 'string'
      ? record.requestContext.legacyRecordType
      : undefined

  return {
    projectionMode:
      input.workspace.storageDriver === 'postgres'
        ? 'transactional_mirror'
        : 'shadow',
    walletAction: projectWalletAction(record),
    actionRequest,
    agent: actionRequest?.agent,
    wallet: projectWalletSummary({ record, agent, wallet }),
    walletCycle,
    provenance: {
      nativeActionRequest: true,
      legacyPaidCallDerived: legacyRecordType === 'PaidCall',
      sourceActionRequestId: record.actionRequestId,
    },
  }
}
