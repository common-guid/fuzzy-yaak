import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import type { HttpRequest, HttpResponse } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { useAtom, useAtomValue } from 'jotai';
import { atom } from 'jotai';
import type { CSSProperties, KeyboardEvent } from 'react';
import { useState, useMemo, useRef, useEffect } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { activeWorkspaceAtom } from '../../hooks/useActiveWorkspace';
import { invokeCmd } from '../../lib/tauri';
import { getResponseBodyText } from '../../lib/responseBody';
import { createRequestAndNavigate } from '../../lib/createRequestAndNavigate';
import { Button } from '../core/Button';
import { Editor } from '../core/Editor/LazyEditor';
import { Tabs, TabContent, type TabsRef } from '../core/Tabs/Tabs';
import { HStack } from '../core/Stacks';
import { Dialog } from '../core/Dialog';
import { Icon } from '../core/Icon';
import { fuzzerMarkersExtension } from './FuzzerEditorExtensions';
import type { EditorView } from '@codemirror/view';
import { generateId } from '../../lib/generateId';
import { sendEphemeralRequest } from '../../lib/sendEphemeralRequest';
import { Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell } from '../core/Table';
import { HttpStatusTagRaw } from '../core/HttpStatusTag';
import { atomWithKVStorage } from '../../lib/atoms/atomWithKVStorage';
import { runFuzzerRequests, type FuzzerMarker, type FuzzerResult } from './runFuzzer';
import { patchModel } from '@yaakapp-internal/models';
import { PlainInput } from '../core/PlainInput';
import { Select } from '../core/Select';

export type FuzzerEncoder = 'none' | 'url' | 'base64' | 'utf8' | 'html';

export interface FuzzerSettings {
  requestsPerSecond: number | null;
  encoder: FuzzerEncoder;
}

const defaultSettings: FuzzerSettings = {
  requestsPerSecond: null,
  encoder: 'none',
};

export interface FuzzerRun {
  id: string;
  requestSnapshot: HttpRequest;
  markers: FuzzerMarker[];
  wordlist: string;
  settings: FuzzerSettings;
  results: FuzzerResult[];
  createdAt: number;
}

export interface FuzzerSessionState {
  markers: FuzzerMarker[];
  wordlist: string;
  isLocked: boolean;
  runs: FuzzerRun[];
  settings: FuzzerSettings;
}

const defaultSessionState: FuzzerSessionState = {
  markers: [],
  wordlist: '',
  isLocked: false,
  runs: [],
  settings: defaultSettings,
};

const sessionAtoms = new Map<string, ReturnType<typeof atomWithKVStorage<FuzzerSessionState>>>();

export function getFuzzerSessionAtom(requestId: string) {
  let a = sessionAtoms.get(requestId);
  if (!a) {
    a = atomWithKVStorage<FuzzerSessionState>(['fuzzer_session', requestId], defaultSessionState);
    sessionAtoms.set(requestId, a);
  }
  return a;
}

export const fuzzerIsRunningAtom = atom<Record<string, boolean>>({});


interface Props {
  style?: CSSProperties;
  className?: string;
}
const syntaxTheme = {
  'pre[class*="language-"]': {},
  comment: { color: 'var(--textSubtle)' },
  punctuation: { color: 'var(--textSubtle)' },
  property: { color: 'var(--primary)' },
  'attr-name': { color: 'var(--primary)' },
  string: { color: 'var(--notice)' },
  number: { color: 'var(--info)' },
  boolean: { color: 'var(--warning)' },
  operator: { color: 'var(--danger)' },
  keyword: { color: 'var(--danger)' },
} as const;

function normalizeJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

function DetailCodeBlock({ language, content }: { language: string; content: string }) {
  return (
    <SyntaxHighlighter
      language={language}
      style={syntaxTheme}
      customStyle={{
        margin: 0,
        background: 'transparent',
        padding: 0,
        fontSize: '0.75rem',
        lineHeight: '1.4',
      }}
      wrapLongLines
    >
      {content}
    </SyntaxHighlighter>
  );
}

