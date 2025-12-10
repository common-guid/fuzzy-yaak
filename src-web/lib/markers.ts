import type { EditorView } from '@codemirror/view';

/**
 * Toggle a single-character marker around the current selection in a CodeMirror editor.
 *
 * Behaviour:
 * - If the selection is empty: insert `marker + marker` at the caret and place the cursor between them.
 * - If text is selected and is not wrapped: wrap selection as `marker + selection + marker`.
 * - If the selection is already wrapped in markers, or the selection sits between two markers,
 *   remove the surrounding markers.
 */
export function toggleMarkersAroundSelection(view: EditorView, marker = '§'): void {
  const state = view.state;
  const sel = state.selection.main;
  const docText = state.doc.toString();

  const from = sel.from;
  const to = sel.to;

  // Empty selection: insert a pair of markers at the caret and place cursor between them
  if (sel.empty) {
    const before = docText.slice(0, from);
    const after = docText.slice(from);
    const insert = `${marker}${marker}`;
    const nextPos = before.length + 1;

    const newText = before + insert + after;

    view.dispatch({
      changes: { from: 0, to: docText.length, insert: newText },
      selection: { anchor: nextPos, head: nextPos },
      scrollIntoView: true,
    });
    return;
  }

  const before = docText.slice(0, from);
  const selected = docText.slice(from, to);
  const after = docText.slice(to);
  const docLen = docText.length;

  // Case 1: selection is inside an existing pair of markers, e.g. `§foo§` with selection `foo`.
  if (from > 0 && to < docLen && docText[from - 1] === marker && docText[to] === marker) {
    const newText = before.slice(0, -1) + selected + after.slice(1);
    const newFrom = from - 1;
    const newTo = newFrom + selected.length;

    view.dispatch({
      changes: { from: 0, to: docLen, insert: newText },
      selection: { anchor: newFrom, head: newTo },
      scrollIntoView: true,
    });
    return;
  }

  // Case 2: selection already includes the markers, e.g. selection is `§foo§`.
  if (selected.length >= 2 && selected[0] === marker && selected[selected.length - 1] === marker) {
    const inner = selected.slice(1, -1);
    const newText = before + inner + after;
    const newFrom = from;
    const newTo = from + inner.length;

    view.dispatch({
      changes: { from: 0, to: docLen, insert: newText },
      selection: { anchor: newFrom, head: newTo },
      scrollIntoView: true,
    });
    return;
  }

  // Default: wrap the selection with a pair of markers.
  const wrapped = `${marker}${selected}${marker}`;
  const newText = before + wrapped + after;
  const newFrom = from + 1; // keep the inner selection
  const newTo = newFrom + selected.length;

  view.dispatch({
    changes: { from: 0, to: docLen, insert: newText },
    selection: { anchor: newFrom, head: newTo },
    scrollIntoView: true,
  });
}
