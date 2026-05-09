import { motion, useReducedMotion } from 'framer-motion'
import { LANDING_SPRING, LANDING_TIMING } from './landingMotion'

const DIRECTION_OFFSET = {
  up: { x: 0, y: 26 },
  down: { x: 0, y: -18 },
  left: { x: -28, y: 0 },
  right: { x: 28, y: 0 },
  still: { x: 0, y: 0 },
}

export default function ScrollReveal({
  as = 'div',
  children,
  className,
  delay = LANDING_TIMING.section,
  direction = 'up',
  amount = 0.26,
}) {
  const prefersReducedMotion = useReducedMotion()
  const MotionElement = motion[as] ?? motion.div
  const offset = DIRECTION_OFFSET[direction] ?? DIRECTION_OFFSET.up

  if (prefersReducedMotion) {
    return <MotionElement className={className}>{children}</MotionElement>
  }

  return (
    <MotionElement
      className={className}
      initial={{ opacity: 0, x: offset.x, y: offset.y, filter: 'blur(10px)' }}
      whileInView={{ opacity: 1, x: 0, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: false, amount, margin: '0px 0px -12% 0px' }}
      transition={{ ...LANDING_SPRING, delay }}
    >
      {children}
    </MotionElement>
  )
}
