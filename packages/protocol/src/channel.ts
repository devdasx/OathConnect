import {b64, canonical, fixed, integer, nowSeconds, opposite, parseJSON, random, record, requireThat, role, text, unb64, utf8, type Role} from './codec.js';

export interface Frame {v: 1; session: string; sender: Role; sequence: number; expires: number; nonce: string; ciphertext: string}
export const MAX_PLAINTEXT = 24_576;
export function validateFrame(value: unknown, now = nowSeconds()): Frame {
  record(value, ['v', 'session', 'sender', 'sequence', 'expires', 'nonce', 'ciphertext']);
  requireThat(value.v === 1, 'unsupported_version'); fixed(value.session, 32); role(value.sender);
  integer(value.sequence, 1, 4096); integer(value.expires, now + 1, now + 3600); fixed(value.nonce, 12);
  requireThat(unb64(value.ciphertext, MAX_PLAINTEXT + 16).length >= 16);
  return value as unknown as Frame;
}
export const associatedData = (f: Omit<Frame, 'ciphertext'>) => utf8(JSON.stringify(['OathConnect/frame/v1', f.session, f.sender, f.sequence, f.expires]));

/** Not resumable. Never serialize keys/counters and then restart from an old snapshot. */
export class SecureChannel {
  #send = 0; #receive = 0; #closed = false;
  #sendTail: Promise<unknown> = Promise.resolve(); #receiveTail: Promise<unknown> = Promise.resolve();
  constructor(readonly session: string, readonly localRole: Role, private readonly sendKey: CryptoKey, private readonly receiveKey: CryptoKey, readonly expires: number) {}
  close() { this.#closed = true; }
  seal(value: unknown, now = nowSeconds()): Promise<Frame> {
    const serialized = canonical(value); requireThat(utf8(serialized).length <= MAX_PLAINTEXT, 'message_too_large');
    const task = this.#sendTail.then(async () => {
      requireThat(!this.#closed && now < this.expires, 'session_closed');
      requireThat(this.#send < 4096, 'session_exhausted');
      const header = {v: 1 as const, session: this.session, sender: this.localRole, sequence: ++this.#send, expires: this.expires, nonce: random(12)};
      try {
        const encrypted = await crypto.subtle.encrypt({name: 'AES-GCM', iv: unb64(header.nonce, 12), additionalData: associatedData(header), tagLength: 128}, this.sendKey, utf8(serialized));
        requireThat(!this.#closed, 'session_closed'); return {...header, ciphertext: b64(new Uint8Array(encrypted))};
      } catch (error) { this.close(); throw error; }
    });
    this.#sendTail = task.catch(() => {}); return task;
  }
  open(value: unknown, now = nowSeconds()): Promise<unknown> {
    // Copy before awaiting to avoid caller mutation between validation and decryption.
    const snapshot = parseJSON(JSON.stringify(value));
    const task = this.#receiveTail.then(async () => {
      requireThat(!this.#closed && now < this.expires, 'session_closed');
      const frame = validateFrame(snapshot, now);
      requireThat(frame.session === this.session && frame.sender === opposite(this.localRole) && frame.expires === this.expires, 'wrong_channel');
      requireThat(frame.sequence === this.#receive + 1, 'replay_or_gap');
      let clear: ArrayBuffer;
      try { clear = await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(frame.nonce, 12), additionalData: associatedData(frame), tagLength: 128}, this.receiveKey, unb64(frame.ciphertext, MAX_PLAINTEXT + 16)); }
      catch { throw new Error('authentication_failed'); }
      requireThat(!this.#closed, 'session_closed');
      const decoded = parseJSON(text(new Uint8Array(clear)), MAX_PLAINTEXT);
      this.#receive = frame.sequence; return decoded;
    });
    this.#receiveTail = task.catch(() => {}); return task;
  }
}
