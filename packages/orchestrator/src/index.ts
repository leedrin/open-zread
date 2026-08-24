/**
 * @open-zread/blueprint
 *
 * Wiki blueprint generation using Agent orchestration.
 */

// Phase 1: Blueprint Generation
export { generateWikiCatalog } from './orchestrator.js'

// Phase 2: Wiki Content Generation
export { generateWikiContent } from './wiki/generate-wiki.js'
export type { WikiResult, ProgressState, PageResult, GenerateWikiOptions, ArticleEventPayload } from './wiki/types.js'

// Phase 3: Wiki Sync
export { syncWiki } from './wiki/sync-wiki.js'
export type { SyncResult } from './wiki/sync-wiki.js'

// Wiki Topic Management: 新增主题 / 编辑元数据（associatedFiles） / 小节级重新生成
export { appendWikiTopic, updateWikiTopicAssociatedFiles } from './orchestrator.js'
export type { AppendTopicResult, UpdateTopicAssociatedFilesResult } from './orchestrator.js'
export { regenerateWikiPageSection } from './wiki/regenerate-section.js'
export type { RegenerateSectionResult } from './wiki/regenerate-section.js'

// Types
export * from './types.js'

// Re-export TokenUsage from agent-sdk
export type { TokenUsage } from '@open-zread/agent-sdk'