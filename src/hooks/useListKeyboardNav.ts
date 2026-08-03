import { useCallback, type KeyboardEvent } from "react";
import { normalizePath } from "../lib/path";
import type { FileInfo } from "../types";

export interface NavigableRow {
  file: FileInfo;
  hasChildren: boolean;
}

function clampIndex(index: number, maxIndex: number) {
  return Math.min(Math.max(index, 0), maxIndex);
}

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

interface UseListKeyboardNavOptions<T extends NavigableRow> {
  items: T[];
  selectedPath: string | null;
  isPreview: boolean;
  /** Called when keyboard navigation selects a row. */
  onSelectPath: (file: FileInfo) => void;
  /** Called when Enter is pressed on a directory. */
  onEnterDirectory: (file: FileInfo) => void;
  /** Called when Enter is pressed on a non-directory. */
  onOpen: (file: FileInfo) => void;
  onDelete: (file: FileInfo) => void;
  /** Space: toggle the row context menu. */
  onToggleMenu: (file: FileInfo) => void;
  /** View-specific ArrowRight handling (e.g. tree expand/enter). */
  onArrowRight?: (current: T) => void;
  /** View-specific ArrowLeft handling (e.g. tree collapse / go up). */
  onArrowLeft?: (current: T) => void;
}

/**
 * Shared keyboard navigation for the tree and flat result lists. The handler
 * only acts when the list container itself is focused, so text inputs (search
 * box, etc.) are unaffected.
 */
export function useListKeyboardNav<T extends NavigableRow>(options: UseListKeyboardNavOptions<T>) {
  const {
    items,
    selectedPath,
    isPreview,
    onSelectPath,
    onEnterDirectory,
    onOpen,
    onDelete,
    onToggleMenu,
    onArrowRight,
    onArrowLeft,
  } = options;

  return useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (
        event.target !== event.currentTarget ||
        isTextEntryTarget(event.target) ||
        items.length === 0 ||
        isPreview
      ) {
        return;
      }

      const selectedIndex = items.findIndex(
        (row) => normalizePath(row.file.path) === normalizePath(selectedPath ?? ""),
      );
      const indexForMovement = selectedIndex >= 0 ? selectedIndex : 0;
      const selectNavigableIndex = (index: number) => {
        onSelectPath(items[clampIndex(index, items.length - 1)].file);
      };
      const current = selectedIndex >= 0 ? items[selectedIndex] : items[0];

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          selectNavigableIndex(indexForMovement + 1);
          return;
        case "ArrowUp":
          event.preventDefault();
          selectNavigableIndex(indexForMovement - 1);
          return;
        case "Home":
          event.preventDefault();
          selectNavigableIndex(0);
          return;
        case "End":
          event.preventDefault();
          selectNavigableIndex(items.length - 1);
          return;
        case "ArrowRight":
          event.preventDefault();
          if (current.file.is_dir) onArrowRight?.(current);
          return;
        case "ArrowLeft":
          event.preventDefault();
          onArrowLeft?.(current);
          return;
        case "Enter":
          event.preventDefault();
          if (current.file.is_dir) onEnterDirectory(current.file);
          else onOpen(current.file);
          return;
        case " ":
          event.preventDefault();
          onToggleMenu(current.file);
          return;
        case "Delete":
        case "Backspace":
          event.preventDefault();
          onDelete(current.file);
          return;
      }
    },
    [
      items,
      selectedPath,
      isPreview,
      onSelectPath,
      onEnterDirectory,
      onOpen,
      onDelete,
      onToggleMenu,
      onArrowRight,
      onArrowLeft,
    ],
  );
}
