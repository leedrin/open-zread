import { describe, expect, test, vi } from 'bun:test';
import type { KeyboardEvent } from 'react';
import { handleProjectLibraryTreeKeyDown } from '../components/ProjectLibraryTree';

function treeItem(id: string, parentId?: string, expanded?: boolean, onClick = vi.fn(), onExpand = vi.fn()) {
  const state = { tabIndex: -1, focused: false };
  const item = {
    dataset: { treeItemId: id, ...(parentId ? { treeParentId: parentId } : {}) },
    getAttribute: (name: string) => name === 'aria-expanded' && expanded !== undefined ? String(expanded) : null,
    closest: (selector: string) => selector === '[role="treeitem"]' ? item : null,
    click: onClick,
    parentElement: { querySelector: () => ({ click: onExpand }) },
    focus: () => { state.focused = true; },
    ...state,
  } as unknown as HTMLElement;
  return { item, state, onClick, onExpand };
}

function keyboardEvent(key: string, target: HTMLElement) {
  return {
    key,
    target,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent<HTMLElement>;
}

function treeRoot(items: HTMLElement[]) {
  return { querySelectorAll: () => items } as unknown as HTMLElement;
}

describe('Project library tree keyboard navigation', () => {
  test('uses one roving tab stop and moves focus with the arrow keys', () => {
    const first = treeItem('project:p1');
    const second = treeItem('wiki:p1:open_zread@.', 'project:p1');
    const root = treeRoot([first.item, second.item]);
    const event = keyboardEvent('ArrowDown', first.item);

    handleProjectLibraryTreeKeyDown(event, root, () => undefined);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(first.item.tabIndex).toBe(-1);
    expect(second.item.tabIndex).toBe(0);
    expect(second.state.focused).toBe(true);
  });

  test('moves focus from a leaf to its parent with ArrowLeft', () => {
    const project = treeItem('project:p1');
    const wiki = treeItem('wiki:p1:open_zread@.', 'project:p1');
    const root = treeRoot([project.item, wiki.item]);

    handleProjectLibraryTreeKeyDown(keyboardEvent('ArrowLeft', wiki.item), root, () => undefined);

    expect(project.state.focused).toBe(true);
    expect(project.item.tabIndex).toBe(0);
  });

  test('activates the focused tree item with Enter or Space', () => {
    for (const key of ['Enter', ' ', 'Spacebar']) {
      const onClick = vi.fn();
      const project = treeItem('project:p1', undefined, false, onClick);
      const event = keyboardEvent(key, project.item);

      handleProjectLibraryTreeKeyDown(event, treeRoot([project.item]), () => undefined);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(onClick).toHaveBeenCalledTimes(1);
    }
  });

  test('focuses the first child of an expanded tree node with ArrowRight', () => {
    const project = treeItem('project:p1', undefined, true);
    const firstChild = treeItem('wiki:p1:open_zread@.', 'project:p1');
    const root = treeRoot([project.item, firstChild.item]);

    handleProjectLibraryTreeKeyDown(keyboardEvent('ArrowRight', project.item), root, () => undefined);

    expect(firstChild.state.focused).toBe(true);
  });

  test('expands a collapsed node and moves focus into its newly visible child', async () => {
    const project = treeItem('project:p1', undefined, false);
    const child = treeItem('wiki:p1:open_zread@.', 'project:p1');
    const root = treeRoot([project.item, child.item]);

    handleProjectLibraryTreeKeyDown(keyboardEvent('ArrowRight', project.item), root, () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(project.onExpand).toHaveBeenCalledTimes(1);
    expect(child.state.focused).toBe(true);
    expect(child.item.tabIndex).toBe(0);
  });

  test('Escape closes the tree even when focus is on a non-tree control', () => {
    const closeTree = vi.fn();
    const event = keyboardEvent('Escape', { closest: () => null } as unknown as HTMLElement);

    handleProjectLibraryTreeKeyDown(event, treeRoot([]), closeTree);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(closeTree).toHaveBeenCalledTimes(1);
  });
});
