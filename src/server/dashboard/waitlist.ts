import { mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { writeJsonFile } from '../../../runtime/runtime/jsonFile.js'
import { createId, readMaybeString, readRecord } from './shared.js'

export type WaitlistSubmission = {
  id: string
  createdAt: string
  name: string
  email: string
  roleCompany: string
  agentUseCase: string
  source: 'landing'
}

function sanitizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

export function readWaitlistSubmission(
  value: unknown,
): Omit<WaitlistSubmission, 'id' | 'createdAt' | 'source'> | undefined {
  const candidate = readRecord(value)
  const name = readMaybeString(candidate.name)
  const email = readMaybeString(candidate.email)
  const roleCompany = readMaybeString(candidate.roleCompany)
  const agentUseCase = readMaybeString(candidate.agentUseCase)

  if (!name || !email || !roleCompany || !agentUseCase) {
    return undefined
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return undefined
  }

  return {
    name: name.slice(0, 160),
    email: sanitizeEmail(email).slice(0, 240),
    roleCompany: roleCompany.slice(0, 200),
    agentUseCase: agentUseCase.slice(0, 800),
  }
}

async function readWaitlist(baseDir: string): Promise<WaitlistSubmission[]> {
  try {
    const contents = await readFile(
      join(baseDir, 'waitlist-submissions.json'),
      'utf8',
    )
    const parsed = JSON.parse(contents)
    return Array.isArray(parsed) ? (parsed as WaitlistSubmission[]) : []
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return []
    }

    throw error
  }
}

async function appendWaitlistSubmission(
  baseDir: string,
  submission: WaitlistSubmission,
): Promise<void> {
  await mkdir(baseDir, { recursive: true })
  const current = await readWaitlist(baseDir)
  const deduped = current.filter((item) => item.email !== submission.email)
  await writeJsonFile(join(baseDir, 'waitlist-submissions.json'), [
    ...deduped,
    submission,
  ])
}

export async function saveWaitlistSubmission(
  baseDir: string,
  input: Omit<WaitlistSubmission, 'id' | 'createdAt' | 'source'>,
): Promise<WaitlistSubmission> {
  const submission: WaitlistSubmission = {
    ...input,
    id: createId('waitlist'),
    createdAt: new Date().toISOString(),
    source: 'landing',
  }
  await appendWaitlistSubmission(baseDir, submission)
  return submission
}
