import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';

const EASE = [0.25, 0.1, 0.25, 1] as const;
const HEIGHT_TRANSITION = { duration: 0.26, ease: EASE };
const FADE_TRANSITION = { duration: 0.2, ease: EASE };

interface StepTransitionProps {
  /** Identity of the visible step, so a change cross-fades the body and eases the panel height */
  stepKey: string;
  /** Heading shared by every step, rendered above the body without cross-fading */
  header?: ReactNode;
  children: ReactNode;
}

/**
 * Eases a stacked two-factor modal between steps of differing heights. The body cross-fades while the
 * wrapper animates its real height from the old step to the new one in a single pass, so the panel
 * never snaps and the content is never scaled out of shape the way a layout animation would. The
 * outgoing step is lifted out of flow during the fade, so the measured height already reflects the
 * incoming step
 */
export function StepTransition({ stepKey, header, children }: StepTransitionProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');
  const [isEasing, setIsEasing] = useState(false);

  // Track the in-flow content height so the wrapper can ease to it whenever the step or its content
  // changes, such as an error line appearing under the code field
  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    const observer = new ResizeObserver(() => setHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      animate={{ height }}
      transition={HEIGHT_TRANSITION}
      // Clip only while the height eases, so focus rings on the edge controls are not cut off at rest
      style={{ overflow: isEasing ? 'hidden' : 'visible' }}
      onAnimationStart={() => setIsEasing(true)}
      onAnimationComplete={() => setIsEasing(false)}
    >
      <div ref={contentRef} className="relative flex flex-col gap-5">
        {header}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={stepKey}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={FADE_TRANSITION}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
