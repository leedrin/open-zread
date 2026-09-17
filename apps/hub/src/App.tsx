import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  HubHealth,
  HubProject,
  HubProviderHealth,
  HubOpenZreadOperation,
  HubTask,
  HubTaskEvent,
  HubWikiSearchResponse,
  HubWikiDocument,
  HubWikiProvider,
} from '@open-zread/hub-contract';
import {
  createHubApplicationService,
  type HubApplicationService,
} from './lib/application-service';
import { OpenZreadReader, type WikiReaderSession } from './components/OpenZreadReader';
import './app.css';

type HealthState =
  | { status: 'loading' }
  | { status: 'ready'; health: HubHealth }
  | { status: 'error'; message: string };

type ProjectsState =
  | { status: 'loading' }
  | { status: 'ready'; projects: HubProject[] }
  | { status: 'error'; message: string };

type ProjectAction = 'idle' | 'adding' | 'managing';

type ReaderState =
  | { status: 'closed' }
  | { status: 'loading'; project: HubProject; provider: HubWikiProvider }
  | { status: 'ready'; project: HubProject; wiki: HubWikiDocument }
  | { status: 'error'; project: HubProject; provider: HubWikiProvider; message: string };

type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'ready'; response: HubWikiSearchResponse }
  | { status: 'error'; message: string };

const EMPTY_READER_SESSION: WikiReaderSession = {
  scrollTop: 0,
};

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

function formatLastOpened(lastOpenedAt?: string): string {
  if (!lastOpenedAt) {
    return 'Never opened';
  }
  const timestamp = Number(lastOpenedAt);
  if (!Number.isFinite(timestamp)) {
    return lastOpenedAt;
  }
  return new Date(timestamp).toLocaleString();
}

