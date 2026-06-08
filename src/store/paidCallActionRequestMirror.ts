import type { ActionRequestRegistry } from './ActionRequestRegistry.js'
import type { PaidCallRecord } from './PaidCallRegistry.js'
import { mapPaidCallToActionRequest } from './mapPaidCallToActionRequest.js'

export async function mirrorPaidCallRecord(
  actionRequests: ActionRequestRegistry,
  record: PaidCallRecord,
): Promise<void> {
  const current = await actionRequests.get(record.executionId)
  await actionRequests.put(mapPaidCallToActionRequest(record, current))
}

export async function removeMirroredActionRequest(
  actionRequests: ActionRequestRegistry,
  executionId: string,
): Promise<void> {
  await actionRequests.remove(executionId)
}
