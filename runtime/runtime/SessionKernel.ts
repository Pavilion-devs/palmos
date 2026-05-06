import { createHash } from 'crypto'
import type { RuntimeActor, SignerClass } from '../contracts/common.js'
import type { ApprovalEngine } from '../contracts/approval.js'
import type { ApprovalRecord, ApprovalState } from '../contracts/approval.js'
import type { Broadcaster, BroadcastRecord } from '../contracts/broadcast.js'
import type { IntentActionType, IntentObject } from '../contracts/intent.js'
import type { ArtifactRef, LedgerRefs } from '../contracts/ledger.js'
import type { PolicyProfile } from '../contracts/policy.js'
import type { PolicyResolver, ResolvedPolicyProfile } from '../contracts/policyResolution.js'
import type { ReconciliationReport, Reconciler } from '../contracts/reconciliation.js'
import type { RunCloseoutReport, TransferCloseoutReport } from '../contracts/report.js'
import type { SignerProfile } from '../contracts/signerProfile.js'
import type {
  SignatureRequest,
  SignatureResult,
  SignerGateway,
} from '../contracts/signing.js'
import type { SimulationEngine } from '../contracts/simulation.js'
import type { SimulationRecord } from '../contracts/simulation.js'
import type {
  ResolvedTransferSourceWallet,
  WalletRecord,
  WalletProvider,
} from '../contracts/wallet.js'
import type {
  KernelBootstrapInput,
  KernelCallbackEvent,
  KernelInput,
  KernelInputKind,
  KernelTurnResult,
  RunState,
  SessionKernel,
  SessionState,
  TranscriptEntry,
} from '../contracts/runtime.js'
import { classifyKernelInput, detectRequestedActionType } from './inputClassifier.js'
import {
  FileKernelPersistence,
  InMemoryKernelPersistence,
  type KernelPersistence,
} from './kernelPersistence.js'
import {
  assertPhaseTransition,
  type PhaseTransitionContext,
} from './phaseGuards.js'
import { InMemoryRunRegistry, type RunRegistry } from './runRegistry.js'
import {
  defaultIdGenerator,
  defaultNow,
  type SessionKernelDependencies,
} from './types.js'
import {
  InMemorySessionRegistry,
  type SessionRegistry,
} from './sessionRegistry.js'
import { RestrictivePolicyResolver } from '../policy/RestrictivePolicyResolver.js'
import { DeterministicApprovalEngine } from '../approval/DeterministicApprovalEngine.js'
import { DeterministicSimulationEngine } from '../simulation/DeterministicSimulationEngine.js'
import { DeterministicBroadcaster } from '../broadcast/DeterministicBroadcaster.js'
import { DeterministicReconciler } from '../reconciliation/DeterministicReconciler.js'
import { DeterministicSignerGateway } from '../signing/DeterministicSignerGateway.js'
import {
  createDefaultSignerProfiles,
  SignerProfileRegistry,
} from '../signing/SignerProfileRegistry.js'
import { PersistentSignerProfileRegistry } from '../signing/PersistentSignerProfileRegistry.js'
import { buildTransferSignatureRequest } from '../signing/buildTransferSignatureRequest.js'
import { buildTransferIntent } from '../transfers/TransferIntentBuilder.js'
import { createTransferMaterialHash } from '../transfers/materialHash.js'
import { parseTransferRequest } from '../transfers/parseTransferRequest.js'
import { validateTransferIntent } from '../transfers/validateTransferIntent.js'
import { DeterministicWalletProvider } from '../wallets/DeterministicWalletProvider.js'
import { buildWalletCreateIntent } from '../wallets/WalletCreateIntentBuilder.js'
import { parseWalletCreateRequest } from '../wallets/parseWalletCreateRequest.js'
import { validateWalletCreateIntent } from '../wallets/validateWalletCreateIntent.js'
import {
  FileWalletRegistry,
  InMemoryWalletRegistry,
  type WalletRegistry,
} from '../wallets/WalletRegistry.js'
import { readFile } from 'fs/promises'

type ResolvedDependencies = {
  sessions: SessionRegistry
  runs: RunRegistry
  persistence: KernelPersistence
  policyResolver: PolicyResolver
  approvalEngine: ApprovalEngine
  simulationEngine: SimulationEngine
  signerGateway: SignerGateway
  signerProfiles: SignerProfileRegistry
  walletRegistry: WalletRegistry
  walletProvider: WalletProvider
  broadcaster: Broadcaster
  reconciler: Reconciler
  getPolicyCandidates: (input: {
    session: SessionState
    run: RunState
    kernelInput: KernelInput
  }) => Promise<PolicyProfile[]>
  now: () => string
  createId: (prefix: string) => string
}

export class DefaultSessionKernel implements SessionKernel {
  private readonly deps: ResolvedDependencies

  constructor(dependencies: SessionKernelDependencies = {}) {
    const now = dependencies.now ?? defaultNow
    const createId = dependencies.createId ?? defaultIdGenerator
    const persistence =
      dependencies.persistence ?? new InMemoryKernelPersistence()
    const signerProfiles =
      dependencies.signerProfiles ??
      (persistence instanceof FileKernelPersistence
        ? new PersistentSignerProfileRegistry({
            baseDir: persistence.baseDir,
            seedProfiles: createDefaultSignerProfiles(),
          })
        : new SignerProfileRegistry(createDefaultSignerProfiles()))
    const walletRegistry =
      dependencies.walletRegistry ??
      (persistence instanceof FileKernelPersistence
        ? new FileWalletRegistry(persistence.baseDir)
        : new InMemoryWalletRegistry())

    this.deps = {
      sessions: dependencies.sessions ?? new InMemorySessionRegistry(),
      runs: dependencies.runs ?? new InMemoryRunRegistry(),
      persistence,
      policyResolver:
        dependencies.policyResolver ??
        new RestrictivePolicyResolver({
          now,
        }),
      approvalEngine:
        dependencies.approvalEngine ??
        new DeterministicApprovalEngine({
          now,
          createId,
        }),
      simulationEngine:
        dependencies.simulationEngine ??
        new DeterministicSimulationEngine({
          now,
          createId,
        }),
      signerGateway:
        dependencies.signerGateway ?? new DeterministicSignerGateway('pending'),
      signerProfiles,
      walletRegistry,
      walletProvider:
        dependencies.walletProvider ??
        new DeterministicWalletProvider({
          now,
          registry: walletRegistry,
        }),
      broadcaster:
        dependencies.broadcaster ??
        new DeterministicBroadcaster({
          now,
          createId,
        }),
      reconciler:
        dependencies.reconciler ??
        new DeterministicReconciler({
          now,
          createId,
        }),
      getPolicyCandidates: dependencies.getPolicyCandidates ?? (async () => []),
      now,
      createId,
    }
  }

  async loadOrCreateSession(
    input: KernelBootstrapInput,
  ): Promise<SessionState> {
    if (input.sessionId) {
      const existing = await this.deps.sessions.get(input.sessionId)
      if (existing) {
        return this.normalizeSession(existing)
      }
    }

    const createdAt = this.deps.now()
    const sessionId = input.sessionId ?? this.deps.createId('session')
    const session: SessionState = {
      sessionId,
      createdAt,
      updatedAt: createdAt,
      mode: input.mode,
      environment: input.environment,
      orgContext: input.orgContext,
      actorContext: input.actorContext,
      runIds: [],
      pendingApprovalRunIds: [],
      pendingSignatureRunIds: [],
      pendingConfirmationRunIds: [],
      halted: false,
      transcriptRef: input.transcriptRef ?? `session:${sessionId}:transcript`,
    }

    await this.deps.sessions.put(session)
    await this.appendTranscript({
      entryId: this.deps.createId('entry'),
      at: createdAt,
      sessionId,
      role: 'system',
      content: `Session ${sessionId} created in ${input.mode} mode.`,
    })

    return session
  }

  async handleInput(input: KernelInput): Promise<KernelTurnResult> {
    const session = await this.requireSession(input.sessionId)
    const kind = classifyKernelInput(input)
    const receivedAt = input.receivedAt ?? this.deps.now()

    await this.appendTranscript({
      entryId: this.deps.createId('entry'),
      at: receivedAt,
      sessionId: session.sessionId,
      runId: input.runId,
      role: 'operator',
      content: input.text ?? `[${kind}]`,
    })

    switch (kind) {
      case 'action_request':
        return this.handleActionRequest(session, input, kind, receivedAt)
      case 'resume_signal':
        return this.handleResumeSignal(session, input, kind)
      case 'status_query':
        return this.handleStatusQuery(session, input, kind)
      case 'operator_command':
        return this.handleOperatorCommand(session, input, kind)
      case 'callback_event':
        if (input.payload?.callbackEvent) {
          await this.ingestCallback(
            input.payload.callbackEvent as KernelCallbackEvent,
          )
        }
        return this.finalizeTurn(session, kind, ['Processed callback event.'])
      case 'conversational':
      default:
        return this.finalizeTurn(session, kind, [
          'Input captured without creating a run.',
        ])
    }
  }

  async resumeRun(runId: string): Promise<RunState> {
    const run = await this.requireRun(runId)
    const session = await this.requireSession(run.sessionId)
    const updatedSession = {
      ...session,
      activeRunId: run.runId,
      updatedAt: this.deps.now(),
    }
    await this.deps.sessions.put(updatedSession)
    return run
  }

