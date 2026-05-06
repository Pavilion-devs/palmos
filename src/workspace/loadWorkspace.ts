import {
  DefaultSessionKernel,
  DeterministicSignerGateway,
  FileKernelPersistence,
  OwsWalletProvider,
  FileRunRegistry,
  FileSessionRegistry,
  FileWalletRegistry,
  type RuntimeEnvironment,
} from '../../runtime/index.js'
import { OwsClient } from '../integrations/ows/client.js'
import {
  createAgentPolicyCandidateResolver,
} from '../policies/compileAgentPolicy.js'
import { FileAgentControlEventRegistry } from '../store/AgentControlEventRegistry.js'
import { FileAgentCredentialRegistry } from '../store/AgentCredentialRegistry.js'
import { FileAgentRegistry } from '../store/AgentRegistry.js'
import { FileOwsAccessRegistry } from '../store/OwsAccessRegistry.js'
import { FilePalmosServiceRegistry } from '../store/PalmosServiceRegistry.js'
import { FilePaidCallRegistry } from '../store/PaidCallRegistry.js'
import { FileXMTPAlertRegistry } from '../store/XMTPAlertRegistry.js'

export type AgentSpendWorkspace = {
  baseDir: string
  kernel: DefaultSessionKernel
  agentRegistry: FileAgentRegistry
  walletRegistry: FileWalletRegistry
  paidCallRegistry: FilePaidCallRegistry
  runRegistry: FileRunRegistry
  controlEventRegistry: FileAgentControlEventRegistry
  agentCredentialRegistry: FileAgentCredentialRegistry
  serviceRegistry: FilePalmosServiceRegistry
  xmtpAlertRegistry: FileXMTPAlertRegistry
  owsAccessRegistry: FileOwsAccessRegistry
  owsClient?: OwsClient
}

export function loadAgentSpendWorkspace(input: {
  baseDir: string
  environment?: RuntimeEnvironment
  now?: () => string
  createId?: (prefix: string) => string
}): AgentSpendWorkspace {
  const now = input.now ?? (() => new Date().toISOString())
  const agentRegistry = new FileAgentRegistry(input.baseDir)
  const walletRegistry = new FileWalletRegistry(input.baseDir)
  const paidCallRegistry = new FilePaidCallRegistry(input.baseDir)
  const runRegistry = new FileRunRegistry(input.baseDir)
  const controlEventRegistry = new FileAgentControlEventRegistry(input.baseDir)
  const agentCredentialRegistry = new FileAgentCredentialRegistry(input.baseDir)
  const serviceRegistry = new FilePalmosServiceRegistry(input.baseDir)
  const xmtpAlertRegistry = new FileXMTPAlertRegistry(input.baseDir)
  const owsAccessRegistry = new FileOwsAccessRegistry(input.baseDir)
  const owsClient = OwsClient.fromEnv(input.baseDir)
  const kernel = new DefaultSessionKernel({
    persistence: new FileKernelPersistence(input.baseDir),
    sessions: new FileSessionRegistry(input.baseDir),
    runs: runRegistry,
    walletRegistry,
    walletProvider:
      owsClient != null
        ? new OwsWalletProvider({
            registry: walletRegistry,
            vaultPath: owsClient.vaultPath,
          })
        : undefined,
    signerGateway: new DeterministicSignerGateway('pending'),
    getPolicyCandidates: createAgentPolicyCandidateResolver({
      agentRegistry,
      now,
    }),
    now,
    createId: input.createId,
  })

  return {
    baseDir: input.baseDir,
    kernel,
    agentRegistry,
    walletRegistry,
    paidCallRegistry,
    runRegistry,
    controlEventRegistry,
    agentCredentialRegistry,
    serviceRegistry,
    xmtpAlertRegistry,
    owsAccessRegistry,
    owsClient,
  }
}
