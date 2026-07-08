import { motion } from 'motion/react';

type LoadingScreenProps = {
  variant?: 'screen' | 'main';
  message?: string;
};

// The overlay carries no interactive content, so it stays click-through the whole
// time it is mounted, otherwise its exit fade keeps swallowing taps on the menu and
// in-page buttons for the length of the fade after the content is already interactive
const loadingScreenClassNames = {
  screen: 'pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 px-6 text-center min-[730px]:gap-6',
  main: 'pointer-events-none fixed inset-0 z-30 flex flex-col items-center justify-center gap-5 px-6 text-center min-[730px]:gap-6 min-[1050px]:left-[260px]',
};

const LoadingScreen = ({ variant = 'screen', message = 'Your financial future awaits' }: LoadingScreenProps) => (
  <motion.div
    className={loadingScreenClassNames[variant]}
    style={{ backgroundColor: 'var(--app-bg)' }}
    role="status"
    aria-live="polite"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.25 }}
  >
    <div
      className="h-9 w-9 rounded-full border-2 animate-spin motion-reduce:animate-none"
      style={{ borderColor: 'var(--app-border-strong)', borderTopColor: 'var(--app-accent)' }}
      aria-hidden
    />
    <p
      className="max-w-64 text-[0.6875rem] font-medium uppercase tracking-[0.18em] min-[730px]:text-xs min-[730px]:tracking-[0.2em]"
      style={{ color: 'var(--app-text-muted)' }}
    >
      {message}
    </p>
  </motion.div>
);

export default LoadingScreen;
