import type { HttpRequest, HttpResponse } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { useAtom } from 'jotai';
import { atom } from 'jotai';
import type { CSSProperties } from 'react';
import { useCallback, useState, useMemo } from 'react';
import { useImportCurl } from '../hooks/useImportCurl';
import { invokeCmd } from '../lib/tauri';
import { Button } from './core/Button';
import { Editor } from './core/Editor/LazyEditor';
import { Tabs, TabContent } from './core/Tabs/Tabs';
import { UrlBar } from './UrlBar';
import { PlainInput } from './core/PlainInput';
import { HStack } from './core/Stacks';
import { Dialog } from './core/Dialog';
import { fuzzerMarkersExtension, type Marker } from './fuzzer/FuzzerEditorExtensions';
import type { EditorView } from '@codemirror/view';
import { generateId } from '../lib/generateId';
import { sendEphemeralRequest } from '../lib/sendEphemeralRequest';
import { Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell } from './core/Table';
import { StatusTag } from './core/StatusTag';
import { atomWithKVStorage } from '../lib/atoms/atomWithKVStorage';

// Use atomWithKVStorage for persistence
export const fuzzerDraftRequestAtom = atomWithKVStorage<HttpRequest | null>('fuzzer_draft_request', null);
export const fuzzerMarkersAtom = atomWithKVStorage<FuzzerMarker[]>('fuzzer_markers', []);
export const fuzzerWordlistAtom = atomWithKVStorage<string>('fuzzer_wordlist', '');
export const fuzzerResultsAtom = atomWithKVStorage<FuzzerResult[]>('fuzzer_results', []);
export const fuzzerIsLockedAtom = atomWithKVStorage<boolean>('fuzzer_is_locked', false);
export const fuzzerIsRunningAtom = atom<boolean>(false);

interface FuzzerMarker {
  id: string;
  field: 'url' | 'body';
  start: number;
  end: number;
  originalText: string;
}

interface FuzzerResult {
  id: string;
  word: string;
  status: number;
  elapsed: number;
  contentLength: number;
  error?: string;
  timestamp: number;
}

interface Props {
  style?: CSSProperties;
  className?: string;
}

export function FuzzerLayout({ style, className }: Props) {
  const [activeTab, setActiveTab] = useState('request');

  return (
    <div style={style} className={classNames(className, 'h-full flex flex-col bg-surface')}>
      <Tabs
        defaultValue="request"
        onChangeValue={setActiveTab}
        value={activeTab} // Control the tab
        tabs={[
          { value: 'request', label: 'Request' },
          { value: 'results', label: 'Results' },
        ]}
        className="h-full grid grid-rows-[auto_1fr]"
        tabListClassName="px-2 border-b border-border-subtle"
      >
        <TabContent value="request">
          <FuzzerRequestPane switchToResults={() => setActiveTab('results')} />
        </TabContent>
        <TabContent value="results">
          <FuzzerResultsPane />
        </TabContent>
      </Tabs>
    </div>
  );
}