function FuzzerRequestDetailPanel({ request }: { request: HttpRequest | undefined }) {
  if (request == null) {
    return (
      <div className="min-h-0 flex flex-col">
        <div className="flex-none px-3 py-2 text-xs font-medium text-text-subtle border-b border-border-subtle">
          Request
        </div>
        <div className="min-h-0 overflow-auto p-3 text-xs text-text-subtle">
          Request snapshot unavailable for this result.
        </div>
      </div>
    );
  }

  const requestLine = `${request.method} ${request.url} HTTP/1.1`;
  const headersText = request.headers
    .filter((header) => header.enabled !== false)
    .map((header) => `${header.name}: ${header.value}`);
  const bodyText = request.body?.text ?? '';
  const normalizedBody = normalizeJson(bodyText);
  const bodyLanguage = normalizedBody != null ? 'json' : 'http';
  const bodyContent = normalizedBody ?? (bodyText.trim() === '' ? '(empty body)' : bodyText);

  return (
    <div className="min-h-0 flex flex-col">
      <div className="flex-none px-3 py-2 text-xs font-medium text-text-subtle border-b border-border-subtle">
        Request
      </div>
      <div className="min-h-0 overflow-auto">
        <div className="px-3 py-2 border-b border-border-subtle">
          <div className="text-[10px] uppercase tracking-wide text-text-subtle mb-1">Start Line</div>
          <DetailCodeBlock language="http" content={requestLine} />
        </div>
        <div className="px-3 py-2 border-b border-border-subtle">
          <div className="text-[10px] uppercase tracking-wide text-text-subtle mb-1">Headers</div>
          <DetailCodeBlock
            language="http"
            content={headersText.length ? headersText.join('\n') : '(no headers)'}
          />
        </div>
        <div className="px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-text-subtle mb-1">Body</div>
          <DetailCodeBlock language={bodyLanguage} content={bodyContent} />
        </div>
      </div>
    </div>
  );
}

function FuzzerResponseDetailPanel({
  result,
  responseBody,
  responseBodyError,
  isResponseBodyLoading,
}: {
  result: FuzzerResult;
  responseBody: string | undefined;
  responseBodyError: string | undefined;
  isResponseBodyLoading: boolean;
}) {
  if (result.response == null) {
    return (
      <div className="min-h-0 flex flex-col">
        <div className="flex-none px-3 py-2 text-xs font-medium text-text-subtle border-b border-border-subtle">
          Response
        </div>
        <div className="min-h-0 overflow-auto p-3 text-xs text-danger">
          {result.error ? `Error: ${result.error}` : 'Response snapshot unavailable for this result.'}
        </div>
      </div>
    );
  }

  const response: HttpResponse = result.response;
  const version = response.version ?? 'HTTP/1.1';
  const statusReason = response.statusReason ?? '';
  const statusLine = `${version} ${response.status}${statusReason ? ` ${statusReason}` : ''}`;
  const headersText = response.headers.map((header) => `${header.name}: ${header.value}`).join('\n');

  let bodyText = '';
  let bodyLanguage = 'http';
  if (isResponseBodyLoading) {
    bodyText = 'Loading response body...';
  } else if (responseBodyError) {
    bodyText = `Failed to load response body: ${responseBodyError}`;
  } else if (responseBody != null) {
    const normalized = normalizeJson(responseBody);
    bodyLanguage = normalized != null ? 'json' : 'http';
    bodyText = normalized ?? responseBody;
  } else if (result.error) {
    bodyText = `Error: ${result.error}`;
  } else {
    bodyText = '(empty body)';
  }

  return (
    <div className="min-h-0 flex flex-col">
      <div className="flex-none px-3 py-2 text-xs font-medium text-text-subtle border-b border-border-subtle">
        Response
      </div>
      <div className="min-h-0 overflow-auto">
        <div className="px-3 py-2 border-b border-border-subtle">
          <div className="text-[10px] uppercase tracking-wide text-text-subtle mb-1">Status</div>
          <DetailCodeBlock language="http" content={statusLine} />
        </div>
        <div className="px-3 py-2 border-b border-border-subtle">
          <div className="text-[10px] uppercase tracking-wide text-text-subtle mb-1">Headers</div>
          <DetailCodeBlock language="http" content={headersText || '(no headers)'} />
        </div>
        <div className="px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-text-subtle mb-1">Body</div>
          <DetailCodeBlock language={bodyLanguage} content={bodyText} />
        </div>
      </div>
    </div>
  );
}