  async ingestCallback(event: KernelCallbackEvent): Promise<void> {
    const run = await this.requireRun(event.runId)
    const session = await this.requireSession(run.sessionId)
    const at = event.receivedAt ?? this.deps.now()

    await this.appendLedgerEvent({
      eventType: 'run.callback_received',
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: run.currentPhase,
      actor: {
        actorType: 'system',
        actorId: 'session-kernel',
      },
      refs: this.getRunRefs(run),
      summary: `Received ${event.type} callback for run ${run.runId}.`,
      payload: event as unknown as Record<string, unknown>,
    })

    let updatedRun: RunState = run
    let eventType = 'run.callback_received'
    let summary = event.summary ?? `Callback processed for run ${run.runId}.`
    let artifactRefs: ArtifactRef[] | undefined

    if (event.type === 'approval_decision') {
      eventType =
        event.status === 'approved' ? 'approval.granted' : 'approval.rejected'
      summary =
        event.summary ??
        `Approval callback marked run ${run.runId} as ${event.status}.`

      const approvalUpdatedRun = await this.persistApprovalDecisionForRun(
        run,
        event.status,
        event.approvalStateRef,
        event.approvalRecord,
        at,
      )

      updatedRun = approvalUpdatedRun.run
      artifactRefs = [approvalUpdatedRun.artifact]

      if (approvalUpdatedRun.approvalState.status === 'approved') {
        eventType = 'approval.granted'
        summary =
          event.summary ??
          `Approval state ${approvalUpdatedRun.approvalState.approvalStateId} is now approved.`
        updatedRun = (
          await this.beginSigningForRun(session, approvalUpdatedRun.run, at)
        ).run
      } else if (approvalUpdatedRun.approvalState.status === 'pending') {
        eventType = 'approval.recorded'
        summary =
          event.summary ??
          `Approval recorded for state ${approvalUpdatedRun.approvalState.approvalStateId}; more approvals are still required.`
      } else {
        eventType =
          approvalUpdatedRun.approvalState.status === 'rejected'
            ? 'approval.rejected'
            : 'approval.invalidated'
        summary =
          event.summary ??
          `Approval state ${approvalUpdatedRun.approvalState.approvalStateId} is now ${approvalUpdatedRun.approvalState.status}.`
        updatedRun = await this.transitionRunPhase(approvalUpdatedRun.run, 'failed', {
          at,
          actor: {
            actorType: 'system',
            actorId: 'session-kernel',
          },
          reason: 'Approval callback rejected, expired, or invalidated the run.',
          status: 'failed',
          context: {},
        })
      }
    }

    if (event.type === 'signature_status') {
      eventType = `signature.request_${event.status}`
      summary =
        event.summary ??
        `Signature status for run ${run.runId} is now ${event.status}.`

      const callbackSignatureResult = await this.persistSignatureResultForRun(
        updatedRun,
        {
          status: event.status,
          signatureRequestId: event.signatureRequestId,
          signerProfileId: 'callback_signer',
          transactionHash: event.transactionHash,
        },
        at,
      )
      updatedRun = callbackSignatureResult.run
      artifactRefs = [callbackSignatureResult.artifact]

      if (event.status === 'signed') {
        updatedRun = (
          await this.continueTransferAfterSignedResult(
            session,
            callbackSignatureResult.run,
            callbackSignatureResult.signatureResult,
            at,
          )
        ).run
      } else if (event.status === 'pending') {
        updatedRun = {
          ...updatedRun,
          status: 'waiting_for_signature',
          currentPhase: 'signing',
          lastUpdatedAt: at,
        }
      } else {
        updatedRun = await this.transitionRunPhase(updatedRun, 'failed', {
          at,
          actor: {
            actorType: 'system',
            actorId: 'session-kernel',
          },
          reason: 'Signature request failed or was rejected.',
          status: 'failed',
          context: {},
        })
      }
    }

    if (event.type === 'broadcast_confirmation') {
      eventType =
        event.status === 'confirmed'
          ? 'broadcast.confirmed'
          : 'broadcast.failed'
      summary =
        event.summary ??
        `Broadcast for run ${run.runId} ${event.status === 'confirmed' ? 'confirmed' : 'failed'}.`

      const callbackBroadcastRun = await this.persistBroadcastForRun(
        updatedRun,
        {
          broadcastId: event.broadcastRef,
          runId: updatedRun.runId,
          submittedAt: at,
          status: event.status === 'confirmed' ? 'confirmed' : 'failed',
          transactionHash: event.transactionHash,
          network: 'callback_network',
          signatureRequestId:
            updatedRun.signatureRequestRefs.at(-1) ?? 'unknown_signature_request',
          summary:
            event.status === 'confirmed'
              ? 'Broadcast callback confirmed the transaction.'
              : 'Broadcast callback reported a failed transaction.',
        },
        at,
      )
      updatedRun = callbackBroadcastRun.run
      artifactRefs = [callbackBroadcastRun.artifact]

      if (event.status === 'confirmed') {
        updatedRun = (
          await this.continueTransferAfterBroadcast(
            session,
            callbackBroadcastRun.run,
            callbackBroadcastRun.broadcast,
            at,
          )
        ).run
      } else {
        updatedRun = await this.transitionRunPhase(updatedRun, 'failed', {
          at,
          actor: {
            actorType: 'system',
            actorId: 'session-kernel',
          },
          reason: 'Broadcast failed.',
          status: 'failed',
          context: {},
        })
      }
    }

    await this.deps.runs.put(updatedRun)
    await this.syncSessionIndexes(session.sessionId)
    await this.appendLedgerEvent({
      eventType,
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: updatedRun.currentPhase,
      actor: {
        actorType: 'system',
        actorId: 'session-kernel',
      },
      refs: this.getRunRefs(updatedRun),
      summary,
      payload: event as unknown as Record<string, unknown>,
      artifactRefs,
    })
  }

  async haltRun(runId: string, reason: string): Promise<void> {
    const run = await this.requireRun(runId)
    const updatedRun = await this.transitionRunPhase(run, 'halted', {
      at: this.deps.now(),
      actor: {
        actorType: 'system',
        actorId: 'session-kernel',
      },
      reason,
      status: 'halted',
      context: {
        emergencyHaltActive: true,
      },
    })

    await this.syncSessionIndexes(run.sessionId)
    await this.appendLedgerEvent({
      eventType: 'run.halted',
      at: updatedRun.lastUpdatedAt,
      runId,
      sessionId: run.sessionId,
      phase: 'halted',
      actor: {
        actorType: 'system',
        actorId: 'session-kernel',
      },
      refs: this.getRunRefs(updatedRun),
      summary: `Run ${runId} halted.`,
      payload: { reason },
    })
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.deps.persistence.closeSession(sessionId)
    await this.deps.sessions.remove(sessionId)
  }

  private async handleActionRequest(
    session: SessionState,
    input: KernelInput,
    kind: KernelInputKind,
    at: string,
  ): Promise<KernelTurnResult> {
    const actionType =
      input.requestedActionType ?? detectRequestedActionType(input.text) ?? 'unknown'
    const runId = this.deps.createId('run')
    const run: RunState = {
      runId,
      sessionId: session.sessionId,
      actionType,
      status: 'active',
      currentPhase: 'session_setup',
      simulationRefs: [],
      signatureRequestRefs: [],
      signatureResultRefs: [],
      broadcastRefs: [],
      simulationArtifactPaths: [],
      signatureRequestArtifactPaths: [],
      signatureResultArtifactPaths: [],
      broadcastArtifactPaths: [],
      lastUpdatedAt: at,
    }

    await this.deps.runs.put(run)
    await this.appendLedgerEvent({
      eventType: 'run.created',
      at,
      runId,
      sessionId: session.sessionId,
      phase: 'session_setup',
      actor: this.getSessionActor(session),
      refs: this.getRunRefs(run),
      summary: `Run ${runId} created for ${actionType}.`,
      payload: {
        actionType,
        source: input.source,
        inputText: input.text,
      },
    })

    const updatedRun = await this.transitionRunPhase(run, 'intent_capture', {
      at,
      actor: this.getSessionActor(session),
      reason: 'Run created from action request.',
      status: 'active',
      context: {
        activeRunContext: true,
        actorIdentityResolved: true,
      },
    })

    if (actionType === 'asset.transfer') {
      const transferResult = await this.advanceTransferRun(
        session,
        input,
        updatedRun,
        at,
      )

      await this.syncSessionIndexes(session.sessionId, runId)
      const refreshedSession = await this.requireSession(session.sessionId)

      return this.finalizeTurn(
        refreshedSession,
        kind,
        [`Created run ${runId} for ${actionType}.`, ...transferResult.output],
        transferResult.run,
        true,
      )
    }

    if (actionType === 'wallet.create') {
      const walletCreateResult = await this.advanceWalletCreateRun(
        session,
        input,
        updatedRun,
        at,
      )

      await this.syncSessionIndexes(session.sessionId, runId)
      const refreshedSession = await this.requireSession(session.sessionId)

      return this.finalizeTurn(
        refreshedSession,
        kind,
        [`Created run ${runId} for ${actionType}.`, ...walletCreateResult.output],
        walletCreateResult.run,
        true,
      )
    }

    await this.syncSessionIndexes(session.sessionId, runId)
    const refreshedSession = await this.requireSession(session.sessionId)

    return this.finalizeTurn(refreshedSession, kind, [
      `Created run ${runId} for ${actionType}.`,
      'Run is now in intent_capture.',
    ], updatedRun, true)
  }

  private async handleResumeSignal(
    session: SessionState,
    input: KernelInput,
    kind: KernelInputKind,
  ): Promise<KernelTurnResult> {
    if (!input.runId) {
      return this.finalizeTurn(session, kind, [
        'Resume requested without a run id.',
      ])
    }

    let run = await this.resumeRun(input.runId)
    const output = [`Resumed run ${run.runId} at phase ${run.currentPhase}.`]

    if (
      run.actionType === 'asset.transfer' &&
      run.currentPhase === 'signing' &&
      run.status === 'waiting_for_signature'
    ) {
      const pollResult = await this.pollTransferSignatureStatus(
        session,
        run,
        this.deps.now(),
      )
      run = pollResult.run
      output.push(...pollResult.output)
    }

    if (
      run.actionType === 'asset.transfer' &&
      run.currentPhase === 'broadcast' &&
      run.status === 'waiting_for_confirmation'
    ) {
      const pollResult = await this.pollTransferBroadcastStatus(
        session,
        run,
        this.deps.now(),
      )
      run = pollResult.run
      output.push(...pollResult.output)
    }

    await this.syncSessionIndexes(session.sessionId, run.runId)
    const refreshedSession = await this.requireSession(session.sessionId)

    return this.finalizeTurn(refreshedSession, kind, output, run)
  }

  private async handleStatusQuery(
    session: SessionState,
    input: KernelInput,
    kind: KernelInputKind,
  ): Promise<KernelTurnResult> {
    if (input.runId) {
      const run = await this.deps.runs.get(input.runId)
      if (run) {
        return this.finalizeTurn(session, kind, [
          `Run ${run.runId} is ${run.status} in ${run.currentPhase}.`,
        ], run)
      }
    }

    const runs = await this.deps.runs.listBySession(session.sessionId)
    return this.finalizeTurn(session, kind, [
      `Session has ${runs.length} run(s).`,
      `Pending approvals: ${session.pendingApprovalRunIds.length}.`,
      `Pending signatures: ${session.pendingSignatureRunIds.length}.`,
      `Pending confirmations: ${session.pendingConfirmationRunIds.length}.`,
    ])
  }

  private async handleOperatorCommand(
    session: SessionState,
    input: KernelInput,
    kind: KernelInputKind,
  ): Promise<KernelTurnResult> {
    const text = input.text ?? ''

    if (/show pending approvals/i.test(text)) {
      return this.finalizeTurn(session, kind, [
        `Pending approval runs: ${session.pendingApprovalRunIds.join(', ') || 'none'}.`,
      ])
    }

    if (/show pending confirmations/i.test(text)) {
      return this.finalizeTurn(session, kind, [
        `Pending confirmation runs: ${session.pendingConfirmationRunIds.join(', ') || 'none'}.`,
      ])
    }

    if (/close session/i.test(text)) {
      await this.closeSession(session.sessionId)
      return {
        kind,
        createdRun: false,
        session,
        output: [`Closed session ${session.sessionId}.`],
      }
    }

    return this.finalizeTurn(session, kind, [
      'Command acknowledged. No runtime mutation performed.',
    ])
  }

  private async finalizeTurn(
    session: SessionState,
    kind: KernelInputKind,
    output: string[],
    run?: RunState,
    createdRun = false,
  ): Promise<KernelTurnResult> {
    const updatedSession: SessionState = {
      ...session,
      updatedAt: this.deps.now(),
    }
    await this.deps.sessions.put(updatedSession)
    await this.deps.persistence.flushCritical(updatedSession.sessionId, run?.runId)

    return {
      kind,
      createdRun,
      session: updatedSession,
      run,
      output,
    }
  }

