/**
 * Catalog Editor Page - 目录编辑器
 *
 * 支持键盘导航及节点操作：锁定、删除、恢复、深度切换、保存。
 * 支持子模式：新增 (a) / 重命名 (r) / 移动 (m)。
 */

import { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { useNavigate } from 'react-router';
import { useWiki, useEscHandler } from '../../provider';
import { useI18n } from '../../i18n';
import {
  migrateCatalog,
  buildCatalogTree,
  toggleLock,
  tombstonePage,
  setDepth,
  updatePage,
  addPage,
  movePage,
  saveScope,
  listScopes,
  loadScope,
  resolveScope,
} from '@open-zread/utils';
import type { WikiPage } from '@open-zread/types';
import Divider from '../../components/Divider';
import { persistCatalog } from './persist.js';

export default function CatalogEditorPage() {
  const { t } = useI18n();
  const { wikiCatalog, reload } = useWiki();
  const { claimEsc, releaseEsc } = useEscHandler();
  const navigate = useNavigate();

  const [pages, setPages] = useState<WikiPage[]>(() =>
    wikiCatalog ? migrateCatalog(wikiCatalog).pages : []
  );

  const tree = useMemo(
    () => buildCatalogTree(pages, { includeTombstoned: true }),
    [pages]
  );

  const [cursor, setCursor] = useState(0);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [dirty, setDirty] = useState(false);

  const [mode, setMode] = useState<'browse' | 'add' | 'rename' | 'move' | 'saveScope' | 'loadScope'>('browse');
  const [draft, setDraft] = useState('');
  const [selection, setSelection] = useState<Set<string>>(new Set());

  const selected = tree.flat[cursor];

  // Claim ESC while in a sub-mode so the Layout's global handler doesn't navigate away.
  // In browse mode, release so the Layout can handle ESC (navigate back out of editor).
  useEffect(() => {
    if (mode !== 'browse') {
      claimEsc();
    } else {
      releaseEsc();
    }
    return () => releaseEsc();
  }, [mode, claimEsc, releaseEsc]);

  useInput((input, key) => {
    if (mode !== 'browse') {
      if (key.escape) { setMode('browse'); setDraft(''); }
      return; // other keys go to the focused TextInput/SelectInput
    }

    if (key.upArrow || input === 'k') {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setCursor((c) => Math.min(Math.max(0, tree.flat.length - 1), c + 1));
      return;
    }

    const id = selected?.id;

    if (input === 'l' && id) {
      setPages((ps) => toggleLock(ps, id));
      setDirty(true);
      return;
    }
    if (input === 'x' && id && selected.status !== 'tombstone') {
      setPages((ps) => tombstonePage(ps, id));
      setDirty(true);
      return;
    }
    if (input === 'u' && id && selected.status === 'tombstone') {
      setPages((ps) => updatePage(ps, id, { status: 'active' }));
      setDirty(true);
      return;
    }
    if (input === 'p' && id) {
      setPages((ps) => setDepth(ps, id, selected.depth === 'deep' ? 'standard' : 'deep'));
      setDirty(true);
      return;
    }
    if (input === 's' && wikiCatalog && status === 'idle') {
      setStatus('saving');
      persistCatalog(wikiCatalog, pages)
        .then(() => reload())
        .then(() => {
          setStatus('saved');
          setDirty(false);
          setTimeout(() => setStatus('idle'), 1500);
        })
        .catch(() => {
          setStatus('failed');
          setTimeout(() => setStatus('idle'), 2500);
        });
      return;
    }

    if (input === 'r') {
      if (!id) return;
      setDraft(selected.title);
      setMode('rename');
      return;
    }
    if (input === 'a') {
      setDraft('');
      setMode('add');
      return;
    }
    if (input === 'm') {
      if (!id) return;
      setMode('move');
      return;
    }

    // Scope save/load operate on the selection Set / scope files — they do NOT
    // require a currently-selected page, so they must run before the id guard.
    if (input === 'S') {
      if (selection.size > 0) {
        setDraft('');
        setMode('saveScope');
      }
      return;
    }
    if (input === 'L') {
      if (listScopes().length > 0) {
        setMode('loadScope');
      }
      return;
    }

    if (!id) return;

    if (input === 'v') {
      setSelection((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
      return;
    }
    if (input === 'D') {
      void navigate(`/wiki/catalog-merge?deepDive=${id}`);
      return;
    }
  });

  if (pages.length === 0) {
    return (
      <Box flexDirection="column">
        <Divider title={t('catalogEditor.title')} />
        <Box marginTop={1}>
          <Text dimColor>{t('catalogEditor.empty')}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Divider title={t('catalogEditor.title')} />

      {/* Save status / dirty indicator */}
      {(status !== 'idle' || dirty) && (
        <Box marginTop={1}>
          {status === 'saving' && <Text color="yellow">{t('catalogEditor.saving')}</Text>}
          {status === 'saved' && <Text color="green">{t('catalogEditor.saved')}</Text>}
          {status === 'failed' && <Text color="red">{t('catalogEditor.failed')}</Text>}
          {status === 'idle' && dirty && <Text color="yellow">* {t('catalogEditor.dirty')}</Text>}
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        {tree.sections.map((section) => (
          <Box key={section.section} flexDirection="column">
            {/* Section header */}
            <Text bold>{section.section}</Text>

            {/* Direct pages (no group) */}
            {section.directPages.map((page) => {
              const isSelected = tree.flat[cursor]?.id === page.id;
              const inSelection = selection.has(page.id ?? '');
              return (
                <Box key={page.id ?? page.slug} marginLeft={2}>
                  <Text
                    bold={isSelected}
                    color={
                      isSelected
                        ? 'cyan'
                        : page.status === 'tombstone'
                          ? 'gray'
                          : undefined
                    }
                  >
                    {isSelected ? '│ ' : '  '}
                    {inSelection ? '* ' : ''}
                    {page.title}
                    {page.locked ? ' 🔒' : ''}
                    {page.depth === 'deep' ? ' [deep]' : ''}
                    {page.status === 'tombstone' ? ' (deleted)' : ''}
                  </Text>
                </Box>
              );
            })}

            {/* Groups */}
            {section.groups.map((grp) => (
              <Box key={grp.group} flexDirection="column" marginLeft={2}>
                {/* Group label */}
                <Text dimColor>{grp.group}</Text>

                {/* Group pages */}
                {grp.pages.map((page) => {
                  const isSelected = tree.flat[cursor]?.id === page.id;
                  const inSelection = selection.has(page.id ?? '');
                  return (
                    <Box key={page.id ?? page.slug} marginLeft={2}>
                      <Text
                        bold={isSelected}
                        color={
                          isSelected
                            ? 'cyan'
                            : page.status === 'tombstone'
                              ? 'gray'
                              : undefined
                        }
                      >
                        {isSelected ? '│ ' : '  '}
                        {inSelection ? '* ' : ''}
                        {page.title}
                        {page.locked ? ' 🔒' : ''}
                        {page.depth === 'deep' ? ' [deep]' : ''}
                        {page.status === 'tombstone' ? ' (deleted)' : ''}
                      </Text>
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Box>
        ))}
      </Box>

      {/* Sub-mode: rename */}
      {mode === 'rename' && (
        <Box marginTop={1}>
          <Text>{t('catalogEditor.renameLabel')}</Text>
          <TextInput
            value={draft}
            onChange={setDraft}
            onSubmit={() => {
              const id = selected?.id;
              if (id) {
                const title = draft.trim();
                setPages((ps) => updatePage(ps, id, { title: title || selected.title }));
                setDirty(true);
              }
              setMode('browse');
            }}
          />
        </Box>
      )}

      {/* Sub-mode: add */}
      {mode === 'add' && (
        <Box marginTop={1}>
          <Text>{t('catalogEditor.addLabel')}</Text>
          <TextInput
            value={draft}
            onChange={setDraft}
            onSubmit={() => {
              const title = draft.trim();
              if (title) {
                const slug = `custom-${Date.now()}`;
                setPages((ps) =>
                  addPage(ps, {
                    slug,
                    title,
                    file: `${slug}.md`,
                    section: selected?.section ?? t('catalogEditor.uncategorized'),
                    group: selected?.group,
                    level: 'Intermediate',
                  })
                );
                setDirty(true);
              }
              setMode('browse');
            }}
          />
        </Box>
      )}

      {/* Sub-mode: move */}
      {mode === 'move' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>{t('catalogEditor.moveLabel')}</Text>
          <SelectInput
            items={[
              ...new Set(
                pages.filter((p) => p.status !== 'tombstone').map((p) => p.section)
              ),
            ].map((s) => ({ label: s, value: s }))}
            onSelect={(item) => {
              const id = selected?.id;
              if (id) {
                setPages((ps) => movePage(ps, id, item.value));
                setDirty(true);
              }
              setMode('browse');
            }}
          />
        </Box>
      )}

      {/* Sub-mode: saveScope */}
      {mode === 'saveScope' && (
        <Box marginTop={1}>
          <Text>{t('catalogEditor.saveScopeLabel')}</Text>
          <TextInput
            value={draft}
            onChange={setDraft}
            onSubmit={() => {
              const name = draft.trim();
              if (name) {
                saveScope({ name, pageIds: [...selection], createdAt: new Date().toISOString() });
                setSelection(new Set());
              }
              setMode('browse');
            }}
          />
        </Box>
      )}

      {/* Sub-mode: loadScope */}
      {mode === 'loadScope' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>{t('catalogEditor.loadScopeLabel')}</Text>
          <SelectInput
            items={listScopes().map((s) => ({ label: s.name, value: s.name }))}
            onSelect={(item) => {
              const sc = loadScope(item.value);
              if (sc) {
                const ids = resolveScope(sc, pages).map((p) => p.id).filter((x): x is string => !!x);
                setSelection(new Set(ids));
              }
              setMode('browse');
            }}
          />
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        {mode === 'browse' ? (
          <Text dimColor>{t('catalogEditor.hintBrowse')}</Text>
        ) : (
          <Text dimColor>{t('catalogEditor.hintEdit')}</Text>
        )}
      </Box>
    </Box>
  );
}
