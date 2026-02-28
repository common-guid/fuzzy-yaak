import type { HttpRequest, HttpResponse } from '@yaakapp-internal/models';

export interface FuzzerMarker {
  id: string;
  field: 'url' | 'body' | 'headers';
  start: number;
  end: number;
  originalText: string;
}

export interface FuzzerResult {
  id: string;
  word: string;
  status: number;
  elapsed: number;
  contentLength: number;
  error?: string;
  timestamp: number;
}

type SendResult = Pick<HttpResponse, 'status' | 'contentLength' | 'error'>;

interface RunFuzzerRequestsOptions {
  draftRequest: HttpRequest;
  markers: FuzzerMarker[];
  rawHeaders: string;
  words: string[];
  sendRequest: (request: HttpRequest) => Promise<SendResult>;
  addResult: (result: FuzzerResult) => void;
  generateId: () => string;
  now: () => number;
  nowPerf: () => number;
  shouldContinue?: () => boolean;
}

function applyMarkers(text: string, markers: FuzzerMarker[], word: string) {
  let nextText = text;
  const sortedMarkers = [...markers].sort((a, b) => b.start - a.start);
  for (const marker of sortedMarkers) {
    nextText = nextText.substring(0, marker.start) + word + nextText.substring(marker.end);
  }
  return nextText;
}

function parseHeaders(headersText: string, generateId: () => string) {
  return headersText
    .split('\n')
    .map((line) => {
      const parts = line.split(':');
      if (parts.length < 2) return null;

      const name = parts[0]?.trim();
      const value = parts.slice(1).join(':').trim();
      if (!name) return null;

      return { name, value, enabled: true, id: generateId() };
    })
    .filter((header): header is { name: string; value: string; enabled: boolean; id: string } => {
      return header !== null;
    });
}

export async function runFuzzerRequests({
  draftRequest,
  markers,
  rawHeaders,
  words,
  sendRequest,
  addResult,
  generateId,
  now,
  nowPerf,
  shouldContinue = () => true,
}: RunFuzzerRequestsOptions) {
  const urlMarkers = markers.filter((m) => m.field === 'url');
  const headerMarkers = markers.filter((m) => m.field === 'headers');
  const bodyMarkers = markers.filter((m) => m.field === 'body');

  for (const word of words) {
    if (!shouldContinue()) break;

    const request = { ...draftRequest };

    request.url = applyMarkers(request.url ?? '', urlMarkers, word);
    const bodyText = applyMarkers(request.body?.text ?? '', bodyMarkers, word);
    const headersText = applyMarkers(rawHeaders, headerMarkers, word);
    request.body = { ...request.body, text: bodyText };
    request.headers = parseHeaders(headersText, generateId);

    try {
      const start = nowPerf();
      const response = await sendRequest(request);
      const elapsed = nowPerf() - start;

      addResult({
        id: generateId(),
        word,
        status: response.status,
        elapsed,
        contentLength: response.contentLength ?? 0,
        error: response.error ?? undefined,
        timestamp: now(),
      });
    } catch (e) {
      addResult({
        id: generateId(),
        word,
        status: 0,
        elapsed: 0,
        contentLength: 0,
        error: String(e),
        timestamp: now(),
      });
    }
  }
}