  private async appendTranscript(entry: TranscriptEntry): Promise<void> {
    await this.deps.persistence.transcript.append(entry)
  }

  private async readArtifactJson<T>(path?: string): Promise<T | undefined> {
    if (!path) {
      return undefined
    }

    const contents = await readFile(path, 'utf8')
    return JSON.parse(contents) as T
  }

  private async transitionRunPhase(
    run: RunState,
    to: RunState['currentPhase'],
    input: {
      at: string
      actor: RuntimeActor
      reason: string
      status?: RunState['status']
      context: PhaseTransitionContext
      payload?: Record<string, unknown>
    },
  ): Promise<RunState> {
    assertPhaseTransition(run.currentPhase, to, input.context)

    const updatedRun: RunState = {
      ...run,
      currentPhase: to,
      status: input.status ?? run.status,
      lastUpdatedAt: input.at,
    }

    await this.deps.runs.put(updatedRun)
    await this.appendLedgerEvent({
      eventType: 'run.phase_transitioned',
      at: input.at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: updatedRun.currentPhase,
      actor: input.actor,
      refs: this.getRunRefs(updatedRun),
      summary: `Run moved from ${run.currentPhase} to ${to}.`,
      payload: {
        from: run.currentPhase,
        to,
        reason: input.reason,
        ...input.payload,
      },
    })

    return updatedRun
  }

  private async appendLedgerEvent(event: {
    eventType: string
    at: string
    runId: string
    sessionId: string
    phase: RunState['currentPhase']
    actor: RuntimeActor
    refs: LedgerRefs
    summary: string
    payload: Record<string, unknown>
    artifactRefs?: ArtifactRef[]
  }): Promise<void> {
    await this.deps.persistence.ledger.append({
      eventId: this.deps.createId('event'),
      eventType: event.eventType,
      at: event.at,
      sessionId: event.sessionId,
      runId: event.runId,
      phase: event.phase,
      actor: event.actor,
      refs: event.refs,
      summary: event.summary,
      payload: event.payload,
      artifactRefs: event.artifactRefs,
    })
  }

  private getRunRefs(run: RunState): LedgerRefs {
    return {
      intentRef: run.intentRef,
      approvalRefs: run.approvalStateRef ? [run.approvalStateRef] : undefined,
      simulationRefs: run.simulationRefs,
      signatureRequestRef: run.signatureRequestRefs.at(-1),
      broadcastRef: run.broadcastRefs.at(-1),
    }
  }

  private getSessionActor(session: SessionState): RuntimeActor {
    return {
      actorType: 'human',
      actorId: session.actorContext.actorId,
    }
  }

  private normalizeSession(session: SessionState): SessionState {
    return {
      ...session,
      runIds: session.runIds ?? [],
      pendingApprovalRunIds: session.pendingApprovalRunIds ?? [],
      pendingSignatureRunIds: session.pendingSignatureRunIds ?? [],
      pendingConfirmationRunIds: session.pendingConfirmationRunIds ?? [],
    }
  }

