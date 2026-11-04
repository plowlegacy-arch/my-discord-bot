// JSON-RPC transport with batching, retries, rate-limit backoff and health stats.
// Shared by every chain pipeline. No third-party SDK, no screener dependency.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RpcError extends Error {
  constructor(message, code, data) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}

export class RpcClient {
  constructor(url, { label = 'rpc', maxBatch = 20, minInterval = 40, timeoutMs = 20000 } = {}) {
    this.url = url;
    this.label = label;
    this.maxBatch = maxBatch;
    this.minInterval = minInterval;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.queue = Promise.resolve();
    this.lastCallAt = 0;
    this.stats = {
      calls: 0,
      errors: 0,
      retries: 0,
      lastError: null,
      lastOkAt: null,
      latencyMs: null,
    };
  }

  async _throttle() {
    const wait = this.lastCallAt + this.minInterval - Date.now();
    this.lastCallAt = Date.now() + Math.max(0, wait);
    if (wait > 0) await sleep(wait);
  }

  async call(method, params = [], { retries = 3 } = {}) {
    let attempt = 0;
    let backoff = 400;
    for (;;) {
      await this._throttle();
      const body = { jsonrpc: '2.0', id: this.nextId++, method, params };
      const started = Date.now();
      try {
        this.stats.calls += 1;
        const res = await fetch(this.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        this.stats.latencyMs = Date.now() - started;
        if (res.status === 429 || res.status === 503) {
          throw new RpcError(`rate limited (${res.status})`, res.status);
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new RpcError(`http ${res.status} ${text.slice(0, 160)}`, res.status);
        }
        const json = await res.json();
        if (json.error) {
          const msg = json.error.message || JSON.stringify(json.error);
          const retryable = /rate|limit|timeout|busy|temporar|header not found|block not/i.test(msg);
          if (retryable && attempt < retries) throw new RpcError(msg, json.error.code ?? -32000);
          throw new RpcError(msg, json.error.code ?? -32000, json.error.data);
        }
        this.stats.lastOkAt = Date.now();
        this.stats.lastError = null;
        return json.result;
      } catch (err) {
        const retryable =
          attempt < retries &&
          (err.name === 'TimeoutError' ||
            err.code === 429 ||
            err.code === 503 ||
            err.code === -32000 ||
            /rate|limit|timeout|fetch failed|ECONNRESET|socket/i.test(err.message || ''));
        if (!retryable) {
          this.stats.errors += 1;
          this.stats.lastError = err.message;
          throw err;
        }
        attempt += 1;
        this.stats.retries += 1;
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 8000);
      }
    }
  }

  async batch(calls, { retries = 2 } = {}) {
    if (!calls.length) return [];
    const out = [];
    for (let i = 0; i < calls.length; i += this.maxBatch) {
      const chunk = calls.slice(i, i + this.maxBatch);
      out.push(...(await this._batchChunk(chunk, retries)));
    }
    return out;
  }

  async _batchChunk(chunk, retries) {
    await this._throttle();
    const payload = chunk.map((c) => ({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: c.method,
      params: c.params || [],
    }));
    try {
      this.stats.calls += 1;
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new RpcError(`http ${res.status}`, res.status);
      const json = await res.json();
      if (!Array.isArray(json)) throw new RpcError(json.error?.message || 'invalid batch response');
      const byId = new Map(json.map((r) => [r.id, r]));
      this.stats.lastOkAt = Date.now();
      return payload.map((p) => {
        const r = byId.get(p.id);
        if (!r || r.error) return { error: r?.error?.message || 'missing result', result: null };
        return { result: r.result, error: null };
      });
    } catch (err) {
      if (retries > 0) {
        this.stats.retries += 1;
        await sleep(700);
        return this._batchChunk(chunk, retries - 1);
      }
      this.stats.errors += 1;
      this.stats.lastError = err.message;
      return payload.map(() => ({ error: err.message, result: null }));
    }
  }

  async health() {
    const started = Date.now();
    try {
      if (this.label.startsWith('solana')) {
        const slot = await this.call('getSlot', [{ commitment: 'confirmed' }], { retries: 0 });
        return { ok: true, head: slot, latencyMs: Date.now() - started };
      }
      const bn = await this.call('eth_blockNumber', [], { retries: 0 });
      return { ok: true, head: parseInt(bn, 16), latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, error: err.message, latencyMs: Date.now() - started };
    }
  }
}

const clients = new Map();
export function getClient(chain) {
  if (clients.has(chain.id)) return clients.get(chain.id);
  const url = process.env[chain.rpcEnv] || chain.defaultRpc;
  if (!url) return null;
  const c = new RpcClient(url, {
    label: chain.family === 'solana' ? `solana:${chain.id}` : `evm:${chain.id}`,
    maxBatch: chain.family === 'solana' ? 1 : 20,
    minInterval: chain.family === 'solana' ? 250 : 40,
  });
  clients.set(chain.id, c);
  return c;
}
