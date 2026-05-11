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
    umbraPolicyAttached: boolean
  }
  execution: PaidCallRecord
  turnOutput: string[]
  run?: RunState
  error?: string
}

export type UmbraApprovalSettlementInput = {
  baseDir: string
  execution: PaidCallRecord
  config: UmbraRuntimeConfig
  prefundWrappedSol?: boolean
  now?: () => string
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

  const umbraWalletProvider = await UmbraWalletProvider.create({
    network: input.config.network,
    rpcUrl: input.config.rpcUrl,
    rpcSubscriptionsUrl: input.config.rpcSubscriptionsUrl,
    indexerApiEndpoint: input.config.indexerApiEndpoint,
    secretKeyBase64: input.config.secretKeyBase64,
    registry: walletRegistry,
    defaultSignerProfileId: 'mpc_default',
  })
  const kernel = createUmbraSettlementKernel({
    baseDir: input.baseDir,
    walletRegistry,
    agentRegistry,
    walletProvider: umbraWalletProvider,
    config: input.config,
    now,
  })

  const executionId = createExecutionId()
  const createdAt = now()
  const spendDecision = evaluateSpendRequest({
    policy: agent.policyConfig,
    amount: input.amount,
    vendorId: input.vendorId ?? UMBRA_DEFAULT_VENDOR_ID,
    trustTier: agent.trustTier,
  })
  if (
    !spendDecision.requiresApproval &&
    input.assetSymbol === 'wSOL' &&
    input.prefundWrappedSol !== false
  ) {
    await prepareWrappedSol({
      amount: input.amount,
      config: input.config,
    })
  }
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
        umbraPolicyAttached: proofAgent.umbraPolicyAttached,
      },
      execution,
      turnOutput: [],
      error: submitted.reason,
    }
  }

  const run = submitted.turn.run
  const artifacts = await readUmbraRunArtifacts(run)
  const finalTransactionSignature =
    artifacts.broadcast?.transactionHash ??
    artifacts.reconciliation?.observedTransactionHash
  const status = deriveUmbraPaidCallStatus(run)

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
    ok:
      status === 'executed' ||
      status === 'approval_pending' ||
      status === 'waiting_for_execution',
    agent: submitted.agent,
    proofAgent: {
      source: proofAgent.source,
      synthetic: proofAgent.source === 'auto_created',
      umbraPolicyAttached: proofAgent.umbraPolicyAttached,
    },
    execution,
    turnOutput: submitted.turn.output,
    run,
    error: execution.errorMessage,
  }
}

export function isUmbraPaidCall(record: PaidCallRecord): boolean {
  return record.paymentRail === UMBRA_PAYMENT_RAIL || Boolean(record.umbraSettlement)
}

export function createUmbraSettlementKernel(input: {
  baseDir: string
  walletRegistry: FileWalletRegistry
  agentRegistry: AgentRegistry
  walletProvider: UmbraWalletProvider
  config: UmbraRuntimeConfig
  now?: () => string
}): DefaultSessionKernel {
  const now = input.now ?? (() => new Date().toISOString())
  return new DefaultSessionKernel({
    persistence: new FileKernelPersistence(input.baseDir),
    sessions: new FileSessionRegistry(input.baseDir),
    runs: new FileRunRegistry(input.baseDir),
    walletRegistry: input.walletRegistry,
    walletProvider: input.walletProvider,
    signerGateway: new DeterministicSignerGateway('signed'),
    broadcaster: new UmbraMixerBroadcaster({
      walletProvider: input.walletProvider,
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
      agentRegistry: input.agentRegistry,
      now,
    }),
    now,
  })
}

export async function createUmbraSettlementKernelFromConfig(input: {
  baseDir: string
  agentRegistry: AgentRegistry
  walletRegistry: FileWalletRegistry
  config: UmbraRuntimeConfig
  now?: () => string
}): Promise<DefaultSessionKernel> {
  const walletProvider = await UmbraWalletProvider.create({
    network: input.config.network,
    rpcUrl: input.config.rpcUrl,
    rpcSubscriptionsUrl: input.config.rpcSubscriptionsUrl,
    indexerApiEndpoint: input.config.indexerApiEndpoint,
    secretKeyBase64: input.config.secretKeyBase64,
    registry: input.walletRegistry,
    defaultSignerProfileId: 'mpc_default',
  })
  return createUmbraSettlementKernel({
    baseDir: input.baseDir,
    walletRegistry: input.walletRegistry,
    agentRegistry: input.agentRegistry,
    walletProvider,
    config: input.config,
    now: input.now,
  })
}

