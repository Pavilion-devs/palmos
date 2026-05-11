type OnboardingField =
  | 'agentTask'
  | 'maxPerCall'
  | 'sessionBudget'
  | 'autoApproveUnder'
  | 'allowedVendors'
  | 'walletMode'
  | 'managerAddress'
  | 'anthropicKey'
  | 'walletSecret'

type OnboardingInputType = 'text' | 'amount' | 'choice' | 'secret'

type OnboardingState = {
  agentName?: string
  agentTask?: string
  maxPerCall?: string
  sessionBudget?: string
  autoApproveUnder?: string
  allowedVendors?: string[]
  walletMode?: WalletMode
  managerAddress?: string
  hasAnthropicKey?: boolean
  hasWalletSecret?: boolean
}

type WalletMode = 'local-demo' | 'ows' | 'real-solana'

type OnboardingPrompt = {
  field: OnboardingField
  message: string
  inputType: OnboardingInputType
  placeholder?: string
  suffix?: string
  optional?: boolean
  choices?: Array<{ value: string; label: string }>
}

type OnboardingTurn = OnboardingPrompt & {
  ok: boolean
  state: OnboardingState
  complete: boolean
  validationError?: string
}

type OnboardingIntent =
  | {
      intent: 'set_text'
      field: 'agentTask' | 'allowedVendors'
      value: string
      confidence: number
    }
  | {
      intent: 'set_amount'
      field: 'maxPerCall' | 'sessionBudget' | 'autoApproveUnder'
      value: string
      confidence: number
    }
  | {
      intent: 'choose_wallet_mode'
      field: 'walletMode'
      value: WalletMode
      confidence: number
    }
  | {
      intent: 'provide_address'
      field: 'managerAddress'
      value: string
      confidence: number
    }
  | {
      intent: 'confirm' | 'skip' | 'unknown'
      field: string
      confidence: number
    }

type IntentResult =
  | { valid: true; state: OnboardingState }
  | { valid: false; validationError: string; message: string }

const ONBOARDING_ORDER: OnboardingField[] = [
  'agentTask',
  'maxPerCall',
  'sessionBudget',
  'autoApproveUnder',
  'allowedVendors',
  'walletMode',
  'managerAddress',
  'anthropicKey',
  'walletSecret',
]

const AMOUNT_FIELDS = new Set<OnboardingField>([
  'maxPerCall',
  'sessionBudget',
  'autoApproveUnder',
])

const OPTIONAL_FIELDS = new Set<OnboardingField>([
  'managerAddress',
  'anthropicKey',
  'walletSecret',
])

const ONBOARDING_PROMPTS: Record<OnboardingField, OnboardingPrompt> = {
  agentTask: {
    field: 'agentTask',
    message:
      "Let's register your external agent with PalmOS. Which paid services should it be allowed to use?",
    inputType: 'text',
    placeholder: 'Market data APIs and ops brief vendors',
  },
  maxPerCall: {
    field: 'maxPerCall',
    message:
      'What is the most this agent can spend on one paid API call? New agents start with a lower effective cap, so 2.00 PUSD is a good demo default.',
    inputType: 'amount',
    placeholder: '2.00',
    suffix: 'PUSD',
  },
  sessionBudget: {
    field: 'sessionBudget',
    message:
      'What total PUSD budget should this agent have for the session?',
    inputType: 'amount',
    placeholder: '1.00',
    suffix: 'PUSD',
  },
  autoApproveUnder: {
    field: 'autoApproveUnder',
    message:
      'What PUSD amount should PalmOS auto-approve without interrupting you?',
    inputType: 'amount',
    placeholder: '0.05',
    suffix: 'PUSD',
  },
  allowedVendors: {
    field: 'allowedVendors',
    message:
      'Which paid services should this agent be allowed to use? List service ids separated by commas.',
    inputType: 'text',
    placeholder: 'local.pusd.ops_brief, local.pusd.spot_price',
  },
  walletMode: {
    field: 'walletMode',
    message: 'Choose the wallet mode for this run.',
    inputType: 'choice',
    choices: [
      { value: 'local-demo', label: 'Service-test settlement' },
      { value: 'ows', label: 'OWS governed wallet' },
      { value: 'real-solana', label: 'Real Solana settlement' },
    ],
  },
  managerAddress: {
    field: 'managerAddress',
    message:
      'Where should approval requests go? Paste a manager XMTP address or inbox id. You can skip this for local demo.',
    inputType: 'text',
    placeholder: '0x... or inbox id',
    optional: true,
  },
  anthropicKey: {
    field: 'anthropicKey',
    message:
      'Your Anthropic key should live in your local .env. Add a masked marker here, or skip this step.',
    inputType: 'secret',
    placeholder: 'leave blank if .env is set',
    optional: true,
  },
  walletSecret: {
    field: 'walletSecret',
    message:
      'For demo mode you can skip the wallet secret. Add one only if this run needs direct wallet signing.',
    inputType: 'secret',
    placeholder: 'masked wallet secret',
    optional: true,
  },
}

