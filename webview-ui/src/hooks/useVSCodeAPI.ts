import { useCallback, useEffect, useRef } from 'react';

import type { ExtensionMessage, WebviewMessage } from '../types';

type MessageHandler = (message: ExtensionMessage) => void;

interface VSCodeAPI {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

let api: VSCodeAPI | undefined;

function getVSCodeApi(): VSCodeAPI | undefined {
  if (api) return api;
  try {
    api = acquireVsCodeApi();
  } catch {
    // The standalone Vite preview intentionally runs without VS Code.
  }
  return api;
}

export function useVSCodeAPI(): {
  postMessage: (message: WebviewMessage) => void;
  onMessage: (handler: MessageHandler) => () => void;
} {
  const handlers = useRef(new Set<MessageHandler>());

  useEffect(() => {
    const receive = (event: MessageEvent<ExtensionMessage>) => {
      handlers.current.forEach(handler => handler(event.data));
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  const postMessage = useCallback((message: WebviewMessage) => {
    getVSCodeApi()?.postMessage(message);
  }, []);

  const onMessage = useCallback((handler: MessageHandler) => {
    handlers.current.add(handler);
    return () => {
      handlers.current.delete(handler);
    };
  }, []);

  return { postMessage, onMessage };
}
