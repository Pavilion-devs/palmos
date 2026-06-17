import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Search, Github, CornerDownLeft } from 'lucide-react'
import DocsContent from './DocsContent'
import { docGroups, docSections, anchorToSection } from './docsNav'

/** Active-anchor tracking: the last anchor scrolled past the top reading line. */
function useScrollSpy(ids) {
  const [active, setActive] = useState(ids[0])
  useEffect(() => {
    const onScroll = () => {
      let current = ids[0]
      for (const id of ids) {
        const el = document.getElementById(id)
        if (!el) continue
        if (el.getBoundingClientRect().top <= 140) current = id
        else break
      }
      setActive(current)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [ids])
  return active
}

function goToAnchor(id) {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  window.history.replaceState(null, '', `#${id}`)
}

function Topbar({ onOpenSearch }) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center justify-between gap-4 px-5 md:px-8">
        <div className="flex items-center gap-3">
          <a href="/" className="group flex items-center gap-2">
            <img src="/logo.png" alt="PalmOS" className="h-7 w-auto" />
          </a>
          <span className="hidden text-white/20 sm:block">/</span>
          <span className="hidden font-mono text-xs uppercase tracking-widest text-white/45 sm:block">
            Docs
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex items-center gap-2 border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/45 transition-colors hover:border-white/20 hover:text-white"
          >
            <Search className="size-3.5" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-white/40 sm:inline">
              ⌘K
            </kbd>
          </button>
          <a
            href="https://github.com/Pavilion-devs/palmos"
            target="_blank"
            rel="noopener noreferrer"
            className="flex size-8 items-center justify-center border border-white/10 bg-white/5 text-white/45 transition-colors hover:border-white/20 hover:text-white"
            aria-label="GitHub"
          >
            <Github className="size-4" />
          </a>
        </div>
      </div>
    </header>
  )
}

