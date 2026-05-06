import { Quote } from 'lucide-react'

export default function TestimonialCard({ quote, initials, name, handle }) {
  return (
    <div className="flex h-full flex-col justify-between border border-neutral-800 bg-neutral-900/20 p-8 transition-colors duration-300 hover:border-neutral-600">
      <div>
        <Quote
          className="mb-6 h-6 w-6 fill-neutral-600/20 text-neutral-600"
          strokeWidth={1.5}
        />
        <p className="mb-8 text-lg leading-relaxed font-light text-neutral-300">
          {quote}
        </p>
      </div>
      <div className="flex items-center gap-4 border-neutral-800/50 border-t pt-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800 font-mono text-xs">
          {initials}
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-white">{name}</span>
          <span className="font-mono text-xs text-neutral-500">{handle}</span>
        </div>
      </div>
    </div>
  )
}
