import {nowSeconds, ProtocolError, record, requireThat, type Project, type SecureChannel} from '@oathconnect/protocol';
import {isSubset, newRequest, validateCapabilities, validateProposal, type Capability, type RequestedCapability, type WalletAuthorizer} from './permissions.js';
import {RelayClient, type PeerIdentity} from './transport.js';

/** One request in flight. Ambiguous failures close locally; never automatically retry a signature. */
export class Session {
  #cursor = 0; #closed = false; #busy = false; #capabilities: Capability[] | undefined; #activeAuthorizer: WalletAuthorizer | undefined;
  readonly #projects: readonly Project[]; #peer: PeerIdentity | undefined;
  constructor(private readonly channel: SecureChannel, private readonly relay: RelayClient, trustedProjects: readonly Project[]) {this.#projects = structuredClone(trustedProjects);}
  get peer(): PeerIdentity | undefined {return this.#peer ? {...this.#peer} : undefined;}
  async #send(value: unknown) { requireThat(!this.#closed, 'session_closed'); await this.relay.send(await this.channel.seal(value)); }
  async #receive(deadline: number): Promise<unknown> {
    while (!this.#closed && nowSeconds() < deadline) {
      const messages = await this.relay.receive(this.#cursor);
      if (messages.length) {
        requireThat(messages.length === 1, 'unexpected_concurrent_messages');
        const frame = messages[0]!; const value = await this.channel.open(frame); this.#cursor = frame.sequence;
        await this.relay.acknowledge(this.#cursor); return value;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new ProtocolError('request_timeout');
  }
  async #exclusive<T>(body: () => Promise<T>): Promise<T> {
    requireThat(!this.#closed && !this.#busy, 'session_unavailable'); this.#busy = true;
    try { return await body(); }
    catch (error) { this.#closed = true; this.channel.close(); this.#activeAuthorizer?.close(); throw error; }
    finally { this.#busy = false; }
  }
  async propose(capabilities: RequestedCapability[]): Promise<Capability[]> {
    return this.#exclusive(async () => {
      requireThat(this.channel.localRole === 'dapp' && !this.#capabilities, 'invalid_state');
      const requested = validateProposal(capabilities); const proposal = {type: 'proposal', capabilities: requested};
      await this.#send({...proposal, identity: await this.relay.attest(proposal)});
      const response = await this.#receive(nowSeconds() + 120); record(response, ['type', 'capabilities', 'identity']); requireThat(response.type === 'approved');
      this.#peer = await this.relay.identify({type: response.type, capabilities: response.capabilities}, response.identity, this.#projects, 'wallet');
      const approved = validateCapabilities(response.capabilities);
      requireThat(isSubset(approved, requested), 'permission_escalation');
      this.#capabilities = approved; return structuredClone(approved);
    });
  }
  async approveSession(decide: (requested: RequestedCapability[], peer: PeerIdentity) => Promise<Capability[]>): Promise<Capability[]> {
    return this.#exclusive(async () => {
      requireThat(this.channel.localRole === 'wallet' && !this.#capabilities, 'invalid_state');
      const proposal = await this.#receive(nowSeconds() + 120); record(proposal, ['type', 'capabilities', 'identity']); requireThat(proposal.type === 'proposal');
      this.#peer = await this.relay.identify({type: proposal.type, capabilities: proposal.capabilities}, proposal.identity, this.#projects, 'dapp');
      const requested = validateProposal(proposal.capabilities);
      const approved = validateCapabilities(await decide(structuredClone(requested), {...this.#peer}));
      requireThat(isSubset(approved, requested), 'permission_escalation');
      this.#capabilities = approved; const response = {type: 'approved', capabilities: approved};
      await this.#send({...response, identity: await this.relay.attest(response)}); return structuredClone(approved);
    });
  }
  async request(capability: Capability, method: string, params: unknown): Promise<unknown> {
    return this.#exclusive(async () => {
      requireThat(this.channel.localRole === 'dapp' && this.#capabilities?.some(c => c.chain === capability.chain && c.account === capability.account && c.methods.includes(method)), 'unauthorized_request');
      const request = newRequest(capability, method, params); await this.#send(request);
      const response = await this.#receive(request.expires); record(response, ['type', 'id', 'result', 'error']);
      requireThat(response.type === 'response' && response.id === request.id, 'wrong_response');
      if (response.error !== null) throw new ProtocolError('wallet_rejected'); return response.result;
    });
  }
  async serveOnce(authorizer: WalletAuthorizer, deadline = nowSeconds() + 120): Promise<void> {
    return this.#exclusive(async () => {
      requireThat(this.channel.localRole === 'wallet' && this.#capabilities, 'invalid_state');
      const request = await this.#receive(deadline);
      // Check the negotiated session grant independently of the supplied authorizer.
      const {validateRequest} = await import('./permissions.js'); const checked = validateRequest(request, this.#capabilities);
      this.#activeAuthorizer = authorizer;
      let result: unknown = null; let error: string | null = null;
      try { result = await authorizer.handle(checked); } catch { error = 'rejected'; }
      finally { this.#activeAuthorizer = undefined; }
      await this.#send({type: 'response', id: checked.id, result, error});
    });
  }
  async close() { this.#closed = true; this.channel.close(); this.#activeAuthorizer?.close(); await this.relay.close(); }
}
