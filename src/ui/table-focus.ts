interface FocusedTable {
  root: HTMLElement;
  deleteTable(): void;
}

let current: FocusedTable | null = null;

/** The table the cursor is in. Kept apart from the table editor so the palette can ask without loading the editor. */
export const focusedTable = () => (current?.root.isConnected ? current : null);

export function setFocusedTable(table: FocusedTable | null): void {
  current = table;
}
