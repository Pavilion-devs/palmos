import { Shell } from '../Shell'
import { ConnectAgentPanel } from './ConnectAgentPanel'

// Connect-agent surface: the 0-agents empty state and the #redesign/connect route.
export function ConnectAgentPage({ onConnected }) {
  return (
    <Shell title="Connect agent">
      <div className="flex flex-1 items-start justify-center pt-2">
        <ConnectAgentPanel onConnected={onConnected} />
      </div>
    </Shell>
  )
}
