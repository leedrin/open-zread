import { resolve } from 'node:path';
import type {
  AppConfig,
  FileManifest,
  SymbolManifest,
  TechStackSummary,
  WikiOutput,
  WikiPage,
} from '@open-zread/types';
import {
  generateWikiJson,
  saveCachedManifest,
  saveCachedSymbols,
  loadWikiBlueprint,
} from '@open-zread/utils';
import { parseFiles, scanFiles } from '@open-zread/repo-analyzer';
import {
  generateWikiCatalog as generateWikiCatalogCore,
} from '../orchestrator.js';
import {
  generateWikiContent as generateWikiContentCore,
} from '../wiki/generate-wiki.js';
import {
  syncWiki as syncWikiCore,
  type SyncOptions,
  type SyncResult,
} from '../wiki/sync-wiki.js';
import type {
  BlueprintResult,
  CatalogEvent,
  GenerateWikiCatalogOptions,
} from '../types.js';
import type {
  GenerateWikiOptions,
  WikiResult,
} from '../wiki/types.js';

export interface OpenZreadProjectContext {
  /** Absolute path to the project being read or modified. */
  projectRoot: string;
}

export interface OpenZreadApplicationDependencies {
  refreshProjectIndex?: (
    projectRoot: string,
    onEvent?: (event: CatalogEvent) => void,
  ) => Promise<OpenZreadProjectIndex>;
  generateWikiCatalog?: (options: GenerateWikiCatalogOptions) => Promise<BlueprintResult>;
  generateWikiContent?: (options: GenerateWikiOptions) => Promise<WikiResult>;
  syncWiki?: (options: SyncOptions) => Promise<SyncResult>;
}

export interface OpenZreadProjectIndex {
  manifest: FileManifest;
  symbols: SymbolManifest;
}

export interface OpenZreadApplication {
  readonly projectRoot: string;
  readonly context: OpenZreadProjectContext;
  refreshProjectIndex(onEvent?: (event: CatalogEvent) => void): Promise<OpenZreadProjectIndex>;
  readWikiBlueprint(path?: string): Promise<WikiOutput>;
  generateWikiBlueprint(
    pages: WikiPage[],
    config: AppConfig,
    techStackSummary?: TechStackSummary,
  ): Promise<string>;
  generateWikiCatalog(onEvent?: (event: CatalogEvent) => void): Promise<BlueprintResult>;
  generateWikiContent(options?: Omit<GenerateWikiOptions, 'projectRoot'>): Promise<WikiResult>;
  syncWiki(onEvent?: (event: CatalogEvent) => void): Promise<SyncResult>;
}

/**
 * Create a non-interactive OpenZread application bound to one project.
 *
 * Every operation created by this service receives the bound project root;
 * callers never need to change the process working directory.
 */
export function createOpenZreadApplication(
  projectRoot: string,
  dependencies: OpenZreadApplicationDependencies = {},
): OpenZreadApplication {
  const context: OpenZreadProjectContext = { projectRoot: resolve(projectRoot) };
  const refreshProjectIndex = dependencies.refreshProjectIndex ?? (async (
    root: string,
    onEvent?: (event: CatalogEvent) => void,
  ) => {
    onEvent?.({ type: 'scanning' });
    const manifest = await scanFiles(root);
    if (manifest.files.length === 0) {
      throw new Error('No files found');
    }

    await saveCachedManifest(manifest, root);
    onEvent?.({ type: 'parsing' });
    const symbols = await parseFiles(manifest, root);
    await saveCachedSymbols(symbols, root);
    return { manifest, symbols };
  });
  const generateWikiCatalog = dependencies.generateWikiCatalog ?? generateWikiCatalogCore;
  const generateWikiContent = dependencies.generateWikiContent ?? generateWikiContentCore;
  const syncWiki = dependencies.syncWiki ?? syncWikiCore;

  return {
    projectRoot: context.projectRoot,
    context,

    refreshProjectIndex(onEvent) {
      return refreshProjectIndex(context.projectRoot, onEvent);
    },

    readWikiBlueprint(path) {
      return loadWikiBlueprint(path, context.projectRoot);
    },

    generateWikiBlueprint(pages, config, techStackSummary) {
      return generateWikiJson(pages, config, techStackSummary, context.projectRoot);
    },

    async generateWikiCatalog(onEvent) {
      await refreshProjectIndex(context.projectRoot, onEvent);
      const options: GenerateWikiCatalogOptions = {
        projectRoot: context.projectRoot,
        onEvent,
      };
      return generateWikiCatalog(options);
    },

    generateWikiContent(options = {}) {
      return generateWikiContent({ ...options, projectRoot: context.projectRoot });
    },

    syncWiki(onEvent) {
      const options: SyncOptions = {
        projectRoot: context.projectRoot,
        onEvent,
      };
      return syncWiki(options);
    },
  };
}
