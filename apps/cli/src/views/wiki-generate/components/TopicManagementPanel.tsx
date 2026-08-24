/**
 * TopicManagementPanel - 主题维护交互面板
 *
 * 渲染 useTopicManagement 状态机对应的交互 UI：
 * 新增主题输入 / 删除二次确认 / 元数据编辑表单 / 小节重写指令输入
 * 及各自的 running/done 反馈。
 */

import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import Divider from "../../../components/Divider";
import SpinnerComponent from "../../../components/Spinner";
import { useI18n } from "../../../i18n";
import { theme } from "../../../theme";
import type { useTopicManagement } from "../hooks/use-topic-management";

type TopicManagement = ReturnType<typeof useTopicManagement>;

interface TopicManagementPanelProps {
  topicManagement: TopicManagement;
}

export default function TopicManagementPanel({ topicManagement }: TopicManagementPanelProps) {
  const { t } = useI18n();
  const { state, actions } = topicManagement;
  const [text, setText] = useState("");

  useEffect(() => {
    switch (state.phase) {
      case "add-input":
      case "rewrite-input":
      case "edit-associated":
        setText("");
        break;
      case "edit-title":
        setText(state.draft.title);
        break;
      case "edit-section":
        setText(state.draft.section);
        break;
      case "edit-group":
        setText(state.draft.group);
        break;
      default:
        break;
    }
    // 仅在阶段切换时重置输入框内容
  }, [state.phase]);

  useInput(
    (input, key) => {
      if (state.phase === "delete-confirm") {
        if (input === "y") actions.confirmDelete();
        else if (input === "n" || key.escape) actions.cancel();
        return;
      }
      if (state.phase.endsWith("-done")) {
        actions.dismiss();
        return;
      }
      if (key.escape) {
        actions.cancel();
      }
    },
    { isActive: state.phase !== "idle" && !state.phase.endsWith("-running") }
  );

  if (state.phase === "idle") return null;

  const isInputPhase =
    state.phase === "add-input" ||
    state.phase === "rewrite-input" ||
    state.phase === "edit-title" ||
    state.phase === "edit-section" ||
    state.phase === "edit-group" ||
    state.phase === "edit-associated";

  const isRunning = state.phase.endsWith("-running");
  const isDone = state.phase.endsWith("-done");

  let promptLabel = "";
  let onSubmit: ((value: string) => void) | undefined;
  if (state.phase === "add-input") {
    promptLabel = t("wikiGenerate.addPrompt");
    onSubmit = actions.submitAdd;
  } else if (state.phase === "rewrite-input") {
    promptLabel = t("wikiGenerate.sectionRewritePrompt");
    onSubmit = actions.submitRewrite;
  } else if (state.phase === "edit-title") {
    promptLabel = t("wikiGenerate.editTitleLabel");
    onSubmit = actions.submitEditTitle;
  } else if (state.phase === "edit-section") {
    promptLabel = t("wikiGenerate.editSectionLabel");
    onSubmit = actions.submitEditSection;
  } else if (state.phase === "edit-group") {
    promptLabel = t("wikiGenerate.editGroupLabel");
    onSubmit = actions.submitEditGroup;
  } else if (state.phase === "edit-associated") {
    promptLabel = t("wikiGenerate.editAssociatedPrompt");
    onSubmit = actions.submitEditAssociated;
  }

  let runningLabel = "";
  if (state.phase === "add-running") runningLabel = t("wikiGenerate.addRunning");
  else if (state.phase === "delete-running") runningLabel = t("wikiGenerate.deleteRunning");
  else if (state.phase === "edit-running") runningLabel = t("wikiGenerate.editRunning");
  else if (state.phase === "rewrite-running") runningLabel = t("wikiGenerate.sectionRewriteRunning");

  return (
    <Box flexDirection="column">
      <Divider />

      {isInputPhase && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.primary}>{promptLabel}</Text>
          <Box>
            <Text color={theme.primary}>{"> "}</Text>
            <TextInput value={text} onChange={setText} onSubmit={onSubmit} showCursor />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>{t("wikiGenerate.submitHint")}</Text>
          </Box>
        </Box>
      )}

      {state.phase === "delete-confirm" && state.targetPage && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.error}>
            {t("wikiGenerate.deleteConfirm", { title: state.targetPage.title })}
          </Text>
          <Box marginTop={1}>
            <Text dimColor>{t("wikiGenerate.deleteConfirmHint")}</Text>
          </Box>
        </Box>
      )}

      {isRunning && (
        <Box marginTop={1}>
          <SpinnerComponent />
          <Text> {runningLabel}</Text>
          {state.progressLabel && <Text dimColor> ({state.progressLabel})</Text>}
        </Box>
      )}

      {isDone && (
        <Box marginTop={1} flexDirection="column">
          <Text color={state.resultIsError ? theme.error : theme.success}>
            {state.resultMessage}
          </Text>
          <Box marginTop={1}>
            <Text dimColor>{t("wikiGenerate.dismissHint")}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
