import { ArrowRight, ShieldCheck, Wallet } from 'lucide-react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useOperatorSession } from '../../../hooks/useOperatorSession'

function formatAddress(address) {
  return address && address.length > 8
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : address
}

// "Connect to PalmOS" front door (dark/lime). Replaces the retired passcode page.
// Two steps: connect a Solana wallet, then sign the server nonce (SIWS). No forms.
export function ConnectScreen() {
  const { wallets, select, connected, connecting, publicKey, wallet, disconnect } =
    useWallet()
  const { status, error, signIn } = useOperatorSession()

  const signing = status === 'signing'
  const address = publicKey?.toBase58()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-10 font-sans text-foreground antialiased">
      <div className="w-full max-w-md rounded-[var(--radius)] border border-hairline bg-panel p-8 shadow-2xl">
        <div className="mb-7">
          <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-lime/15 ring-1 ring-lime/30">
            <Wallet className="size-6 text-lime" strokeWidth={2} aria-hidden="true" />
          </div>
          <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Operator dashboard
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Connect to PalmOS
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Sign in with your Solana wallet. Your wallet is your login — no
            email, no password.
          </p>
        </div>

        {error && (
          <div className="mb-5 rounded-[var(--radius-sm)] border border-blocked/30 bg-blocked/10 px-3 py-2 text-sm text-blocked">
            {error}
          </div>
        )}

        {connected && address ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-hairline bg-panel-2 px-4 py-3">
              <div className="flex items-center gap-3">
                {wallet?.adapter.icon && (
                  <img
                    src={wallet.adapter.icon}
                    alt=""
                    className="size-6 rounded"
                    aria-hidden="true"
                  />
                )}
                <div className="leading-tight">
                  <div className="text-sm font-medium">
                    {wallet?.adapter.name ?? 'Wallet'}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {formatAddress(address)}
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void signIn()}
              disabled={signing}
              className="group flex w-full items-center justify-center gap-2 rounded-full bg-lime px-4 py-3 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60"
            >
              {signing ? 'Signing in…' : 'Sign in'}
              {!signing && (
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              )}
            </button>

            <button
              type="button"
              onClick={() => void disconnect()}
              disabled={signing}
              className="w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
            >
              Use a different wallet
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {wallets.map((entry) => {
              const detected = entry.readyState === 'Installed'
              return (
                <button
                  key={entry.adapter.name}
                  type="button"
                  onClick={() => select(entry.adapter.name)}
                  disabled={connecting}
                  className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] border border-hairline bg-panel-2 px-4 py-3 text-left transition-colors hover:border-lime/40 hover:bg-panel-2/70 disabled:cursor-wait disabled:opacity-60"
                >
                  {entry.adapter.icon && (
                    <img
                      src={entry.adapter.icon}
                      alt=""
                      className="size-7 rounded"
                      aria-hidden="true"
                    />
                  )}
                  <span className="flex-1 text-sm font-medium">
                    {entry.adapter.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {detected ? 'Detected' : 'Not installed'}
                  </span>
                </button>
              )
            })}
            {wallets.length === 0 && (
              <p className="rounded-[var(--radius-sm)] border border-hairline bg-panel-2 px-4 py-3 text-sm text-muted-foreground">
                No Solana wallet detected. Install Phantom or Solflare to continue.
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          Signing proves you own the wallet. It does not move funds or cost gas.
        </div>
      </div>
    </div>
  )
}
