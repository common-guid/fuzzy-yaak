import type { HttpRequest, HttpResponse } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { useAtom, useAtomValue } from 'jotai';
import { atom } from 'jotai';
import type { CSSProperties, KeyboardEvent } from 'react';
import { useState, useMemo, useRef, useEffect } from 'react';
import { activeWorkspaceAtom } from '../hooks/useActiveWorkspace';
import { invokeCmd } from '../lib/tauri';
import { getResponseBodyText } from '../lib/responseBody';
import { Button } from './core/Button';
import { Editor } from './core/Editor/LazyEditor';
import { Tabs, TabContent, type TabsRef } from './core/Tabs/Tabs';
import { HStack } from './core/Stacks';
import { Dialog } from './core/Dialog';
import { fuzzerMarkersExtension } from './fuzzer/FuzzerEditorExtensions';
import type { EditorView } from '@codemirror/view';
import { generateId } from '../lib/generateId';
import { sendEphemeralRequest } from '../lib/sendEphemeralRequest';
import { Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell } from './core/Table';
import { HttpStatusTagRaw } from './core/HttpStatusTag';
import { atomWithKVStorage } from '../lib/atoms/atomWithKVStorage';
import { runFuzzerRequests, type FuzzerMarker, type FuzzerResult } from './fuzzer/runFuzzer';

// Use atomWithKVStorage for persistence
export const fuzzerDraftRequestAtom = atomWithKVStorage<HttpRequest | null>('fuzzer_draft_request', null);
export const fuzzerMarkersAtom = atomWithKVStorage<FuzzerMarker[]>('fuzzer_markers', []);
export const fuzzerWordlistAtom = atomWithKVStorage<string>('fuzzer_wordlist', '');
export const fuzzerResultsAtom = atomWithKVStorage<FuzzerResult[]>('fuzzer_results', []);
export const fuzzerIsLockedAtom = atomWithKVStorage<boolean>('fuzzer_is_locked', false);
export const fuzzerIsRunningAtom = atom<boolean>(false);

// Helper to store raw headers string in atom to survive reloads,
// since we parse/unparse from HttpRequest which might lose exact formatting
export const fuzzerRawHeadersAtom = atomWithKVStorage<string>('fuzzer_raw_headers', '');


interface Props {
  style?: CSSProperties;
  className?: string;
}

function FuzzerResultDetailPanel({ title, content }: { title: string; content: string }) {
  return (
    <div className="min-h-0 flex flex-col">
      <div className="flex-none px-3 py-2 text-xs font-medium text-text-subtle border-b border-border-subtle">
        {title}
      </div>
      <div className="min-h-0 overflow-auto p-3">
        <pre className="text-xs whitespace-pre-wrap break-words font-mono text-text leading-relaxed">
          {content}
        </pre>
      </div>
    </div>
  );
}

function formatRequestSnapshot(request: HttpRequest | undefined): string {
  if (request == null) {
    return 'Request snapshot unavailable for this result.';
  }

  const requestLine = `${request.method} ${request.url} HTTP/1.1`;
  const headerLines = request.headers
    .filter((header) => header.enabled !== false)
    .map((header) => `${header.name}: ${header.value}`);
  const body = request.body?.text ?? '';
  return `${[requestLine, ...headerLines].join('\n')}${body ? `\n\n${body}` : ''}`;
}

function formatResponseSnapshot({
  result,
  responseBody,
  responseBodyError,
  isResponseBodyLoading,
}: {
  result: FuzzerResult;
  responseBody: string | undefined;
  responseBodyError: string | undefined;
  isResponseBodyLoading: boolean;
}): string {
  if (result.response == null) {
    return result.error ? `Error: ${result.error}` : 'Response snapshot unavailable for this result.';
  }

  const response: HttpResponse = result.response;
  const version = response.version ?? 'HTTP/1.1';
  const statusReason = response.statusReason ?? '';
  const statusLine = `${version} ${response.status}${statusReason ? ` ${statusReason}` : ''}`;
  const headerLines = response.headers.map((header) => `${header.name}: ${header.value}`);

  let bodySection = '';
  if (isResponseBodyLoading) {
    bodySection = '\n\nLoading response body...';
  } else if (responseBodyError) {
    bodySection = `\n\nFailed to load response body: ${responseBodyError}`;
  } else if (responseBody != null) {
    bodySection = `\n\n${responseBody}`;
  } else if (result.error) {
    bodySection = `\n\nError: ${result.error}`;
  }

  return `${[statusLine, ...headerLines].join('\n')}${bodySection}`;
}

