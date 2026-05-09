export default function StubPage({ title, message }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="max-w-md text-center">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-neutral-600">
          {title}
        </div>
        <h2 className="text-lg font-medium text-white">Coming next</h2>
        <p className="mt-3 text-sm leading-6 text-neutral-500">{message}</p>
      </div>
    </div>
  )
}