export async function prepareUmbraFundingForApprovedExecution(
  input: UmbraApprovalSettlementInput,
): Promise<void> {
  if (input.prefundWrappedSol === false) {
    return
  }
  if (input.execution.assetSymbol !== 'wSOL') {
    return
  }
  await prepareWrappedSol({
    amount: input.execution.amount,
    config: input.config,
  })
}

export async function updateUmbraExecutionFromRun(input: {
  paidCallRegistry: PaidCallRegistry
  execution: PaidCallRecord
  run: RunState | undefined
  status?: PaidCallRecord['status']
  errorCode?: string
  errorMessage?: string
  now?: () => string
}): Promise<PaidCallRecord> {
  const artifacts = await readUmbraRunArtifacts(input.run)
  const finalTransactionSignature =
    artifacts.broadcast?.transactionHash ??
    artifacts.reconciliation?.observedTransactionHash ??
    input.execution.transactionSignature
  const status = input.status ?? deriveUmbraPaidCallStatus(input.run)
  const existingSettlement = input.execution.umbraSettlement
  const network =
    existingSettlement?.network ?? input.execution.chainId ?? 'solana-devnet'
  const updatedSettlement: UmbraSettlementMetadata = {
    settlementRail: 'umbra',
    privacyPath:
      artifacts.broadcast?.privacyPath ??
      existingSettlement?.privacyPath ??
      UMBRA_DEFAULT_PRIVACY_PATH,
    network,
    assetSymbol: existingSettlement?.assetSymbol ?? input.execution.assetSymbol,
    mint: existingSettlement?.mint ?? '',
    amount: existingSettlement?.amount ?? input.execution.amount,
    finalTransactionSignature,
    fundingTransactionSignatures:
      artifacts.broadcast?.fundingTransactionSignatures ??
      existingSettlement?.fundingTransactionSignatures,
    createUtxoTransactionSignatures:
      artifacts.broadcast?.createUtxoTransactionSignatures ??
      existingSettlement?.createUtxoTransactionSignatures,
    claimTransactionSignatures:
      artifacts.broadcast?.claimTransactionSignatures ??
      existingSettlement?.claimTransactionSignatures,
    reportId: input.run?.reportRef ?? existingSettlement?.reportId,
    reconciliationStatus: mapReconciliationStatus(artifacts.reconciliation?.status),
    disclosurePosture: existingSettlement?.disclosurePosture ?? 'artifact_only',
  }
  const updatedRecord: PaidCallRecord = {
    ...input.execution,
    updatedAt: input.now?.() ?? new Date().toISOString(),
    status,
    runtimeStatus: input.run?.status ?? input.execution.runtimeStatus,
    runtimePhase: input.run?.currentPhase ?? input.execution.runtimePhase,
    runId: input.run?.runId ?? input.execution.runId,
    sessionId: input.run?.sessionId ?? input.execution.sessionId,
    transactionSignature: finalTransactionSignature,
    transactionExplorerUrl: buildSolanaExplorerUrlFromChain(
      finalTransactionSignature,
      network,
    ),
    umbraSettlement: updatedSettlement,
    responsePreview: {
      broadcast: artifacts.broadcast?.summary,
      reconciliation: artifacts.reconciliation?.summary,
      reportId: input.run?.reportRef ?? existingSettlement?.reportId,
    },
    errorCode: input.errorCode,
    errorMessage:
      input.errorMessage ??
      (status === 'failed'
        ? 'Umbra private settlement did not complete.'
        : undefined),
  }

  await input.paidCallRegistry.put(updatedRecord)
  return updatedRecord
}