export function readOnboardingField(value: unknown): OnboardingField {
  return ONBOARDING_ORDER.includes(value as OnboardingField)
    ? (value as OnboardingField)
    : 'agentTask'
}

export function readOnboardingState(value: unknown): OnboardingState {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const candidate = value as Record<string, unknown>
  const state: OnboardingState = {}

  if (typeof candidate.agentName === 'string') {
    state.agentName = candidate.agentName
  }
  if (typeof candidate.agentTask === 'string') {
    state.agentTask = candidate.agentTask
  }
  if (typeof candidate.maxPerCall === 'string') {
    state.maxPerCall = candidate.maxPerCall
  }
  if (typeof candidate.sessionBudget === 'string') {
    state.sessionBudget = candidate.sessionBudget
  }
  if (typeof candidate.autoApproveUnder === 'string') {
    state.autoApproveUnder = candidate.autoApproveUnder
  }
  if (Array.isArray(candidate.allowedVendors)) {
    state.allowedVendors = candidate.allowedVendors.filter(
      (vendor): vendor is string => typeof vendor === 'string',
    )
  }
  if (isWalletMode(candidate.walletMode)) {
    state.walletMode = candidate.walletMode
  }
  if (typeof candidate.managerAddress === 'string') {
    state.managerAddress = candidate.managerAddress
  }
  if (typeof candidate.hasAnthropicKey === 'boolean') {
    state.hasAnthropicKey = candidate.hasAnthropicKey
  }
  if (typeof candidate.hasWalletSecret === 'boolean') {
    state.hasWalletSecret = candidate.hasWalletSecret
  }

  return state
}

export async function createOnboardingTurn(
  env: Record<string, string | undefined>,
  input: {
    field?: string
    userReply?: string
    state?: unknown
  },
): Promise<OnboardingTurn> {
  const field = readOnboardingField(input.field)
  const state = readOnboardingState(input.state)
  const rawReply = input.userReply?.trim() ?? ''

  if (isSecretField(field)) {
    return advanceFromSecret(env, field, rawReply, state)
  }

  const prompt = promptForField(env, field, state)
  const intent = await parseOnboardingIntent(env, {
    field,
    prompt,
    state,
    userReply: rawReply,
  })
  let result = validateIntent(field, rawReply, state, intent)

  if (!result.valid && env.ANTHROPIC_API_KEY?.trim()) {
    const localResult = validateIntent(
      field,
      rawReply,
      state,
      parseIntentLocally(field, rawReply),
    )
    if (localResult.valid) {
      result = localResult
    }
  }

  if (!result.valid) {
    return {
      ...prompt,
      ok: false,
      complete: false,
      state,
      validationError: result.validationError,
      message: result.message,
    }
  }

  return advanceFromField(env, field, rawReply, result.state)
}

