import { readFile } from 'fs/promises'
import {
  Connection,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import type {
  BroadcastRecord,
  ReconciliationReport,
  RunState,
  WalletRecord,
} from '../../../runtime/index.js'
import {
  DefaultSessionKernel,
  DeterministicSignerGateway,
  FileKernelPersistence,
  FileRunRegistry,
  FileSessionRegistry,
  FileWalletRegistry,
} from '../../../runtime/index.js'
import { requestPaidAction } from '../../app/requestPaidAction.js'
import {
  createAgentPolicyCandidateResolver,
  evaluateSpendRequest,
} from '../../policies/compileAgentPolicy.js'
import type { AgentRecord, AgentRegistry } from '../../store/AgentRegistry.js'
import { FileAgentRegistry } from '../../store/AgentRegistry.js'
import type {
  PaidCallRecord,
  PaidCallRegistry,
  UmbraSettlementMetadata,
} from '../../store/PaidCallRegistry.js'
import { FilePaidCallRegistry } from '../../store/PaidCallRegistry.js'
import { toLamports } from './amount.js'
import {
  UMBRA_DEFAULT_PRIVACY_PATH,
  UMBRA_DEFAULT_VENDOR_ID,
  UMBRA_PAYMENT_RAIL,
  UMBRA_PRIVATE_SERVICE_ID,
  defaultUmbraMintAddresses,
  toSolanaChainId,
  type UmbraAssetSymbol,
} from './constants.js'
import { UmbraMixerBroadcaster } from './mixerBroadcaster.js'
import { readUmbraKeypair, type UmbraRuntimeConfig } from './readiness.js'
import { UmbraWalletProvider } from './walletProvider.js'
import { ensureWrappedSol } from './wsol.js'

export type UmbraPrivateSettlementInput = {
  baseDir: string
  agentId: string
  destinationAddress: string
  amount: string
  assetSymbol: UmbraAssetSymbol
  config: UmbraRuntimeConfig
  note?: string
  vendorId?: string
  prefundWrappedSol?: boolean
  requireExistingAgent?: boolean
}

export type UmbraPrivateSettlementResult = {
  ok: boolean
  agent: AgentRecord
  proofAgent: {
    source: 'existing' | 'auto_created'
    synthetic: boolean
  }
  execution: PaidCallRecord
  turnOutput: string[]
  run?: RunState
  error?: string
}

type UmbraBroadcastArtifacts = BroadcastRecord & {
  fundingTransactionSignatures?: string[]
  createUtxoTransactionSignatures?: string[]
  claimTransactionSignatures?: string[]
}

export async function executeUmbraPrivateSettlement(
  input: UmbraPrivateSettlementInput,
): Promise<UmbraPrivateSettlementResult> {
  const now = () => new Date().toISOString()
  const agentRegistry = new FileAgentRegistry(input.baseDir)
  const walletRegistry = new FileWalletRegistry(input.baseDir)
  const paidCallRegistry = new FilePaidCallRegistry(input.baseDir)
  const proofAgent = await ensureUmbraProofAgent({
    input,
    agentRegistry,
    walletRegistry,
    now,
  })
  const agent = proofAgent.agent

  assertUmbraPolicyAllows({
    agent,
    amount: input.amount,
    assetSymbol: input.assetSymbol,
    chainId: toSolanaChainId(input.config.network),
    vendorId: input.vendorId ?? UMBRA_DEFAULT_VENDOR_ID,
    destinationAddress: input.destinationAddress,
  })

  if (input.assetSymbol === 'wSOL' && input.prefundWrappedSol !== false) {
    await prepareWrappedSol(input)
  }

  const umbraWalletProvider = await UmbraWalletProvider.create({
    network: input.config.network,
    rpcUrl: input.config.rpcUrl,
    rpcSubscriptionsUrl: input.config.rpcSubscriptionsUrl,
    indexerApiEndpoint: input.config.indexerApiEndpoint,
    secretKeyBase64: input.config.secretKeyBase64,
    registry: walletRegistry,
    defaultSignerProfileId: 'mpc_default',
  })
  const kernel = new DefaultSessionKernel({
    persistence: new FileKernelPersistence(input.baseDir),
    sessions: new FileSessionRegistry(input.baseDir),
    runs: new FileRunRegistry(input.baseDir),
    walletRegistry,
    walletProvider: umbraWalletProvider,
    signerGateway: new DeterministicSignerGateway('signed'),
    broadcaster: new UmbraMixerBroadcaster({
      walletProvider: umbraWalletProvider,
      network: input.config.network,
      relayerApiEndpoint: input.config.relayerApiEndpoint,
      scanTreeIndex: Number(process.env.UMBRA_MIXER_TREE_INDEX ?? 0),
      scanStartIndex: Number(process.env.UMBRA_MIXER_SCAN_START_INDEX ?? 0),
      scanLimit: Number(process.env.UMBRA_MIXER_SCAN_LIMIT ?? 10_000),
      scanAttempts: Number(process.env.UMBRA_MIXER_SCAN_ATTEMPTS ?? 6),
      scanDelayMs: Number(process.env.UMBRA_MIXER_SCAN_DELAY_MS ?? 5_000),
      fundEncryptedBalance: process.env.UMBRA_MIXER_PREFUND_ETA !== 'false',
      autoClaim: process.env.UMBRA_MIXER_AUTO_CLAIM !== 'false',
      mintAddresses: defaultUmbraMintAddresses(input.config.network),
    }),
    getPolicyCandidates: createAgentPolicyCandidateResolver({
      agentRegistry,
      now,
    }),
    now,
  })

  const executionId = createExecutionId()
  const createdAt = now()
  const submitted = await requestPaidAction(
    {
      kernel,
      agentRegistry,
      now,
    },
    {
      agentId: input.agentId,
      serviceId: UMBRA_PRIVATE_SERVICE_ID,
      amount: input.amount,
      assetSymbol: input.assetSymbol,
      vendorId: input.vendorId ?? UMBRA_DEFAULT_VENDOR_ID,
      destinationAddress: input.destinationAddress,
      chainId: toSolanaChainId(input.config.network),
      note: input.note ?? 'umbra:private-settlement',
    },
  )

  if (submitted.kind === 'blocked') {
    const execution = await persistUmbraExecution({
      paidCallRegistry,
      executionId,
      at: createdAt,
      agent: submitted.agent,
      input,
      proofAgentSource: proofAgent.source,
      status: 'blocked',
      errorCode: 'policy.blocked',
      errorMessage: submitted.reason,
    })
    return {
      ok: false,
      agent: submitted.agent,
      proofAgent: {
        source: proofAgent.source,
        synthetic: proofAgent.source === 'auto_created',
      },
      execution,
      turnOutput: [],
      error: submitted.reason,
    }
  }

  const run = submitted.turn.run
  const artifacts = await readUmbraRunArtifacts(run)
  const reconciliationStatus = mapReconciliationStatus(
    artifacts.reconciliation?.status,
  )
  const finalTransactionSignature =
    artifacts.broadcast?.transactionHash ??
    artifacts.reconciliation?.observedTransactionHash
  const status: PaidCallRecord['status'] =
    run?.status === 'completed' && reconciliationStatus === 'matched'
      ? 'executed'
      : run?.status === 'waiting_for_approval'
        ? 'approval_pending'
        : 'failed'

  const execution = await persistUmbraExecution({
    paidCallRegistry,
    executionId,
    at: createdAt,
    agent: submitted.agent,
    input,
    proofAgentSource: proofAgent.source,
    status,
    run,
    broadcast: artifacts.broadcast,
    reconciliation: artifacts.reconciliation,
    transactionSignature: finalTransactionSignature,
    errorCode: status === 'failed' ? 'umbra.execution_failed' : undefined,
    errorMessage:
      status === 'failed'
        ? submitted.turn.output.at(-1) ?? 'Umbra settlement did not complete.'
        : undefined,
  })

  return {
    ok: status === 'executed',
    agent: submitted.agent,
    proofAgent: {
      source: proofAgent.source,
      synthetic: proofAgent.source === 'auto_created',
    },
    execution,
    turnOutput: submitted.turn.output,
    run,
    error: execution.errorMessage,
  }
}

async function ensureUmbraProofAgent(input: {
  input: UmbraPrivateSettlementInput
  agentRegistry: AgentRegistry
  walletRegistry: FileWalletRegistry
  now: () => string
}): Promise<{
  agent: AgentRecord
  source: 'existing' | 'auto_created'
}> {
  const existing = await input.agentRegistry.get(input.input.agentId)
  if (existing) {
    if (existing.status !== 'ready') {
      throw new Error(
        `Umbra proof requires agent ${existing.agentId} to be ready; current status is ${existing.status}.`,
      )
    }
    return {
      agent: existing,
      source: 'existing',
    }
  }

  if (input.input.requireExistingAgent) {
    throw new Error(
      `Umbra proof agent ${input.input.agentId} does not exist and --require-existing-agent was set.`,
    )
  }

  const at = input.now()
  const chainId = toSolanaChainId(input.input.config.network)
  const signerAddress = readUmbraKeypair(
    input.input.config.secretKeyBase64,
  ).publicKey.toBase58()
  const walletId = `wallet_${input.input.agentId}`
  const wallet: WalletRecord = {
    walletId,
    createdAt: at,
    updatedAt: at,
    state: 'active_full',
    organizationId: 'org_umbra_private',
    treasuryId: 'treasury_umbra_private',
    subjectId: input.input.agentId,
    walletType: 'treasury',
    address: signerAddress,
    supportedChains: [chainId],
    signerProfileId: 'mpc_default',
    providerId: 'umbra_wallet_provider',
    complianceStatus: 'approved',
    policyAttachmentStatus: 'attached',
    signerHealthStatus: 'healthy',
    trustStatus: 'sufficient',
  }
  const agent: AgentRecord = {
    agentId: input.input.agentId,
    createdAt: at,
    updatedAt: at,
    displayName: 'Umbra Private Settlement Agent',
    organizationId: 'org_umbra_private',
    treasuryId: 'treasury_umbra_private',
    environment: 'production',
    actorId: `actor_${input.input.agentId}`,
    sessionId: `session_${input.input.agentId}`,
    walletType: 'treasury',
    walletId,
    walletState: 'active_full',
    signerProfileId: 'mpc_default',
    policyProfileId: `policy_${input.input.agentId}`,
    walletBackend: 'runtime',
    policyConfig: {
      agentId: input.input.agentId,
      organizationId: 'org_umbra_private',
      environment: 'production',
      walletType: 'treasury',
      allowedChains: [chainId],
      allowedAssets: [input.input.assetSymbol],
      allowedSignerClasses: ['mpc'],
      allowedVendors: [
        {
          vendorId: input.input.vendorId ?? UMBRA_DEFAULT_VENDOR_ID,
          label: 'Umbra private settlement recipient',
          destinationAddress: input.input.destinationAddress,
          chainId,
        },
      ],
      autoApproveUnder: process.env.UMBRA_AUTO_APPROVE_UNDER ?? '1',
      maxPerTransaction: process.env.UMBRA_MAX_PER_TRANSACTION ?? '1',
      sessionBudget: process.env.UMBRA_SESSION_BUDGET ?? '1',
      heartbeatTimeoutSeconds: 900,
      requireSanctionsScreening: false,
      umbra: {
        defaultPath: 'anonymous',
        mixerRequired: true,
        viewingKeyRetention: 'on_request',
        disclosureRecipients: [],
      },
    },
    trustTier: 'trusted',
    status: 'ready',
    lastCheckInAt: at,
  }

  await input.walletRegistry.put(wallet)
  await input.agentRegistry.put(agent)
  return {
    agent,
    source: 'auto_created',
  }
}

function assertUmbraPolicyAllows(input: {
  agent: AgentRecord
  amount: string
  assetSymbol: string
  chainId: string
  vendorId: string
  destinationAddress: string
}): void {
  const policy = input.agent.policyConfig
  if (!policy.allowedAssets.includes(input.assetSymbol)) {
    throw new Error(`Policy does not allow Umbra asset ${input.assetSymbol}.`)
  }
  if (!policy.allowedChains.includes(input.chainId)) {
    throw new Error(`Policy does not allow Umbra network ${input.chainId}.`)
  }
  if (policy.umbra?.mixerRequired !== true) {
    throw new Error('Policy must require the Umbra mixer path for this proof.')
  }
  const vendorAllowed = policy.allowedVendors.some(
    (vendor) =>
      vendor.vendorId === input.vendorId &&
      vendor.chainId === input.chainId &&
      vendor.destinationAddress === input.destinationAddress,
  )
  if (!vendorAllowed) {
    throw new Error(`Policy does not allow Umbra vendor ${input.vendorId}.`)
  }

  const spendDecision = evaluateSpendRequest({
    policy,
    amount: input.amount,
    vendorId: input.vendorId,
    trustTier: input.agent.trustTier,
  })
  if (spendDecision.status === 'denied') {
    throw new Error(`Policy denied Umbra settlement: ${spendDecision.reasonCode}.`)
  }
}

async function prepareWrappedSol(input: UmbraPrivateSettlementInput): Promise<void> {
  const keypair = readUmbraKeypair(input.config.secretKeyBase64)
  const connection = new Connection(input.config.rpcUrl, 'confirmed')
  const balance = await connection.getBalance(keypair.publicKey)
  if (balance < 0.03 * LAMPORTS_PER_SOL) {
    throw new Error('Umbra proof wallet needs at least 0.03 devnet SOL.')
  }

  await ensureWrappedSol({
    connection,
    keypair,
    targetLamports: toLamports(input.amount),
  })
}

async function readUmbraRunArtifacts(
  run: RunState | undefined,
): Promise<{
  broadcast?: UmbraBroadcastArtifacts
  reconciliation?: ReconciliationReport
}> {
  if (!run) {
    return {}
  }

  return {
    broadcast: await readJsonArtifact<UmbraBroadcastArtifacts>(
      run.broadcastArtifactPaths.at(-1),
    ),
    reconciliation: await readJsonArtifact<ReconciliationReport>(
      run.reconciliationArtifactPath,
    ),
  }
}

async function readJsonArtifact<T>(path: string | undefined): Promise<T | undefined> {
  if (!path) {
    return undefined
  }

  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function persistUmbraExecution(input: {
  paidCallRegistry: PaidCallRegistry
  executionId: string
  at: string
  agent: AgentRecord
  input: UmbraPrivateSettlementInput
  proofAgentSource: 'existing' | 'auto_created'
  status: PaidCallRecord['status']
  run?: RunState
  broadcast?: UmbraBroadcastArtifacts
  reconciliation?: ReconciliationReport
  transactionSignature?: string
  errorCode?: string
  errorMessage?: string
}): Promise<PaidCallRecord> {
  const mint = defaultUmbraMintAddresses(input.input.config.network)[
    input.input.assetSymbol
  ]
  const umbraSettlement: UmbraSettlementMetadata = {
    settlementRail: 'umbra',
    privacyPath: input.broadcast?.privacyPath ?? UMBRA_DEFAULT_PRIVACY_PATH,
    network: toSolanaChainId(input.input.config.network),
    assetSymbol: input.input.assetSymbol,
    mint,
    amount: input.input.amount,
    finalTransactionSignature: input.transactionSignature,
    fundingTransactionSignatures: input.broadcast?.fundingTransactionSignatures,
    createUtxoTransactionSignatures:
      input.broadcast?.createUtxoTransactionSignatures,
    claimTransactionSignatures: input.broadcast?.claimTransactionSignatures,
    reportId: input.run?.reportRef,
    reconciliationStatus: mapReconciliationStatus(input.reconciliation?.status),
    disclosurePosture: 'artifact_only',
  }
  const record: PaidCallRecord = {
    executionId: input.executionId,
    createdAt: input.at,
    updatedAt: new Date().toISOString(),
    agentId: input.agent.agentId,
    serviceId: UMBRA_PRIVATE_SERVICE_ID,
    vendorId: input.input.vendorId ?? UMBRA_DEFAULT_VENDOR_ID,
    paymentRail: UMBRA_PAYMENT_RAIL,
    settlementMode: 'umbra',
    amount: input.input.amount,
    assetSymbol: input.input.assetSymbol,
    chainId: toSolanaChainId(input.input.config.network),
    transactionSignature: input.transactionSignature,
    transactionExplorerUrl: buildSolanaExplorerUrl(
      input.transactionSignature,
      input.input.config.network,
    ),
    umbraSettlement,
    status: input.status,
    runId: input.run?.runId,
    sessionId: input.run?.sessionId ?? input.agent.sessionId,
    walletId: input.agent.walletId,
    runtimeStatus: input.run?.status,
    runtimePhase: input.run?.currentPhase,
    requestPayload: {
      destinationAddress: input.input.destinationAddress,
      privacyPath: UMBRA_DEFAULT_PRIVACY_PATH,
      note: input.input.note,
      proofAgentSource: input.proofAgentSource,
      syntheticProofAgent: input.proofAgentSource === 'auto_created',
    },
    requestSummary: {
      route: 'PalmOS policy -> Umbra ETA -> Mixer -> ETA',
      proof: 'Umbra private settlement proof runner',
      proofAgentSource: input.proofAgentSource,
      syntheticProofAgent: input.proofAgentSource === 'auto_created',
      privacyPath: UMBRA_DEFAULT_PRIVACY_PATH,
      network: toSolanaChainId(input.input.config.network),
      amount: input.input.amount,
      assetSymbol: input.input.assetSymbol,
      destinationAddress: input.input.destinationAddress,
    },
    responsePreview: {
      broadcast: input.broadcast?.summary,
      reconciliation: input.reconciliation?.summary,
      reportId: input.run?.reportRef,
    },
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  }

  await input.paidCallRegistry.put(record)
  return record
}

function mapReconciliationStatus(
  status: ReconciliationReport['status'] | undefined,
): UmbraSettlementMetadata['reconciliationStatus'] {
  switch (status) {
    case 'matched':
      return 'matched'
    case 'mismatch':
      return 'unmatched'
    case 'failed':
      return 'failed'
    default:
      return 'pending'
  }
}

function buildSolanaExplorerUrl(
  signature: string | undefined,
  network: UmbraPrivateSettlementInput['config']['network'],
): string | undefined {
  if (!signature) {
    return undefined
  }
  const cluster = network === 'devnet' ? '?cluster=devnet' : ''
  return `https://explorer.solana.com/tx/${signature}${cluster}`
}

function createExecutionId(): string {
  return `umbra_call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