  private async requireSession(sessionId: string): Promise<SessionState> {
    const session = await this.deps.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`)
    }
    return this.normalizeSession(session)
  }

  private async requireRun(runId: string): Promise<RunState> {
    const run = await this.deps.runs.get(runId)
    if (!run) {
      throw new Error(`Unknown run: ${runId}`)
    }
    return run
  }

  private async syncSessionIndexes(
    sessionId: string,
    activeRunId?: string,
  ): Promise<void> {
    const session = await this.requireSession(sessionId)
    const runs = await this.deps.runs.listBySession(sessionId)
    const updatedSession: SessionState = {
      ...session,
      updatedAt: this.deps.now(),
      activeRunId: activeRunId ?? session.activeRunId,
      runIds: runs.map((run) => run.runId),
      pendingApprovalRunIds: runs
        .filter((run) => run.status === 'waiting_for_approval')
        .map((run) => run.runId),
      pendingSignatureRunIds: runs
        .filter((run) => run.status === 'waiting_for_signature')
        .map((run) => run.runId),
      pendingConfirmationRunIds: runs
        .filter((run) => run.status === 'waiting_for_confirmation')
        .map((run) => run.runId),
    }
    await this.deps.sessions.put(updatedSession)
  }

  private async advanceTransferRun(
    session: SessionState,
    input: KernelInput,
    run: RunState,
    at: string,
  ): Promise<{ run: RunState; output: string[] }> {
    const parsed = parseTransferRequest({
      text: input.text,
      payload: input.payload,
    })

    if (!parsed.ok) {
      const failedRun = await this.transitionRunPhase(run, 'failed', {
        at,
        actor: this.getSessionActor(session),
        reason: parsed.error,
        status: 'failed',
        context: {},
        payload: {
          step: 'intent_capture',
          error: parsed.error,
        },
      })

      return {
        run: failedRun,
        output: [parsed.error],
      }
    }

    const normalizedPayload = {
      ...parsed.payload,
      sourceWalletId:
        parsed.payload.sourceWalletId ?? session.orgContext.walletIds?.[0],
    }

    const intentId = this.deps.createId('intent')
    const intent = buildTransferIntent({
      intentId,
      createdAt: at,
      actor: {
        actorType: 'human',
        actorId: session.actorContext.actorId,
        sessionId: session.sessionId,
      },
      environment: session.environment,
      payload: normalizedPayload,
      organizationId: session.orgContext.organizationId,
      treasuryId: session.orgContext.treasuryIds?.[0],
      walletId: normalizedPayload.sourceWalletId,
      originalRequestText: input.text,
    })
    const materialHash = createTransferMaterialHash(intent)

    const intentArtifact = await this.deps.persistence.artifacts.write(
      {
        artifactType: 'intent_snapshot',
        path: `runs/${run.runId}/ledger/artifacts/intent/${intent.intentId}-${intent.version}.json`,
      },
      intent,
    )

    let updatedRun: RunState = {
      ...run,
      intentRef: {
        intentId: intent.intentId,
        version: intent.version,
      },
      intentArtifactPath: intentArtifact.path,
      lastUpdatedAt: at,
    }
    await this.deps.runs.put(updatedRun)
    await this.appendLedgerEvent({
      eventType: 'intent.created',
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: 'intent_capture',
      actor: this.getSessionActor(session),
      refs: this.getRunRefs(updatedRun),
      summary: `Intent ${intent.intentId} created for transfer run ${run.runId}.`,
      payload: {
        actionType: intent.action.type,
        materialHash,
      },
      artifactRefs: [intentArtifact],
    })

    updatedRun = await this.transitionRunPhase(updatedRun, 'validation', {
      at,
      actor: this.getSessionActor(session),
      reason: 'Transfer intent persisted and ready for validation.',
      context: {
        intentExists: true,
        intentPersisted: true,
      },
    })

    const validation = validateTransferIntent(intent)
    if (!validation.valid) {
      await this.appendLedgerEvent({
        eventType: 'intent.rejected',
        at,
        runId: run.runId,
        sessionId: run.sessionId,
        phase: 'validation',
        actor: this.getSessionActor(session),
        refs: this.getRunRefs(updatedRun),
        summary: `Transfer intent ${intent.intentId} failed validation.`,
        payload: {
          issues: validation.issues,
          materialHash,
        },
      })

      updatedRun = await this.transitionRunPhase(updatedRun, 'failed', {
        at,
        actor: this.getSessionActor(session),
        reason: 'Transfer intent validation failed.',
        status: 'failed',
        context: {},
        payload: {
          issues: validation.issues,
        },
      })

      return {
        run: updatedRun,
        output: [
          `Persisted transfer intent ${intent.intentId}.`,
          `Transfer validation failed: ${validation.issues.join(', ')}.`,
        ],
      }
    }

    await this.appendLedgerEvent({
      eventType: 'intent.validated',
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: 'validation',
      actor: this.getSessionActor(session),
      refs: this.getRunRefs(updatedRun),
      summary: `Transfer intent ${intent.intentId} validated successfully.`,
      payload: {
        materialHash,
      },
    })

    updatedRun = await this.transitionRunPhase(updatedRun, 'policy_resolution', {
      at,
      actor: this.getSessionActor(session),
      reason: 'Transfer validation passed.',
      context: {
        validationPassed: true,
      },
    })

    const policyCandidates = await this.deps.getPolicyCandidates({
      session,
      run: updatedRun,
      kernelInput: input,
    })

    let walletPolicyContext:
      | Awaited<ReturnType<DefaultSessionKernel['resolveTransferWalletContextForPolicy']>>
      | undefined
    if (normalizedPayload.sourceWalletId) {
      try {
        walletPolicyContext = await this.resolveTransferWalletContextForPolicy(
          session,
          normalizedPayload.sourceWalletId,
          normalizedPayload.chainId,
          policyCandidates,
          updatedRun.runId,
          at,
        )

        const walletPolicyArtifact = await this.deps.persistence.artifacts.write(
          {
            artifactType: 'wallet_resolution',
            path: `runs/${run.runId}/ledger/artifacts/wallet/source_${walletPolicyContext.wallet.walletId}.policy_context.json`,
          },
          {
            providerId: walletPolicyContext.providerId,
            walletId: walletPolicyContext.wallet.walletId,
            walletType: walletPolicyContext.wallet.walletType,
            address: walletPolicyContext.address,
            signerProfileId: walletPolicyContext.signerProfile.signerProfileId,
            signerClass: walletPolicyContext.signerProfile.signerClass,
            state: walletPolicyContext.wallet.state,
            complianceStatus: walletPolicyContext.wallet.complianceStatus,
            signerHealthStatus: walletPolicyContext.wallet.signerHealthStatus,
            trustStatus: walletPolicyContext.wallet.trustStatus,
          },
        )

        await this.appendLedgerEvent({
          eventType: 'wallet.policy_context_resolved',
          at,
          runId: run.runId,
          sessionId: run.sessionId,
          phase: 'policy_resolution',
          actor: this.getSessionActor(session),
          refs: this.getRunRefs(updatedRun),
          summary: `Resolved wallet policy context for ${walletPolicyContext.wallet.walletId}.`,
          payload: {
            walletId: walletPolicyContext.wallet.walletId,
            walletType: walletPolicyContext.wallet.walletType,
            providerId: walletPolicyContext.providerId,
            signerProfileId: walletPolicyContext.signerProfile.signerProfileId,
            signerClass: walletPolicyContext.signerProfile.signerClass,
            state: walletPolicyContext.wallet.state,
          },
          artifactRefs: [walletPolicyArtifact],
        })
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unknown wallet provider resolution error.'

        await this.appendLedgerEvent({
          eventType: 'wallet.policy_context_failed',
          at,
          runId: run.runId,
          sessionId: run.sessionId,
          phase: 'policy_resolution',
          actor: this.getSessionActor(session),
          refs: this.getRunRefs(updatedRun),
          summary: `Wallet policy context resolution failed for ${normalizedPayload.sourceWalletId}.`,
          payload: {
            walletId: normalizedPayload.sourceWalletId,
            error: message,
          },
        })

        updatedRun = await this.transitionRunPhase(updatedRun, 'failed', {
          at,
          actor: this.getSessionActor(session),
          reason: 'Wallet provider resolution failed before policy resolution.',
          status: 'failed',
          context: {},
          payload: {
            walletId: normalizedPayload.sourceWalletId,
            error: message,
          },
        })

        return {
          run: updatedRun,
          output: [
            `Persisted transfer intent ${intent.intentId}.`,
            'Transfer validation passed.',
            `Wallet resolution failed: ${message}.`,
          ],
        }
      }
    }

    const resolvedPolicy = await this.deps.policyResolver.resolve({
      runId: updatedRun.runId,
      sessionId: updatedRun.sessionId,
      environment: session.environment,
      actor: session.actorContext,
      intentRef: {
        intentId: intent.intentId,
        version: intent.version,
        actionType: intent.action.type,
      },
      walletContext: {
        walletId: walletPolicyContext?.wallet.walletId ?? normalizedPayload.sourceWalletId,
        walletType: walletPolicyContext?.wallet.walletType,
        signerClass: walletPolicyContext?.signerProfile.signerClass,
        signerProfileId: walletPolicyContext?.signerProfile.signerProfileId,
        address: walletPolicyContext?.address,
        providerId: walletPolicyContext?.providerId,
        state: walletPolicyContext?.wallet.state,
        complianceStatus: walletPolicyContext?.wallet.complianceStatus,
        signerHealthStatus: walletPolicyContext?.wallet.signerHealthStatus,
        trustStatus: walletPolicyContext?.wallet.trustStatus,
      },
      treasuryContext: {
        treasuryId: session.orgContext.treasuryIds?.[0],
      },
      emergencyState: {
        haltActive: session.halted,
      },
      policyCandidates,
    })

    const policyArtifact = await this.deps.persistence.artifacts.write(
      {
        artifactType: 'policy_snapshot',
        path: `runs/${run.runId}/ledger/artifacts/policy/${resolvedPolicy.resolutionId}.json`,
      },
      resolvedPolicy,
    )

    updatedRun = {
      ...updatedRun,
      policyRef: {
        resolutionId: resolvedPolicy.resolutionId,
      },
      policyArtifactPath: policyArtifact.path,
      lastUpdatedAt: at,
    }
    await this.deps.runs.put(updatedRun)
    await this.appendLedgerEvent({
      eventType:
        resolvedPolicy.status === 'denied' ? 'policy.denied' : 'policy.resolved',
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: 'policy_resolution',
      actor: this.getSessionActor(session),
      refs: this.getRunRefs(updatedRun),
      summary: `Policy resolution completed with status ${resolvedPolicy.status}.`,
      payload: {
        resolutionId: resolvedPolicy.resolutionId,
        status: resolvedPolicy.status,
        reasonCodes: resolvedPolicy.reasonCodes,
        sourceProfileCount: policyCandidates.length,
      },
      artifactRefs: [policyArtifact],
    })

    if (resolvedPolicy.status === 'denied') {
      updatedRun = await this.transitionRunPhase(updatedRun, 'failed', {
        at,
        actor: this.getSessionActor(session),
        reason: 'Resolved policy denied the transfer run.',
        status: 'failed',
        context: {},
        payload: {
          resolutionId: resolvedPolicy.resolutionId,
          reasonCodes: resolvedPolicy.reasonCodes,
        },
      })

      return {
        run: updatedRun,
        output: [
          `Persisted transfer intent ${intent.intentId}.`,
          'Transfer validation passed.',
          `Policy denied the run: ${resolvedPolicy.reasonCodes.join(', ') || 'policy.denied'}.`,
        ],
      }
    }

    updatedRun = await this.transitionRunPhase(updatedRun, 'planning', {
      at,
      actor: this.getSessionActor(session),
      reason: 'Policy resolution completed and the run is ready for planning.',
      context: {
        resolvedPolicyExists: true,
        actionAllowedToBePlanned: true,
      },
    })

    updatedRun = await this.transitionRunPhase(updatedRun, 'simulation', {
      at,
      actor: this.getSessionActor(session),
      reason: 'Transfer plan is ready for deterministic simulation.',
      context: {
        planExists: true,
        planPolicyCompatible: true,
      },
    })

    const simulation = await this.deps.simulationEngine.simulateTransfer({
      runId: updatedRun.runId,
      sessionId: updatedRun.sessionId,
      intent,
      resolvedPolicy,
      materialHash,
    })

    const simulationArtifact = await this.deps.persistence.artifacts.write(
      {
        artifactType: 'simulation_record',
        path: `runs/${run.runId}/ledger/artifacts/simulation/${simulation.simulationId}.json`,
      },
      simulation,
    )

    updatedRun = {
      ...updatedRun,
      simulationRefs: [...updatedRun.simulationRefs, simulation.simulationId],
      simulationArtifactPaths: [
        ...updatedRun.simulationArtifactPaths,
        simulationArtifact.path,
      ],
      lastUpdatedAt: at,
    }
    await this.deps.runs.put(updatedRun)
    await this.appendLedgerEvent({
      eventType:
        simulation.status === 'succeeded'
          ? 'simulation.completed'
          : 'simulation.failed',
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: 'simulation',
      actor: this.getSessionActor(session),
      refs: this.getRunRefs(updatedRun),
      summary: simulation.summary,
      payload: {
        simulationId: simulation.simulationId,
        status: simulation.status,
        resultHash: simulation.resultHash,
        freshnessExpiresAt: simulation.freshnessExpiresAt,
      },
      artifactRefs: [simulationArtifact],
    })

    if (simulation.status !== 'succeeded') {
      updatedRun = await this.transitionRunPhase(updatedRun, 'failed', {
        at,
        actor: this.getSessionActor(session),
        reason: 'Transfer simulation failed.',
        status: 'failed',
        context: {},
        payload: {
          simulationId: simulation.simulationId,
        },
      })

      return {
        run: updatedRun,
        output: [
          `Persisted transfer intent ${intent.intentId}.`,
          'Transfer validation passed.',
          `Policy resolved as ${resolvedPolicy.status}.`,
          'Simulation failed.',
        ],
      }
    }

    updatedRun = await this.transitionRunPhase(updatedRun, 'approval', {
      at,
      actor: this.getSessionActor(session),
      reason: 'Simulation completed and the run is ready for approval evaluation.',
      context: {
        simulationRequired: resolvedPolicy.signing.requireSimulation,
        simulationCompleted: true,
        simulationFreshnessRecorded: Boolean(
          simulation.freshnessExpiresAt || !resolvedPolicy.signing.requireSimulation,
        ),
      },
    })

    const approvalState = await this.deps.approvalEngine.evaluateRequirement({
      intentRef: {
        intentId: intent.intentId,
        version: intent.version,
      },
      policy: resolvedPolicy,
      materialHash,
      computedAt: at,
    })

    const approvalArtifact = await this.deps.persistence.artifacts.write(
      {
        artifactType: 'approval_record',
        path: `runs/${run.runId}/ledger/artifacts/approvals/${approvalState.approvalStateId}.json`,
      },
      approvalState,
    )

    updatedRun = {
      ...updatedRun,
      approvalStateRef: approvalState.approvalStateId,
      approvalArtifactPath: approvalArtifact.path,
      status:
        approvalState.status === 'pending'
          ? 'waiting_for_approval'
          : approvalState.status === 'rejected'
            ? 'failed'
            : 'active',
      lastUpdatedAt: at,
    }
    await this.deps.runs.put(updatedRun)
    await this.appendLedgerEvent({
      eventType:
        approvalState.status === 'not_required'
          ? 'approval.not_required'
          : approvalState.status === 'rejected'
            ? 'approval.rejected'
            : 'approval.requested',
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: 'approval',
      actor: this.getSessionActor(session),
      refs: this.getRunRefs(updatedRun),
      summary: `Approval state ${approvalState.approvalStateId} computed as ${approvalState.status}.`,
      payload: {
        approvalStateId: approvalState.approvalStateId,
        approvalClass: approvalState.approvalClass,
        status: approvalState.status,
        requiredApprovals: approvalState.requirement.requiredApprovals,
      },
      artifactRefs: [approvalArtifact],
    })

    if (approvalState.status === 'rejected') {
      updatedRun = await this.transitionRunPhase(updatedRun, 'failed', {
        at,
        actor: this.getSessionActor(session),
        reason: 'Approval evaluation blocked execution.',
        status: 'failed',
        context: {},
        payload: {
          approvalStateId: approvalState.approvalStateId,
        },
      })

      return {
        run: updatedRun,
        output: [
          `Persisted transfer intent ${intent.intentId}.`,
          'Transfer validation passed.',
          `Policy resolved as ${resolvedPolicy.status}.`,
          'Simulation completed.',
          'Approval evaluation blocked the run.',
        ],
      }
    }

    if (approvalState.status === 'not_required') {
      const signingResult = await this.beginSigningForRun(session, updatedRun, at)
      return {
        run: signingResult.run,
        output: [
          `Persisted transfer intent ${intent.intentId}.`,
          'Transfer validation passed.',
          `Policy resolved as ${resolvedPolicy.status}.`,
          'Simulation completed.',
          ...signingResult.output,
        ],
      }
    }

    return {
      run: updatedRun,
      output: [
        `Persisted transfer intent ${intent.intentId}.`,
        'Transfer validation passed.',
        `Policy resolved as ${resolvedPolicy.status}.`,
        'Simulation completed.',
        approvalState.status === 'pending'
          ? 'Approval is now pending.'
          : 'Approval is not required and the run is ready for signing.',
      ],
    }
  }

  private async advanceWalletCreateRun(
    session: SessionState,
    input: KernelInput,
    run: RunState,
    at: string,
  ): Promise<{ run: RunState; output: string[] }> {
    const parsed = parseWalletCreateRequest({
      text: input.text,
      payload: input.payload,
    })

    if (!parsed.ok) {
      const failedRun = await this.transitionRunPhase(run, 'failed', {
        at,
        actor: this.getSessionActor(session),
        reason: 'Wallet creation request could not be parsed into structured intent.',
        status: 'failed',
        context: {},
        payload: {
          error: parsed.error,
        },
      })

      return {
        run: failedRun,
        output: [parsed.error],
      }
    }

    const payload = {
      ...parsed.payload,
      environment: session.environment,
    }

    const intentId = this.deps.createId('intent')
    const intent = buildWalletCreateIntent({
      intentId,
      createdAt: at,
      actor: {
        actorType: 'human',
        actorId: session.actorContext.actorId,
        sessionId: session.sessionId,
      },
      environment: session.environment,
      payload,
      organizationId: session.orgContext.organizationId,
      treasuryId: session.orgContext.treasuryIds?.[0],
      originalRequestText: input.text,
    })

    const intentArtifact = await this.deps.persistence.artifacts.write(
      {
        artifactType: 'intent_snapshot',
        path: `runs/${run.runId}/ledger/artifacts/intent/${intent.intentId}-${intent.version}.json`,
      },
      intent,
    )

    let updatedRun: RunState = {
      ...run,
      intentRef: {
        intentId: intent.intentId,
        version: intent.version,
      },
      intentArtifactPath: intentArtifact.path,
      lastUpdatedAt: at,
    }
    await this.deps.runs.put(updatedRun)
    await this.appendLedgerEvent({
      eventType: 'intent.created',
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: 'intent_capture',
      actor: this.getSessionActor(session),
      refs: this.getRunRefs(updatedRun),
      summary: `Intent ${intent.intentId} created for wallet creation run ${run.runId}.`,
      payload: {
        actionType: intent.action.type,
        subjectId: intent.action.payload.subjectId,
        walletType: intent.action.payload.walletType,
      },
      artifactRefs: [intentArtifact],
    })

    updatedRun = await this.transitionRunPhase(updatedRun, 'validation', {
      at,
      actor: this.getSessionActor(session),
      reason: 'Wallet creation intent persisted and ready for validation.',
      context: {
        intentExists: true,
        intentPersisted: true,
      },
    })

    const validation = validateWalletCreateIntent(intent)
    if (!validation.valid) {
      await this.appendLedgerEvent({
        eventType: 'intent.rejected',
        at,
        runId: run.runId,
        sessionId: run.sessionId,
        phase: 'validation',
        actor: this.getSessionActor(session),
        refs: this.getRunRefs(updatedRun),
        summary: `Wallet creation intent ${intent.intentId} failed validation.`,
        payload: {
          issues: validation.issues,
        },
      })

      updatedRun = await this.transitionRunPhase(updatedRun, 'failed', {
        at,
        actor: this.getSessionActor(session),
        reason: 'Wallet creation intent validation failed.',
        status: 'failed',
        context: {},
        payload: {
          issues: validation.issues,
        },
      })

      return {
        run: updatedRun,
        output: [
          `Persisted wallet creation intent ${intent.intentId}.`,
          `Wallet creation validation failed: ${validation.issues.join(', ')}.`,
        ],
      }
    }

    await this.appendLedgerEvent({
      eventType: 'intent.validated',
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: 'validation',
      actor: this.getSessionActor(session),
      refs: this.getRunRefs(updatedRun),
      summary: `Wallet creation intent ${intent.intentId} validated successfully.`,
      payload: {
        subjectId: intent.action.payload.subjectId,
        walletType: intent.action.payload.walletType,
      },
    })

    updatedRun = await this.transitionRunPhase(updatedRun, 'policy_resolution', {
      at,
      actor: this.getSessionActor(session),
      reason: 'Wallet creation validation passed.',
      context: {
        validationPassed: true,
      },
    })

    const policyCandidates = await this.deps.getPolicyCandidates({
      session,
      run: updatedRun,
      kernelInput: input,
    })
    const resolvedPolicy = await this.deps.policyResolver.resolve({
      runId: updatedRun.runId,
      sessionId: updatedRun.sessionId,
      environment: session.environment,
      actor: session.actorContext,
      intentRef: {
        intentId: intent.intentId,
        version: intent.version,
        actionType: intent.action.type,
      },
      walletContext: {
        walletType: intent.action.payload.walletType,
      },
      treasuryContext: {
        treasuryId: session.orgContext.treasuryIds?.[0],
      },
      emergencyState: {
        haltActive: session.halted,
      },
      policyCandidates,
    })

    const policyArtifact = await this.deps.persistence.artifacts.write(
      {
        artifactType: 'policy_snapshot',
        path: `runs/${run.runId}/ledger/artifacts/policy/${resolvedPolicy.resolutionId}.json`,
      },
      resolvedPolicy,
    )

    updatedRun = {
      ...updatedRun,
      policyRef: {
        resolutionId: resolvedPolicy.resolutionId,
      },
      policyArtifactPath: policyArtifact.path,
      lastUpdatedAt: at,
    }
    await this.deps.runs.put(updatedRun)
    await this.appendLedgerEvent({
      eventType:
        resolvedPolicy.status === 'denied' ? 'policy.denied' : 'policy.resolved',
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: 'policy_resolution',
      actor: this.getSessionActor(session),
      refs: this.getRunRefs(updatedRun),
      summary: `Policy resolution completed with status ${resolvedPolicy.status}.`,
      payload: {
        resolutionId: resolvedPolicy.resolutionId,
        status: resolvedPolicy.status,
        reasonCodes: resolvedPolicy.reasonCodes,
        sourceProfileCount: policyCandidates.length,
      },
      artifactRefs: [policyArtifact],
    })

    if (resolvedPolicy.status === 'denied') {
      updatedRun = await this.transitionRunPhase(updatedRun, 'failed', {
        at,
        actor: this.getSessionActor(session),
        reason: 'Resolved policy denied the wallet creation run.',
        status: 'failed',
        context: {},
        payload: {
          resolutionId: resolvedPolicy.resolutionId,
          reasonCodes: resolvedPolicy.reasonCodes,
        },
      })

      return {
        run: updatedRun,
        output: [
          `Persisted wallet creation intent ${intent.intentId}.`,
          'Wallet creation validation passed.',
          `Policy denied the run: ${resolvedPolicy.reasonCodes.join(', ') || 'policy.denied'}.`,
        ],
      }
    }

    updatedRun = await this.transitionRunPhase(updatedRun, 'planning', {
      at,
      actor: this.getSessionActor(session),
      reason: 'Policy resolution completed and wallet provisioning can be planned.',
      context: {
        resolvedPolicyExists: true,
        actionAllowedToBePlanned: true,
      },
    })

    let signerProfile
    try {
      signerProfile = this.deps.signerProfiles.resolveCompatible({
        signerProfileId: intent.action.payload.signerProfileId,
        chainId: resolvedPolicy.scope.allowedChains[0] ?? 'test',
        allowedSignerClasses:
          resolvedPolicy.signing.allowedSignerClasses.length > 0
            ? resolvedPolicy.signing.allowedSignerClasses
            : this.deps.signerProfiles.list().map((profile) => profile.signerClass),
      })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown signer profile resolution error.'

      updatedRun = await this.transitionRunPhase(updatedRun, 'failed', {
        at,
        actor: this.getSessionActor(session),
        reason: 'Wallet creation could not resolve a signer profile.',
        status: 'failed',
        context: {},
        payload: {
          error: message,
        },
      })

      return {
        run: updatedRun,
        output: [
          `Persisted wallet creation intent ${intent.intentId}.`,
          'Wallet creation validation passed.',
          `Policy resolved as ${resolvedPolicy.status}.`,
          `Signer profile resolution failed: ${message}.`,
        ],
      }
    }

    const walletId = this.deps.createId('wallet')
    const walletRecord: WalletRecord = {
      walletId,
      createdAt: at,
      updatedAt: at,
      state:
        intent.action.payload.initialPolicyProfileId != null
          ? 'pending_compliance'
          : 'linked_pending_policy',
      organizationId: session.orgContext.organizationId,
      treasuryId:
        intent.action.payload.walletType === 'treasury' ||
        intent.action.payload.walletType === 'ops'
          ? session.orgContext.treasuryIds?.[0]
          : undefined,
      subjectId: intent.action.payload.subjectId,
      walletType: intent.action.payload.walletType,
      address: this.buildDeterministicWalletAddress(walletId),
      supportedChains:
        resolvedPolicy.scope.allowedChains.length > 0
          ? resolvedPolicy.scope.allowedChains
          : ['test'],
      signerProfileId: signerProfile.signerProfileId,
      providerId: 'deterministic_wallet_provider',
      complianceStatus: 'not_started' as const,
      policyAttachmentStatus:
        intent.action.payload.initialPolicyProfileId != null ? 'attached' : 'pending',
      signerHealthStatus: 'healthy' as const,
      trustStatus: 'unassessed' as const,
    }
    await this.deps.walletRegistry.put(walletRecord)

    const walletArtifact = await this.deps.persistence.artifacts.write(
      {
        artifactType: 'wallet_snapshot',
        path: `runs/${run.runId}/ledger/artifacts/wallet/${walletId}.created.json`,
      },
      walletRecord,
    )

    await this.appendLedgerEvent({
      eventType: 'wallet.created',
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: 'planning',
      actor: this.getSessionActor(session),
      refs: {
        ...this.getRunRefs(updatedRun),
        walletIds: [walletRecord.walletId],
      },
      summary: `Wallet ${walletRecord.walletId} created for subject ${walletRecord.subjectId}.`,
      payload: {
        walletId: walletRecord.walletId,
        subjectId: walletRecord.subjectId,
        walletType: walletRecord.walletType,
        state: walletRecord.state,
        signerProfileId: walletRecord.signerProfileId,
      },
      artifactRefs: [walletArtifact],
    })

    updatedRun = await this.transitionRunPhase(updatedRun, 'reporting', {
      at,
      actor: this.getSessionActor(session),
      reason: 'Wallet record created inside the runtime and ready for closeout reporting.',
      context: {
        planExists: true,
        planPolicyCompatible: true,
        executionBypassed: true,
      },
    })

    const report = this.buildRunCloseoutReport({
      session,
      run: updatedRun,
      at,
      summary: `Wallet ${walletRecord.walletId} created in state ${walletRecord.state}.`,
      walletIds: [walletRecord.walletId],
      notes: [
        `Signer profile ${walletRecord.signerProfileId} attached.`,
        `Initial compliance status: ${walletRecord.complianceStatus}.`,
        `Initial policy attachment status: ${walletRecord.policyAttachmentStatus}.`,
      ],
    })
    const reportArtifact = await this.deps.persistence.artifacts.write(
      {
        artifactType: 'audit_report',
        path: `runs/${run.runId}/closeout/${report.reportId}.json`,
      },
      report,
    )

    updatedRun = {
      ...updatedRun,
      reportArtifactPath: reportArtifact.path,
      reportRef: report.reportId,
      lastUpdatedAt: at,
    }
    await this.deps.runs.put(updatedRun)
    await this.appendLedgerEvent({
      eventType: 'run.report_created',
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: 'reporting',
      actor: this.getSessionActor(session),
      refs: {
        ...this.getRunRefs(updatedRun),
        walletIds: [walletRecord.walletId],
      },
      summary: report.summary,
      payload: {
        reportId: report.reportId,
        finalStatus: report.finalStatus,
      },
      artifactRefs: [reportArtifact],
    })

    const completedRun = await this.transitionRunPhase(updatedRun, 'completed', {
      at,
      actor: this.getSessionActor(session),
      reason: 'Wallet onboarding record was created and reported successfully.',
      status: 'completed',
      context: {
        reportArtifactCreated: true,
      },
    })

    return {
      run: completedRun,
      output: [
        `Persisted wallet creation intent ${intent.intentId}.`,
        'Wallet creation validation passed.',
        `Policy resolved as ${resolvedPolicy.status}.`,
        `Wallet ${walletRecord.walletId} created for ${walletRecord.subjectId}.`,
        `Execution report ${report.reportId} created.`,
      ],
    }
  }

  private collectTransferSignerClasses(
    policyCandidates: PolicyProfile[],
  ): SignerClass[] {
    const signerClasses = new Set<SignerClass>()

    for (const candidate of policyCandidates) {
      for (const signerClass of candidate.permissions.signer.allowedSignerClasses) {
        signerClasses.add(signerClass)
      }

      for (const signerClass of
        candidate.permissions.actions['asset.transfer']?.allowedSignerClasses ?? []) {
        signerClasses.add(signerClass)
      }
    }

    if (signerClasses.size === 0) {
      for (const profile of this.deps.signerProfiles.list()) {
        signerClasses.add(profile.signerClass)
      }
    }

    return [...signerClasses]
  }

  private async resolveTransferWalletContext(
    session: SessionState,
    input: {
      sourceWalletId: string
      chainId: string
      runId: string
      at: string
      allowedSignerClasses: SignerClass[]
      requiredSignerClass?: SignerClass
    },
  ): Promise<{
    providerId: string
    address: string
    wallet: ResolvedTransferSourceWallet['wallet']
    resolvedWallet: ResolvedTransferSourceWallet
    signerProfile: SignerProfile
  }> {
    const resolvedWallet = await this.deps.walletProvider.resolveTransferSource({
      walletId: input.sourceWalletId,
      chainId: input.chainId,
      environment: session.environment,
      actionType: 'asset.transfer',
      requiredSignerClass: input.requiredSignerClass,
      allowedSignerClasses: input.allowedSignerClasses,
    })

    const signerProfile = this.deps.signerProfiles.resolveCompatible({
      signerProfileId: resolvedWallet.signerProfileId,
      walletId: resolvedWallet.wallet.walletId,
      chainId: input.chainId,
      allowedSignerClasses: input.allowedSignerClasses,
      requiredSignerClass: input.requiredSignerClass,
    })

    return {
      providerId: resolvedWallet.providerId,
      address: resolvedWallet.address,
      wallet: {
        ...resolvedWallet.wallet,
        updatedAt: input.at,
      },
      resolvedWallet: {
        ...resolvedWallet,
        wallet: {
          ...resolvedWallet.wallet,
          updatedAt: input.at,
        },
      },
      signerProfile,
    }
  }

  private async resolveTransferWalletContextForPolicy(
    session: SessionState,
    sourceWalletId: string,
    chainId: string,
    policyCandidates: PolicyProfile[],
    runId: string,
    at: string,
  ): Promise<{
    providerId: string
    address: string
    wallet: ResolvedTransferSourceWallet['wallet']
    resolvedWallet: ResolvedTransferSourceWallet
    signerProfile: SignerProfile
  }> {
    return this.resolveTransferWalletContext(session, {
      sourceWalletId,
      chainId,
      runId,
      at,
      allowedSignerClasses: this.collectTransferSignerClasses(policyCandidates),
    })
  }

  private async resolveTransferSigningContext(
    session: SessionState,
    intent: IntentObject,
    resolvedPolicy: ResolvedPolicyProfile,
    runId: string,
    at: string,
  ): Promise<{
    providerId: string
    address: string
    wallet: ResolvedTransferSourceWallet['wallet']
    resolvedWallet: ResolvedTransferSourceWallet
    signerProfile: SignerProfile
  }> {
    if (intent.action.type !== 'asset.transfer') {
      throw new Error(
        `Wallet resolution only supports asset.transfer, received ${intent.action.type}.`,
      )
    }

    const sourceWalletId =
      intent.action.payload.sourceWalletId ?? session.orgContext.walletIds?.[0]
    if (!sourceWalletId) {
      throw new Error(
        `Run ${runId} cannot enter signing without a source wallet id.`,
      )
    }

    const resolvedWalletContext = await this.resolveTransferWalletContext(session, {
      sourceWalletId,
      chainId: intent.action.payload.chainId,
      runId,
      at,
      allowedSignerClasses: resolvedPolicy.signing.allowedSignerClasses,
      requiredSignerClass: resolvedPolicy.signing.requiredSignerClass,
    })

    if (
      resolvedPolicy.scope.allowedWalletIds.length > 0 &&
      !resolvedPolicy.scope.allowedWalletIds.includes(
        resolvedWalletContext.wallet.walletId,
      )
    ) {
      throw new Error(
        `Resolved wallet ${resolvedWalletContext.wallet.walletId} is not allowed by policy for run ${runId}.`,
      )
    }

    return resolvedWalletContext
  }

  private async beginSigningForRun(
    session: SessionState,
    run: RunState,
    at: string,
  ): Promise<{ run: RunState; output: string[] }> {
    const intent = await this.readArtifactJson<IntentObject>(run.intentArtifactPath)
    const resolvedPolicy = await this.readArtifactJson<ResolvedPolicyProfile>(
      run.policyArtifactPath,
    )
    const simulation = await this.readArtifactJson<SimulationRecord>(
      run.simulationArtifactPaths.at(-1),
    )
    const approvalState = await this.readArtifactJson<ApprovalState>(
      run.approvalArtifactPath,
    )

    if (!intent || !resolvedPolicy || !simulation) {
      throw new Error('Signing requires intent, policy, and simulation artifacts.')
    }

    const walletResolution = await this.resolveTransferSigningContext(
      session,
      intent,
      resolvedPolicy,
      run.runId,
      at,
    )
    const walletResolutionArtifact = await this.deps.persistence.artifacts.write(
      {
        artifactType: 'wallet_resolution',
        path: `runs/${run.runId}/ledger/artifacts/wallet/source_${walletResolution.wallet.walletId}.signing_resolution.json`,
      },
      {
        providerId: walletResolution.providerId,
        walletId: walletResolution.wallet.walletId,
        address: walletResolution.address,
        signerProfileId: walletResolution.signerProfile.signerProfileId,
        signerClass: walletResolution.signerProfile.signerClass,
        supportedChains: walletResolution.resolvedWallet.supportedChains,
      },
    )
    await this.appendLedgerEvent({
      eventType: 'wallet.source_resolved',
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: run.currentPhase,
      actor: this.getSessionActor(session),
      refs: this.getRunRefs(run),
      summary: `Resolved source wallet ${walletResolution.wallet.walletId} to ${walletResolution.address} using signer profile ${walletResolution.signerProfile.signerProfileId}.`,
      payload: {
        walletId: walletResolution.wallet.walletId,
        providerId: walletResolution.providerId,
        address: walletResolution.address,
        signerProfileId: walletResolution.signerProfile.signerProfileId,
        signerClass: walletResolution.signerProfile.signerClass,
      },
      artifactRefs: [walletResolutionArtifact],
    })

    const materialHash = createTransferMaterialHash(intent)
    const updatedRun = await this.transitionRunPhase(run, 'signing', {
      at,
      actor: this.getSessionActor(session),
      reason: 'Signing prerequisites satisfied.',
      status: 'waiting_for_signature',
      context: {
        approvalStatus: approvalState?.status ?? 'not_required',
        approvalInvalidated: approvalState?.status === 'invalidated',
        emergencyHaltActive: session.halted,
      },
    })

    const signatureRequestId = this.deps.createId('signature_request')
    const signatureRequest = buildTransferSignatureRequest({
      signatureRequestId,
      createdAt: at,
      intent,
      resolvedPolicy,
      simulation,
      approvalState,
      sourceAddress: walletResolution.address,
      signerProfile: walletResolution.signerProfile,
    })

    const signatureRequestArtifact = await this.deps.persistence.artifacts.write(
      {
        artifactType: 'signature_request',
        path: `runs/${run.runId}/ledger/artifacts/signatures/${signatureRequestId}.request.json`,
      },
      signatureRequest,
    )

    let signingRun: RunState = {
      ...updatedRun,
      signatureRequestRefs: [
        ...updatedRun.signatureRequestRefs,
        signatureRequest.signatureRequestId,
      ],
      signatureRequestArtifactPaths: [
        ...updatedRun.signatureRequestArtifactPaths,
        signatureRequestArtifact.path,
      ],
      lastUpdatedAt: at,
    }
    await this.deps.runs.put(signingRun)
    await this.appendLedgerEvent({
      eventType: 'signature.request_created',
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: 'signing',
      actor: this.getSessionActor(session),
      refs: this.getRunRefs(signingRun),
      summary: `Signature request ${signatureRequest.signatureRequestId} created.`,
      payload: {
        signerProfileId: signatureRequest.signer.signerProfileId,
        signerClass: signatureRequest.signer.signerClass,
        simulationId: simulation.simulationId,
        materialHash,
      },
      artifactRefs: [signatureRequestArtifact],
    })

    const signatureResult = await this.deps.signerGateway.requestSignature(
      signatureRequest,
    )
    const signatureResultArtifact = await this.deps.persistence.artifacts.write(
      {
        artifactType: 'signature_result',
        path: `runs/${run.runId}/ledger/artifacts/signatures/${signatureRequestId}.result.json`,
      },
      signatureResult,
    )

    signingRun = {
      ...signingRun,
      signatureResultRefs: [
        ...signingRun.signatureResultRefs,
        signatureResult.signatureRequestId,
      ],
      signatureResultArtifactPaths: [
        ...signingRun.signatureResultArtifactPaths,
        signatureResultArtifact.path,
      ],
      status:
        signatureResult.status === 'pending'
          ? 'waiting_for_signature'
          : signatureResult.status === 'signed'
            ? 'active'
            : 'failed',
      lastUpdatedAt: at,
    }
    await this.deps.runs.put(signingRun)
    await this.appendLedgerEvent({
      eventType: `signature.request_${signatureResult.status}`,
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: 'signing',
      actor: this.getSessionActor(session),
      refs: this.getRunRefs(signingRun),
      summary: `Signature request ${signatureRequest.signatureRequestId} returned ${signatureResult.status}.`,
      payload: {
        signerProfileId: signatureResult.signerProfileId,
        transactionHash: signatureResult.transactionHash,
        errorMessage: signatureResult.errorMessage,
      },
      artifactRefs: [signatureResultArtifact],
    })

    if (signatureResult.status === 'signed') {
      const broadcastResult = await this.continueTransferAfterSignedResult(
        session,
        signingRun,
        signatureResult,
        at,
      )

      return {
        run: broadcastResult.run,
        output: [
          `Signature request ${signatureRequest.signatureRequestId} created.`,
          'Signature request returned signed.',
          ...broadcastResult.output,
        ],
      }
    }

    if (signatureResult.status !== 'pending') {
      const failedRun = await this.transitionRunPhase(signingRun, 'failed', {
        at,
        actor: this.getSessionActor(session),
        reason: 'Signing backend did not return a usable signature result.',
        status: 'failed',
        context: {},
        payload: {
          signatureRequestId: signatureRequest.signatureRequestId,
          status: signatureResult.status,
        },
      })

      return {
        run: failedRun,
        output: [
          `Signature request ${signatureRequest.signatureRequestId} created.`,
          `Signature request returned ${signatureResult.status}.`,
        ],
      }
    }

    return {
      run: signingRun,
      output: [
        `Signature request ${signatureRequest.signatureRequestId} created.`,
        signatureResult.status === 'pending'
          ? 'Signature request submitted and is now pending.'
          : `Signature request returned ${signatureResult.status}.`,
      ],
    }
  }

  private appendUnique(values: string[], value: string | undefined): string[] {
    if (!value || values.includes(value)) {
      return values
    }

    return [...values, value]
  }

  private findLatestPathContaining(
    paths: string[],
    token: string | undefined,
  ): string | undefined {
    if (!token) {
      return paths.at(-1)
    }

    for (let index = paths.length - 1; index >= 0; index -= 1) {
      const candidate = paths[index]
      if (!candidate) {
        continue
      }
      if (candidate.includes(token)) {
        return candidate
      }
    }

    return paths.at(-1)
  }

  private async persistSignatureResultForRun(
    run: RunState,
    signatureResult: SignatureResult,
    at: string,
    artifactLabel = `callback_${this.deps.createId('signature_status')}`,
  ): Promise<{
    run: RunState
    signatureResult: SignatureResult
    artifact: ArtifactRef
  }> {
    const artifact = await this.deps.persistence.artifacts.write(
      {
        artifactType: 'signature_result',
        path: `runs/${run.runId}/ledger/artifacts/signatures/${signatureResult.signatureRequestId}.${artifactLabel}.${signatureResult.status}.json`,
      },
      signatureResult,
    )

    const updatedRun: RunState = {
      ...run,
      signatureRequestRefs: this.appendUnique(
        run.signatureRequestRefs,
        signatureResult.signatureRequestId,
      ),
      signatureResultRefs: this.appendUnique(
        run.signatureResultRefs,
        signatureResult.signatureRequestId,
      ),
      signatureResultArtifactPaths: this.appendUnique(
        run.signatureResultArtifactPaths,
        artifact.path,
      ),
      status:
        signatureResult.status === 'pending'
          ? 'waiting_for_signature'
          : signatureResult.status === 'signed'
            ? 'active'
            : 'failed',
      lastUpdatedAt: at,
    }

    await this.deps.runs.put(updatedRun)

    return {
      run: updatedRun,
      signatureResult,
      artifact,
    }
  }

  private async pollTransferSignatureStatus(
    session: SessionState,
    run: RunState,
    at: string,
  ): Promise<{ run: RunState; output: string[] }> {
    const signatureRequestId = run.signatureRequestRefs.at(-1)
    if (!signatureRequestId) {
      throw new Error('Signature polling requires a persisted signature request ref.')
    }

    const signatureResult = await this.deps.signerGateway.getSignatureResult(
      signatureRequestId,
    )
    const persistedSignature = await this.persistSignatureResultForRun(
      run,
      signatureResult,
      at,
      `poll_${this.deps.createId('signature_status')}`,
    )

    await this.appendLedgerEvent({
      eventType: 'signature.status_polled',
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: 'signing',
      actor: {
        actorType: 'system',
        actorId: 'session-kernel',
      },
      refs: this.getRunRefs(persistedSignature.run),
      summary: `Polled signature request ${signatureRequestId}; current status is ${signatureResult.status}.`,
      payload: {
        signatureRequestId,
        status: signatureResult.status,
        signerProfileId: signatureResult.signerProfileId,
        transactionHash: signatureResult.transactionHash,
      },
      artifactRefs: [persistedSignature.artifact],
    })

    if (signatureResult.status === 'signed') {
      return this.continueTransferAfterSignedResult(
        session,
        persistedSignature.run,
        persistedSignature.signatureResult,
        at,
      )
    }

    if (signatureResult.status === 'pending') {
      await this.syncSessionIndexes(session.sessionId, run.runId)
      return {
        run: persistedSignature.run,
        output: [`Signature request ${signatureRequestId} is still pending.`],
      }
    }

    const failedRun = await this.transitionRunPhase(persistedSignature.run, 'failed', {
      at,
      actor: this.getSessionActor(session),
      reason: 'Signature polling returned a terminal non-signed result.',
      status: 'failed',
      context: {},
      payload: {
        signatureRequestId,
        status: signatureResult.status,
      },
    })

    return {
      run: failedRun,
      output: [
        `Signature request ${signatureRequestId} returned ${signatureResult.status}.`,
      ],
    }
  }

  private async persistBroadcastForRun(
    run: RunState,
    broadcast: BroadcastRecord,
    at: string,
  ): Promise<{
    run: RunState
    broadcast: BroadcastRecord
    artifact: ArtifactRef
  }> {
    const artifact = await this.deps.persistence.artifacts.write(
      {
        artifactType: 'broadcast_record',
        path: `runs/${run.runId}/ledger/artifacts/broadcast/${broadcast.broadcastId}.${broadcast.status}.json`,
      },
      broadcast,
    )

    const updatedRun: RunState = {
      ...run,
      broadcastRefs: this.appendUnique(run.broadcastRefs, broadcast.broadcastId),
      broadcastArtifactPaths: this.appendUnique(
        run.broadcastArtifactPaths,
        artifact.path,
      ),
      status:
        broadcast.status === 'confirmed'
          ? 'active'
          : broadcast.status === 'submitted'
            ? 'waiting_for_confirmation'
            : 'failed',
      lastUpdatedAt: at,
    }

    await this.deps.runs.put(updatedRun)

    return {
      run: updatedRun,
      broadcast,
      artifact,
    }
  }

  private async pollTransferBroadcastStatus(
    session: SessionState,
    run: RunState,
    at: string,
  ): Promise<{ run: RunState; output: string[] }> {
    const broadcastPath = this.findLatestPathContaining(
      run.broadcastArtifactPaths,
      run.broadcastRefs.at(-1),
    )
    const currentBroadcast = await this.readArtifactJson<BroadcastRecord>(
      broadcastPath,
    )

    if (!currentBroadcast) {
      throw new Error('Broadcast polling requires a persisted broadcast artifact.')
    }

    const refreshedBroadcast = await this.deps.broadcaster.refreshBroadcast({
      runId: run.runId,
      sessionId: run.sessionId,
      record: currentBroadcast,
    })

    if (refreshedBroadcast.status === 'submitted') {
      const waitingRun: RunState = {
        ...run,
        status: 'waiting_for_confirmation',
        lastUpdatedAt: at,
      }
      await this.deps.runs.put(waitingRun)
      await this.appendLedgerEvent({
        eventType: 'broadcast.confirmation_pending',
        at,
        runId: run.runId,
        sessionId: run.sessionId,
        phase: 'broadcast',
        actor: {
          actorType: 'system',
          actorId: 'session-kernel',
        },
        refs: this.getRunRefs(waitingRun),
        summary: `Broadcast ${currentBroadcast.broadcastId} is still awaiting confirmation.`,
        payload: {
          broadcastId: currentBroadcast.broadcastId,
          status: refreshedBroadcast.status,
          transactionHash: refreshedBroadcast.transactionHash,
        },
      })
      await this.syncSessionIndexes(session.sessionId, run.runId)

      return {
        run: waitingRun,
        output: [
          `Broadcast ${currentBroadcast.broadcastId} is still awaiting confirmation.`,
        ],
      }
    }

    const persistedBroadcast = await this.persistBroadcastForRun(
      run,
      refreshedBroadcast,
      at,
    )
    await this.appendLedgerEvent({
      eventType:
        refreshedBroadcast.status === 'confirmed'
          ? 'broadcast.confirmed'
          : 'broadcast.failed',
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: 'broadcast',
      actor: {
        actorType: 'system',
        actorId: 'session-kernel',
      },
      refs: this.getRunRefs(persistedBroadcast.run),
      summary: refreshedBroadcast.summary,
      payload: {
        broadcastId: refreshedBroadcast.broadcastId,
        status: refreshedBroadcast.status,
        transactionHash: refreshedBroadcast.transactionHash,
        network: refreshedBroadcast.network,
      },
      artifactRefs: [persistedBroadcast.artifact],
    })

    if (refreshedBroadcast.status === 'confirmed') {
      return this.continueTransferAfterBroadcast(
        session,
        persistedBroadcast.run,
        persistedBroadcast.broadcast,
        at,
      )
    }

    const failedRun = await this.transitionRunPhase(
      persistedBroadcast.run,
      'failed',
      {
        at,
        actor: this.getSessionActor(session),
        reason: 'Broadcast failed during confirmation polling.',
        status: 'failed',
        context: {},
        payload: {
          broadcastId: refreshedBroadcast.broadcastId,
        },
      },
    )

    return {
      run: failedRun,
      output: [`Broadcast ${refreshedBroadcast.broadcastId} failed.`],
    }
  }

  private async continueTransferAfterSignedResult(
    session: SessionState,
    run: RunState,
    signatureResult: SignatureResult,
    at: string,
  ): Promise<{ run: RunState; output: string[] }> {
    const resolvedPolicy = await this.readArtifactJson<ResolvedPolicyProfile>(
      run.policyArtifactPath,
    )
    const signatureRequestPath = this.findLatestPathContaining(
      run.signatureRequestArtifactPaths,
      signatureResult.signatureRequestId,
    )
    const signatureRequest = await this.readArtifactJson<SignatureRequest>(
      signatureRequestPath,
    )

    if (!resolvedPolicy || !signatureRequest) {
      throw new Error(
        'Broadcast requires a resolved policy and a signature request artifact.',
      )
    }

    if (!resolvedPolicy.signing.broadcastAllowed) {
      const failedRun = await this.transitionRunPhase(run, 'failed', {
        at,
        actor: this.getSessionActor(session),
        reason: 'Resolved policy does not allow broadcasting signed payloads.',
        status: 'failed',
        context: {},
        payload: {
          signatureRequestId: signatureResult.signatureRequestId,
          resolutionId: resolvedPolicy.resolutionId,
        },
      })

      return {
        run: failedRun,
        output: ['Signed payload received, but policy blocked broadcast.'],
      }
    }

    const broadcastRun = await this.transitionRunPhase(run, 'broadcast', {
      at,
      actor: this.getSessionActor(session),
      reason: 'Signed payload is ready for broadcast.',
      status: 'active',
      context: {
        signatureResultExists: true,
        signatureValidForPlannedPayload:
          signatureResult.status === 'signed' &&
          signatureRequest.signatureRequestId ===
            signatureResult.signatureRequestId,
      },
    })

    const broadcast = await this.deps.broadcaster.broadcastSignedTransfer({
      runId: run.runId,
      sessionId: run.sessionId,
      signatureRequest,
      signatureResult,
    })
    const persistedBroadcast = await this.persistBroadcastForRun(
      broadcastRun,
      broadcast,
      at,
    )

    await this.appendLedgerEvent({
      eventType:
        broadcast.status === 'confirmed'
          ? 'broadcast.confirmed'
          : 'broadcast.submitted',
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: 'broadcast',
      actor: this.getSessionActor(session),
      refs: this.getRunRefs(persistedBroadcast.run),
      summary: broadcast.summary,
      payload: {
        broadcastId: broadcast.broadcastId,
        status: broadcast.status,
        transactionHash: broadcast.transactionHash,
        network: broadcast.network,
        signatureRequestId: broadcast.signatureRequestId,
      },
      artifactRefs: [persistedBroadcast.artifact],
    })

    if (broadcast.status === 'confirmed') {
      return this.continueTransferAfterBroadcast(
        session,
        persistedBroadcast.run,
        persistedBroadcast.broadcast,
        at,
      )
    }

    return {
      run: persistedBroadcast.run,
      output: [
        `Broadcast ${broadcast.broadcastId} submitted and is awaiting confirmation.`,
      ],
    }
  }

  private async continueTransferAfterBroadcast(
    session: SessionState,
    run: RunState,
    broadcast: BroadcastRecord,
    at: string,
  ): Promise<{ run: RunState; output: string[] }> {
    const intent = await this.readArtifactJson<IntentObject>(run.intentArtifactPath)
    const simulation = await this.readArtifactJson<SimulationRecord>(
      run.simulationArtifactPaths.at(-1),
    )
    const signatureResultPath = this.findLatestPathContaining(
      run.signatureResultArtifactPaths,
      broadcast.signatureRequestId,
    )
    const signatureResult = await this.readArtifactJson<SignatureResult>(
      signatureResultPath,
    )

    if (!intent || !simulation || !signatureResult) {
      throw new Error(
        'Reconciliation requires intent, simulation, and signature result artifacts.',
      )
    }

    const reconciliationRun = await this.transitionRunPhase(
      run,
      'reconciliation',
      {
        at,
        actor: this.getSessionActor(session),
        reason: 'Broadcast completed and reconciliation can now run.',
        status: 'active',
        context: {
          broadcastHandleExists: Boolean(
            broadcast.transactionHash || broadcast.broadcastId,
          ),
        },
      },
    )

    const reconciliation = await this.deps.reconciler.reconcileTransfer({
      runId: run.runId,
      intent,
      simulation,
      signatureResult,
      broadcast,
    })
    const reconciliationArtifact = await this.deps.persistence.artifacts.write(
      {
        artifactType: 'reconciliation_report',
        path: `runs/${run.runId}/ledger/artifacts/reconciliation/${reconciliation.reconciliationId}.json`,
      },
      reconciliation,
    )

    let updatedRun: RunState = {
      ...reconciliationRun,
      reconciliationArtifactPath: reconciliationArtifact.path,
      lastUpdatedAt: at,
    }
    await this.deps.runs.put(updatedRun)
    await this.appendLedgerEvent({
      eventType:
        reconciliation.status === 'matched'
          ? 'reconciliation.matched'
          : reconciliation.status === 'mismatch'
            ? 'reconciliation.mismatch'
            : 'reconciliation.failed',
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: 'reconciliation',
      actor: this.getSessionActor(session),
      refs: this.getRunRefs(updatedRun),
      summary: reconciliation.summary,
      payload: {
        reconciliationId: reconciliation.reconciliationId,
        status: reconciliation.status,
        observedTransactionHash: reconciliation.observedTransactionHash,
        failedChecks: reconciliation.checks
          .filter((check) => check.status === 'failed')
          .map((check) => check.checkId),
      },
      artifactRefs: [reconciliationArtifact],
    })

    updatedRun = await this.transitionRunPhase(updatedRun, 'reporting', {
      at,
      actor: this.getSessionActor(session),
      reason: 'Reconciliation completed and final reporting can begin.',
      status: 'active',
      context: {
        finalObservedResultClassified: true,
      },
    })

    const report = this.buildTransferCloseoutReport({
      session,
      run: updatedRun,
      at,
      broadcast,
      signatureResult,
      reconciliation,
    })
    const reportArtifact = await this.deps.persistence.artifacts.write(
      {
        artifactType: 'audit_report',
        path: `runs/${run.runId}/closeout/${report.reportId}.json`,
      },
      report,
    )

    updatedRun = {
      ...updatedRun,
      reportArtifactPath: reportArtifact.path,
      reportRef: report.reportId,
      lastUpdatedAt: at,
    }
    await this.deps.runs.put(updatedRun)
    await this.appendLedgerEvent({
      eventType: 'run.report_created',
      at,
      runId: run.runId,
      sessionId: run.sessionId,
      phase: 'reporting',
      actor: this.getSessionActor(session),
      refs: this.getRunRefs(updatedRun),
      summary: report.summary,
      payload: {
        reportId: report.reportId,
        finalStatus: report.finalStatus,
        reconciliationStatus: report.reconciliationStatus,
        transactionHash: report.transactionHash,
      },
      artifactRefs: [reportArtifact],
    })

    if (reconciliation.status === 'matched') {
      const completedRun = await this.transitionRunPhase(updatedRun, 'completed', {
        at,
        actor: this.getSessionActor(session),
        reason: 'Broadcast confirmed and reconciliation matched expected effects.',
        status: 'completed',
        context: {
          reportArtifactCreated: true,
        },
      })

      return {
        run: completedRun,
        output: [
          `Broadcast ${broadcast.broadcastId} confirmed.`,
          'Reconciliation matched expected transfer effects.',
          `Execution report ${report.reportId} created.`,
        ],
      }
    }

    const failedRun = await this.transitionRunPhase(updatedRun, 'failed', {
      at,
      actor: this.getSessionActor(session),
      reason: 'Reconciliation did not match the expected transfer outcome.',
      status: 'failed',
      context: {},
      payload: {
        reconciliationId: reconciliation.reconciliationId,
        status: reconciliation.status,
      },
    })

    return {
      run: failedRun,
      output: [
        `Broadcast ${broadcast.broadcastId} confirmed.`,
        'Reconciliation reported a mismatch.',
        `Execution report ${report.reportId} created.`,
      ],
    }
  }

  private buildTransferCloseoutReport(input: {
    session: SessionState
    run: RunState
    at: string
    broadcast: BroadcastRecord
    signatureResult: SignatureResult
    reconciliation: ReconciliationReport
  }): TransferCloseoutReport {
    const notes = [
      input.broadcast.summary,
      input.reconciliation.summary,
      ...input.reconciliation.checks
        .filter((check) => check.status === 'failed')
        .map((check) => check.reason ?? check.checkId),
    ]

    return {
      reportId: this.deps.createId('report'),
      runId: input.run.runId,
      sessionId: input.session.sessionId,
      actionType: input.run.actionType,
      createdAt: input.at,
      finalStatus:
        input.reconciliation.status === 'matched' ? 'completed' : 'failed',
      summary:
        input.reconciliation.status === 'matched'
          ? `Transfer run ${input.run.runId} completed successfully.`
          : `Transfer run ${input.run.runId} completed with reconciliation failure.`,
      intentRef: input.run.intentRef,
      approvalStateRef: input.run.approvalStateRef,
      simulationRef: input.run.simulationRefs.at(-1),
      signatureRequestRef: input.run.signatureRequestRefs.at(-1),
      signatureResultRef: input.run.signatureResultRefs.at(-1),
      broadcastRef: input.broadcast.broadcastId,
      reconciliationId: input.reconciliation.reconciliationId,
      reconciliationStatus: input.reconciliation.status,
      transactionHash:
        input.broadcast.transactionHash ?? input.signatureResult.transactionHash,
      notes,
    }
  }

  private buildRunCloseoutReport(input: {
    session: SessionState
    run: RunState
    at: string
    summary: string
    notes: string[]
    walletIds?: string[]
  }): RunCloseoutReport {
    return {
      reportId: this.deps.createId('report'),
      runId: input.run.runId,
      sessionId: input.session.sessionId,
      actionType: input.run.actionType,
      createdAt: input.at,
      finalStatus: 'completed',
      summary: input.summary,
      intentRef: input.run.intentRef,
      notes: input.notes,
      walletIds: input.walletIds,
    }
  }

  private buildDeterministicWalletAddress(walletId: string): string {
    return `0x${createHash('sha256')
      .update(walletId)
      .digest('hex')
      .slice(0, 40)}`
  }

  private async persistApprovalDecisionForRun(
    run: RunState,
    status: 'approved' | 'rejected' | 'expired' | 'invalidated',
    approvalStateRef: string | undefined,
    approvalRecord:
      | {
          approvalRecordId?: string
          approver: {
            actorId: string
            role: string
          }
          comment?: string
          decidedAt?: string
        }
      | undefined,
    at: string,
  ): Promise<{
    run: RunState
    approvalState: ApprovalState
    artifact: ArtifactRef
  }> {
    const currentApprovalState = await this.readArtifactJson<ApprovalState>(
      run.approvalArtifactPath,
    )
    const resolvedApprovalStateRef =
      approvalStateRef ?? run.approvalStateRef ?? this.deps.createId('approval_state')

    const baseApprovalState: ApprovalState = currentApprovalState
      ? {
          ...currentApprovalState,
          approvalStateId: resolvedApprovalStateRef,
          invalidationReason: undefined,
        }
      : {
          approvalStateId: resolvedApprovalStateRef,
          status: 'pending',
          approvalClass: status === 'approved' ? 'single_human' : 'blocked',
          requirement: {
            requirementId: this.deps.createId('approval_requirement'),
            intentRef:
              run.intentRef ?? {
                intentId: 'unknown_intent',
                version: 'unknown',
              },
            policyRef: {
              policyProfileId: 'callback_approval',
              version: 'v1',
            },
            reason: 'Approval callback supplied decision state.',
            requiredApprovals: 1,
            materialHash: 'callback_material_hash',
            createdAt: at,
          },
          approvals: [],
        }

    let updatedApprovalState: ApprovalState = baseApprovalState

    if (status === 'approved' || status === 'rejected') {
      const record: ApprovalRecord = {
        approvalRecordId:
          approvalRecord?.approvalRecordId ?? this.deps.createId('approval_record'),
        requirementId: baseApprovalState.requirement.requirementId,
        approver: approvalRecord?.approver ?? {
          actorId: 'callback_approver',
          role: 'unknown',
        },
        decision: status,
        decidedAt: approvalRecord?.decidedAt ?? at,
        comment: approvalRecord?.comment,
        intentRef: baseApprovalState.requirement.intentRef,
        materialHash: baseApprovalState.requirement.materialHash,
      }

      const approvals = [
        ...baseApprovalState.approvals.filter(
          (existingRecord) =>
            existingRecord.approvalRecordId !== record.approvalRecordId,
        ),
        record,
      ]

      const approvedRecords = approvals.filter(
        (existingRecord) => existingRecord.decision === 'approved',
      )
      const uniqueRoles = new Set(
        approvedRecords.map((existingRecord) => existingRecord.approver.role),
      )

      updatedApprovalState = {
        ...baseApprovalState,
        approvals,
        status: approvals.some((existingRecord) => existingRecord.decision === 'rejected')
          ? 'rejected'
          : approvedRecords.length >= baseApprovalState.requirement.requiredApprovals &&
              (!baseApprovalState.requirement.roleSeparationRequired ||
                uniqueRoles.size >= baseApprovalState.requirement.requiredApprovals)
            ? 'approved'
            : 'pending',
      }
    } else {
      updatedApprovalState = {
        ...baseApprovalState,
        status,
        invalidationReason: `${status} @ ${at}`,
      }
    }

    const approvalArtifact = await this.deps.persistence.artifacts.write(
      {
        artifactType: 'approval_record',
        path: `runs/${run.runId}/ledger/artifacts/approvals/${resolvedApprovalStateRef}.${updatedApprovalState.status}.${this.deps.createId('approval_event')}.json`,
      },
      updatedApprovalState,
    )

    const updatedRun: RunState = {
      ...run,
      approvalStateRef: resolvedApprovalStateRef,
      approvalArtifactPath: approvalArtifact.path,
      status:
        updatedApprovalState.status === 'approved'
          ? 'active'
          : updatedApprovalState.status === 'pending'
            ? 'waiting_for_approval'
            : 'failed',
      lastUpdatedAt: at,
    }

    await this.deps.runs.put(updatedRun)
    return {
      run: updatedRun,
      approvalState: updatedApprovalState,
      artifact: approvalArtifact,
    }
  }
}

export function inferActionTypeFromText(
  text?: string,
): IntentActionType | undefined {
  return detectRequestedActionType(text)
}
