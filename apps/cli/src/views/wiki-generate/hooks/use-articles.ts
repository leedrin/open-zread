/**
 * useArticlesGenerate - Wiki 文章生成 Hook
 *
 * 架构设计：
 * - 状态管理：useImmer
 * - 事件处理：mapper 纯函数
 * - 初始化：由外部显式调用 initialize()
 * - 生成启动：由外部显式调用 start()
 *
 * 流程：外部调用 initialize() → 外部调用 start() → 并行生成各页面
 */

import { useCallback, useRef } from "react";
import { useImmer } from "use-immer";
import {
  loadConfig,
  getWikiDir,
  joinPath,
  fileExists,
  loadCachedSymbols,
  loadCachedManifest,
  saveCachedManifest,
  saveCachedSymbols,
  buildIncrementalPlan,
  createVersionSnapshot,
  logger,
} from "@open-zread/utils";
import { scanFiles, parseFiles } from "@open-zread/repo-analyzer";
import { generateWikiContent, type ArticleEventPayload } from "@open-zread/orchestrator";
import type { IncrementalPlan, SymbolManifest } from "@open-zread/types";
import { articleEventToState } from "../mapper";
import { createInitialArticlesState } from "../state";
import type { ArticlesState, WikiPage } from "../types";

// ==================== 接口定义 ====================

interface UseArticlesGenerateOptions {
  /** 文章列表（来自 wiki.json） */
  pages: WikiPage[];
  /** 完成回调（只通知完成，不触发 reload） */
  onComplete?: () => void;
}

interface UseArticlesGenerateReturn {
  /** 文章生成状态 */
  state: ArticlesState;
  /** 操作方法 */
  actions: {
    /** 初始化：检测已存在文档并设置状态，返回 pendingPages 列表 */
    initialize: () => Promise<WikiPage[]>;
    /** 开始生成，接收待生成页面列表 */
    start: (pendingPages: WikiPage[]) => Promise<void>;
    /** 重新生成单篇文章 */
    regeneratePage: (slug: string) => Promise<void>;
    /** 增量更新：仅重生受影响页面 */
    startIncremental: () => Promise<void>;
  };
}

// ==================== Hook 实现 ====================

