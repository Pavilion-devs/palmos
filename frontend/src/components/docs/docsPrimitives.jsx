import { useState } from 'react'
import { Copy, Check, Info, TriangleAlert } from 'lucide-react'

/** Inline code chip. */
export function Code({ children }) {
  return (
    <code className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[0.85em] text-lime/90">
      {children}
    </code>
  )
}

export function CopyButton({ value }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard?.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-white/60 transition-colors hover:border-white/20 hover:text-white"
    >
      {copied ? <Check className="size-3 text-lime" /> : <Copy className="size-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export function CodeBlock({ title, code, copy = true }) {
  return (
    <div className="overflow-hidden border border-white/10 bg-[#070807]">
      {(title || copy) && (
        <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.02] px-4 py-2.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-white/40">
            {title}
          </span>
          {copy && <CopyButton value={code} />}
        </div>
      )}
      <pre className="no-scrollbar overflow-x-auto p-4 font-mono text-[12.5px] leading-6 text-white/70">
        <code>{code}</code>
      </pre>
    </div>
  )
}

export function Callout({ variant = 'note', title, children }) {
  const warn = variant === 'warn'
  const Icon = warn ? TriangleAlert : Info
  return (
    <div
      className={`flex gap-3 border-l-2 p-4 ${
        warn
          ? 'border-amber-400/60 bg-amber-400/[0.06]'
          : 'border-lime/60 bg-lime/[0.05]'
      }`}
    >
      <Icon
        className={`mt-0.5 size-4 shrink-0 ${warn ? 'text-amber-400' : 'text-lime'}`}
        strokeWidth={2}
      />
      <div className="min-w-0 text-sm leading-6 text-white/70">
        {title && (
          <div className="mb-1 font-medium text-white">{title}</div>
        )}
        {children}
      </div>
    </div>
  )
}

/** Hairline data table. `head` = string[]; `rows` = (string|JSX)[][]. */
export function DocTable({ head, rows }) {
  return (
    <div className="no-scrollbar overflow-x-auto border border-white/10">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.02]">
            {head.map((h) => (
              <th
                key={h}
                className="px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-widest text-white/40"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-white/5 align-top last:border-0 hover:bg-white/[0.02]"
            >
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`px-4 py-3 leading-6 ${
                    j === 0 ? 'text-white/90' : 'text-white/55'
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Section wrapper: anchor target + mono eyebrow + title + prose body. */
export function Section({ id, eyebrow, title, children }) {
  return (
    <section
      id={id}
      data-doc-anchor
      className="scroll-mt-24 border-b border-white/10 py-12 first:pt-2"
    >
      <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-lime/70">
        {eyebrow}
      </div>
      <h2 className="text-3xl font-light tracking-tighter text-white md:text-[2.5rem] md:leading-[1.1]">
        {title}
      </h2>
      <div className="mt-6 space-y-5 text-[15px] leading-7 text-white/60">
        {children}
      </div>
    </section>
  )
}

export function SubHeading({ id, children }) {
  return (
    <h3
      id={id}
      data-doc-anchor
      className="scroll-mt-24 pt-4 text-lg font-medium tracking-tight text-white"
    >
      {children}
    </h3>
  )
}
