import { createContext, useContext } from 'react'

// Operator session context. The provider (OperatorSessionProvider) lives in its
// own file so this module exports no components — keeping React Fast Refresh happy.
export const OperatorSessionContext = createContext(null)

export function useOperatorSession() {
  const context = useContext(OperatorSessionContext)
  if (!context) {
    throw new Error(
      'useOperatorSession must be used within an OperatorSessionProvider',
    )
  }
  return context
}
