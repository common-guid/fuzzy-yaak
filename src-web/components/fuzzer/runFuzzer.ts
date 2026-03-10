import type { HttpRequest, HttpResponse } from '@yaakapp-internal/models';

export type FuzzerEncoder = 'none' | 'url' | 'base64' | 'utf8' | 'html';

export interface FuzzerSettings {
  requestsPerSecond: number | null;
  encoder: FuzzerEncoder;
}

export function encodeWord(word: string, encoder: FuzzerEncoder = 'none'): string {
  switch (encoder) {
    case 'url':
      return encodeURIComponent(word);
    case 'base64':
      // Handle Unicode safely
      return btoa(unescape(encodeURIComponent(word)));
    case 'utf8': {
      // Percent-encode only non-ASCII bytes; leave printable ASCII intact
      let result = '';
      for (const char of word) {
        const code = char.codePointAt(0) ?? 0;
        if (code < 0x80) {
          result += char;
        } else {
          // Encode to UTF-8 bytes as %XX sequences
          const bytes = new TextEncoder().encode(char);
          for (const byte of bytes) {
            result += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
          }
        }
      }
      return result;
    }
    case 'html':
      return word
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    case 'none':
    default:
      return word;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  request?: HttpRequest;
  response?: HttpResponse;
}

type SendResult = HttpResponse;

interface RunFuzzerRequestsOptions {
  draftRequest: HttpRequest;
  markers: FuzzerMarker[];
  rawHeaders: string;
  words: string[];
  sendRequest: (request: HttpRequest) => Promise<SendResult>;
  addResult: (result: FuzzerResult) => void;
  workspaceId?: string;
  generateId: () => string;
  now: () => number;
  nowPerf: () => number;
  shouldContinue?: () => boolean;
  settings?: FuzzerSettings;
  /** Injectable sleep for testing; defaults to real setTimeout-based sleep */
  sleepFn?: (ms: number) => Promise<void>;
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

function cloneRequest(request: HttpRequest): HttpRequest {
  return {
    ...request,
    authentication: { ...request.authentication },
    body: { ...request.body },
    headers: request.headers.map((header) => ({ ...header })),
    urlParameters: request.urlParameters.map((param) => ({ ...param })),
  };
}

function cloneResponse(response: HttpResponse): HttpResponse {
  return {
    ...response,
    headers: response.headers.map((header) => ({ ...header })),
    requestHeaders: response.requestHeaders.map((header) => ({ ...header })),
  };
}

export async function runFuzzerRequests({
  draftRequest,
  markers,
  rawHeaders,
  words,
  sendRequest,
  addResult,
  workspaceId,
  generateId,
  now,
  nowPerf,
  shouldContinue = () => true,
  settings,
  sleepFn = sleep,
}: RunFuzzerRequestsOptions) {
  const urlMarkers = markers.filter((m) => m.field === 'url');
  const headerMarkers = markers.filter((m) => m.field === 'headers');
  const bodyMarkers = markers.filter((m) => m.field === 'body');
  const encoder = settings?.encoder ?? 'none';
  const rps = settings?.requestsPerSecond ?? null;

  for (let i = 0; i < words.length; i++) {
    if (!shouldContinue()) break;

    const word = words[i] as string;
    const encodedWord = encodeWord(word, encoder);
    const iterationStart = nowPerf();

    const request = { ...draftRequest, workspaceId: workspaceId ?? draftRequest.workspaceId };

    request.url = applyMarkers(request.url ?? '', urlMarkers, encodedWord);
    const bodyText = applyMarkers(request.body?.text ?? '', bodyMarkers, encodedWord);
    const headersText = applyMarkers(rawHeaders, headerMarkers, encodedWord);
    request.body = { ...request.body, text: bodyText };
    request.headers = parseHeaders(headersText, generateId);
    const requestSnapshot = cloneRequest(request);

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
        request: requestSnapshot,
        response: cloneResponse(response),
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
        request: requestSnapshot,
      });
    }

    // Rate limiting: wait remaining time in the interval after each non-last word
    if (rps != null && i < words.length - 1) {
      const minInterval = 1000 / rps;
      const elapsed = nowPerf() - iterationStart;
      const remaining = minInterval - elapsed;
      if (remaining > 0) {
        await sleepFn(remaining);
      }
    }
  }
}
