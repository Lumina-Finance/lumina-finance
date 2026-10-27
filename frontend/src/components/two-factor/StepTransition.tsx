import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';

const EASE = [0.25, 0.1, 0.25, 1] as const;
const HEIGHT_TRANSITION = { duration: 0.26, ease: EASE };
// The outgoing step is gone before the incoming one shows, so the two never sit over each other
const FADE_OUT_TRANSITION = { duration: 0.1, ease: EASE };
const FADE_IN_TRANSITION = { duration: 0.2, ease: EASE };

interface StepTransitionProps {
  /** Identity of the visible step, so a change fades the old body out, then the new one in, and eases the panel height */
  stepKey: string;
  /** Heading shared by every step, rendered above the body without cross-fading */
  header?: ReactNode;
  /** On a phone, where the modal fills the screen, stretches the step so a footer inside it can sit at the
   *  bottom of the screen, as the form modals' footers do */
  fillPhone?: boolean;
  children: ReactNode;
}

/**
 * Eases a stacked two-factor modal between steps of differing heights. The old body fades out and the
 * new one in while the wrapper animates its real height from the old step to the new one in a single
 * pass, so the panel never snaps and the content is never scaled out of shape the way a layout
 * animation would. The
 * outgoing step is lifted out of flow during the fade, so the measured height already reflects the
 * incoming step
 */
export function StepTransition({ stepKey, header, fillPhone = false, children }: StepTransitionProps) {
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
      className={fillPhone ? 'max-[1049px]:flex max-[1049px]:min-h-full max-[1049px]:flex-col' : undefined}
      animate={{ height }}
      transition={HEIGHT_TRANSITION}
      // Clip only while the height eases, so focus rings on the edge controls are not cut off at rest. Clip
      // rather than hide, and only top to bottom, so a dialog footer inside keeps sticking to the panel's
      // bottom and reaching its side edges while it eases
      style={{ overflowX: 'visible', overflowY: isEasing ? 'clip' : 'visible' }}
      onAnimationStart={() => setIsEasing(true)}
      onAnimationComplete={() => setIsEasing(false)}
    >
      <div ref={contentRef} className={`relative flex flex-col gap-5 ${fillPhone ? 'max-[1049px]:flex-1' : ''}`}>
        {header}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={stepKey}
            className={fillPhone ? 'max-[1049px]:flex max-[1049px]:flex-1 max-[1049px]:flex-col' : undefined}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { ...FADE_IN_TRANSITION, delay: FADE_OUT_TRANSITION.duration } }}
            exit={{ opacity: 0, transition: FADE_OUT_TRANSITION }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