async function ensureUmbraProofAgent(input: {
  input: UmbraPrivateSettlementInput
  agentRegistry: AgentRegistry
  walletRegistry: FileWalletRegistry
  now: () => string
}): Promise<{
  agent: AgentRecord
  source: 'existing' | 'auto_created'
  umbraPolicyAttached: boolean
}> {
  const existing = await input.agentRegistry.get(input.input.agentId)
  if (existing) {
    if (existing.status !== 'ready') {
      throw new Error(
        `Umbra proof requires agent ${existing.agentId} to be ready; current status is ${existing.status}.`,
      )
    }
    const agent = await attachUmbraPolicyToExistingAgent(input)
    return {
      agent,
      source: 'existing',
      umbraPolicyAttached: true,
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
    umbraPolicyAttached: true,
  }
}

async function attachUmbraPolicyToExistingAgent(input: {
  input: UmbraPrivateSettlementInput
  agentRegistry: AgentRegistry
  walletRegistry: FileWalletRegistry
  now: () => string
}): Promise<AgentRecord> {
  const agent = await input.agentRegistry.get(input.input.agentId)
  if (!agent) {
    throw new Error(`Umbra proof agent ${input.input.agentId} does not exist.`)
  }
  if (!agent.walletId) {
    throw new Error(`Umbra proof requires agent ${agent.agentId} to have a wallet.`)
  }

  const wallet = await input.walletRegistry.get(agent.walletId)
  if (!wallet) {
    throw new Error(`Umbra proof wallet ${agent.walletId} was not found.`)
  }

  const at = input.now()
  const chainId = toSolanaChainId(input.input.config.network)
  const vendorId = input.input.vendorId ?? UMBRA_DEFAULT_VENDOR_ID
  const vendorRule = {
    vendorId,
    label: 'Umbra private settlement recipient',
    destinationAddress: input.input.destinationAddress,
    chainId,
  }
  const allowedVendors = [
    ...agent.policyConfig.allowedVendors.filter(
      (vendor) =>
        !(
          vendor.vendorId === vendorRule.vendorId &&
          vendor.chainId === vendorRule.chainId
        ),
    ),
    vendorRule,
  ]
  const updatedWallet: WalletRecord = {
    ...wallet,
    updatedAt: at,
    supportedChains: uniqueStrings([...(wallet.supportedChains ?? []), chainId]),
    signerProfileId: 'mpc_default',
    complianceStatus: 'approved',
    policyAttachmentStatus: 'attached',
    signerHealthStatus: 'healthy',
    trustStatus: 'sufficient',
  }
  await input.walletRegistry.put(updatedWallet)

  const updatedAgent: AgentRecord = {
    ...agent,
    updatedAt: at,
    walletState: updatedWallet.state,
    signerProfileId: 'mpc_default',
    policyConfig: {
      ...agent.policyConfig,
      allowedChains: uniqueStrings([
        ...agent.policyConfig.allowedChains,
        chainId,
      ]),
      allowedAssets: uniqueStrings([
        ...agent.policyConfig.allowedAssets,
        input.input.assetSymbol,
      ]),
      allowedSignerClasses: uniqueStrings([
        'mpc',
        ...(agent.policyConfig.allowedSignerClasses ?? []),
      ]),
      allowedVendors,
      umbra: agent.policyConfig.umbra ?? {
        defaultPath: 'anonymous',
        mixerRequired: true,
        viewingKeyRetention: 'on_request',
        disclosureRecipients: [],
      },
    },
    lastCheckInAt: at,
  }
  await input.agentRegistry.put(updatedAgent)
  return updatedAgent
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values.filter(Boolean)))
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

async function prepareWrappedSol(input: {
  amount: string
  config: UmbraRuntimeConfig
}): Promise<void> {
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
      umbraPolicyAttached: true,
    },
    requestSummary: {
      route: 'PalmOS policy -> Umbra ETA -> Mixer -> ETA',
      proof: 'Umbra private settlement proof runner',
      proofAgentSource: input.proofAgentSource,
      syntheticProofAgent: input.proofAgentSource === 'auto_created',
      umbraPolicyAttached: true,
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

function deriveUmbraPaidCallStatus(run: RunState | undefined): PaidCallRecord['status'] {
  if (run?.status === 'waiting_for_approval') {
    return 'approval_pending'
  }
  if (run?.status === 'completed') {
    return 'executed'
  }
  if (
    run?.status === 'waiting_for_signature' ||
    run?.status === 'waiting_for_confirmation'
  ) {
    return 'waiting_for_execution'
  }
  return 'failed'
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

function buildSolanaExplorerUrlFromChain(
  signature: string | undefined,
  chainId: string | undefined,
): string | undefined {
  if (!signature) {
    return undefined
  }
  const cluster = chainId === 'solana-devnet' ? '?cluster=devnet' : ''
  return `https://explorer.solana.com/tx/${signature}${cluster}`
}

function createExecutionId(): string {
  return `umbra_call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
