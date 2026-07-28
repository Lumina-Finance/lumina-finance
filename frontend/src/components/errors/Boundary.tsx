import { Component, type ErrorInfo, type ReactNode } from 'react';
import Fallback, { type FallbackVariant } from '@/components/errors/Fallback';

interface BoundaryProps {
  children: ReactNode;
  variant: FallbackVariant;
}

interface BoundaryState {
  componentStack: string | null;
  error: unknown;
  hasError: boolean;
}

/**
 * Catches a render error below it and shows the recovery screen in place of the subtree
 *
 * A class because React offers no hook that can catch a render error. There is no reset: the app
 * level has nothing to fall back to, and the per-route level is thrown away and rebuilt whenever
 * the user navigates, since the route subtree is keyed by path
 */
export default class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { componentStack: null, error: null, hasError: false };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error, hasError: true };
  }

  // React passes the list of components that were rendering here and nowhere else, so the fallback
  // gets it on the second render rather than the first
  componentDidCatch(_error: unknown, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <Fallback
        componentStack={this.state.componentStack}
        error={this.state.error}
        variant={this.props.variant}
      />
    );
  }
}