export function FuzzerLayout({ style, className }: Props) {
  const tabsRef = useRef<TabsRef>(null);

  // We don't need activeTab state unless we render differently based on it,
  // but Tabs handles content switching.
  const switchToResults = () => {
      tabsRef.current?.setActiveTab('results');
  };

  return (
    <div style={style} className={classNames(className, 'h-full flex flex-col bg-surface')}>
      <Tabs
        ref={tabsRef}
        defaultValue="request"
        label="Fuzzer Tabs"
        tabs={[
          { value: 'request', label: 'Request' },
          { value: 'results', label: 'Results' },
        ]}
        className="h-full grid grid-rows-[auto_1fr]"
        tabListClassName="px-2 border-b border-border-subtle"
      >
        <TabContent value="request">
          <FuzzerRequestPane switchToResults={switchToResults} />
        </TabContent>
        <TabContent value="results">
          <FuzzerResultsPane />
        </TabContent>
      </Tabs>
    </div>
  );
}

function FuzzerRequestPane({ switchToResults }: { switchToResults: () => void }) {
  const activeWorkspace = useAtomValue(activeWorkspaceAtom);
  const [draftRequest, setDraftRequest] = useAtom(fuzzerDraftRequestAtom);
  const [markers, setMarkers] = useAtom(fuzzerMarkersAtom);
  const [wordlist, setWordlist] = useAtom(fuzzerWordlistAtom);
  const [isLocked, setIsLocked] = useAtom(fuzzerIsLockedAtom);
  const [isRunning, setIsRunning] = useAtom(fuzzerIsRunningAtom);
  const [, setResults] = useAtom(fuzzerResultsAtom); // results unused here
  const [rawHeaders, setRawHeaders] = useAtom(fuzzerRawHeadersAtom);

  const [showCurlImport, setShowCurlImport] = useState(false);
  const [curlInput, setCurlInput] = useState('');

  const [urlEditorView, setUrlEditorView] = useState<EditorView | null>(null);
  const [headersEditorView, setHeadersEditorView] = useState<EditorView | null>(null);
  const [bodyEditorView, setBodyEditorView] = useState<EditorView | null>(null);

  // Track focused field to know where to apply marker
  const [focusedField, setFocusedField] = useState<'url' | 'body' | 'headers' | null>(null);

  const handleImportCurl = async () => {
    if (activeWorkspace?.id == null) {
      console.error('Cannot import curl for fuzzer: no active workspace');
      return;
    }
    try {
      const request: HttpRequest = await invokeCmd('cmd_curl_to_request', {
        command: curlInput,
        workspaceId: activeWorkspace.id,
      });
      setDraftRequest({ ...request, workspaceId: activeWorkspace.id });

      // Initialize raw headers from imported request
      const headersText = request.headers.map(h => `${h.name}: ${h.value}`).join('\n');
      setRawHeaders(headersText);

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
      let view: EditorView | null = null;
      let field: FuzzerMarker['field'] | null = null;

      if (focusedField === 'url') {
          view = urlEditorView;
          field = 'url';
      } else if (focusedField === 'headers') {
          view = headersEditorView;
          field = 'headers';
      } else if (focusedField === 'body') {
          view = bodyEditorView;
          field = 'body';
      }

      if (view && field) {
          const selection = view.state.selection.main;
          if (selection.empty) return;

          const marker: FuzzerMarker = {
              id: generateId(),
              field,
              start: selection.from,
              end: selection.to,
              originalText: view.state.doc.sliceString(selection.from, selection.to),
          };
          setMarkers([...markers, marker]);
          setIsLocked(true);
      }
  };

  const handleClearMarkers = () => {
      setMarkers([]);
      setIsLocked(false);
  };

  const handleRunFuzzer = async () => {
    if (!draftRequest || markers.length === 0 || !wordlist.trim() || activeWorkspace?.id == null) {
      return;
    }

    setIsRunning(true);
    setResults([]); // Clear previous run
    switchToResults();

    const words = wordlist.split('\n').map(w => w.trim()).filter(w => w);
    try {
      await runFuzzerRequests({
        draftRequest,
        markers,
        rawHeaders,
        words,
        sendRequest: (request) => sendEphemeralRequest(request, null),
        addResult: (result) => setResults((prev) => [...prev, result]),
        workspaceId: activeWorkspace.id,
        generateId,
        now: () => Date.now(),
        nowPerf: () => performance.now(),
      });
    } finally {
      setIsRunning(false);
    }
  };

  const getExtensionsForField = (field: FuzzerMarker['field']) => {
      const fieldMarkers = markers.filter(m => m.field === field).map(m => ({
          id: m.id,
          start: m.start,
          end: m.end,
          originalText: m.originalText
      }));
      return isLocked ? fuzzerMarkersExtension(fieldMarkers) : [];
  };

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
                    Mark Selection ({focusedField ? focusedField.toUpperCase() : 'None'})
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
                disabled={
                  !draftRequest ||
                  markers.length === 0 ||
                  !wordlist.trim() ||
                  isRunning ||
                  activeWorkspace?.id == null
                }
                onClick={handleRunFuzzer}
             >
                 {isRunning ? 'Running...' : 'Run Fuzzer'}
             </Button>
        </div>

        {draftRequest ? (
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
             {/* URL Editor */}
             {/* biome-ignore lint/a11y/noStaticElementInteractions: Used for focus tracking */}
             <div className="p-2 border-b border-border-subtle" onFocus={() => setFocusedField('url')}>
                <div className="text-xs text-text-subtle mb-1">URL</div>
                <div className="border border-border-subtle rounded overflow-hidden">
                    <Editor
                        language="url"
                        singleLine
                        defaultValue={draftRequest.url}
                        onChange={(url) => !isLocked && updateDraft({ url })}
                        readOnly={isLocked || isRunning}
                        heightMode="auto"
                        stateKey={`fuzzer.url.${draftRequest.id}`}
                        setRef={setUrlEditorView}
                        extraExtensions={getExtensionsForField('url')}
                    />
                </div>
             </div>

             {/* Headers Editor */}
             {/* biome-ignore lint/a11y/noStaticElementInteractions: Used for focus tracking */}
             <div className="flex-1 min-h-[150px] flex flex-col border-b border-border-subtle" onFocus={() => setFocusedField('headers')}>
                <div className="px-2 py-1 text-xs text-text-subtle bg-surface-subtle border-b border-border-subtle">Headers (Raw)</div>
                <div className="flex-1 relative">
                    <Editor
                        language={null} // Force plain text
                        defaultValue={rawHeaders}
                        onChange={(text) => !isLocked && setRawHeaders(text)}
                        readOnly={isLocked || isRunning}
                        heightMode="full"
                        stateKey={`fuzzer.headers.${draftRequest.id}`}
                        setRef={setHeadersEditorView}
                        extraExtensions={getExtensionsForField('headers')}
                    />
                </div>
             </div>

             {/* Body Editor */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: Used for focus tracking */}
              <div className="flex-1 min-h-[200px] flex flex-col" onFocus={() => setFocusedField('body')}>
                  <div className="px-2 py-1 text-xs text-text-subtle bg-surface-subtle border-b border-border-subtle">Body</div>
                  <div className="flex-1 relative">
                    <Editor
                        language="json"
                        defaultValue={draftRequest.body?.text ?? ''}
                        onChange={(text) => !isLocked && updateDraft({ body: { ...draftRequest.body, text } })}
                        readOnly={isLocked || isRunning}
                        heightMode="full"
                        stateKey={`fuzzer.body.${draftRequest.id}`}
                        setRef={setBodyEditorView}
                        extraExtensions={getExtensionsForField('body')}
                    />
                  </div>
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
                language={null} // Plain text for curl paste
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
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [isDetailsPaneOpen, setIsDetailsPaneOpen] = useState(true);
  const [responseBodies, setResponseBodies] = useState<Record<string, string>>({});
  const [responseBodyErrors, setResponseBodyErrors] = useState<Record<string, string>>({});
  const [loadingResponseBodyId, setLoadingResponseBodyId] = useState<string | null>(null);

  const selectedResult = useMemo(
    () => results.find((result) => result.id === selectedResultId) ?? null,
    [results, selectedResultId],
  );

  useEffect(() => {
    if (results.length === 0) {
      setSelectedResultId(null);
      setResponseBodies({});
      setResponseBodyErrors({});
      setLoadingResponseBodyId(null);
      return;
    }

    if (selectedResultId == null || !results.some((result) => result.id === selectedResultId)) {
      setSelectedResultId(results[0]?.id ?? null);
      setIsDetailsPaneOpen(true);
    }
  }, [results, selectedResultId]);

  useEffect(() => {
    if (!isDetailsPaneOpen || selectedResult?.id == null || selectedResult.response == null) {
      return;
    }
    if (selectedResult.response.bodyPath == null) {
      return;
    }
    if (responseBodies[selectedResult.id] != null || responseBodyErrors[selectedResult.id] != null) {
      return;
    }

    let cancelled = false;
    setLoadingResponseBodyId(selectedResult.id);

    getResponseBodyText({ response: selectedResult.response, filter: null })
      .then((content) => {
        if (cancelled) return;
        setResponseBodies((prev) => ({ ...prev, [selectedResult.id]: content ?? '' }));
      })
      .catch((error) => {
        if (cancelled) return;
        setResponseBodyErrors((prev) => ({ ...prev, [selectedResult.id]: String(error) }));
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingResponseBodyId((prev) => (prev === selectedResult.id ? null : prev));
      });

    return () => {
      cancelled = true;
    };
  }, [isDetailsPaneOpen, selectedResult, responseBodies, responseBodyErrors]);

  const handleSelectResult = (resultId: string) => {
    setSelectedResultId(resultId);
    setIsDetailsPaneOpen(true);
  };

  const handleResultsTableKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (results.length === 0) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    event.preventDefault();
    const selectedIndex = selectedResultId
      ? results.findIndex((result) => result.id === selectedResultId)
      : -1;
    const currentIndex = selectedIndex < 0 ? 0 : selectedIndex;
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(results.length - 1, currentIndex + delta));
    const nextResult = results[nextIndex];
    if (nextResult?.id == null) return;
    handleSelectResult(nextResult.id);
  };

  const handleExport = () => {
    const csv = [
      'Word,Status,Size,Time,Error',
      ...results.map(
        (result) =>
          `\"${result.word}\",${result.status},${result.contentLength},${result.elapsed},\"${
            result.error || ''
          }\"`,
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fuzzer-results-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const responseBody = selectedResult ? responseBodies[selectedResult.id] : undefined;
  const responseBodyError = selectedResult ? responseBodyErrors[selectedResult.id] : undefined;
  const isResponseBodyLoading =
    selectedResult != null && loadingResponseBodyId === selectedResult.id;

  return (
    <div className="h-full flex flex-col">
      <div className="flex-none p-2 border-b border-border-subtle flex items-center justify-between">
        <div className="text-xs text-text-subtle">Use ↑ and ↓ to browse result rows</div>
        <HStack space={2}>
          {selectedResult != null && !isDetailsPaneOpen && (
            <Button size="sm" variant="border" onClick={() => setIsDetailsPaneOpen(true)}>
              Show Details
            </Button>
          )}
          <Button size="sm" variant="border" disabled={results.length === 0} onClick={handleExport}>
            Export Results
          </Button>
        </HStack>
      </div>
      <div
        className={classNames(
          'flex-1 min-h-0 grid',
          isDetailsPaneOpen && selectedResult != null
            ? 'grid-rows-[minmax(0,1fr)_minmax(220px,45%)]'
            : 'grid-rows-[minmax(0,1fr)]',
        )}
      >
        <div
          className="min-h-0 overflow-auto outline-none"
          tabIndex={0}
          role="grid"
          aria-label="Fuzzer Results"
          onKeyDown={handleResultsTableKeyDown}
        >
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
              {results.map((result) => {
                const isSelected = selectedResultId === result.id;
                return (
                  <tr
                    key={result.id}
                    className={classNames(
                      'cursor-pointer hocus:bg-surface-highlight/30',
                      isSelected && 'bg-surface-highlight/50',
                    )}
                    onClick={() => handleSelectResult(result.id)}
                    aria-selected={isSelected}
                  >
                    <TableCell>{result.word}</TableCell>
                    <TableCell>
                      <HttpStatusTagRaw status={result.status} />
                    </TableCell>
                    <TableCell>{result.contentLength}</TableCell>
                    <TableCell>{result.elapsed.toFixed(0)}ms</TableCell>
                    <TableCell className="text-danger">{result.error}</TableCell>
                  </tr>
                );
              })}
            </TableBody>
          </Table>
          {results.length === 0 && (
            <div className="p-4 text-center text-text-subtle">
              No results yet. Run the fuzzer to see results.
            </div>
          )}
        </div>
        {isDetailsPaneOpen && selectedResult != null && (
          <div className="min-h-0 border-t border-border-subtle bg-surface-subtle flex flex-col">
            <div className="flex-none p-2 border-b border-border-subtle flex items-center justify-between">
              <div className="text-xs text-text-subtle truncate">
                Selected: <span className="text-text font-medium">{selectedResult.word}</span>
              </div>
              <Button size="2xs" variant="border" onClick={() => setIsDetailsPaneOpen(false)}>
                Close
              </Button>
            </div>
            <div className="flex-1 min-h-0 grid grid-cols-2 divide-x divide-border-subtle">
              <FuzzerResultDetailPanel
                title="Request"
                content={formatRequestSnapshot(selectedResult.request)}
              />
              <FuzzerResultDetailPanel
                title="Response"
                content={formatResponseSnapshot({
                  result: selectedResult,
                  responseBody,
                  responseBodyError,
                  isResponseBodyLoading,
                })}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
