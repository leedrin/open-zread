/**
 * useTopicManagement - Wiki 主题维护 Hook（新增 / 删除 / 编辑元数据 / 小节重写）
 *
 * 架构设计：
 * - 单一 phase 状态机驱动 4 类维护操作的交互流程
 * - 同一时刻只允许一个操作处于 running 阶段（进程内互斥，manage 模式下
 *   the CLI 层用 isBusy 禁用其余快捷键触发新操作）
 * - 每类操作完成后调用 useWiki().reload() 刷新 wiki.json 快照
 */

import { useCallback, useState } from "react";
import {
  appendWikiTopic,
  updateWikiTopicAssociatedFiles,
  regenerateWikiPageSection,
  generateWikiContent,
  type CatalogEvent,
} from "@open-zread/orchestrator";
import { deleteWikiPage, updateWikiPageMetadata, loadConfig } from "@open-zread/utils";
import { useWiki } from "../../../provider";
import type { WikiPage } from "../types";

export type TopicManagementPhase =
  | "idle"
  | "add-input"
  | "add-running"
  | "add-done"
  | "delete-confirm"
  | "delete-running"
  | "delete-done"
  | "edit-title"
  | "edit-section"
  | "edit-group"
  | "edit-associated"
  | "edit-running"
  | "edit-done"
  | "rewrite-input"
  | "rewrite-running"
  | "rewrite-done";

export interface TopicManagementState {
  phase: TopicManagementPhase;
  targetPage: WikiPage | null;
  /** 表单草稿：add/rewrite 用 text；edit 用 title/section/group/associatedText */
  draft: {
    text: string;
    title: string;
    section: string;
    group: string;
    associatedText: string;
  };
  progressLabel?: string;
  resultMessage?: string;
  resultIsError?: boolean;
}

const emptyDraft = { text: "", title: "", section: "", group: "", associatedText: "" };

function eventLabel(event: CatalogEvent): string {
  switch (event.type) {
    case "scanning":
      return "scanning";
    case "parsing":
      return "parsing";
    case "requesting":
      return "requesting";
    case "responding":
      return "responding";
    case "tool_start":
    case "tool_result":
      return event.toolName ? `tool: ${event.toolName}` : "tool";
    case "retry":
      return `retry ${event.retryCount ?? ""}/${event.maxRetries ?? ""}`;
    default:
      return "";
  }
}

