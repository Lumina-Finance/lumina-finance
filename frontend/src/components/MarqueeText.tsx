import { useEffect, useRef, useState, type CSSProperties } from 'react'

interface MarqueeTextProps {
  children: string
  active?: boolean
  className?: string
  trackClassName?: string
}

export default function MarqueeText({
  children,
  active = false,
  className = '',
  trackClassName = '',
}: MarqueeTextProps) {
  const containerRef = useRef<HTMLSpanElement | null>(null)
  const measureRef = useRef<HTMLSpanElement | null>(null)
  const [marquee, setMarquee] = useState({ overflowing: false, distance: 0, duration: 5 })

  useEffect(() => {
    const updateMarquee = () => {
      const container = containerRef.current
      const measure = measureRef.current
      if (!container || !measure) return

      const textWidth = measure.getBoundingClientRect().width
      const containerWidth = container.getBoundingClientRect().width
      const rawDistance = Math.ceil(textWidth - containerWidth)
      const overflowing = rawDistance > 1
      const distance = overflowing ? rawDistance + 6 : 0
      const duration = Math.min(Math.max(distance / 18 + 4, 5), 9)
      setMarquee((current) => (
        current.overflowing === overflowing &&
        current.distance === distance &&
        current.duration === duration
          ? current
          : { overflowing, distance, duration }
      ))
    }

    updateMarquee()
    if ('fonts' in document) {
      void document.fonts.ready.then(updateMarquee)
    }
    const observer = new ResizeObserver(updateMarquee)
    if (containerRef.current) observer.observe(containerRef.current)
    if (measureRef.current) observer.observe(measureRef.current)

    return () => observer.disconnect()
  }, [children])

  return (
    <span
      ref={containerRef}
      className={`app-marquee-text relative block min-w-0 overflow-hidden whitespace-nowrap ${className}`}
      data-active={active ? 'true' : 'false'}
      data-overflow={marquee.overflowing ? 'true' : 'false'}
      style={{
        '--app-marquee-distance': `${marquee.distance}px`,
        '--app-marquee-duration': `${marquee.duration}s`,
      } as CSSProperties}
    >
      <span
        ref={measureRef}
        className="invisible fixed -left-[9999px] -top-[9999px] inline-block w-max max-w-none whitespace-nowrap"
        aria-hidden
      >
        {children}
      </span>
      <span className="app-marquee-text-static block max-w-full overflow-hidden text-ellipsis">
        {children}
      </span>
      <span
        className={`app-marquee-text-track pointer-events-none absolute left-0 top-0 inline-block w-max max-w-none whitespace-nowrap opacity-0 ${trackClassName}`}
        aria-hidden
      >
        {children}
      </span>
    </span>
  )
}
