// Mock Tauri environment
Object.defineProperty(global, 'window', {
  value: {
    __TAURI__: {
      os: {
        type: () => 'linux',
      },
    },
    navigator: {
        userAgent: 'test'
    }
  },
  writable: true
});

import { describe, it, expect, vi } from 'vitest';
import { createStore } from 'jotai';
import { fuzzerResultsAtom, fuzzerMarkersAtom } from './FuzzerLayout';

// Mock dependencies that cause issues in node environment
vi.mock('@tauri-apps/plugin-os', () => ({
  type: () => 'linux',
}));

vi.mock('../lib/tauri', () => ({
  invokeCmd: vi.fn(),
}));

// Mock CodeMirror deps which might be pulling in WASM or other complex stuff
vi.mock('./core/Editor/LazyEditor', () => ({
  Editor: () => null
}));

vi.mock('./fuzzer/FuzzerEditorExtensions', () => ({
  fuzzerMarkersExtension: () => []
}));

vi.mock('./UrlBar', () => ({
  UrlBar: () => null
}));

describe('Fuzzer State Logic', () => {
  it('should store markers correctly', () => {
    const store = createStore();

    store.set(fuzzerMarkersAtom, [{
      id: '1',
      field: 'body',
      start: 0,
      end: 5,
      originalText: 'test'
    }]);

    const markers = store.get(fuzzerMarkersAtom);
    expect(markers).toHaveLength(1);
    expect(markers[0]?.id).toBe('1');
  });

  it('should store results correctly', () => {
    const store = createStore();

    store.set(fuzzerResultsAtom, [{
      id: '1',
      word: 'payload',
      status: 200,
      elapsed: 100,
      contentLength: 50,
      timestamp: 1234567890
    }]);

    const results = store.get(fuzzerResultsAtom);
    expect(results).toHaveLength(1);
    expect(results[0]?.word).toBe('payload');
  });
});
