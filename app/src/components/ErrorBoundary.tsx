import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Last line of defence for the event-day app.
 *
 * Without this, one unexpected value in a programme row is a white screen on a
 * phone, at the venue, with no recovery route but a manual reload. Reloading is
 * usually enough because the service worker can serve the shell offline, so the
 * fallback offers exactly that.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('app_render_failed', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="error-state" role="alert">
        <span aria-hidden="true">!</span>
        <h1>Something went wrong.</h1>
        <p>The app hit an unexpected problem. Reloading usually fixes it — the event details stay saved on this device.</p>
        <button className="button button--dark" type="button" onClick={() => window.location.reload()}>
          Reload the app
        </button>
        <p className="error-state__fallback">
          Still stuck? Email <a href="mailto:hello@replaycon.in">hello@replaycon.in</a>.
        </p>
      </div>
    );
  }
}
