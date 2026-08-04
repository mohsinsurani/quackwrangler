import { useCallback, useEffect, useRef } from 'react';

import type { ExtensionMessage, WebviewMessage } from '../types';

type MessageHandler = (message: ExtensionMessage) => void;

interface VSCodeAPI {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

let api: VSCodeAPI | undefined;

export function isTrustedExtensionMessageOrigin(
  eventOrigin: string,
  webviewOrigin: string,
): boolean {
  return eventOrigin === webviewOrigin;
}

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
    const trustedOrigin = window.location.origin;

    const receive = (event: MessageEvent<ExtensionMessage>) => {
      // VS Code may relay extension-host messages through an internal frame that
      // is not the webview's immediate parent. The webview origin is stable and
      // remains the security boundary documented by VS Code.
      if (!isTrustedExtensionMessageOrigin(event.origin, trustedOrigin)) return;
      handlers.current.forEach((handler) => handler(event.data));
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