export function useTopicManagement() {
  const { reload } = useWiki();
  const [state, setState] = useState<TopicManagementState>({
    phase: "idle",
    targetPage: null,
    draft: emptyDraft,
  });

  const isBusy = state.phase.endsWith("-running");

  const reset = useCallback(() => {
    setState({ phase: "idle", targetPage: null, draft: emptyDraft });
  }, []);

  // ==================== 新增主题 ====================

  const openAdd = useCallback(() => {
    if (isBusy) return;
    setState({ phase: "add-input", targetPage: null, draft: emptyDraft });
  }, [isBusy]);

  const submitAdd = useCallback(async (topicDescription: string) => {
    if (!topicDescription.trim()) return;
    setState((s) => ({ ...s, phase: "add-running", progressLabel: undefined }));

    try {
      const result = await appendWikiTopic(topicDescription, (event) => {
        setState((s) => ({ ...s, progressLabel: eventLabel(event) }));
      });

      if (result.addedPages.length > 0) {
        let concurrent = 1;
        try {
          const config = await loadConfig();
          concurrent = config.concurrency.max_concurrent;
        } catch {
          // 使用默认并发数
        }
        await generateWikiContent({ pages: result.addedPages, maxConcurrent: concurrent });
      }

      await reload();
      setState((s) => ({
        ...s,
        phase: "add-done",
        resultIsError: false,
        resultMessage: `已新增 ${result.addedPages.length} 篇页面: ${result.addedPages.map((p) => p.slug).join(", ")}`,
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, phase: "add-done", resultIsError: true, resultMessage: message }));
    }
  }, [reload]);

  // ==================== 删除主题 ====================

  const openDelete = useCallback((page: WikiPage) => {
    if (isBusy) return;
    setState({ phase: "delete-confirm", targetPage: page, draft: emptyDraft });
  }, [isBusy]);

  const confirmDelete = useCallback(async () => {
    const page = state.targetPage;
    if (!page) return;

    setState((s) => ({ ...s, phase: "delete-running" }));

    try {
      await deleteWikiPage(page.slug);
      await reload();
      setState((s) => ({
        ...s,
        phase: "delete-done",
        resultIsError: false,
        resultMessage: `已删除「${page.title}」`,
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, phase: "delete-done", resultIsError: true, resultMessage: message }));
    }
  }, [reload, state.targetPage]);

  // ==================== 编辑元数据 ====================

  const openEdit = useCallback((page: WikiPage) => {
    if (isBusy) return;
    setState({
      phase: "edit-title",
      targetPage: page,
      draft: {
        ...emptyDraft,
        title: page.title,
        section: page.section,
        group: page.group ?? "",
      },
    });
  }, [isBusy]);

  const submitEditTitle = useCallback((title: string) => {
    setState((s) => ({ ...s, phase: "edit-section", draft: { ...s.draft, title } }));
  }, []);

  const submitEditSection = useCallback((section: string) => {
    setState((s) => ({ ...s, phase: "edit-group", draft: { ...s.draft, section } }));
  }, []);

  const submitEditGroup = useCallback((group: string) => {
    setState((s) => ({ ...s, phase: "edit-associated", draft: { ...s.draft, group } }));
  }, []);

  const submitEditAssociated = useCallback(async (associatedText: string) => {
    setState((s) => ({ ...s, phase: "edit-running", draft: { ...s.draft, associatedText }, progressLabel: undefined }));

    const target = state.targetPage;
    const { title, section, group } = state.draft;
    if (!target) {
      setState((s) => ({ ...s, phase: "idle" }));
      return;
    }

    try {
      await updateWikiPageMetadata({
        slug: target.slug,
        title,
        section,
        group: group || undefined,
      });

      if (associatedText.trim()) {
        const result = await updateWikiTopicAssociatedFiles(target.slug, associatedText, (event) => {
          setState((s) => ({ ...s, progressLabel: eventLabel(event) }));
        });
        await generateWikiContent({ pages: [result.page] });
      }

      await reload();
      setState((s) => ({
        ...s,
        phase: "edit-done",
        resultIsError: false,
        resultMessage: `已更新「${title}」的元数据`,
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, phase: "edit-done", resultIsError: true, resultMessage: message }));
    }
  }, [reload, state.targetPage, state.draft]);

  // ==================== 小节级重新生成 ====================

  const openRewrite = useCallback((page: WikiPage) => {
    if (isBusy) return;
    setState({ phase: "rewrite-input", targetPage: page, draft: emptyDraft });
  }, [isBusy]);

  const submitRewrite = useCallback(async (instruction: string) => {
    if (!instruction.trim()) return;
    const target = state.targetPage;
    if (!target) return;

    setState((s) => ({ ...s, phase: "rewrite-running", progressLabel: undefined }));

    try {
      await regenerateWikiPageSection(target, instruction, (event) => {
        setState((s) => ({ ...s, progressLabel: eventLabel(event) }));
      });
      setState((s) => ({
        ...s,
        phase: "rewrite-done",
        resultIsError: false,
        resultMessage: `「${target.title}」小节重写完成`,
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, phase: "rewrite-done", resultIsError: true, resultMessage: message }));
    }
  }, [state.targetPage]);

  return {
    state,
    isBusy,
    actions: {
      openAdd,
      submitAdd,
      openDelete,
      confirmDelete,
      openEdit,
      submitEditTitle,
      submitEditSection,
      submitEditGroup,
      submitEditAssociated,
      openRewrite,
      submitRewrite,
      cancel: reset,
      dismiss: reset,
    },
  };
}
