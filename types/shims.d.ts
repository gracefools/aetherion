// Type shims for packages whose @types are not installed in the offline sandbox.
// Delete this file after `npm install` (package.json lists the real @types packages).
declare module 'ws' {
  import type { Server } from 'node:http';
  export class WebSocket {
    constructor(url: string);
    readyState: number;
    bufferedAmount: number;
    send(data: string): void;
    close(): void;
    terminate(): void;
    on(ev: 'message', cb: (data: Buffer, isBinary: boolean) => void): this;
    on(ev: 'open' | 'close', cb: () => void): this;
    on(ev: 'error', cb: (e: Error) => void): this;
  }
  export class WebSocketServer {
    constructor(opts: { server: Server; path?: string; maxPayload?: number; perMessageDeflate?: boolean; verifyClient?: (info: { req: import('node:http').IncomingMessage }, done: (ok: boolean, code?: number, msg?: string) => void) => void });
    clients: Set<WebSocket>;
    on(ev: 'connection', cb: (ws: WebSocket, req: import('node:http').IncomingMessage) => void): this;
  }
  export default WebSocket;
}
declare module 'react' {
  const React: any;
  export default React;
  export const useState: any, useEffect: any, useLayoutEffect: any, useRef: any, useCallback: any, useSyncExternalStore: any, memo: any;
}
declare module 'react-dom/client' {
  export const createRoot: any;
}
declare namespace JSX {
  interface IntrinsicElements {
    [tag: string]: any;
  }
  type Element = any;
  interface IntrinsicAttributes {
    key?: any;
  }
}
