// Minimal Redis (RESP2) client. Used for session cache + rate limiting. Fails soft: callers
// treat a rejected command as a cache miss.
import net from 'node:net';

type Reply = string | number | null | Reply[] | Error;

export class Redis {
  private sock: net.Socket | null = null;
  private buf: Buffer = Buffer.alloc(0);
  private pending: { resolve: (v: any) => void; reject: (e: Error) => void }[] = [];
  ready = false;
  private closed = false;

  constructor(private url: string) {}

  connect(): Promise<void> {
    return new Promise((resolve) => {
      const u = new URL(this.url);
      const s = (this.sock = net.connect(Number(u.port || 6379), u.hostname));
      s.setNoDelay(true);
      s.on('connect', () => {
        this.ready = true;
        resolve();
      });
      s.on('data', (d: Buffer) => this.onData(d));
      const down = () => {
        if (this.sock !== s) return;
        this.ready = false;
        this.sock = null;
        for (const p of this.pending) p.reject(new Error('redis disconnected'));
        this.pending = [];
        resolve(); // never block startup on Redis
        if (!this.closed) setTimeout(() => this.connect(), 2000).unref();
      };
      s.on('error', down);
      s.on('close', down);
    });
  }

  cmd(...args: (string | number)[]): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ready || !this.sock) return reject(new Error('redis unavailable'));
      let out = `*${args.length}\r\n`;
      for (const a of args) {
        const s = String(a);
        out += `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
      }
      this.pending.push({ resolve, reject });
      this.sock.write(out);
    });
  }

  private onData(d: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    let off = 0;
    for (;;) {
      const r = this.parse(off);
      if (!r) break;
      off = r[1];
      const p = this.pending.shift();
      if (p) r[0] instanceof Error ? p.reject(r[0]) : p.resolve(r[0]);
    }
    this.buf = this.buf.subarray(off);
  }

  private parse(off: number): [Reply, number] | null {
    const eol = this.buf.indexOf('\r\n', off);
    if (eol < 0) return null;
    const line = this.buf.toString('utf8', off + 1, eol);
    const next = eol + 2;
    switch (String.fromCharCode(this.buf[off])) {
      case '+': return [line, next];
      case '-': return [new Error(line), next];
      case ':': return [Number(line), next];
      case '$': {
        const n = Number(line);
        if (n < 0) return [null, next];
        if (this.buf.length < next + n + 2) return null;
        return [this.buf.toString('utf8', next, next + n), next + n + 2];
      }
      case '*': {
        const n = Number(line);
        if (n < 0) return [null, next];
        const arr: Reply[] = [];
        let p = next;
        for (let i = 0; i < n; i++) {
          const r = this.parse(p);
          if (!r) return null;
          arr.push(r[0]);
          p = r[1];
        }
        return [arr, p];
      }
      default: throw new Error('bad RESP');
    }
  }

  close() {
    this.closed = true;
    this.sock?.destroy();
  }
}