function FuzzerRequestPane({ switchToResults }: { switchToResults: () => void }) {
  const [draftRequest, setDraftRequest] = useAtom(fuzzerDraftRequestAtom);
  const [markers, setMarkers] = useAtom(fuzzerMarkersAtom);
  const [wordlist, setWordlist] = useAtom(fuzzerWordlistAtom);
  const [isLocked, setIsLocked] = useAtom(fuzzerIsLockedAtom);
  const [isRunning, setIsRunning] = useAtom(fuzzerIsRunningAtom);
  const [results, setResults] = useAtom(fuzzerResultsAtom);

  const [showCurlImport, setShowCurlImport] = useState(false);
  const [curlInput, setCurlInput] = useState('');

  const [bodyEditorView, setBodyEditorView] = useState<EditorView | null>(null);

  // Track focused field to know where to apply marker
  const [focusedField, setFocusedField] = useState<'url' | 'body' | null>(null);

  const handleImportCurl = async () => {
    try {
      const request: HttpRequest = await invokeCmd('cmd_curl_to_request', {
        command: curlInput,
        workspaceId: 'temp', // We don't persist it yet
      });
      setDraftRequest(request);
      setShowCurlImport(false);
      setCurlInput('');
      setMarkers([]);
      setIsLocked(false);
      setResults([]);
    } catch (err) {
      console.error('Failed to import curl', err);
      // TODO: Show toast
    }
  };

  const updateDraft = (patch: Partial<HttpRequest>) => {
    if (draftRequest) {
        setDraftRequest({ ...draftRequest, ...patch });
    }
  };

  const handleMarkSelection = () => {
      // NOTE: For now we only support Body marking as UrlBar doesn't expose view.
      // But the logic is structured to support it if we get access.
      if (focusedField === 'body' && bodyEditorView) {
          const selection = bodyEditorView.state.selection.main;
          if (selection.empty) return;

          const marker: FuzzerMarker = {
              id: generateId(),
              field: 'body',
              start: selection.from,
              end: selection.to,
              originalText: bodyEditorView.state.doc.sliceString(selection.from, selection.to),
          };
          setMarkers([...markers, marker]);
          setIsLocked(true);
      } else {
          // If we can't detect focus or it's not body, alert user or try body fallback
          // For now, fallback to body if available
           if (bodyEditorView) {
              const selection = bodyEditorView.state.selection.main;
              if (!selection.empty) {
                  const marker: FuzzerMarker = {
                      id: generateId(),
                      field: 'body',
                      start: selection.from,
                      end: selection.to,
                      originalText: bodyEditorView.state.doc.sliceString(selection.from, selection.to),
                  };
                  setMarkers([...markers, marker]);
                  setIsLocked(true);
              }
           }
      }
  };

  const handleClearMarkers = () => {
      setMarkers([]);
      setIsLocked(false);
  };

  const handleRunFuzzer = async () => {
    if (!draftRequest || markers.length === 0 || !wordlist.trim()) return;

    setIsRunning(true);
    setResults([]); // Clear previous run
    switchToResults();

    const words = wordlist.split('\n').map(w => w.trim()).filter(w => w);

    // Sort markers by start index descending so replacements don't shift earlier indices
    const sortedMarkers = [...markers].sort((a, b) => b.start - a.start);

    for (const word of words) {
        if (!isRunning) break; // Check for cancel (though hook state updates might be delayed in loop)

        // Clone request
        const request = { ...draftRequest };
        let bodyText = request.body?.text || '';
        let urlText = request.url || '';

        // Apply replacements
        for (const marker of sortedMarkers) {
            if (marker.field === 'body') {
                bodyText = bodyText.substring(0, marker.start) + word + bodyText.substring(marker.end);
            } else if (marker.field === 'url') {
                urlText = urlText.substring(0, marker.start) + word + urlText.substring(marker.end);
            }
        }

        request.body = { ...request.body, text: bodyText };
        request.url = urlText;

        try {
            const start = performance.now();
            const response = await sendEphemeralRequest(request, null);
            const elapsed = performance.now() - start;

            const result: FuzzerResult = {
                id: generateId(),
                word,
                status: response.status,
                elapsed,
                contentLength: response.contentLength || 0,
                error: response.error || undefined,
                timestamp: Date.now()
            };

            setResults(prev => [...prev, result]);
        } catch (e) {
            console.error("Fuzzer error", e);
             const result: FuzzerResult = {
                id: generateId(),
                word,
                status: 0,
                elapsed: 0,
                contentLength: 0,
                error: String(e),
                timestamp: Date.now()
            };
             setResults(prev => [...prev, result]);
        }
    }
    setIsRunning(false);
  };

  const bodyMarkers = useMemo(() =>
      markers.filter(m => m.field === 'body').map(m => ({
          id: m.id,
          start: m.start,
          end: m.end,
          originalText: m.originalText
      })),
  [markers]);

  const bodyExtensions = useMemo(() =>
     isLocked ? fuzzerMarkersExtension(bodyMarkers) : [],
  [isLocked, bodyMarkers]);

  return (
    <div className="h-full grid grid-cols-[1fr_300px] divide-x divide-border-subtle">
      {/* Left: Request Editor */}
      <div className="flex flex-col min-w-0 h-full">
        <div className="p-2 border-b border-border-subtle flex gap-2 items-center justify-between">
            <div className="flex gap-2">
                <Button size="sm" onClick={() => setShowCurlImport(true)} disabled={isLocked || isRunning}>
                Parse from cURL
                </Button>
                <div className="h-4 w-px bg-border-subtle mx-2" />
                <Button
                    size="sm"
                    disabled={!draftRequest || isRunning}
                    onClick={handleMarkSelection}
                    variant="border"
                >
                    Mark Selection (Body)
                </Button>
                {isLocked && (
                    <Button size="sm" color="danger" variant="border" onClick={handleClearMarkers} disabled={isRunning}>
                        Clear Markers & Unlock
                    </Button>
                )}
            </div>

             <Button
                size="sm"
                color="primary"
                disabled={!draftRequest || markers.length === 0 || !wordlist.trim() || isRunning}
                onClick={handleRunFuzzer}
             >
                 {isRunning ? 'Running...' : 'Run Fuzzer'}
             </Button>
        </div>

        {draftRequest ? (
          <div className="flex-1 flex flex-col min-h-0">
             {/* Using simple div wrapper to capture focus events for now */}
             <div onFocus={() => setFocusedField('url')} tabIndex={-1}>
                <UrlBar
                    url={draftRequest.url}
                    placeholder="https://example.com"
                    onUrlChange={(url) => !isLocked && updateDraft({ url })}
                    onSend={() => {}}
                    onCancel={() => {}}
                    isLoading={false}
                    forceUpdateKey={draftRequest.id}
                    stateKey={`fuzzer.url.${draftRequest.id}`}
                />
             </div>
              <div className="flex-1 min-h-0 relative" onFocus={() => setFocusedField('body')}>
                  <Editor
                    language="json"
                    defaultValue={draftRequest.body?.text ?? ''}
                    onChange={(text) => !isLocked && updateDraft({ body: { ...draftRequest.body, text } })}
                    readOnly={isLocked || isRunning}
                    heightMode="full"
                    stateKey={`fuzzer.body.${draftRequest.id}`}
                    setRef={setBodyEditorView}
                    extraExtensions={bodyExtensions}
                  />
              </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-subtle">
            Import a cURL command to start fuzzing
          </div>
        )}
      </div>

      {/* Right: Wordlist & Settings */}
      <div className="flex flex-col min-w-0 h-full bg-surface-subtle">
        <div className="p-2 font-semibold text-sm border-b border-border-subtle">Wordlist</div>
        <div className="flex-1 min-h-0 relative">
            <Editor
                language="text"
                defaultValue={wordlist}
                onChange={setWordlist}
                placeholder="Enter wordlist (one per line)"
                heightMode="full"
                stateKey="fuzzer.wordlist"
                readOnly={isRunning}
            />
        </div>
      </div>

      {/* Curl Import Dialog */}
      <Dialog
        open={showCurlImport}
        onClose={() => setShowCurlImport(false)}
        title="Import cURL"
      >
        <div className="flex flex-col gap-3 min-w-[500px]">
            <Editor
                language="bash"
                defaultValue={curlInput}
                onChange={setCurlInput}
                heightMode="auto"
                className="min-h-[200px] border border-border-subtle rounded"
                placeholder="curl -X POST https://api.example.com/..."
                stateKey="fuzzer.curl_import"
            />
            <HStack justifyContent="end" space={2}>
                <Button variant="border" onClick={() => setShowCurlImport(false)}>Cancel</Button>
                <Button color="primary" onClick={handleImportCurl} disabled={!curlInput.trim()}>Import</Button>
            </HStack>
        </div>
      </Dialog>
    </div>
  );
}

