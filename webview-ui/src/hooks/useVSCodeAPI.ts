import { useEffect, useRef, useCallback, useState } from 'react';
import type { WebviewMessage, ExtensionMessage, ResponseMessage } from '../types';

type MessageHandler = (message: ExtensionMessage) => void;

interface UseVSCodeAPI {
  postMessage: (message: WebviewMessage) => void;
  sendRequest: (type: string, payload: unknown) => Promise<unknown>;
  onMessage: (handler: MessageHandler) => () => void;
  getState: <T>() => T | undefined;
  setState: <T>(state: T) => void;
}

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

let vsCodeApi: ReturnType<typeof acquireVsCodeApi> | undefined;

function getVSCodeApi() {
  if (!vsCodeApi) {
    try {
      vsCodeApi = acquireVsCodeApi();
    } catch {
      // Running outside VS Code
    }
  }
  return vsCodeApi;
}

let messageCounter = 0;
const pendingRequests = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

export function useVSCodeAPI(): UseVSCodeAPI {
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const api = getVSCodeApi();
    if (api) {
      setIsReady(true);
    }

    const handleMessage = (event: MessageEvent) => {
      const message = event.data as ExtensionMessage;

      // Handle request responses
      if ('requestId' in message) {
        const response = message as unknown as ResponseMessage;
        const pending = pendingRequests.get(response.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingRequests.delete(response.requestId);
          if (response.error) {
            pending.reject(new Error(response.error));
          } else {
            pending.resolve(response.payload);
          }
        }
        return;
      }

      // Notify all handlers
      handlersRef.current.forEach(handler => {
        try {
          handler(message);
        } catch (err) {
          console.error('Error in message handler:', err);
        }
      });
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      // Reject all pending requests
      pendingRequests.forEach((pending) => {
        clearTimeout(pending.timer);
        pending.reject(new Error('VS Code API hook unmounted'));
      });
      pendingRequests.clear();
    };
  }, []);

  const postMessage = useCallback((message: WebviewMessage) => {
    const api = getVSCodeApi();
    if (api) {
      api.postMessage(message);
    } else {
      console.warn('[QuackWrangler] VS Code API not available, message not sent:', message);
    }
  }, []);

  const sendRequest = useCallback((type: string, payload: unknown): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      const requestId = `req_${++messageCounter}_${Date.now()}`;

      const timer = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error(`Request ${type} timed out after 30s`));
      }, 30000);

      pendingRequests.set(requestId, { resolve, reject, timer });

      postMessage({ type, payload, requestId } as WebviewMessage);
    });
  }, [postMessage]);

  const onMessage = useCallback((handler: MessageHandler): (() => void) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const getState = useCallback(<T,>(): T | undefined => {
    const api = getVSCodeApi();
    return api?.getState() as T | undefined;
  }, []);

  const setState = useCallback((state: unknown) => {
    const api = getVSCodeApi();
    api?.setState(state);
  }, []);

  // Ensure handlers work even when API isn't available (dev mode)
  useEffect(() => {
    if (!isReady) {
      const handleMessage = (event: MessageEvent) => {
        const message = event.data as ExtensionMessage;
        handlersRef.current.forEach(handler => {
          try {
            handler(message);
          } catch (err) {
            console.error('Error in message handler:', err);
          }
        });
      };

      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }
  }, [isReady]);

  return { postMessage, sendRequest, onMessage, getState, setState };
}
