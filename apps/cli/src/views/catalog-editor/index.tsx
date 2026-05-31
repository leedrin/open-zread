/**
 * Catalog Editor Page - 目录编辑器
 *
 * 支持键盘导航及节点操作：锁定、删除、恢复、深度切换、保存。
 */

import { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { useWiki } from '../../provider';
import {
  migrateCatalog,
  buildCatalogTree,
  toggleLock,
  tombstonePage,
  setDepth,
  updatePage,
} from '@open-zread/utils';
import type { WikiPage } from '@open-zread/types';
import Divider from '../../components/Divider';
import { persistCatalog } from './persist.js';

export default function CatalogEditorPage() {
  const { wikiCatalog, reload } = useWiki();

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

  const selected = tree.flat[cursor];

  useInput((input, key) => {
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
  });

  if (pages.length === 0) {
    return (
      <Box flexDirection="column">
        <Divider title="目录编辑器" />
        <Box marginTop={1}>
          <Text dimColor>暂无目录</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Divider title="目录编辑器" />

      {/* Save status / dirty indicator */}
      {(status !== 'idle' || dirty) && (
        <Box marginTop={1}>
          {status === 'saving' && <Text color="yellow">保存中…</Text>}
          {status === 'saved' && <Text color="green">已保存 ✓</Text>}
          {status === 'failed' && <Text color="red">保存失败</Text>}
          {status === 'idle' && dirty && <Text color="yellow">* 未保存更改</Text>}
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

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>↑/↓ 导航 | l 锁定 | x 删除 | u 恢复 | p 深度 | s 保存 | ESC 返回</Text>
      </Box>
    </Box>
  );
}
