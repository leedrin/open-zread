/**
 * @open-zread/types
 *
 * Shared type definitions for the open-zread project.
 *
 * Modules:
 * - manifest: File manifest (scanner output)
 * - symbols: Symbol manifest (parser output)
 * - wiki: Wiki page definitions and output
 * - config: Application configuration
 * - cache: Cache manifest structure
 * - repo-map: Three-layer repo map types
 */

// Manifest types
export type { FileManifest, FileInfo } from './manifest.js'

// Symbol types
export type { SymbolManifest, SymbolInfo, ImportInfo } from './symbols.js'

// Wiki types
export type { WikiPage, WikiOutput, TechStackSummary, WikiLevel, GlossaryTerm } from './wiki.js'

// Facts types
export type { PageFacts, ExportFact, FileSummary } from './facts.js'

// Incremental pipeline types
export type {
  DependencyEdge,
  DependencyGraph,
  AffectedDoc,
  IncrementalPlan,
  GraphNode,
  GraphEdge,
  GraphData,
} from './incremental.js'

// Config types
export type { AppConfig } from './config.js'

// Cache types
export type { CacheManifest } from './cache.js'

// Repo Map types
export type {
  RepoMapOptions,
  FilePriority,
  DirectoryTreeNode,
  RepoMapOutput,
  DirectoryTreeOutput,
  CoreSignaturesOutput,
  ModuleDetailsOutput,
} from './repo-map.js'