function promptForField(
  env: Record<string, string | undefined>,
  field: OnboardingField,
  state: OnboardingState,
): OnboardingPrompt {
  const prompt = ONBOARDING_PROMPTS[field]

  if (field === 'anthropicKey' && env.ANTHROPIC_API_KEY?.trim()) {
    return {
      ...prompt,
      message:
        'I found the Anthropic key in your local environment. You can skip this step.',
    }
  }

  if (field === 'walletSecret' && state.walletMode === 'real-solana') {
    return {
      ...prompt,
      message:
        'For real Solana signing, keep the wallet secret in .env. Do not paste the raw key here; skip when ready.',
      placeholder: 'skip if .env is ready',
    }
  }

  if (field === 'walletSecret' && state.walletMode === 'ows') {
    return {
      ...prompt,
      message:
        'OWS handles wallet access for this demo, so you can skip the wallet secret.',
      placeholder: 'skip for OWS',
    }
  }

  return prompt
}

function advanceFromSecret(
  env: Record<string, string | undefined>,
  field: OnboardingField,
  rawReply: string,
  state: OnboardingState,
): OnboardingTurn {
  const updatedState: OnboardingState = { ...state }

  if (field === 'anthropicKey') {
    updatedState.hasAnthropicKey = Boolean(
      rawReply || env.ANTHROPIC_API_KEY?.trim(),
    )
  }

  if (field === 'walletSecret') {
    updatedState.hasWalletSecret = Boolean(rawReply)
  }

  return advanceFromField(env, field, rawReply, updatedState)
}

function advanceFromField(
  env: Record<string, string | undefined>,
  field: OnboardingField,
  _rawReply: string,
  state: OnboardingState,
): OnboardingTurn {
  const nextField = nextOnboardingField(field)

  if (!nextField) {
    const completedState = completeOnboardingState(state)
    return {
      ...promptForField(env, field, completedState),
      ok: true,
      state: completedState,
      complete: true,
      message:
        'That is enough to register the governed payment profile. Next, copy an SDK credential and connect your agent code.',
    }
  }

  const nextPrompt = promptForField(env, nextField, state)
  return {
    ...nextPrompt,
    ok: true,
    state,
    complete: false,
  }
}

async function parseOnboardingIntent(
  env: Record<string, string | undefined>,
  input: {
    field: OnboardingField
    prompt: OnboardingPrompt
    state: OnboardingState
    userReply: string
  },
): Promise<OnboardingIntent> {
  const apiKey = env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) {
    return parseIntentLocally(input.field, input.userReply)
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL?.trim() || 'claude-haiku-4-5',
        max_tokens: 180,
        temperature: 0,
        system: [
          'You parse PalmOS onboarding replies into structured JSON intents.',
          'Return JSON only. No markdown, prose, or code fences.',
          'Do not invent values. Extract only values explicitly present in the user reply.',
          'Confirmations are only valid when the backend has a pending confirmation. This flow has no pending confirmation state, so vague confirmations must be unknown.',
          'Return unknown for vague replies such as "yes PUSD", "Yep PUSD", or "yes for both" when a concrete value is required.',
        ].join(' '),
        messages: [
          {
            role: 'user',
            content: JSON.stringify({
              currentField: input.field,
              expectedInputType: input.prompt.inputType,
              currentState: sanitizeStateForIntent(input.state),
              userReply: input.userReply,
              schema:
                "One of: {intent:'set_text',field:'agentTask'|'allowedVendors',value:string,confidence:number}, {intent:'set_amount',field:'maxPerCall'|'sessionBudget'|'autoApproveUnder',value:string,confidence:number}, {intent:'choose_wallet_mode',field:'walletMode',value:'local-demo'|'ows'|'real-solana',confidence:number}, {intent:'provide_address',field:'managerAddress',value:string,confidence:number}, {intent:'confirm'|'skip'|'unknown',field:string,confidence:number}",
            }),
          },
        ],
      }),
    })

    if (!response.ok) {
      return parseIntentLocally(input.field, input.userReply)
    }

    const parsed = parseIntentJson(extractAnthropicText(await response.json()))
    return parsed ?? parseIntentLocally(input.field, input.userReply)
  } catch {
    return parseIntentLocally(input.field, input.userReply)
  }
}

