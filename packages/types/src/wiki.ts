/**
 * Wiki Types
 *
 * Wiki page definitions and output format
 */

/**
 * Wiki 难度级别
 * - Beginner: 初学者，适合入门章节
 * - Intermediate: 中级，需要一定基础
 * - Advanced: 高级，适合深度技术章节
 */
export type WikiLevel = 'Beginner' | 'Intermediate' | 'Advanced';

export type DocType = 'tutorial' | 'howto' | 'reference' | 'explanation';

export type PageOrigin = 'ai' | 'human';
export type PageStatus = 'active' | 'tombstone';

/**
 * WikiPage - Wiki page definition
 */
export interface WikiPage {
  slug: string;
  title: string;
  file: string;
  section: string;
  /**
   * 二级模块聚合，用于在同一 section 下进一步分组相关章节
   * 例如："平台接入指南"、"核心引擎架构"
   */
  group?: string;
  level: WikiLevel;
  /**
   * 关联的源文件或目录路径
   * - 文件路径: "packages/web-integration/src/index.ts"
   * - 目录路径: "packages/web-integration/src/" (以 / 结尾)
   * 后续生成 Wiki 内容时，会读取这些路径获取上下文
   */
  associatedFiles?: string[];
  docType?: DocType;
  /** Stable identity, independent of title/slug. Backfilled on load by migrateCatalog. Merge key. */
  id?: string;
  /** Who created this page. */
  origin?: PageOrigin;
  /** Hard protection: locked pages are never touched by AI operations. */
  locked?: boolean;
  /** Soft-delete state. Tombstoned pages stay in wiki.json but are excluded from derived artifacts. */
  status?: PageStatus;
  /** Depth directive for content generation. */
  depth?: 'standard' | 'deep';
  /** Canonical glossary terms this page is the authoritative home for (page -> many terms). */
  concepts?: string[];
}

/**
 * WikiOutput - Final output
 */
export interface WikiOutput {
  id: string;
  generated_at: string;
  language: string;
  pages: WikiPage[];
  techStackSummary?: TechStackSummary;
  glossary?: GlossaryTerm[];
}

/**
 * GlossaryTerm - Canonical term for cross-page naming consistency
 */
export interface GlossaryTerm {
  term: string;
  aliases?: string[];
  definition: string;
  canonicalPage?: string;
}

/**
 * TechStackSummary - Technology stack analysis result
 */
export interface TechStackSummary {
  techStack: {
    languages: string[];
    frameworks: string[];
    buildTools: string[];
  };
  projectType: string;
  entryPoints: string[];
}

/** A named, themed selection of pages (references by id, never copies content). */
export interface TopicScope {
  name: string;
  description?: string;
  pageIds: string[];
  createdAt: string;
}

/** Result of a 3-way catalog merge (filled in Phase B). */
export interface CatalogMergePlan {
  adds: WikiPage[];
  updates: Array<{ id: string; from: WikiPage; to: WikiPage }>;
  conflicts: Array<{ id: string; local: WikiPage; remote: WikiPage }>;
  removes: WikiPage[];
  kept: WikiPage[];
}