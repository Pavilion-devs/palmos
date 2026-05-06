import { Github, Globe, Instagram } from 'lucide-react'

function TwitterIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" />
    </svg>
  )
}

const iconClass = 'text-neutral-600 transition-colors hover:text-white'

function SocialLink({ type, href }) {
  switch (type) {
    case 'twitter':
      return (
        <a href={href} className={iconClass} aria-label="Twitter">
          <TwitterIcon className="h-5 w-5" />
        </a>
      )
    case 'github':
      return (
        <a href={href} className={iconClass} aria-label="GitHub">
          <Github className="h-5 w-5" strokeWidth={1.5} />
        </a>
      )
    case 'instagram':
      return (
        <a href={href} className={iconClass} aria-label="Instagram">
          <Instagram className="h-5 w-5" strokeWidth={1.5} />
        </a>
      )
    case 'globe':
      return (
        <a href={href} className={iconClass} aria-label="Website">
          <Globe className="h-5 w-5" strokeWidth={1.5} />
        </a>
      )
    default:
      return null
  }
}

export default function CrewMember({
  image,
  imageAlt,
  badge,
  name,
  role,
  bio,
  socials,
}) {
  return (
    <div className="group flex flex-col">
      <div className="relative mb-6 aspect-[4/3] w-full overflow-hidden border border-neutral-800 bg-neutral-900 md:aspect-[16/10]">
        <div className="pointer-events-none absolute inset-0 z-10 bg-neutral-900 mix-blend-color transition-opacity duration-500 group-hover:opacity-0" />
        <img
          src={image}
          alt={imageAlt}
          className="h-full w-full object-cover opacity-80 transition-all duration-700 ease-out group-hover:scale-105 group-hover:opacity-100"
        />

        <div className="absolute bottom-4 left-4 z-20">
          <span className="border border-white/10 bg-black/50 px-3 py-1 text-[10px] font-medium tracking-widest text-white uppercase backdrop-blur-md">
            {badge}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-start justify-between">
          <h3 className="text-2xl font-medium tracking-tight text-white transition-colors group-hover:text-neutral-200">
            {name}
          </h3>
          <div className="flex gap-3">
            {socials.map((s) => (
              <SocialLink key={s.type} type={s.type} href={s.href} />
            ))}
          </div>
        </div>
        <p className="mb-4 font-mono text-sm text-neutral-500">{role}</p>
        <p className="border-neutral-800 border-l pl-4 leading-relaxed font-light text-neutral-400">
          {bio}
        </p>
      </div>
    </div>
  )
}
