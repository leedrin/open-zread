/**
 * Catalog Merge Page - 重新生成（合并）
 *
 * Phase state machine:
 *   proposing → review → applying → done | error
 *
 * Proposing: run generateCatalogProposal, show spinner status.
 * Review:    show grouped decision rows; ↑/↓ navigate, space toggle, s confirm.
 * Applying:  applyMergePlan → persistMergedCatalog → generateWikiContent.
 * Done/error: final message.
 */

import { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { useSearchParams, useNavigate } from 'react-router';
import { useWiki, useEscHandler } from '../../provider';
import { useI18n } from '../../i18n';
import Divider from '../../components/Divider';
import Spinner from '../../components/Spinner';
import {
  generateCatalogProposal,
  generateDeepDiveProposal,
  persistMergedCatalog,
  generateWikiContent,
  type CatalogEvent,
  type CatalogProposal,
} from '@open-zread/orchestrator';
import { applyMergePlan, loadCachedSymbols, finalizeWiki, getWikiDir } from '@open-zread/utils';
import type { WikiPage } from '@open-zread/types';

// ─── Phase ────────────────────────────────────────────────────────────────────

type Phase = 'proposing' | 'review' | 'applying' | 'done' | 'error';

// ─── Decision row ─────────────────────────────────────────────────────────────

type RowKind = 'add' | 'update' | 'conflict' | 'remove';

interface DecisionRow {
  id: string;
  kind: RowKind;
  title: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildRows(proposal: CatalogProposal): DecisionRow[] {
  const rows: DecisionRow[] = [];

  const titleOf = (p: WikiPage) => p.title || p.slug;

  for (const p of proposal.plan.adds) {
    const id = p.id;
    if (!id) continue;
    rows.push({ id, kind: 'add', title: titleOf(p) });
  }
  for (const u of proposal.plan.updates) {
    rows.push({ id: u.id, kind: 'update', title: titleOf(u.to) });
  }
  for (const c of proposal.plan.conflicts) {
    rows.push({ id: c.id, kind: 'conflict', title: titleOf(c.remote) });
  }
  for (const p of proposal.plan.removes) {
    const id = p.id;
    if (!id) continue;
    rows.push({ id, kind: 'remove', title: titleOf(p) });
  }
  return rows;
}

function buildInitialDecisions(rows: DecisionRow[]) {
  return {
    acceptedAddIds: new Set(rows.filter(r => r.kind === 'add').map(r => r.id)),
    acceptedUpdateIds: new Set(rows.filter(r => r.kind === 'update').map(r => r.id)),
    acceptedRemoveIds: new Set<string>(),
    conflictResolutions: new Map<string, 'local' | 'remote'>(
      rows.filter(r => r.kind === 'conflict').map(r => [r.id, 'local'] as [string, 'local' | 'remote'])
    ),
  };
}

function mapEventToStatus(event: CatalogEvent): string {
  switch (event.type) {
    case 'requesting':
      return '请求中…';
    case 'responding':
      return '响应中…';
    case 'tool_start':
      return event.toolName ? `工具: ${event.toolName}` : '工具调用…';
    case 'tool_result':
      return '工具结果…';
    case 'retry':
      return `重试 ${event.retryCount ?? '?'}/${event.maxRetries ?? '?'}…`;
    case 'error':
      return `错误: ${event.error ?? ''}`;
    default:
      return '生成提案中…';
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CatalogMergePage() {
  const { t } = useI18n();
  const { reload } = useWiki();
  const { claimEsc, releaseEsc } = useEscHandler();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const deepDiveId = params.get('deepDive');

  const [phase, setPhase] = useState<Phase>('proposing');
  const [status, setStatus] = useState('');
  const [activity, setActivity] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  const cancelledRef = useRef(false);

  const [proposal, setProposal] = useState<CatalogProposal | null>(null);
  const [rows, setRows] = useState<DecisionRow[]>([]);

  const [acceptedAddIds, setAcceptedAddIds] = useState(new Set<string>());
  const [acceptedUpdateIds, setAcceptedUpdateIds] = useState(new Set<string>());
  const [acceptedRemoveIds, setAcceptedRemoveIds] = useState(new Set<string>());
  const [conflictResolutions, setConflictResolutions] = useState(new Map<string, 'local' | 'remote'>());

  const [cursor, setCursor] = useState(0);

  const hasStarted = useRef(false);

  // ── Claim ESC while busy so the Layout doesn't also navigate; this view
  //    handles ESC itself (abort → back) in useInput below. ───────────────────
  useEffect(() => {
    if (phase === 'proposing' || phase === 'applying') {
      claimEsc();
    } else {
      releaseEsc();
    }
    return () => releaseEsc();
  }, [phase, claimEsc, releaseEsc]);

  // ── Elapsed-time ticker while busy (constant "alive" feedback even when the
  //    LLM is mid-response and no events arrive). ──────────────────────────────
  useEffect(() => {
    if (phase !== 'proposing' && phase !== 'applying') return;
    const start = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // ── Start proposing on mount ───────────────────────────────────────────────
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    setPhase('proposing');
    setStatus(t('catalogMerge.proposing'));

    // Detailed (flickery) per-event line shown dim as secondary "activity".
    const handleAgentEvent = (event: CatalogEvent) => {
      setActivity(mapEventToStatus(event));
    };

    const proposalPromise = deepDiveId
      ? generateDeepDiveProposal(deepDiveId, handleAgentEvent)
      : generateCatalogProposal(handleAgentEvent);

    proposalPromise
      .then((p) => {
        if (cancelledRef.current) return; // user aborted; do not enter review
        setProposal(p);
        const built = buildRows(p);
        setRows(built);
        const decisions = buildInitialDecisions(built);
        setAcceptedAddIds(decisions.acceptedAddIds);
        setAcceptedUpdateIds(decisions.acceptedUpdateIds);
        setAcceptedRemoveIds(decisions.acceptedRemoveIds);
        setConflictResolutions(decisions.conflictResolutions);
        setCursor(0);
        setPhase('review');
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(msg);
        setPhase('error');
      });
  }, [t, deepDiveId]);

  // ── Apply decisions ────────────────────────────────────────────────────────
  const applyDecisions = () => {
    const p = proposal;
    if (!p) return;

    setPhase('applying');
    setStatus(t('catalogMerge.applying'));

    const decisions = {
      acceptedAddIds,
      acceptedUpdateIds,
      acceptedRemoveIds,
      conflictResolutions,
    };

    const { pages, toGenerate } = applyMergePlan(p.local, p.plan, decisions);

    persistMergedCatalog(pages, p.remote)
      .then(async () => {
        if (toGenerate.length > 0) {
          const symbols = await loadCachedSymbols();
          await generateWikiContent({
            pages: toGenerate,
            symbols: symbols ?? undefined,
            onEvent: (ev) => {
              setActivity(`${ev.slug}`);
            },
          });
          // generateWikiContent's internal finalize used only the regenerated subset,
          // which clobbers _sidebar.md / source-index. Re-finalize with the FULL merged
          // page set so the navigation reflects the whole catalog.
          await finalizeWiki(getWikiDir(), { pages, glossary: p.remote.glossary });
        }
        if (cancelledRef.current) return;
        await reload();
        setPhase('done');
      })
      .catch((err: unknown) => {
        if (cancelledRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(msg);
        setPhase('error');
      });
  };

  // ── Keyboard handling ──────────────────────────────────────────────────────
  useInput((input, key) => {
    // Abort while busy: mark cancelled and go back. Proposing aborts safely
    // (generateCatalogProposal restores wiki.json in its finally); applying may
    // leave partially-generated pages, which the user can regenerate.
    if (phase === 'proposing' || phase === 'applying') {
      if (key.escape || input === 'q') {
        cancelledRef.current = true;
        releaseEsc();
        void navigate(-1);
      }
      return;
    }
    if (phase !== 'review') return;

    if (key.upArrow || input === 'k') {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setCursor((c) => Math.min(Math.max(0, rows.length - 1), c + 1));
      return;
    }

    if (input === ' ' || key.return) {
      const row = rows[cursor];
      const id = row?.id;
      if (!id) return;

      if (row.kind === 'add') {
        setAcceptedAddIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      } else if (row.kind === 'update') {
        setAcceptedUpdateIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      } else if (row.kind === 'remove') {
        setAcceptedRemoveIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      } else if (row.kind === 'conflict') {
        setConflictResolutions((prev) => {
          const next = new Map(prev);
          next.set(id, next.get(id) === 'remote' ? 'local' : 'remote');
          return next;
        });
      }
      return;
    }

    if (input === 's') {
      applyDecisions();
    }
  });

  // ── Kind label ─────────────────────────────────────────────────────────────
  const kindLabel = (kind: RowKind) => {
    switch (kind) {
      case 'add':      return t('catalogMerge.add');
      case 'update':   return t('catalogMerge.update');
      case 'conflict': return t('catalogMerge.conflict');
      case 'remove':   return t('catalogMerge.remove');
    }
  };

  const kindColor = (kind: RowKind) => {
    switch (kind) {
      case 'add':      return 'green';
      case 'update':   return 'cyan';
      case 'conflict': return 'yellow';
      case 'remove':   return 'red';
    }
  };

  const acceptedIndicator = (row: DecisionRow): string => {
    const id = row.id;
    if (row.kind === 'add')      return acceptedAddIds.has(id) ? '✓' : '✗';
    if (row.kind === 'update')   return acceptedUpdateIds.has(id) ? '✓' : '✗';
    if (row.kind === 'remove')   return acceptedRemoveIds.has(id) ? '✓' : '✗';
    if (row.kind === 'conflict') return `[${conflictResolutions.get(id) ?? 'local'}]`;
    return '';
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column">
      <Divider title={deepDiveId ? t('catalogMerge.deepDiveTitle') : t('catalogMerge.title')} />

      {/* Busy (proposing / applying): spinner + elapsed + live activity + abort */}
      {(phase === 'proposing' || phase === 'applying') && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Spinner />
            <Text color="yellow"> {status || (phase === 'proposing' ? t('catalogMerge.proposing') : t('catalogMerge.applying'))}</Text>
            <Text dimColor>  ({elapsed}s)</Text>
          </Box>
          {activity ? (
            <Box marginTop={1}>
              <Text dimColor>{t('catalogMerge.activity')}: {activity}</Text>
            </Box>
          ) : null}
          <Box marginTop={1}>
            <Text dimColor>{t('catalogMerge.hintBusy')}</Text>
          </Box>
        </Box>
      )}

      {/* Review */}
      {phase === 'review' && (
        <>
          {rows.length === 0 ? (
            <Box marginTop={1}>
              <Text dimColor>{t('catalogMerge.empty')}</Text>
            </Box>
          ) : (
            <Box flexDirection="column" marginTop={1}>
              {rows.map((row, i) => {
                const isSelected = i === cursor;
                return (
                  <Box key={row.id} marginLeft={2}>
                    <Text
                      bold={isSelected}
                      color={isSelected ? 'cyan' : undefined}
                    >
                      {isSelected ? '│ ' : '  '}
                      <Text color={kindColor(row.kind)}>[{kindLabel(row.kind)}]</Text>
                      {' '}
                      {row.title}
                      {' '}
                      <Text dimColor>{acceptedIndicator(row)}</Text>
                    </Text>
                  </Box>
                );
              })}
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor>{t('catalogMerge.hintReview')}</Text>
          </Box>
        </>
      )}

      {/* Done */}
      {phase === 'done' && (
        <Box marginTop={1}>
          <Text color="green">{t('catalogMerge.done')}</Text>
        </Box>
      )}

      {/* Error */}
      {phase === 'error' && (
        <Box marginTop={1}>
          <Text color="red">{errorMsg}</Text>
        </Box>
      )}
    </Box>
  );
}