function validateIntent(
  field: OnboardingField,
  rawReply: string,
  state: OnboardingState,
  intent: OnboardingIntent,
): IntentResult {
  if (!rawReply) {
    if (OPTIONAL_FIELDS.has(field)) {
      return {
        valid: true,
        state: applySkip(field, state),
      }
    }

    return invalidForField(field, 'required_value')
  }

  if (intent.intent === 'skip') {
    if (!OPTIONAL_FIELDS.has(field)) {
      return invalidForField(field, 'skip_not_allowed')
    }

    return {
      valid: true,
      state: applySkip(field, state),
    }
  }

  if (intent.intent === 'confirm') {
    return invalidForField(field, expectedValidationError(field))
  }

  if (field === 'agentTask') {
    if (
      intent.intent !== 'set_text' ||
      intent.field !== field ||
      isVagueConfirmation(intent.value) ||
      !hasUsefulText(intent.value)
    ) {
      return invalidForField(field, 'missing_text')
    }

    return {
      valid: true,
      state: {
        ...state,
        agentTask: intent.value.trim(),
      },
    }
  }

  if (AMOUNT_FIELDS.has(field)) {
    if (intent.intent !== 'set_amount' || intent.field !== field) {
      return invalidForField(field, 'missing_amount')
    }

    const amount = parseAmount(intent.value)
    if (!amount) {
      return invalidForField(field, 'missing_amount')
    }

    return {
      valid: true,
      state: {
        ...state,
        [field]: amount,
      },
    }
  }

  if (field === 'allowedVendors') {
    if (intent.intent !== 'set_text' || intent.field !== field) {
      return invalidForField(field, 'missing_vendors')
    }

    const vendors = parseVendors(intent.value)
    if (vendors.length === 0) {
      return invalidForField(field, 'missing_vendors')
    }

    return {
      valid: true,
      state: {
        ...state,
        allowedVendors: vendors,
      },
    }
  }

  if (field === 'walletMode') {
    if (
      intent.intent !== 'choose_wallet_mode' ||
      intent.field !== field ||
      !isWalletMode(intent.value)
    ) {
      return invalidForField(field, 'invalid_wallet_mode')
    }

    return {
      valid: true,
      state: {
        ...state,
        walletMode: intent.value,
      },
    }
  }

  if (field === 'managerAddress') {
    if (intent.intent !== 'provide_address' || intent.field !== field) {
      return invalidForField(field, 'missing_address')
    }

    const address = parseAddress(intent.value)
    if (!address) {
      return invalidForField(field, 'missing_address')
    }

    return {
      valid: true,
      state: {
        ...state,
        managerAddress: address,
      },
    }
  }

  return invalidForField(field, 'unknown_intent')
}

function parseIntentLocally(
  field: OnboardingField,
  userReply: string,
): OnboardingIntent {
  const reply = userReply.trim()
  const lower = reply.toLowerCase()

  if (!reply) {
    return { intent: 'skip', field, confidence: 1 }
  }

  if (isSkipReply(lower)) {
    return { intent: 'skip', field, confidence: 0.95 }
  }

  if (isVagueConfirmation(reply)) {
    return { intent: 'confirm', field, confidence: 0.85 }
  }

  if (field === 'walletMode') {
    const walletMode = parseWalletMode(reply)
    if (walletMode) {
      return {
        intent: 'choose_wallet_mode',
        field,
        value: walletMode,
        confidence: 0.9,
      }
    }
  }

  if (AMOUNT_FIELDS.has(field)) {
    const amount = parseAmount(reply)
    if (amount) {
      return {
        intent: 'set_amount',
        field: field as 'maxPerCall' | 'sessionBudget' | 'autoApproveUnder',
        value: amount,
        confidence: 0.9,
      }
    }
  }

  if (field === 'managerAddress') {
    const address = parseAddress(reply)
    if (address) {
      return {
        intent: 'provide_address',
        field,
        value: address,
        confidence: 0.9,
      }
    }
  }

  if (field === 'agentTask' && hasUsefulText(reply)) {
    return {
      intent: 'set_text',
      field,
      value: reply,
      confidence: 0.8,
    }
  }

  if (field === 'allowedVendors') {
    const vendors = parseVendors(reply)
    if (vendors.length > 0) {
      return {
        intent: 'set_text',
        field,
        value: vendors.join(', '),
        confidence: 0.85,
      }
    }
  }

  return { intent: 'unknown', field, confidence: 0.4 }
}

