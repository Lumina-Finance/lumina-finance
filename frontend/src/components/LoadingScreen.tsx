import { motion } from 'motion/react';

type LoadingScreenProps = {
  variant?: 'screen' | 'main';
};

const loadingScreenClassNames = {
  screen: 'fixed inset-0 z-50 flex flex-col items-center justify-center gap-6',
  main: 'fixed bottom-0 left-[260px] right-0 top-0 z-30 flex flex-col items-center justify-center gap-6',
};

const LoadingScreen = ({ variant = 'screen' }: LoadingScreenProps) => (
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
      className="text-xs font-medium uppercase tracking-[0.2em]"
      style={{ color: 'var(--app-text-subtle)' }}
    >
      Your financial future awaits
    </p>
  </motion.div>
);

export default LoadingScreen;
