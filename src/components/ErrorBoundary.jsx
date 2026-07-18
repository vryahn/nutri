import { Component } from 'react';
import * as Sentry from '@sentry/react';

// Fixed bilingual text: if something broke at this level, there is no guarantee
// that i18n (or any other context) is still safe to use.
export default class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary', error, info);
    Sentry.captureException(error, { extra: info });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center bg-bg text-text">
        <p className="font-display text-xl">Algo salió mal · Something went wrong</p>
        <button
          onClick={() => window.location.reload()}
          className="min-h-[44px] px-4 rounded-xl bg-accent-deep text-on-accent font-medium press"
        >
          Recargar · Reload
        </button>
      </div>
    );
  }
}