function parseIntentJson(text: string | undefined): OnboardingIntent | undefined {
  if (!text) {
    return undefined
  }

  const jsonStart = text.indexOf('{')
  const jsonEnd = text.lastIndexOf('}')
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return undefined
  }

  try {
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as unknown
    return isOnboardingIntent(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function isOnboardingIntent(value: unknown): value is OnboardingIntent {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.intent !== 'string' ||
    typeof candidate.field !== 'string' ||
    typeof candidate.confidence !== 'number'
  ) {
    return false
  }

  if (
    candidate.intent === 'set_text' ||
    candidate.intent === 'set_amount' ||
    candidate.intent === 'provide_address'
  ) {
    return typeof candidate.value === 'string'
  }

  if (candidate.intent === 'choose_wallet_mode') {
    return isWalletMode(candidate.value)
  }

  return (
    candidate.intent === 'confirm' ||
    candidate.intent === 'skip' ||
    candidate.intent === 'unknown'
  )
}

function extractAnthropicText(payload: unknown): string | undefined {
  const content = (payload as { content?: Array<{ type?: string; text?: string }> })
    ?.content
  const text = content?.find((item) => item.type === 'text')?.text?.trim()
  return text || undefined
}

function sanitizeStateForIntent(state: OnboardingState): OnboardingState {
  return {
    agentName: state.agentName,
    agentTask: state.agentTask,
    maxPerCall: state.maxPerCall,
    sessionBudget: state.sessionBudget,
    autoApproveUnder: state.autoApproveUnder,
    allowedVendors: state.allowedVendors,
    walletMode: state.walletMode,
    managerAddress: state.managerAddress,
    hasAnthropicKey: Boolean(state.hasAnthropicKey),
    hasWalletSecret: Boolean(state.hasWalletSecret),
  }
}

function parseAmount(value: string): string | undefined {
  if (isVagueConfirmation(value)) {
    return undefined
  }

  const match = value.replace(/,/g, '').match(/(?:^|[^\d.])(\d+(?:\.\d+)?)(?=$|[^\d.])/)
  if (!match?.[1]) {
    return undefined
  }

  const parsed = Number(match[1])
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined
  }

  return parsed.toFixed(6).replace(/\.?0+$/, '')
}

function parseVendors(value: string): string[] {
  if (isVagueConfirmation(value)) {
    return []
  }

  const vendors = value
    .split(',')
    .map((vendor) => vendor.trim())
    .filter(Boolean)
    .filter((vendor) => /[a-z]/i.test(vendor))
    .filter((vendor) => /^[a-z0-9][a-z0-9._:/-]*$/i.test(vendor))

  return Array.from(new Set(vendors))
}

function parseWalletMode(value: string): WalletMode | undefined {
  const lower = value.toLowerCase()

  if (/\bows\b|open wallet standard/.test(lower)) {
    return 'ows'
  }

  if (/real|mainnet|solana|funded|production/.test(lower)) {
    return 'real-solana'
  }

  if (/local|demo|test/.test(lower)) {
    return 'local-demo'
  }

  return undefined
}

function parseAddress(value: string): string | undefined {
  if (isVagueConfirmation(value)) {
    return undefined
  }

  const evmAddress = value.match(/0x[a-fA-F0-9]{40}/)?.[0]
  if (evmAddress) {
    return evmAddress
  }

  const inboxOrAddress = value
    .split(/\s+/)
    .map((part) => part.trim().replace(/[.,;:!?]+$/g, ''))
    .find((part) => {
      return (
        part.length >= 8 &&
        part.length <= 120 &&
        /[a-z0-9]/i.test(part) &&
        /^[a-z0-9][a-z0-9._:@-]*$/i.test(part) &&
        !isVagueConfirmation(part)
      )
    })

  return inboxOrAddress
}

function isWalletMode(value: unknown): value is WalletMode {
  return value === 'local-demo' || value === 'ows' || value === 'real-solana'
}

