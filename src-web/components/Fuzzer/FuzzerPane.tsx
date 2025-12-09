import type { HttpRequest } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../core/Button';
import { Editor } from '../core/Editor/LazyEditor';
import { Input } from '../core/Input';
import { PlainInput } from '../core/PlainInput';
import { VStack, HStack } from '../core/Stacks';
import { Tabs, TabContent } from '../core/Tabs/Tabs';
import { useActiveEnvironment } from '../../hooks/useActiveEnvironment';
import { Icon } from '../core/Icon';
import { CountBadge } from '../core/CountBadge';

interface Props {
  className?: string;
  activeRequest: HttpRequest;
}

interface FuzzResult {
  request_id: string;
  payload: string;
  status: number;
  time_ms: number;
  size_bytes: number;
  error?: string;
}

export function FuzzerPane({ className, activeRequest }: Props) {
  const [url, setUrl] = useState(activeRequest.url);
  const [headers, setHeaders] = useState<string>(
    activeRequest.headers
      .filter((h) => h.enabled && h.name)
      .map((h) => `${h.name}: ${h.value}`)
      .join('\n'),
  );
  const [body, setBody] = useState<string>(activeRequest.body?.text ?? '');
  const [wordlist, setWordlist] = useState<string>('');
  const [results, setResults] = useState<FuzzResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState('setup');
  const activeEnvironment = useActiveEnvironment();

  useEffect(() => {
    // Listen for results
    const unlisten = listen<FuzzResult>('fuzz_result', (event) => {
        setResults((prev) => [...prev, event.payload]);
    });
    return () => {
        unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    setUrl(activeRequest.url);
    setHeaders(
      activeRequest.headers
        .filter((h) => h.enabled && h.name)
        .map((h) => `${h.name}: ${h.value}`)
        .join('\n'),
    );
    setBody(activeRequest.body?.text ?? '');
    setResults([]);
  }, [activeRequest.id]);

  const handleStart = async () => {
    setIsRunning(true);
    setResults([]);
    setActiveTab('results');

    try {
        const headerList = headers.split('\n').map(line => {
            const parts = line.split(':');
            if(parts.length < 2) return null;
            return {
                name: parts[0]?.trim() ?? '',
                value: parts.slice(1).join(':').trim(),
                enabled: true
            };
        }).filter((h): h is { name: string; value: string; enabled: boolean } => h !== null);

        // Construct a template request
        // We use the activeRequest as a base for other properties (method, auth, etc.)
        const templateRequest = {
            ...activeRequest,
            url,
            headers: headerList as any[], // Type cast because we constructed it manually
            body: { ...activeRequest.body, text: body }
        };

        const words = wordlist.split('\n').map(w => w.trim()).filter(w => w.length > 0);

        await invoke('cmd_run_fuzz_attack', {
            baseRequest: templateRequest,
            wordlist: words,
            environmentId: activeEnvironment?.id
        });
    } catch (e) {
        console.error("Fuzz error", e);
    } finally {
        setIsRunning(false);
    }
  };

  const handleStop = async () => {
      try {
          // Assuming activeRequest.id is used as run_id
          await invoke('cmd_stop_fuzz_attack', { runId: activeRequest.id });
      } catch (e) {
          console.error("Stop error", e);
      }
  };

  const addMarker = (current: string, setter: (v: string) => void) => {
    // Ideally we use the selection, but since we don't track focus easily across components without complex context/refs,
    // we will simply append §marker§ to the end if nothing selected, or if we can't determine selection.
    // For a real "Intruder" experience, we'd need refs to all editors.
    // Since we provided separate Add Marker buttons, let's just append for now or wrap "payload" if it exists.

    // Better: Allow user to click "Add Marker" which copies "§§" to clipboard?
    // Or just insert "§§" at end.
    setter(current + '§§');
  };

  return (
    <div className={classNames(className, 'h-full flex flex-col')}>
      <Tabs
        label="Fuzzer Tabs"
        value={activeTab}
        onChangeValue={setActiveTab}
        tabs={[
            { value: 'setup', label: 'Setup' },
            { value: 'results', label: 'Results', rightSlot: results.length > 0 ? <CountBadge count={results.length} /> : null }
        ]}
        className="flex-shrink-0"
      >
        <TabContent value="setup">
            <div className="p-4 overflow-y-auto h-full space-y-4">
                <VStack space={4}>
                    <div className="space-y-1">
                        <div className="flex justify-between">
                            <label className="text-sm font-bold text-text-subtlest">URL</label>
                             <Button size="xs" variant="border" onClick={() => addMarker(url, setUrl)}>Add §</Button>
                        </div>
                        <Input
                            label="URL"
                            hideLabel
                            stateKey={null}
                            forceUpdateKey={url}
                            defaultValue={url}
                            onChange={setUrl}
                            placeholder="http://example.com/§id§"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4 h-full min-h-[300px]">
                         <div className="flex flex-col space-y-1 h-full">
                            <div className="flex justify-between">
                                <label className="text-sm font-bold text-text-subtlest">Headers (Name: Value)</label>
                                <Button size="xs" variant="border" onClick={() => addMarker(headers, setHeaders)}>Add §</Button>
                            </div>
                            <Editor
                                stateKey={null}
                                forceUpdateKey="headers"
                                defaultValue={headers}
                                onChange={setHeaders}
                                language="text"
                                heightMode="full"
                                className="border border-border rounded-md"
                            />
                        </div>
                        <div className="flex flex-col space-y-1 h-full">
                            <div className="flex justify-between">
                                <label className="text-sm font-bold text-text-subtlest">Body</label>
                                <Button size="xs" variant="border" onClick={() => addMarker(body, setBody)}>Add §</Button>
                            </div>
                            <Editor
                                stateKey={null}
                                forceUpdateKey="body"
                                defaultValue={body}
                                onChange={setBody}
                                language="json" // Or dynamic based on request
                                heightMode="full"
                                className="border border-border rounded-md"
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-sm font-bold text-text-subtlest">Wordlist (One per line)</label>
                        <Editor
                            stateKey={null}
                            forceUpdateKey="wordlist"
                            defaultValue={wordlist}
                            onChange={setWordlist}
                            language="text"
                            heightMode="auto"
                            className="border border-border rounded-md h-32"
                        />
                    </div>

                    <HStack space={2}>
                        {isRunning ? (
                             <Button color="danger" onClick={handleStop}>
                                Stop Attack
                            </Button>
                        ) : (
                            <Button color="primary" onClick={handleStart}>
                                Start Attack
                            </Button>
                        )}

                        <Button variant="border" onClick={() => {
                            // Reset from active request
                            setUrl(activeRequest.url);
                            setHeaders(activeRequest.headers.filter((h) => h.enabled && h.name).map((h) => `${h.name}: ${h.value}`).join('\n'));
                            setBody(activeRequest.body?.text ?? '');
                        }}>
                            Reset to Current Request
                        </Button>
                    </HStack>
                </VStack>
            </div>
        </TabContent>
        <TabContent value="results">
             <div className="h-full flex flex-col">
                <div className="flex-shrink-0 p-2 border-b border-border flex justify-between items-center bg-surface-highlight">
                    <span className="text-sm font-mono">{results.length} requests</span>
                    <HStack space={2}>
                        {isRunning && (
                             <Button size="xs" color="danger" onClick={handleStop}>Stop</Button>
                        )}
                        <Button size="xs" variant="border" onClick={() => setResults([])}>Clear</Button>
                    </HStack>
                </div>
                <div className="flex-1 overflow-auto">
                    <table className="w-full text-sm text-left border-collapse">
                        <thead className="bg-surface sticky top-0 z-10">
                            <tr>
                                <th className="p-2 border-b border-border font-medium text-text-subtlest">ID</th>
                                <th className="p-2 border-b border-border font-medium text-text-subtlest">Payload</th>
                                <th className="p-2 border-b border-border font-medium text-text-subtlest">Status</th>
                                <th className="p-2 border-b border-border font-medium text-text-subtlest">Size</th>
                                <th className="p-2 border-b border-border font-medium text-text-subtlest">Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {results.map((r, i) => (
                                <tr key={i} className="hover:bg-surface-highlight border-b border-border last:border-0 font-mono">
                                    <td className="p-2">{r.request_id}</td>
                                    <td className="p-2 truncate max-w-[200px]" title={r.payload}>{r.payload}</td>
                                    <td className={classNames("p-2", r.status >= 200 && r.status < 300 ? "text-success" : "text-danger")}>{r.status}</td>
                                    <td className="p-2">{r.size_bytes}</td>
                                    <td className="p-2">{r.time_ms}ms</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
             </div>
        </TabContent>
      </Tabs>
    </div>
  );
}
