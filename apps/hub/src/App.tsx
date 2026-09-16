import { useCallback, useEffect, useRef, useState } from 'react';
import type { HubHealth, HubTaskEvent } from '@open-zread/hub-contract';
import {
  createHubApplicationService,
  type HubApplicationService,
} from './lib/application-service';
import './app.css';

type HealthState =
  | { status: 'loading' }
  | { status: 'ready'; health: HubHealth }
  | { status: 'error'; message: string };

export interface HubAppProps {
  service?: HubApplicationService;
}

const defaultService = createHubApplicationService();

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = error.message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return 'Unable to reach the Hub Application Service.';
}

export function HubApp({ service = defaultService }: HubAppProps) {
  const [healthState, setHealthState] = useState<HealthState>({ status: 'loading' });
  const [lastTaskEvent, setLastTaskEvent] = useState<HubTaskEvent | null>(null);
  const mountedRef = useRef(true);

  const loadHealth = useCallback(async () => {
    setHealthState({ status: 'loading' });
    try {
      const health = await service.getHealth();
      if (mountedRef.current) {
        setHealthState({ status: 'ready', health });
      }
    } catch (error) {
      if (mountedRef.current) {
        setHealthState({ status: 'error', message: errorMessage(error) });
      }
    }
  }, [service]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    mountedRef.current = true;

    void loadHealth();
    void service.subscribeToTaskEvents((event) => {
      if (!disposed) {
        setLastTaskEvent(event);
      }
    }).then((stopListening) => {
      if (disposed) {
        stopListening();
      } else {
        unsubscribe = stopListening;
      }
    }).catch(() => {
      // Task events are optional until a long-running task is started.
    });

    return () => {
      disposed = true;
      mountedRef.current = false;
      unsubscribe?.();
    };
  }, [loadHealth, service]);

  const statusLabel = healthState.status === 'ready'
    ? healthState.health.service.status
    : healthState.status === 'loading'
      ? 'checking'
      : 'unavailable';

  return (
    <main className="hub-shell">
      <header className="hub-header">
        <div>
          <p className="eyebrow">OPEN ZREAD</p>
          <h1>Hub</h1>
        </div>
        <span className="runtime-chip">Windows-first desktop</span>
      </header>

      <section className="hero-card" aria-labelledby="welcome-title">
        <div>
          <p className="eyebrow">PROJECT WORKSPACE</p>
          <h2 id="welcome-title">A focused home for your project knowledge.</h2>
          <p className="hero-copy">
            The desktop shell is connected through a typed application-service boundary.
            Reader, generation, and maintenance workflows will attach here.
          </p>
        </div>
        <div className="health-card" aria-live="polite">
          <div className="health-heading">
            <span className={`status-dot status-${statusLabel}`} aria-hidden="true" />
            <h3>Application service</h3>
          </div>
          <p data-testid="service-status" className="service-status">{statusLabel}</p>
          {healthState.status === 'ready' && (
            <dl className="health-details">
              <div><dt>Version</dt><dd data-testid="app-version">{healthState.health.appVersion}</dd></div>
              <div><dt>Runtime</dt><dd>{healthState.health.runtime}</dd></div>
              <div><dt>OS</dt><dd>{healthState.health.os}</dd></div>
              <div><dt>OpenZread</dt><dd data-testid="runner-status">{healthState.health.runner.status}</dd></div>
              <div><dt>Runner version</dt><dd data-testid="runner-version">{healthState.health.runner.version}</dd></div>
              <div className="health-detail-path"><dt>Runner path</dt><dd data-testid="runner-path">{healthState.health.runner.executablePath}</dd></div>
            </dl>
          )}
          {healthState.status === 'error' && (
            <p className="error-message">{healthState.message}</p>
          )}
          <button type="button" className="secondary-button" onClick={() => void loadHealth()}>
            Check again
          </button>
        </div>
      </section>

      <section className="surface-grid" aria-label="Hub capabilities">
        <article className="surface-card">
          <span className="surface-number">01</span>
          <h3>Project context</h3>
          <p>Every future operation will carry an explicit Project identity.</p>
        </article>
        <article className="surface-card">
          <span className="surface-number">02</span>
          <h3>Dual Provider</h3>
          <p>OpenZread and Zread remain independently readable and maintainable.</p>
        </article>
        <article className="surface-card">
          <span className="surface-number">03</span>
          <h3>Observable tasks</h3>
          <p>Long-running work reports stable stages and cancellation states.</p>
          {lastTaskEvent && (
            <p className="task-event" data-testid="last-task-event">
              {lastTaskEvent.phase}: {lastTaskEvent.status}
            </p>
          )}
        </article>
      </section>
    </main>
  );
}

export default HubApp;
