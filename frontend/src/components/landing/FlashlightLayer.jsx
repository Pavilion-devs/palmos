import { useEffect } from 'react'

/**
 * Drives the `.flashlight-target` hover glow. A single delegated pointer
 * listener writes the cursor position into `--mouse-x` / `--mouse-y` on the
 * nearest card, which the radial-gradient pseudo-elements in index.css consume.
 * Port of the template's FlashlightProvider.
 */
export default function FlashlightLayer() {
  useEffect(() => {
    const onMove = (event) => {
      const target = event.target?.closest?.('.flashlight-target')
      if (!target) return
      const rect = target.getBoundingClientRect()
      target.style.setProperty('--mouse-x', `${event.clientX - rect.left}px`)
      target.style.setProperty('--mouse-y', `${event.clientY - rect.top}px`)
    }

    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  return null
}
