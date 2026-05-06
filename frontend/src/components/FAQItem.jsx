import { Plus } from 'lucide-react'

export default function FAQItem({ question, answer }) {
  return (
    <details className="group mb-6 border-neutral-800 border-b pb-6">
      <summary className="flex cursor-pointer list-none items-start justify-between">
        <span className="text-lg font-medium text-neutral-200 transition-colors group-hover:text-white md:text-xl">
          {question}
        </span>
        <span className="text-neutral-500 transition-transform duration-300 group-open:rotate-45 group-hover:text-white">
          <Plus className="h-6 w-6" strokeWidth={1.5} />
        </span>
      </summary>
      <div className="mt-4 max-w-2xl translate-y-2 leading-relaxed font-light text-neutral-400 opacity-0 transition-all duration-500 group-open:translate-y-0 group-open:opacity-100">
        {answer}
      </div>
    </details>
  )
}
