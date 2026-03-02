import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder, type Extension } from '@codemirror/state';

export interface Marker {
  id: string;
  start: number;
  end: number;
  originalText: string;
}

const markerDecoration = Decoration.mark({
  class: 'bg-yellow-500/30 border-b-2 border-yellow-500',
  attributes: { title: 'Fuzzer Replacement Marker' }
});

export function fuzzerMarkersExtension(markers: Marker[]): Extension {
    return [
        ViewPlugin.fromClass(
            class {
                decorations: DecorationSet;

                constructor(view: EditorView) {
                    this.decorations = this.buildDecorations(view);
                }

                update(update: ViewUpdate) {
                    if (update.docChanged || update.viewportChanged) {
                        this.decorations = this.buildDecorations(update.view);
                    }
                }

                buildDecorations(view: EditorView) {
                    const builder = new RangeSetBuilder<Decoration>();
                    const sortedMarkers = [...markers].sort((a, b) => a.start - b.start);

                    for (const marker of sortedMarkers) {
                        // Ensure marker is within bounds
                        if (marker.end <= view.state.doc.length) {
                             builder.add(marker.start, marker.end, markerDecoration);
                        }
                    }
                    return builder.finish();
                }
            },
            {
                decorations: (v) => v.decorations,
            },
        ),
    ];
}
