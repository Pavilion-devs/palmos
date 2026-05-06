import { faqItems } from '../content'
import FAQItem from './FAQItem'

export default function FAQSection() {
  return (
    <section className="border-neutral-900 border-t bg-black px-6 py-24 md:px-12">
      <div className="mx-auto grid max-w-7xl gap-12 md:grid-cols-12">
        <div className="md:col-span-4">
          <h2 className="mb-6 text-4xl font-medium tracking-tighter text-white md:text-5xl">
            common questions
          </h2>
          <p className="max-w-xs text-sm font-light text-neutral-500">
            Everything you need to know about joining buildshop and shipping your
            product.
          </p>
        </div>

        <div className="space-y-2 md:col-span-8">
          {faqItems.map((item) => (
            <FAQItem key={item.question} {...item} />
          ))}
        </div>
      </div>
    </section>
  )
}