function isSecretField(field: OnboardingField): boolean {
  return field === 'anthropicKey' || field === 'walletSecret'
}

function isSkipReply(value: string): boolean {
  return /^(skip|pass|not now|later|none|no thanks)$/i.test(value.trim())
}

function isVagueConfirmation(value: string): boolean {
  return /^(y|yes|yeah|yep|sure|ok|okay|confirm|proceed|yes proceed|yep pusd|yes pusd|yes for both)$/i.test(
    value.trim(),
  )
}

function hasUsefulText(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length >= 4 && /[a-z]/i.test(trimmed) && !isBareAmount(trimmed)
}

function isBareAmount(value: string): boolean {
  return /^\d+(?:\.\d+)?(?:\s*(?:p?usd|dollars?))?$/i.test(value.trim())
}

function applySkip(
  field: OnboardingField,
  state: OnboardingState,
): OnboardingState {
  if (field === 'managerAddress') {
    return {
      ...state,
      managerAddress: '',
    }
  }

  if (field === 'anthropicKey') {
    return {
      ...state,
      hasAnthropicKey: false,
    }
  }

  if (field === 'walletSecret') {
    return {
      ...state,
      hasWalletSecret: false,
    }
  }

  return state
}

function invalidForField(
  field: OnboardingField,
  validationError: string,
): IntentResult {
  return {
    valid: false,
    validationError,
    message: validationMessage(field, validationError),
  }
}

function expectedValidationError(field: OnboardingField): string {
  if (AMOUNT_FIELDS.has(field)) {
    return 'missing_amount'
  }

  if (field === 'allowedVendors') {
    return 'missing_vendors'
  }

  if (field === 'walletMode') {
    return 'invalid_wallet_mode'
  }

  if (field === 'managerAddress') {
    return 'missing_address'
  }

  if (field === 'agentTask') {
    return 'missing_text'
  }

  return 'unknown_intent'
}

function validationMessage(field: OnboardingField, validationError: string): string {
  if (validationError === 'skip_not_allowed') {
    return 'I need a value for this step before we can continue.'
  }

  if (validationError === 'confirmation_not_expected') {
    return 'There is nothing to confirm yet. Please answer the current setup question.'
  }

  if (field === 'maxPerCall') {
    return 'I need a number for the per-call limit. For example: 0.05 PUSD.'
  }

  if (field === 'sessionBudget') {
    return 'I need a number for the total session budget. For example: 1.00 PUSD.'
  }

  if (field === 'autoApproveUnder') {
    return 'I need a number for the auto-approval limit. For example: 0.05 PUSD.'
  }

  if (field === 'allowedVendors') {
    return 'List service ids separated by commas, for example local.pusd.ops_brief, local.pusd.spot_price.'
  }

  if (field === 'walletMode') {
    return 'Choose one of the wallet modes.'
  }

  if (field === 'managerAddress') {
    return 'I need the actual XMTP address or inbox id. You can also skip this step.'
  }

  if (field === 'agentTask') {
    return 'Tell me which paid services this external agent should be allowed to use.'
  }

  return 'Please answer the current setup question.'
}

function nextOnboardingField(field: OnboardingField): OnboardingField | undefined {
  const currentIndex = ONBOARDING_ORDER.indexOf(field)
  return ONBOARDING_ORDER[currentIndex + 1]
}

function completeOnboardingState(state: OnboardingState): OnboardingState {
  return {
    agentName: state.agentName || 'External Agent',
    agentTask: state.agentTask || 'Use approved paid services through PalmOS',
    maxPerCall: state.maxPerCall || '2.00',
    sessionBudget: state.sessionBudget || '2.00',
    autoApproveUnder: state.autoApproveUnder || '0.05',
    allowedVendors:
      state.allowedVendors && state.allowedVendors.length > 0
        ? state.allowedVendors
        : ['local.pusd.ops_brief', 'local.pusd.spot_price'],
    walletMode: state.walletMode || 'local-demo',
    managerAddress: state.managerAddress || '',
    hasAnthropicKey: Boolean(state.hasAnthropicKey),
    hasWalletSecret: Boolean(state.hasWalletSecret),
  }
}
