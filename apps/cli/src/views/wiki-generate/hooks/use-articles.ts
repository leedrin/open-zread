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
import { loadConfig, getWikiDir, joinPath, fileExists } from "@open-zread/utils";
import { generateWikiContent, type ArticleEventPayload } from "@open-zread/orchestrator";
import { articleEventToState } from "../mapper";
import { createInitialArticlesState } from "../state";
import type { ArticlesState, WikiPage, PageStatus } from "../types";

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
    /** 同步页面集合（主题维护新增/删除页面后调用，不重置已有页面状态） */
    syncPages: (currentPages: WikiPage[]) => Promise<void>;
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
        const currentState = { ...draft } as ArticlesState;
        const newState = articleEventToState(
          currentState,
          event
        );
        if (newState === currentState) return;
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


    try {
      await generateWikiContent({
        pages: pendingPages,
        maxConcurrent: concurrent,
        onEvent: handleEvent,
      });
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

      // 启动生成
      try {
        await generateWikiContent({
          pages: [page],
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
   * 同步页面集合
   *
   * 主题维护（新增/删除/编辑元数据）操作会直接修改 wiki.json，但不经过
   * initialize()/start() 这条路径。initialize() 本身只在首次进入时执行一次
   * （isInitialized 守卫），后续 pages 变化不会重新扫描，导致 statusMap
   * 与最新的 wiki.json 页面列表脱节（新页面查不到状态、被删除的页面残留）。
   *
   * 只做增量对账，不重置已有页面状态：currentPages 中新出现的 slug 按磁盘
   * 文件是否存在判定初始状态；currentPages 中已不存在的 slug 从 statusMap 移除。
   */
  const syncPages = useCallback(
    async (currentPages: WikiPage[]) => {
      if (!isInitialized.current) return;

      const currentSlugs = new Set(currentPages.map((p) => p.slug));
      const wikiDir = getWikiDir();

      const statusesToAdd: Record<string, PageStatus> = {};
      for (const page of currentPages) {
        if (page.slug in statusesToAdd) continue;
        const exists = await fileExists(joinPath(wikiDir, page.section, page.file)).catch(() => false);
        statusesToAdd[page.slug] = { status: exists ? "completed" : "waiting" };
      }

      updateState((draft) => {
        for (const [slug, status] of Object.entries(statusesToAdd)) {
          if (!(slug in draft.pages)) {
            draft.pages[slug] = status;
          }
        }
        const remainingPages: typeof draft.pages = {};
        for (const [slug, status] of Object.entries(draft.pages)) {
          if (currentSlugs.has(slug)) {
            remainingPages[slug] = status;
          }
        }
        draft.pages = remainingPages;
        draft.completedCount = Object.values(draft.pages).filter((p) => p.status === "completed").length;
        draft.failedCount = Object.values(draft.pages).filter((p) => p.status === "failed").length;
        draft.pendingCount = currentPages.length - draft.completedCount - draft.failedCount;
      });
    },
    [updateState]
  );

  return {
    state,
    actions: { initialize, start, regeneratePage, syncPages },
  };
}