function FuzzerResultsPane() {
    const [results] = useAtom(fuzzerResultsAtom);

    const handleExport = () => {
        const csv = [
            'Word,Status,Size,Time,Error',
            ...results.map(r => `"${r.word}",${r.status},${r.contentLength},${r.elapsed},"${r.error || ''}"`)
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fuzzer-results-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="h-full flex flex-col">
             <div className="flex-none p-2 border-b border-border-subtle flex justify-end">
                 <Button size="sm" variant="border" disabled={results.length === 0} onClick={handleExport}>
                     Export Results
                 </Button>
             </div>
             <div className="flex-1 overflow-auto">
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableHeaderCell>Word</TableHeaderCell>
                            <TableHeaderCell>Status</TableHeaderCell>
                            <TableHeaderCell>Size</TableHeaderCell>
                            <TableHeaderCell>Time</TableHeaderCell>
                            <TableHeaderCell>Error</TableHeaderCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {results.map(r => (
                             <TableRow key={r.id}>
                                <TableCell>{r.word}</TableCell>
                                <TableCell>
                                    <StatusTag status={r.status} />
                                </TableCell>
                                <TableCell>{r.contentLength}</TableCell>
                                <TableCell>{r.elapsed.toFixed(0)}ms</TableCell>
                                <TableCell className="text-danger">{r.error}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                {results.length === 0 && (
                    <div className="p-4 text-center text-text-subtle">No results yet. Run the fuzzer to see results.</div>
                )}
            </div>
        </div>
    );
}