export function useArticlesGenerate({
  pages,
  onComplete,
}: UseArticlesGenerateOptions): UseArticlesGenerateReturn {
  // 初始化状态（空状态，等待 initialize() 调用）
  const [state, updateState] = useImmer<ArticlesState>(() =>
    createInitialArticlesState([])
  );
  const isGenerating = useRef(false);
  const isInitialized = useRef(false);

  /**
   * 初始化：检测已存在文档并设置状态
   *
   * 由组合层在 pages 确定后显式调用，不使用 useEffect 自动触发。
   * 返回待生成的 pages 列表，避免调用方闭包陷阱。
   */
  const initialize = useCallback(async (): Promise<WikiPage[]> => {
    if (pages.length === 0 || isInitialized.current) return [];
    isInitialized.current = true;

    const wikiDir = getWikiDir();
    const existingSlugs: string[] = [];

    for (const page of pages) {
      const filePath = joinPath(wikiDir, page.section, page.file);
      try {
        const exists = await fileExists(filePath);
        if (exists) {
          existingSlugs.push(page.slug);
        }
      } catch {
        // 文件检查失败，视为不存在
      }
    }

    const pendingCount = pages.length - existingSlugs.length;

    // 一次性更新状态
    updateState((draft) => {
      const newState = createInitialArticlesState(pages);
      Object.assign(draft, newState);

      for (const slug of existingSlugs) {
        draft.pages[slug] = { status: "completed" };
      }
      draft.completedCount = existingSlugs.length;
      draft.pendingCount = pendingCount;
    });

    // 返回待生成的 pages 列表（避免闭包陷阱）
    return pages.filter((page) => !existingSlugs.includes(page.slug));
  }, [pages, updateState]);

  /**
   * 事件回调
   */
  const handleEvent = useCallback(
    (event: ArticleEventPayload) => {
      updateState((draft) => {
        const newState = articleEventToState(
          { ...draft } as ArticlesState,
          event
        );
        Object.assign(draft, newState);
      });
    },
    [updateState]
  );

  /**
   * 开始生成
   *
   * 由组合层在 initialize() 完成后显式调用。
   * 接收 initialize() 返回的 pendingPages 列表，避免闭包陷阱。
   */
  const start = useCallback(async (pendingPages: WikiPage[]) => {
    if (isGenerating.current || pendingPages.length === 0) return;

    // 直接加载配置，避免闭包陷阱（不依赖 configLoaded state）
    let concurrent = 1;
    try {
      const config = await loadConfig();
      concurrent = config.concurrency.max_concurrent;
    } catch {
      // 配置加载失败，使用默认值
    }

    isGenerating.current = true;

    // 加载符号清单以启用 Facts-First（缺省时降级为无 Facts 生成）
    const symbols = (await loadCachedSymbols()) ?? undefined;

    try {
      await generateWikiContent({
        pages: pendingPages,
        symbols,
        maxConcurrent: concurrent,
        onEvent: handleEvent,
      });
      // 生成成功后归档一份版本快照（失败不阻断）
      await safeSnapshot();
      onComplete?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      handleEvent({
        type: "page_error",
        slug: pendingPages[0]?.slug ?? "unknown",
        error: message,
      });
    } finally {
      isGenerating.current = false;
    }
  }, [handleEvent, onComplete]);

  /**
   * 重新生成单篇文章
   */
  const regeneratePage = useCallback(
    async (slug: string) => {
      // 找到对应的 page
      const page = pages.find((p) => p.slug === slug);
      if (!page) return;

      // 先将状态改为 waiting
      updateState((draft) => {
        const prevStatus = draft.pages[slug]?.status;
        draft.pages[slug] = { status: "waiting" };

        // 更新计数
        if (prevStatus === "completed") {
          draft.completedCount--;
          draft.pendingCount++;
        } else if (prevStatus === "failed") {
          draft.failedCount--;
          draft.pendingCount++;
        } else if (prevStatus === "loading") {
          // 正在生成中，不改变计数
        }
      });

      // 加载配置获取并发数
      let concurrent = 1;
      try {
        const config = await loadConfig();
        concurrent = config.concurrency.max_concurrent;
      } catch {
        // 配置加载失败，使用默认值
      }

      // 加载符号清单以启用 Facts-First
      const symbols = (await loadCachedSymbols()) ?? undefined;

      // 启动生成
      try {
        await generateWikiContent({
          pages: [page],
          symbols,
          maxConcurrent: concurrent,
          onEvent: handleEvent,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        handleEvent({
          type: "page_error",
          slug,
          error: message,
        });
      }
    },
    [pages, updateState, handleEvent]
  );

  /**
   * 增量更新：对比上次基线，仅重生/修补受影响页面
   *
   * 序列：读现有 pages → 旧基线 diff 当前扫描 → buildIncrementalPlan
   * → 只生成受影响页面 → 成功后保存新基线 + 版本快照。
   */
  const startIncremental = useCallback(async () => {
    if (isGenerating.current || pages.length === 0) return;
    isGenerating.current = true;

    let concurrent = 1;
    try {
      const config = await loadConfig();
      concurrent = config.concurrency.max_concurrent;
    } catch {
      // 配置加载失败，使用默认值
    }

    try {
      // 1. 旧基线（生成前必须先读）
      const cachedOld = await loadCachedManifest();
      // 2. 当前源码快照 + 符号
      const current = await scanFiles();
      const symbols: SymbolManifest = await parseFiles(current);

      // 3. 构建增量计划（无旧基线则降级为全量）
      let plan: IncrementalPlan | undefined;
      let affectedPages: WikiPage[];
      if (!cachedOld) {
        logger.warn("增量更新：未找到历史基线，降级为全量重新生成");
        affectedPages = pages;
      } else {
        plan = await buildIncrementalPlan({
          cached: cachedOld,
          current,
          symbols,
          wikiPath: getWikiDir(),
          pages,
        });
        affectedPages = plan.affectedDocs.map((d) => d.page as WikiPage);
      }

      // 4. 无变更：短路
      if (cachedOld && affectedPages.length === 0) {
        logger.info("增量更新：自上次生成以来无源码变更");
        updateState((draft) => {
          const newState = createInitialArticlesState(pages);
          Object.assign(draft, newState);
          for (const p of pages) draft.pages[p.slug] = { status: "completed" };
          draft.completedCount = pages.length;
          draft.pendingCount = 0;
        });
        onComplete?.();
        return;
      }

      // 5. 初始化状态：受影响页面 waiting，其余 completed
      const affectedSlugs = new Set(affectedPages.map((p) => p.slug));
      updateState((draft) => {
        const newState = createInitialArticlesState(pages);
        Object.assign(draft, newState);
        for (const p of pages) {
          if (!affectedSlugs.has(p.slug)) {
            draft.pages[p.slug] = { status: "completed" };
          }
        }
        draft.completedCount = pages.length - affectedPages.length;
        draft.pendingCount = affectedPages.length;
      });

      logger.info(`增量更新：${affectedPages.length} 个受影响页面`);

      // 6. 生成（plan 存在时驱动受影响页面选择；否则全量重生 pages）
      await generateWikiContent({
        pages,
        symbols,
        incrementalPlan: plan,
        maxConcurrent: concurrent,
        onEvent: handleEvent,
      });

      // 7. 成功后保存新基线（清单 + 符号需保持一致）+ 版本快照
      await saveCachedManifest(current);
      await saveCachedSymbols(symbols);
      await safeSnapshot();
      onComplete?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      handleEvent({
        type: "page_error",
        slug: pages[0]?.slug ?? "unknown",
        error: message,
      });
    } finally {
      isGenerating.current = false;
    }
  }, [pages, updateState, handleEvent, onComplete]);

  return {
    state,
    actions: { initialize, start, regeneratePage, startIncremental },
  };
}

/**
 * 创建版本快照（失败仅警告，不阻断生成结果）
 */
async function safeSnapshot(): Promise<void> {
  try {
    const name = await createVersionSnapshot();
    if (name) logger.info(`版本快照已创建: versions/${name}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`版本快照创建失败: ${message}`);
  }
}