function SearchOverlay({ open, onClose }) {
  const [q, setQ] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      setQ('')
      inputRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(t)
  }, [open])

  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    const out = []
    docGroups.forEach((group) => {
      group.items.forEach((item) => {
        const subText = (item.sub ?? []).map((s) => s.label).join(' ')
        const haystack = `${item.label} ${subText}`.toLowerCase()
        if (!query || haystack.includes(query)) {
          out.push({ id: item.id, label: item.label, context: group.label })
        }
        ;(item.sub ?? []).forEach((s) => {
          if (query && s.label.toLowerCase().includes(query)) {
            out.push({ id: s.id, label: s.label, context: item.label })
          }
        })
      })
    })
    return out
  }, [q])

  if (!open) return null

  const go = (id) => {
    onClose()
    goToAnchor(id)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-xl border border-white/15 bg-panel shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
        <div className="flex items-center gap-3 border-b border-white/10 px-4">
          <Search className="size-4 shrink-0 text-white/40" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) go(results[0].id)
              if (e.key === 'Escape') onClose()
            }}
            placeholder="Search the docs…"
            className="w-full bg-transparent py-3.5 text-sm text-white placeholder:text-white/30 focus:outline-none"
          />
          <kbd className="shrink-0 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-white/40">
            Esc
          </kbd>
        </div>

        <ul className="no-scrollbar max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-white/30">
              No results.
            </li>
          )}
          {results.map((r) => (
            <li key={`${r.context}-${r.id}`}>
              <button
                type="button"
                onClick={() => go(r.id)}
                className="group flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-white/85 group-hover:text-white">
                    {r.label}
                  </span>
                  <span className="block truncate font-mono text-[10px] uppercase tracking-widest text-white/30">
                    {r.context}
                  </span>
                </span>
                <CornerDownLeft className="size-3.5 shrink-0 text-white/0 group-hover:text-lime" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function Sidebar({ activeSection }) {
  return (
    <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] overflow-y-auto border-r border-white/10 py-8 pr-6 lg:block">
      <nav className="space-y-7">
        {docGroups.map((group) => (
          <div key={group.label}>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = item.id === activeSection
                return (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className={`block border-l-2 py-1.5 pl-3 text-[13px] tracking-tight transition-colors ${
                        active
                          ? 'border-lime text-lime'
                          : 'border-transparent text-white/55 hover:border-white/20 hover:text-white'
                      }`}
                    >
                      {item.label}
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )
}

function OnThisPage({ activeSection, activeId }) {
  const section = docSections.find((s) => s.id === activeSection)
  const subs = section?.sub ?? []
  return (
    <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] overflow-y-auto py-8 pl-6 xl:block">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">
        On this page
      </div>
      <ul className="space-y-1 border-l border-white/10">
        <li>
          <a
            href={`#${section?.id}`}
            className={`-ml-px block border-l-2 py-1 pl-3 text-[12.5px] transition-colors ${
              activeId === activeSection
                ? 'border-lime text-lime'
                : 'border-transparent text-white/50 hover:text-white'
            }`}
          >
            {section?.label}
          </a>
        </li>
        {subs.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className={`-ml-px block border-l-2 py-1 pl-3 text-[12.5px] transition-colors ${
                activeId === s.id
                  ? 'border-lime text-lime'
                  : 'border-transparent text-white/45 hover:text-white'
              }`}
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  )
}

function PrevNext({ activeSection }) {
  const idx = docSections.findIndex((s) => s.id === activeSection)
  const prev = idx > 0 ? docSections[idx - 1] : null
  const next = idx < docSections.length - 1 ? docSections[idx + 1] : null
  return (
    <div className="mt-12 grid grid-cols-2 gap-4 border-t border-white/10 pt-8">
      <div>
        {prev && (
          <a
            href={`#${prev.id}`}
            className="group flex flex-col gap-1 border border-white/10 p-4 transition-colors hover:border-white/25"
          >
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-white/40">
              <ArrowLeft className="size-3" /> Previous
            </span>
            <span className="text-sm text-white/80 group-hover:text-white">
              {prev.label}
            </span>
          </a>
        )}
      </div>
      <div>
        {next && (
          <a
            href={`#${next.id}`}
            className="group flex flex-col items-end gap-1 border border-white/10 p-4 text-right transition-colors hover:border-white/25"
          >
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-white/40">
              Next <ArrowRight className="size-3" />
            </span>
            <span className="text-sm text-white/80 group-hover:text-white">
              {next.label}
            </span>
          </a>
        )}
      </div>
    </div>
  )
}

export default function DocsPage() {
  const ids = useMemo(
    () => docSections.flatMap((s) => [s.id, ...(s.sub ?? []).map((x) => x.id)]),
    [],
  )
  const activeId = useScrollSpy(ids)
  const activeSection = anchorToSection[activeId] ?? activeId
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
      } else if (e.key === '/' && !/input|textarea/i.test(e.target?.tagName ?? '')) {
        e.preventDefault()
        setSearchOpen(true)
      } else if (e.key === 'Escape') {
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      id="top"
      className="landing-dark min-h-screen bg-background font-sans text-white antialiased selection:bg-lime selection:text-black"
    >
      <Topbar onOpenSearch={() => setSearchOpen(true)} />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />

      <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 px-5 md:px-8 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_220px]">
        <Sidebar activeSection={activeSection} />

        <main className="min-w-0 py-10 lg:px-10 xl:px-12">
          {/* page lead */}
          <div className="mb-2 border-b border-white/10 pb-8">
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/35">
              Documentation
            </div>
            <h1 className="mt-4 text-4xl font-light tracking-tighter text-white md:text-5xl">
              Build on PalmOS
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-white/55">
              Governed wallets for autonomous agents — policy guardrails, vault
              custody, and an on-chain audit trail across Solana and Mantle.
              Everything you need to connect an agent and ship.
            </p>
          </div>

          <DocsContent />
          <PrevNext activeSection={activeSection} />
        </main>

        <OnThisPage activeSection={activeSection} activeId={activeId} />
      </div>
    </div>
  )
}