const ENCODER_OPTIONS: { value: FuzzerEncoder; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'url', label: 'URL' },
  { value: 'base64', label: 'Base64' },
  { value: 'utf8', label: 'UTF-8' },
  { value: 'html', label: 'HTML' },
];

function FuzzerSettingsSection({
  settings,
  onChange,
  disabled,
}: {
  settings: FuzzerSettings;
  onChange: (patch: Partial<FuzzerSettings>) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex-none border-t border-border-subtle">
      <div className="px-3 py-2 font-semibold text-sm border-b border-border-subtle">Settings</div>
      <div className="p-3 flex flex-col gap-3">
        <PlainInput
          label="Max req/s"
          labelPosition="top"
          type="number"
          size="sm"
          placeholder="Unlimited"
          defaultValue={settings.requestsPerSecond != null ? String(settings.requestsPerSecond) : ''}
          onChange={(v) => {
            const parsed = v.trim() === '' ? null : Number(v);
            onChange({ requestsPerSecond: parsed != null && !Number.isNaN(parsed) && parsed > 0 ? parsed : null });
          }}
          disabled={disabled}
        />
        <Select
          name="fuzzer-encoder"
          label="Encoder"
          size="sm"
          value={settings.encoder}
          options={ENCODER_OPTIONS}
          onChange={(v) => onChange({ encoder: v })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

interface FuzzerTabProps {
  activeRequest: HttpRequest;
  className?: string;
  style?: CSSProperties;
}

export function FuzzerTab({ activeRequest, className, style }: FuzzerTabProps) {
  const tabsRef = useRef<TabsRef>(null);

  const switchToResults = () => {
      tabsRef.current?.setActiveTab('results');
  };

  return (
    <div style={style} className={classNames(className, 'h-full flex flex-col')}>
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
          <FuzzerRequestPane activeRequest={activeRequest} switchToResults={switchToResults} />
        </TabContent>
        <TabContent value="results">
          <FuzzerResultsPane activeRequest={activeRequest} />
        </TabContent>
      </Tabs>
    </div>
  );
}

function FuzzerRequestPane({ activeRequest, switchToResults }: { activeRequest: HttpRequest, switchToResults: () => void }) {
  const activeWorkspace = useAtomValue(activeWorkspaceAtom);
  const activeRequestId = activeRequest.id;
  const sessionAtom = useMemo(() => getFuzzerSessionAtom(activeRequestId), [activeRequestId]);
  const [session, setSession] = useAtom(sessionAtom);

  const markers = session?.markers ?? [];
  const wordlist = session?.wordlist ?? '';
  const isLocked = session?.isLocked ?? false;
  const rawHeaders = activeRequest.headers.map((h) => `${h.name}: ${h.value}`).join('\n');

  const [runningStates, setRunningStates] = useAtom(fuzzerIsRunningAtom);
  const isRunning = !!runningStates[activeRequestId];

  const updateSession = (patch: Partial<FuzzerSessionState>) => {
    setSession((prev) => ({
      ...defaultSessionState,
      ...prev,
      ...patch,
    }));
  };

  const handleUpdateActiveRequest = async (patch: Partial<HttpRequest>) => {
    if (activeRequest) {
        await patchModel(activeRequest, patch);
    }
  };

  const handleHeadersChange = (text: string) => {
    if (isLocked) return;
    const lines = text.split('\n');
    const oldHeaders = activeRequest.headers;
    const newHeaders = lines.map((line, index) => {
        const colonIndex = line.indexOf(':');
        let name = line.trim();
        let value = '';
        if (colonIndex > 0) {
            name = line.slice(0, colonIndex).trim();
            value = line.slice(colonIndex + 1).trim();
        }

        const oldHeader = oldHeaders[index];
        if (oldHeader && oldHeader.name === name) {
            return { ...oldHeader, value };
        }

        const existingHeader = oldHeaders.find(h => h.name === name);
        if (existingHeader) {
            return { ...existingHeader, value };
        }

        return {
            id: generateId(),
            name,
            value,
            enabled: true
        };
    }).filter(h => h.name || h.value);

    handleUpdateActiveRequest({ headers: newHeaders });
  };

  const [urlEditorView, setUrlEditorView] = useState<EditorView | null>(null);
  const [headersEditorView, setHeadersEditorView] = useState<EditorView | null>(null);
  const [bodyEditorView, setBodyEditorView] = useState<EditorView | null>(null);

  // Track focused field to know where to apply marker
  const [focusedField, setFocusedField] = useState<'url' | 'body' | 'headers' | null>(null);

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
          updateSession({ markers: [...markers, marker], isLocked: true });
      }
  };

  const handleClearMarkers = () => {
      updateSession({ markers: [], isLocked: false });
  };

  const handleRunFuzzer = async () => {
    if (markers.length === 0 || !wordlist.trim() || activeWorkspace?.id == null) {
      return;
    }

    const settings = session.settings ?? defaultSettings;

    setRunningStates((prev) => ({ ...prev, [activeRequestId]: true }));

    const runId = generateId();
    const newRun: FuzzerRun = {
      id: runId,
      requestSnapshot: activeRequest,
      markers,
      wordlist,
      settings,
      results: [],
      createdAt: Date.now(),
    };

    updateSession({ runs: [newRun, ...session.runs] });

    switchToResults();

    const words = wordlist.split('\n').map(w => w.trim()).filter(w => w);
    try {
      await runFuzzerRequests({
        draftRequest: activeRequest,
        markers,
        rawHeaders,
        words,
        sendRequest: (request) => sendEphemeralRequest(request, null),
        addResult: (result) => setSession((prev) => ({
            ...prev,
            runs: prev.runs.map((r) => r.id === runId ? { ...r, results: [...r.results, result] } : r)
        })),
        workspaceId: activeWorkspace.id,
        generateId,
        now: () => Date.now(),
        nowPerf: () => performance.now(),
        settings,
      });
    } finally {
      setRunningStates((prev) => ({ ...prev, [activeRequestId]: false }));
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
                <Button
                    size="sm"
                    disabled={isRunning}
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

        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
             {/* URL Editor */}
             {/* biome-ignore lint/a11y/noStaticElementInteractions: Used for focus tracking */}
             <div className="p-2 border-b border-border-subtle" onFocus={() => setFocusedField('url')}>
                <div className="text-xs text-text-subtle mb-1">URL</div>
                <div className="border border-border-subtle rounded overflow-hidden">
                    <Editor
                        forceUpdateKey={`fuzzer_url_${activeRequest.id}`}
                        language="url"
                        singleLine
                        defaultValue={activeRequest.url}
                        onChange={(url) => handleUpdateActiveRequest({ url })}
                        readOnly={isLocked || isRunning}
                        heightMode="auto"
                        stateKey={`fuzzer.url.${activeRequest.id}`}
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
                        forceUpdateKey={`fuzzer_headers_${activeRequest.id}`}
                        language={null} // Force plain text
                        defaultValue={rawHeaders}
                        onChange={handleHeadersChange}
                        readOnly={isLocked || isRunning}
                        heightMode="full"
                        stateKey={`fuzzer.headers.${activeRequest.id}`}
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
                        forceUpdateKey={`fuzzer_body_${activeRequest.id}`}
                        language="json"
                        defaultValue={activeRequest.body?.text ?? ''}
                        onChange={(text) => handleUpdateActiveRequest({ body: { ...activeRequest.body, text } })}
                        readOnly={isLocked || isRunning}
                        heightMode="full"
                        stateKey={`fuzzer.body.${activeRequest.id}`}
                        setRef={setBodyEditorView}
                        extraExtensions={getExtensionsForField('body')}
                    />
                  </div>
              </div>
          </div>
      </div>

      {/* Right: Wordlist & Settings */}
      <div className="flex flex-col min-w-0 h-full bg-surface-subtle">
        <HStack className="p-2 justify-between border-b border-border-subtle">
          <div className="font-semibold text-sm">Wordlist</div>
          <Button
            size="2xs"
            variant="border"
            onClick={async () => {
              const filePath = await open({
                title: 'Import Wordlist',
                multiple: false,
                filters: [{ name: 'Text Files', extensions: ['txt', 'csv'] }],
              });
              if (typeof filePath === 'string') {
                const text = await readTextFile(filePath);
                updateSession({ wordlist: text });
              }
            }}
          >
            <Icon icon="import" size="xs" className="mr-1" />
            Import
          </Button>
        </HStack>
        <div className="flex-1 min-h-[150px] min-h-0 relative">
            <Editor
                language="text"
                defaultValue={wordlist}
                onChange={(text) => updateSession({ wordlist: text })}
                placeholder="Enter wordlist (one per line)"
                heightMode="full"
                stateKey={`fuzzer.wordlist.${activeRequestId || 'global'}`}
                readOnly={isRunning}
            />
        </div>
        <FuzzerSettingsSection
          settings={session.settings ?? defaultSettings}
          onChange={(patch) => updateSession({ settings: { ...(session.settings ?? defaultSettings), ...patch } })}
          disabled={isRunning}
        />
      </div>
    </div>
  );
}

function FuzzerResultsPane({ activeRequest }: { activeRequest: HttpRequest }) {
  const activeRequestId = activeRequest.id;
  const sessionAtom = useMemo(() => getFuzzerSessionAtom(activeRequestId), [activeRequestId]);
  const [session] = useAtom(sessionAtom);
  const runs = session?.runs ?? [];

  const [selectedRunId, setSelectedRunId] = useState<string | null>(runs[0]?.id ?? null);

  const latestRunId = runs[0]?.id;

  // Auto-select the latest run when a new run is prepended
  useEffect(() => {
    if (latestRunId) {
      setSelectedRunId(latestRunId);
    }
  }, [latestRunId]);

  const selectedRun = useMemo(() => runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? null, [runs, selectedRunId]);
  const results = selectedRun?.results ?? [];

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
      'ID,Word,Status,Size,Time,Error',
      ...results.map(
        (result, index) =>
          `${index + 1},"${result.word}",${result.status},${result.contentLength},${result.elapsed},"${
            result.error || ''
          }"`,
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
        <HStack space={2}>
          <select
            className="bg-surface text-text text-sm border border-border-subtle rounded px-2 py-1 outline-none focus:border-border-focus transition-colors"
            value={selectedRun?.id ?? ''}
            onChange={(e) => setSelectedRunId(e.target.value)}
            disabled={runs.length === 0}
          >
            {runs.length === 0 ? (
              <option value="">No runs yet</option>
            ) : (
              runs.map((run, i) => (
                <option key={run.id} value={run.id}>
                  Run {runs.length - i} ({new Date(run.createdAt).toLocaleTimeString()}) - {run.results.length} results
                </option>
              ))
            )}
          </select>
          <div className="text-xs text-text-subtle ml-2">Use ↑ and ↓ to browse result rows</div>
        </HStack>
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
        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: intentionally making this div focusable to capture arrow keys for table navigation */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: intentionally making this div focusable to capture arrow keys for table navigation */}
        <div
          className="min-h-0 overflow-auto outline-none"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: intentionally making this div focusable to capture arrow keys for table navigation
          tabIndex={0}
          aria-label="Fuzzer Results"
          onKeyDown={handleResultsTableKeyDown}
        >
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>#</TableHeaderCell>
                <TableHeaderCell>Word</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Size</TableHeaderCell>
                <TableHeaderCell>Time</TableHeaderCell>
                <TableHeaderCell>Error</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {results.map((result, index) => {
                const isSelected = selectedResultId === result.id;
                return (
                  <tr
                    key={result.id}
                    className={classNames(
                      'cursor-pointer hocus:[&>td]:bg-surface-highlight/30',
                      isSelected && '[&>td]:bg-primary/10 [&>td]:border-y [&>td]:border-border-focus',
                    )}
                    onClick={() => handleSelectResult(result.id)}
                    aria-selected={isSelected}
                  >
                    <TableCell className={classNames('text-text-subtle', isSelected && 'font-semibold')}>
                      {index + 1}
                    </TableCell>
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
              <FuzzerRequestDetailPanel request={selectedResult.request} />
              <FuzzerResponseDetailPanel
                result={selectedResult}
                responseBody={responseBody}
                responseBodyError={responseBodyError}
                isResponseBodyLoading={isResponseBodyLoading}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
