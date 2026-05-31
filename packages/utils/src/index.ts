// File I/O utilities
export {
  ensureDir,
  removeDir,
  readTextFile,
  writeTextFile,
  writeJsonFile,
  readJsonFile,
  fileExists,
  joinPath,
  getProjectRoot,
  getOutputDir,
  getWikiJsonPath,
  getCacheDir,
  getWikiDir,
} from './file-io.js';

// Logger
export { logger, getLogFile } from './logger.js';

// Config
export { loadConfig, loadConfigSync, saveConfig, validateConfig, getDefaultLanguage, getConfigPath, isFirstTimeConfig, DEFAULT_CONFIG } from './config/index.js';

// Cache
export {
  loadCachedManifest,
  saveCachedManifest,
  diffManifests,
  needsReprocess,
  loadCachedSymbols,
  saveCachedSymbols,
  buildDependencyGraph,
  computeTransitiveImpact,
  saveDependencyGraph,
  loadDependencyGraph,
  buildDocToDocDeps,
  buildIncrementalPlan,
} from './cache/index.js';

// Storage
export { generateSnapshotName, createVersionSnapshot } from './storage/versioning.js';

// Catalog
export { deriveId, migrateCatalog, buildCatalogTree, addPage, updatePage, tombstonePage, movePage, toggleLock, setDepth } from './catalog/index.js';
export type { CatalogTree, CatalogTreeSection, CatalogTreeGroup } from './catalog/index.js';

// Output
export { generateWikiJson, loadWikiBlueprint } from './output/wiki-content.js';
export { scanSecrets, scanWikiForSecrets } from './output/audit-docs.js';
export type { SecretLeak } from './output/audit-docs.js';
export {
  analyzeDoc,
  analyzeWiki,
  analyzeFactsCoverage,
  scoreByComplexity,
} from './output/quality-audit.js';
export type {
  DocMetrics,
  DocQuality,
  QualityLevel,
  QualityReport,
  MermaidIssue as AuditMermaidIssue,
  FactsCoverageResult,
} from './output/quality-audit.js';

export {
  finalizeWiki,
} from './output/finalize.js';
export type {
  FinalizeOptions,
  FinalizeResult,
} from './output/finalize.js';

export { renderGlossaryPage, ensureGlossaryPage, GLOSSARY_PAGE_ID } from './output/glossary-page.js';

// Graph visualization
export { buildGraphData } from './output/graph-data.js';

// Provider Registry
export * from './provider-registry/types.js';
export { getProviderRegistry, syncProviders } from './provider-registry/index.js';