function formatElapsed(startedAt: string, now: number): string {
  const started = Number(startedAt);
  if (!Number.isFinite(started)) {
    return '—';
  }
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function availableWikiProviders(project: HubProject): HubWikiProvider[] {
  return (['open_zread', 'zread'] as const).filter((provider) => {
    const status = provider === 'open_zread' ? project.wiki.openZread : project.wiki.zread;
    return status !== 'missing' && status !== 'unavailable';
  });
}

function providerLabel(provider: HubProviderHealth['provider']): string {
  return provider === 'open_zread' ? 'OpenZread' : 'Zread';
}

function configSourceLabel(source: HubProviderHealth['configSource']): string {
  switch (source) {
    case 'hub_shared':
      return 'Hub shared config';
    case 'zread_native':
      return 'Zread native config';
    default:
      return 'Not configured';
  }
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" focusable="false">
      <path
        d="m12 3.8 2.5 5.08 5.6.81-4.05 3.95.96 5.58L12 16.58l-5.01 2.64.96-5.58L3.9 9.69l5.6-.81L12 3.8Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HubApp({ service = defaultService }: HubAppProps) {
  const [healthState, setHealthState] = useState<HealthState>({ status: 'loading' });
  const [projectsState, setProjectsState] = useState<ProjectsState>({ status: 'loading' });
  const [projectAction, setProjectAction] = useState<ProjectAction>('idle');
  const [projectMessage, setProjectMessage] = useState<string | null>(null);
  const [projectQuery, setProjectQuery] = useState('');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [zreadAction, setZreadAction] = useState<'idle' | 'selecting'>('idle');
  const [providerMessage, setProviderMessage] = useState<string | null>(null);
  const [readerState, setReaderState] = useState<ReaderState>({ status: 'closed' });
  const [readerSessions, setReaderSessions] = useState<Record<string, WikiReaderSession>>({});
  const [lastTaskEvent, setLastTaskEvent] = useState<HubTaskEvent | null>(null);
  const [activeTask, setActiveTask] = useState<HubTask | null>(null);
  const [activeTaskEvent, setActiveTaskEvent] = useState<HubTaskEvent | null>(null);
  const [taskMessage, setTaskMessage] = useState<string | null>(null);
  const [taskClock, setTaskClock] = useState(() => Date.now());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState>({ status: 'idle' });
  const mountedRef = useRef(true);

  const loadHealth = useCallback(async () => {
    setHealthState({ status: 'loading' });
    setProviderMessage(null);
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

  const configureZreadExecutable = useCallback(async () => {
    setZreadAction('selecting');
    setProviderMessage(null);
    try {
      const health = await service.configureZreadExecutable();
      if (mountedRef.current && health) {
        setHealthState({ status: 'ready', health });
      }
    } catch (error) {
      if (mountedRef.current) {
        setProviderMessage(errorMessage(error));
      }
    } finally {
      if (mountedRef.current) {
        setZreadAction('idle');
      }
    }
  }, [service]);

  const loadProjects = useCallback(async () => {
    setProjectsState({ status: 'loading' });
    try {
      const projects = await service.listProjects();
      if (mountedRef.current) {
        setProjectsState({ status: 'ready', projects });
      }
    } catch (error) {
      if (mountedRef.current) {
        setProjectsState({ status: 'error', message: errorMessage(error) });
      }
    }
  }, [service]);

  const searchWiki = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) {
      return;
    }
    setSearchState({ status: 'loading', query });
    try {
      const response = await service.searchWiki(query);
      if (mountedRef.current) {
        setSearchState({ status: 'ready', response });
      }
    } catch (error) {
      if (mountedRef.current) {
        setSearchState({ status: 'error', message: errorMessage(error) });
      }
    }
  }, [searchQuery, service]);

  const addProject = useCallback(async () => {
    setProjectAction('adding');
    setProjectMessage(null);
    try {
      const selectedPath = await service.selectProjectDirectory();
      if (!selectedPath) {
        return;
      }
      const result = await service.registerProject(selectedPath);
      if (!mountedRef.current) {
        return;
      }
      setProjectsState((current) => {
        if (current.status !== 'ready') {
          return { status: 'ready', projects: [result.project] };
        }
        const existingIndex = current.projects.findIndex((project) => project.id === result.project.id);
        if (existingIndex === -1) {
          return { status: 'ready', projects: [...current.projects, result.project] };
        }
        const projects = [...current.projects];
        projects[existingIndex] = result.project;
        return { status: 'ready', projects };
      });
      setProjectMessage(result.created ? 'Project added to your library.' : 'Project is already in your library.');
    } catch (error) {
      if (mountedRef.current) {
        setProjectMessage(errorMessage(error));
      }
    } finally {
      if (mountedRef.current) {
        setProjectAction('idle');
      }
    }
  }, [service]);

  const replaceProject = useCallback((updatedProject: HubProject) => {
    setProjectsState((current) => {
      if (current.status !== 'ready') {
        return current;
      }
      return {
        status: 'ready',
        projects: current.projects.map((project) => (
          project.id === updatedProject.id ? updatedProject : project
        )),
      };
    });
  }, []);

  const toggleFavorite = useCallback(async (project: HubProject) => {
    setProjectAction('managing');
    setProjectMessage(null);
    try {
      const updatedProject = await service.setProjectFavorite(project.id, !project.favorite);
      if (mountedRef.current) {
        replaceProject(updatedProject);
        setProjectMessage(updatedProject.favorite ? 'Project added to favorites.' : 'Project removed from favorites.');
      }
    } catch (error) {
      if (mountedRef.current) {
        setProjectMessage(errorMessage(error));
      }
    } finally {
      if (mountedRef.current) {
        setProjectAction('idle');
      }
    }
  }, [replaceProject, service]);

  const openProjectFolder = useCallback(async (project: HubProject) => {
    setProjectAction('managing');
    setProjectMessage(null);
    try {
      const updatedProject = await service.openProjectFolder(project.id);
      if (mountedRef.current) {
        replaceProject(updatedProject);
        setProjectMessage(`Opened ${project.name}.`);
      }
    } catch (error) {
      if (mountedRef.current) {
        setProjectMessage(errorMessage(error));
      }
    } finally {
      if (mountedRef.current) {
        setProjectAction('idle');
      }
    }
  }, [replaceProject, service]);

  const openProjectTerminal = useCallback(async (project: HubProject) => {
    setProjectAction('managing');
    setProjectMessage(null);
    try {
      const updatedProject = await service.openProjectTerminal(project.id);
      if (mountedRef.current) {
        replaceProject(updatedProject);
        setProjectMessage(`Opened a terminal for ${project.name}.`);
      }
    } catch (error) {
      if (mountedRef.current) {
        setProjectMessage(errorMessage(error));
      }
    } finally {
      if (mountedRef.current) {
        setProjectAction('idle');
      }
    }
  }, [replaceProject, service]);

  const copyProjectPath = useCallback(async (project: HubProject) => {
    setProjectMessage(null);
    try {
      await service.copyProjectPath(project.path);
      if (mountedRef.current) {
        setProjectMessage('Project path copied to the clipboard.');
      }
    } catch (error) {
      if (mountedRef.current) {
        setProjectMessage(errorMessage(error));
      }
    }
  }, [service]);

  const openWikiReader = useCallback(async (project: HubProject, provider: HubWikiProvider) => {
    setReaderState({ status: 'loading', project, provider });
    try {
      const wiki = provider === 'open_zread'
        ? await service.readOpenZreadWiki(project.id)
        : await service.readZreadWiki(project.id);
      if (mountedRef.current) {
        setReaderState({ status: 'ready', project, wiki });
      }
    } catch (error) {
      if (mountedRef.current) {
        setReaderState({ status: 'error', project, provider, message: errorMessage(error) });
      }
    }
  }, [service]);

  const startOpenZreadTask = useCallback(async (project: HubProject, operation: HubOpenZreadOperation) => {
    if (activeTask) {
      return;
    }
    setTaskMessage(null);
    setActiveTaskEvent(null);
    try {
      const task = await service.startOpenZreadTask(project.id, operation);
      if (mountedRef.current) {
        setActiveTask(task);
        setTaskMessage(`${operation === 'generate' ? 'Generation' : 'Sync'} started for ${project.name}.`);
      }
    } catch (error) {
      if (mountedRef.current) {
        setTaskMessage(errorMessage(error));
      }
    }
  }, [activeTask, service]);

  const startZreadTask = useCallback(async (project: HubProject) => {
    if (activeTask) {
      return;
    }
    setTaskMessage(null);
    setActiveTaskEvent(null);
    try {
      const task = await service.startZreadTask(project.id);
      if (mountedRef.current) {
        setActiveTask(task);
        setTaskMessage(`Zread generation started for ${project.name}.`);
      }
    } catch (error) {
      if (mountedRef.current) {
        setTaskMessage(errorMessage(error));
      }
    }
  }, [activeTask, service]);

  const cancelActiveTask = useCallback(async () => {
    if (!activeTask) {
      return;
    }
    try {
      await service.cancelTask(activeTask.taskId);
      if (mountedRef.current) {
        setTaskMessage('Cancellation requested. The previous readable Wiki will be kept if generation does not complete.');
      }
    } catch (error) {
      if (mountedRef.current) {
        setTaskMessage(errorMessage(error));
      }
    }
  }, [activeTask, service]);

  const updateReaderSession = useCallback((projectId: string, provider: HubWikiProvider, session: WikiReaderSession) => {
    setReaderSessions((current) => ({
      ...current,
      [`${projectId}:${provider}`]: session,
    }));
  }, []);

  const relocateProject = useCallback(async (project: HubProject) => {
    setProjectAction('managing');
    setProjectMessage(null);
    try {
      const selectedPath = await service.selectProjectDirectory();
      if (!selectedPath) {
        return;
      }
      const updatedProject = await service.relocateProject(project.id, selectedPath);
      if (mountedRef.current) {
        replaceProject(updatedProject);
        setProjectMessage(`Project relocated to ${updatedProject.path}.`);
      }
    } catch (error) {
      if (mountedRef.current) {
        setProjectMessage(errorMessage(error));
      }
    } finally {
      if (mountedRef.current) {
        setProjectAction('idle');
      }
    }
  }, [replaceProject, service]);

  const removeProject = useCallback(async (project: HubProject) => {
    if (!globalThis.confirm(`Remove "${project.name}" from the Project Library? The source files and Wiki will not be deleted.`)) {
      return;
    }
    setProjectAction('managing');
    setProjectMessage(null);
    try {
      await service.removeProject(project.id);
      if (mountedRef.current) {
        setProjectsState((current) => current.status === 'ready'
          ? { status: 'ready', projects: current.projects.filter((item) => item.id !== project.id) }
          : current);
        setProjectMessage('Project removed from the library. Source files were kept.');
      }
    } catch (error) {
      if (mountedRef.current) {
        setProjectMessage(errorMessage(error));
      }
    } finally {
      if (mountedRef.current) {
        setProjectAction('idle');
      }
    }
  }, [service]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    mountedRef.current = true;

    void loadHealth();
    void loadProjects();
    void service.subscribeToTaskEvents((event) => {
      if (!disposed) {
        setLastTaskEvent(event);
        if (event.taskId !== 'health-check') {
          setActiveTaskEvent(event);
        }
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
  }, [loadHealth, loadProjects, service]);

  useEffect(() => {
    if (!activeTask) {
      return undefined;
    }
    const timer = globalThis.setInterval(() => setTaskClock(Date.now()), 1000);
    return () => globalThis.clearInterval(timer);
  }, [activeTask]);

  const statusLabel = healthState.status === 'ready'
    ? healthState.health.service.status
    : healthState.status === 'loading'
      ? 'checking'
      : 'unavailable';

  const visibleProjects = projectsState.status === 'ready'
    ? projectsState.projects
      .filter((project) => {
        const query = projectQuery.trim().toLocaleLowerCase();
        const matchesQuery = query.length === 0
          || project.name.toLocaleLowerCase().includes(query)
          || project.path.toLocaleLowerCase().includes(query);
        return matchesQuery && (!favoriteOnly || project.favorite);
      })
      .sort((left, right) => Number(right.favorite) - Number(left.favorite))
    : [];

  const openZreadProvider = healthState.status === 'ready'
    ? healthState.health.providers.find((provider) => provider.provider === 'open_zread')
    : undefined;
  const openZreadReady = openZreadProvider?.generator.status === 'available';
  const zreadProvider = healthState.status === 'ready'
    ? healthState.health.providers.find((provider) => provider.provider === 'zread')
    : undefined;
  const zreadReady = zreadProvider?.generator.status === 'available';
  const currentTaskEvent = activeTask && activeTaskEvent?.taskId === activeTask.taskId
    ? activeTaskEvent
    : undefined;
  const activeTaskStatus = currentTaskEvent
    ? currentTaskEvent.status
    : activeTask?.status;
  const taskBusy = activeTaskStatus === 'queued' || activeTaskStatus === 'running' || activeTaskStatus === 'cancelling';

  return (
    <main className="hub-shell">
      <header className="hub-header">
        <div>
          <p className="eyebrow">OPEN ZREAD</p>
          <h1>Hub</h1>
        </div>
        <span className="runtime-chip">Windows-first desktop</span>
      </header>

      <section className="global-search" aria-label="Search saved Wiki">
        <form onSubmit={(event) => { event.preventDefault(); void searchWiki(); }}>
          <input
            data-testid="global-search-input"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search saved Wiki pages across Projects…"
          />
          <button type="submit" className="primary-button" data-testid="global-search-submit" disabled={searchState.status === 'loading' || searchQuery.trim().length === 0}>
            {searchState.status === 'loading' ? 'Searching…' : 'Search'}
          </button>
        </form>
        {searchState.status === 'error' && <p className="error-message" role="alert">{searchState.message}</p>}
        {searchState.status === 'ready' && (
          <div className="search-results" data-testid="search-results">
            {searchState.response.results.length === 0 && <p>No saved Wiki matches for “{searchState.response.query}”.</p>}
            {searchState.response.results.map((result) => (
              <button
                type="button"
                className="search-result"
                data-testid={`search-result-${result.projectId}-${result.slug}`}
                key={`${result.projectId}:${result.provider}:${result.slug}`}
                onClick={() => {
                  const project = projectsState.status === 'ready'
                    ? projectsState.projects.find((candidate) => candidate.id === result.projectId)
                    : undefined;
                  if (project) {
                    void openWikiReader(project, result.provider);
                  }
                }}
              >
                <span><strong>{result.title}</strong><small>{result.projectName} · {result.provider} · {result.path}</small></span>
                <em>{result.snippet}</em>
              </button>
            ))}
            {searchState.response.failures.length > 0 && (
              <p className="search-failures">Some Wiki sources could not be indexed: {searchState.response.failures.map((failure) => `${failure.projectName} (${failure.provider})`).join(', ')}</p>
            )}
          </div>
        )}
      </section>

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
            <>
            <dl className="health-details">
              <div><dt>Version</dt><dd data-testid="app-version">{healthState.health.appVersion}</dd></div>
              <div><dt>Runtime</dt><dd>{healthState.health.runtime}</dd></div>
              <div><dt>OS</dt><dd>{healthState.health.os}</dd></div>
              <div><dt>OpenZread</dt><dd data-testid="runner-status">{healthState.health.runner.status}</dd></div>
              <div><dt>Runner version</dt><dd data-testid="runner-version">{healthState.health.runner.version}</dd></div>
              <div className="health-detail-path"><dt>Runner path</dt><dd data-testid="runner-path">{healthState.health.runner.executablePath}</dd></div>
            </dl>
            <div className="provider-health-grid" aria-label="Provider health">
              {healthState.health.providers.map((provider) => (
                <article className="provider-health-card" data-testid={`provider-health-${provider.provider}`} key={provider.provider}>
                  <div className="provider-health-heading">
                    <h4>{providerLabel(provider.provider)}</h4>
                    <span className={`availability-badge availability-${provider.generator.status}`}>
                      {provider.generator.status}
                    </span>
                  </div>
                  <dl className="provider-health-details">
                    <div>
                      <dt>Content</dt>
                      <dd data-testid={`provider-${provider.provider}-content`}>Per project</dd>
                    </div>
                    <div>
                      <dt>Generator</dt>
                      <dd data-testid={`provider-${provider.provider}-generator-status`}>{provider.generator.status}</dd>
                    </div>
                    <div>
                      <dt>Version</dt>
                      <dd data-testid={`provider-${provider.provider}-version`}>{provider.generator.version}</dd>
                    </div>
                    <div className="health-detail-path">
                      <dt>Executable path</dt>
                      <dd data-testid={`provider-${provider.provider}-path`}>{provider.generator.executablePath}</dd>
                    </div>
                    <div>
                      <dt>Config source</dt>
                      <dd data-testid={`provider-${provider.provider}-config`}>{configSourceLabel(provider.configSource)}</dd>
                    </div>
                  </dl>
                  <div className="provider-capabilities" aria-label={`${providerLabel(provider.provider)} capabilities`}>
                    {(['generate', 'regenerate', 'sync'] as const).map((capability) => (
                      <span className={`capability-badge ${provider.capabilities[capability] ? 'is-supported' : 'is-unsupported'}`} key={capability}>
                        <span>{capability}</span>
                        <strong data-testid={`provider-${provider.provider}-${capability}`}>
                          {provider.capabilities[capability] ? 'Available' : 'Unsupported'}
                        </strong>
                      </span>
                    ))}
                  </div>
                  {provider.provider === 'zread' && (
                    <button
                      type="button"
                      className="secondary-button provider-configure-button"
                      data-testid="select-zread-executable"
                      disabled={zreadAction !== 'idle'}
                      onClick={() => void configureZreadExecutable()}
                    >
                      {zreadAction === 'selecting' ? 'Selecting…' : 'Choose zread.exe'}
                    </button>
                  )}
                  {provider.generator.diagnostics.length > 0 && (
                    <p className="provider-diagnostics">{provider.generator.diagnostics.join(' ')}</p>
                  )}
                </article>
              ))}
            </div>
            {providerMessage && <p className="error-message" role="alert">{providerMessage}</p>}
            </>
          )}
          {healthState.status === 'error' && (
            <p className="error-message">{healthState.message}</p>
          )}
          <button type="button" className="secondary-button" onClick={() => void loadHealth()}>
            Check again
          </button>
        </div>
      </section>

      <section className="project-library" aria-labelledby="project-library-title">
        <div className="library-heading">
          <div>
            <p className="eyebrow">LOCAL PROJECTS</p>
            <h2 id="project-library-title" className="section-title">Project library</h2>
          </div>
          <button
            type="button"
            className="primary-button"
            data-testid="add-project"
            disabled={projectAction !== 'idle'}
            onClick={() => void addProject()}
          >
            {projectAction === 'adding' ? 'Selecting…' : 'Add local project'}
          </button>
        </div>
        {projectMessage && <p className="project-message" role="status">{projectMessage}</p>}
        {projectsState.status === 'ready' && projectsState.projects.length > 0 && (
          <div className="project-library-tools">
            <label className="project-search">
              <span className="sr-only">Filter projects by name or path</span>
              <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" focusable="false">
                <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="m16 16 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <input
                data-testid="project-filter"
                type="search"
                value={projectQuery}
                onChange={(event) => setProjectQuery(event.target.value)}
                placeholder="Filter by name or path"
              />
            </label>
            <label className="favorite-filter">
              <input
                data-testid="favorite-filter"
                type="checkbox"
                checked={favoriteOnly}
                onChange={(event) => setFavoriteOnly(event.target.checked)}
              />
              Favorites only
            </label>
          </div>
        )}
        {projectsState.status === 'loading' && <p className="empty-state" aria-busy="true">Loading registered projects…</p>}
        {projectsState.status === 'error' && (
          <div className="project-error" role="alert">
            <p>{projectsState.message}</p>
            <button type="button" className="secondary-button" onClick={() => void loadProjects()}>Try again</button>
          </div>
        )}
        {projectsState.status === 'ready' && projectsState.projects.length === 0 && (
          <p className="empty-state" data-testid="empty-project-library">
            Add a local code directory to start your project workspace.
          </p>
        )}
        {projectsState.status === 'ready' && projectsState.projects.length > 0 && visibleProjects.length === 0 && (
          <p className="empty-state" data-testid="no-project-results">
            No projects match the current filters.
          </p>
        )}
        {projectsState.status === 'ready' && visibleProjects.length > 0 && (
          <div className="project-grid" data-testid="project-list">
            {visibleProjects.map((project) => (
              <article className="project-card" key={project.id} data-testid={`project-${project.id}`}>
                <div className="project-card-heading">
                  <div>
                    <div className="project-name-row">
                      <h3>{project.name}</h3>
                      <button
                        type="button"
                        className={`favorite-button${project.favorite ? ' is-favorite' : ''}`}
                        data-testid={`favorite-${project.id}`}
                        aria-label={project.favorite ? `Remove ${project.name} from favorites` : `Add ${project.name} to favorites`}
                        aria-pressed={project.favorite}
                        disabled={projectAction !== 'idle'}
                        onClick={() => void toggleFavorite(project)}
                      >
                        <StarIcon filled={project.favorite} />
                      </button>
                    </div>
                    <p className="project-kind">{project.sourceControl === 'git' ? 'Git project' : 'Local project'}</p>
                  </div>
                  <span className={`availability-badge availability-${project.availability}`}>
                    {project.availability}
                  </span>
                </div>
                <p className="project-path">{project.path}</p>
                {project.availabilityReason && <p className="project-reason">{project.availabilityReason}</p>}
                <dl className="wiki-summary">
                  <div><dt>OpenZread</dt><dd>{project.wiki.openZread}</dd></div>
                  <div><dt>Zread</dt><dd>{project.wiki.zread}</dd></div>
                  <div><dt>Last opened</dt><dd>{formatLastOpened(project.lastOpenedAt)}</dd></div>
                </dl>
                <div className="project-actions">
                  <button
                    type="button"
                    className="primary-button"
                    data-testid={`generate-open-zread-${project.id}`}
                    disabled={!openZreadReady || project.availability !== 'available' || taskBusy || projectAction !== 'idle'}
                    onClick={() => void startOpenZreadTask(project, 'generate')}
                  >
                    Generate OpenZread
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    data-testid={`sync-open-zread-${project.id}`}
                    disabled={!openZreadReady || project.availability !== 'available'
                      || project.wiki.openZread === 'missing'
                      || project.wiki.openZread === 'unavailable'
                      || taskBusy || projectAction !== 'idle'}
                    onClick={() => void startOpenZreadTask(project, 'sync')}
                  >
                    Sync OpenZread
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    data-testid={`generate-zread-${project.id}`}
                    disabled={!zreadReady || project.availability !== 'available' || taskBusy || projectAction !== 'idle'}
                    onClick={() => void startZreadTask(project)}
                  >
                    Generate Zread
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    data-testid={`open-open-zread-${project.id}`}
                    disabled={project.availability !== 'available'
                      || project.wiki.openZread === 'missing'
                      || project.wiki.openZread === 'unavailable'
                      || projectAction !== 'idle'}
                    onClick={() => void openWikiReader(project, 'open_zread')}
                  >
                    {readerState.status === 'loading'
                      && readerState.project.id === project.id
                      && readerState.provider === 'open_zread'
                      ? 'Opening…'
                      : 'Open OpenZread'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    data-testid={`open-zread-${project.id}`}
                    disabled={project.availability !== 'available'
                      || project.wiki.zread === 'missing'
                      || project.wiki.zread === 'unavailable'
                      || projectAction !== 'idle'}
                    onClick={() => void openWikiReader(project, 'zread')}
                  >
                    {readerState.status === 'loading'
                      && readerState.project.id === project.id
                      && readerState.provider === 'zread'
                      ? 'Opening…'
                      : 'Open Zread'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    data-testid={`open-folder-${project.id}`}
                    disabled={project.availability !== 'available' || projectAction !== 'idle'}
                    onClick={() => void openProjectFolder(project)}
                  >
                    Open folder
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    data-testid={`open-terminal-${project.id}`}
                    disabled={project.availability !== 'available' || projectAction !== 'idle'}
                    onClick={() => void openProjectTerminal(project)}
                  >
                    Open terminal
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    data-testid={`copy-path-${project.id}`}
                    disabled={projectAction !== 'idle'}
                    onClick={() => void copyProjectPath(project)}
                  >
                    Copy path
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    data-testid={`relocate-${project.id}`}
                    disabled={projectAction !== 'idle'}
                    onClick={() => void relocateProject(project)}
                  >
                    Relocate
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    data-testid={`remove-${project.id}`}
                    disabled={projectAction !== 'idle'}
                    onClick={() => void removeProject(project)}
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {readerState.status === 'loading' && (
        <section className="wiki-reader-loading" aria-live="polite">
          Opening the {readerState.provider === 'zread' ? 'Zread' : 'OpenZread'} Reader…
        </section>
      )}
      {readerState.status === 'error' && (
        <section className="wiki-reader-loading project-error" role="alert">
          <p>{readerState.message}</p>
          <button type="button" className="secondary-button" onClick={() => setReaderState({ status: 'closed' })}>Dismiss</button>
        </section>
      )}
      {readerState.status === 'ready' && (
        <OpenZreadReader
          key={`${readerState.project.id}-${readerState.wiki.provider}-${readerState.wiki.currentPointer ?? readerState.wiki.catalog.id ?? 'catalog'}`}
          project={readerState.project}
          wiki={readerState.wiki}
          providerLabel={readerState.wiki.provider === 'zread' ? 'ZREAD WIKI' : 'OPENZREAD WIKI'}
          availableProviders={availableWikiProviders(readerState.project)}
          session={readerSessions[`${readerState.project.id}:${readerState.wiki.provider}`] ?? EMPTY_READER_SESSION}
          onSessionChange={(session) => updateReaderSession(readerState.project.id, readerState.wiki.provider, session)}
          onSwitchProvider={(provider) => void openWikiReader(readerState.project, provider)}
          switchingProvider={false}
          readSource={(projectId, path) => readerState.wiki.provider === 'zread'
            ? service.readZreadSource(projectId, path)
            : service.readOpenZreadSource(projectId, path)}
          readAsset={(projectId, pagePath, assetPath) => readerState.wiki.provider === 'zread'
            ? service.readZreadAsset(projectId, pagePath, assetPath)
            : service.readOpenZreadAsset(projectId, pagePath, assetPath)}
          previewChange={service.previewWikiChange}
          applyChange={service.applyWikiChange}
          listHistory={service.listWikiHistory}
          restoreHistory={service.restoreWikiHistory}
          createPage={service.createWikiPage}
          deletePage={service.deleteWikiPage}
          updatePageMetadata={service.updateWikiPageMetadata}
          askWiki={service.askWiki}
          rewritePage={service.rewriteWikiPage}
          draftPage={service.draftWikiPage}
          onHistoryRestored={() => void openWikiReader(readerState.project, readerState.wiki.provider)}
          onClose={() => setReaderState({ status: 'closed' })}
        />
      )}

      {activeTask && (
        <section className="task-panel" aria-live="polite" data-testid="active-task">
          <div>
            <p className="eyebrow">ACTIVE TASK</p>
            <h2>{activeTask.operation === 'generate' ? 'Generating OpenZread Wiki' : 'Syncing OpenZread Wiki'}</h2>
            <p className="task-panel-meta">
              Project: {activeTask.projectId} · Provider: OpenZread · Model: {activeTask.model}
            </p>
          </div>
          <dl className="task-panel-details">
            <div><dt>Status</dt><dd data-testid="task-status">{activeTaskStatus}</dd></div>
            <div><dt>Phase</dt><dd data-testid="task-phase">{currentTaskEvent?.phase ?? 'starting'}</dd></div>
            <div><dt>Elapsed</dt><dd data-testid="task-elapsed">{formatElapsed(activeTask.startedAt, taskClock)}</dd></div>
          </dl>
          {currentTaskEvent?.message && <p className="task-panel-message">{currentTaskEvent.message}</p>}
          {currentTaskEvent?.progress && (
            <p className="task-panel-progress">
              {currentTaskEvent.progress.current} / {currentTaskEvent.progress.total} pages
            </p>
          )}
          {taskMessage && <p className="task-panel-message" role="status">{taskMessage}</p>}
          {taskBusy && (
            <button type="button" className="danger-button" data-testid="cancel-active-task" onClick={() => void cancelActiveTask()}>
              Cancel task
            </button>
          )}
        </section>
      )}

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
