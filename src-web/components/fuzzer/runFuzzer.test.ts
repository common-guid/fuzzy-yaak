import type { HttpRequest, HttpResponse } from '@yaakapp-internal/models';
import { describe, expect, it, vi } from 'vitest';
import type { FuzzerMarker, FuzzerResult } from './runFuzzer';
import { runFuzzerRequests } from './runFuzzer';

function createIdGenerator() {
  let index = 0;
  return () => `id-${++index}`;
}

function createRequest(): HttpRequest {
  return {
    model: 'http_request',
    id: 'req-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    workspaceId: 'ws-1',
    folderId: null,
    authentication: {},
    authenticationType: null,
    body: { text: 'token=FUZZ' },
    bodyType: null,
    description: '',
    headers: [],
    method: 'GET',
    name: 'Test Request',
    sortPriority: 0,
    url: 'https://example.com/FUZZ',
    urlParameters: [],
  };
}

function createResponse(status: number, contentLength: number): HttpResponse {
  return {
    model: 'http_response',
    id: `resp-${status}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    workspaceId: 'ws-1',
    requestId: 'req-1',
    bodyPath: null,
    contentLength,
    contentLengthCompressed: contentLength,
    elapsed: 10,
    elapsedHeaders: 5,
    elapsedDns: 1,
    error: null,
    headers: [{ name: 'content-type', value: 'application/json' }],
    remoteAddr: null,
    requestContentLength: null,
    requestHeaders: [{ name: 'accept', value: '*/*' }],
    status,
    statusReason: 'OK',
    state: 'closed',
    url: 'https://example.com',
    version: 'HTTP/1.1',
  };
}

describe('runFuzzerRequests', () => {
  it('sends one request per word and appends one result per word', async () => {
    const request = createRequest();
    const markerText = 'FUZZ';
    const markers: FuzzerMarker[] = [
      {
        id: 'url-marker',
        field: 'url',
        start: request.url.indexOf(markerText),
        end: request.url.indexOf(markerText) + markerText.length,
        originalText: markerText,
      },
      {
        id: 'body-marker',
        field: 'body',
        start: request.body.text.indexOf(markerText),
        end: request.body.text.indexOf(markerText) + markerText.length,
        originalText: markerText,
      },
      {
        id: 'header-marker',
        field: 'headers',
        start: 'X-Test: FUZZ'.indexOf(markerText),
        end: 'X-Test: FUZZ'.indexOf(markerText) + markerText.length,
        originalText: markerText,
      },
    ];

    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(createResponse(200, 123))
      .mockResolvedValueOnce(createResponse(201, 456));

    const results: FuzzerResult[] = [];
    let perfTime = 10;

    await runFuzzerRequests({
      draftRequest: request,
      markers,
      rawHeaders: 'X-Test: FUZZ',
      words: ['alpha', 'beta'],
      sendRequest,
      addResult: (result) => results.push(result),
      generateId: createIdGenerator(),
      now: () => 1_700_000_000_000,
      nowPerf: () => {
        perfTime += 5;
        return perfTime;
      },
    });

    expect(sendRequest).toHaveBeenCalledTimes(2);
    const firstRequest = sendRequest.mock.calls[0]?.[0];
    const secondRequest = sendRequest.mock.calls[1]?.[0];
    expect(firstRequest?.url).toBe('https://example.com/alpha');
    expect(secondRequest?.url).toBe('https://example.com/beta');
    expect(firstRequest?.body.text).toBe('token=alpha');
    expect(secondRequest?.body.text).toBe('token=beta');
    expect(firstRequest?.headers[0]?.value).toBe('alpha');
    expect(secondRequest?.headers[0]?.value).toBe('beta');

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.word)).toEqual(['alpha', 'beta']);
    expect(results.map((r) => r.status)).toEqual([200, 201]);
    expect(results[0]?.request?.url).toBe('https://example.com/alpha');
    expect(results[1]?.request?.url).toBe('https://example.com/beta');
    expect(results[0]?.response?.status).toBe(200);
    expect(results[1]?.response?.status).toBe(201);
  });

  it('uses the active workspace id when provided', async () => {
    const request = createRequest();
    const sendRequest = vi.fn().mockResolvedValue(createResponse(200, 0));

    await runFuzzerRequests({
      draftRequest: { ...request, workspaceId: 'temp' },
      markers: [],
      rawHeaders: '',
      words: ['alpha'],
      sendRequest,
      addResult: () => {},
      workspaceId: 'ws-real',
      generateId: createIdGenerator(),
      now: () => 1_700_000_000_000,
      nowPerf: () => 1,
    });

    const sentRequest = sendRequest.mock.calls[0]?.[0];
    expect(sentRequest?.workspaceId).toBe('ws-real');
  });
});
