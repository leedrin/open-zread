/**
 * Catalog Editor Page - 目录编辑器
 *
 * 骨架视图：渲染目录树 + 键盘导航。暂无写操作（后续任务追加）。
 */

import { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { useWiki } from '../../provider';
import { migrateCatalog, buildCatalogTree } from '@open-zread/utils';
import type { WikiPage } from '@open-zread/types';
import Divider from '../../components/Divider';

export default function CatalogEditorPage() {
  const { wikiCatalog } = useWiki();

  const [pages] = useState<WikiPage[]>(() =>
    wikiCatalog ? migrateCatalog(wikiCatalog).pages : []
  );

  const tree = useMemo(
    () => buildCatalogTree(pages, { includeTombstoned: true }),
    [pages]
  );

  const [cursor, setCursor] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow || _input === 'k') {
      setCursor((c) => Math.max(0, c - 1));
    }
    if (key.downArrow || _input === 'j') {
      setCursor((c) => Math.min(Math.max(0, tree.flat.length - 1), c + 1));
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
        <Text dimColor>↑/↓ 导航 | ESC 返回</Text>
      </Box>
    </Box>
  );
}
