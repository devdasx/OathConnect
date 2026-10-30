import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createIdentity, createPairing, createProof, joinPairing, random, unb64, text} from '@oathconnect/protocol';
import {fixture} from './support/relay.ts';

test('same-origin browser GET requires exact metadata, approved local-origin grant and proof',async()=>{
  for(const local of [true,false]){
    const f=await fixture({sameOrigin:local});
    try {
      const p=await createPairing(f.audience),identity=await createIdentity(),s=p.invitation.session;
      const created=await f.raw(s,'dapp',identity,'PUT','',{pairExpires:p.invitation.expires});assert.equal(created.response.status,200);
      const path=`/v1/sessions/${s}/peer`,token=created.token;
      for(const [site,mode,origin,validProof,expected] of [
        ['same-origin','cors',null,true,local?200:400],
        ['same-site','cors',null,true,400],['cross-site','cors',null,true,400],['','cors',null,true,400],
        ['same-origin','no-cors',null,true,400],['same-origin','cors','https://evil.example',true,400],
        ['same-origin','cors',null,false,400]
      ] as const){
        const proof=validProof?await createProof(token,identity,'GET',path,''):'';
        // Undici generates Sec-Fetch-Mode from RequestInit, as browsers do.
        const r=await f.fetcher(f.audience+path,{mode,headers:{Authorization:'Oath '+token,'X-Oath-Proof':proof,'Sec-Fetch-Site':site,...(origin?{Origin:origin}:{})}});
        assert.equal(r.status,expected,`${local}/${site}/${mode}/${origin}/${validProof}`);
      }
    } finally {await f.mf.dispose();}
  }
});
test('fixture assets preserve status and restrict scripts, framing, referrers and caching',async()=>{
  const f=await fixture({assets:true});
  try {
    const r=await f.fetcher(f.audience+'/interop/missing');assert.equal(r.status,404);assert.equal(await r.text(),'static fixture');
    assert.match(r.headers.get('Content-Security-Policy')!,/script-src 'self'/);assert.match(r.headers.get('Content-Security-Policy')!,/frame-ancestors 'none'/);
    assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');
    assert.equal((await f.fetcher(f.audience+'/interop/',{method:'POST'})).status,404);
    assert.equal((await f.fetcher(f.audience+'/v1/sessions/'+random()+'/peer')).status,400);
  } finally {await f.mf.dispose();}
});

test('Cloudflare runtime: pairing, isolated encrypted delivery, ack and close', async () => {
  const f = await fixture();
  try {
    const p = await createPairing(f.audience); const dId = await createIdentity(); const wId = await createIdentity();
    const d = f.client(p.invitation.session, 'dapp', dId); const w = f.client(p.invitation.session, 'wallet', wId);
    await d.create(p.invitation.expires); assert.equal(await d.hello(), null);
    const joined = await joinPairing(p.uri, f.audience); await w.join(joined.hello); const channel = await p.accept(await d.hello());
    await d.send(await channel.seal({private: 'secret'}));
    const frames = await w.receive(0); assert.equal(frames.length, 1); assert.deepEqual(await joined.channel.open(frames[0]), {private: 'secret'});
    await w.acknowledge(1); assert.deepEqual(await w.receive(1), []);
    await assert.rejects(f.client(p.invitation.session, 'wallet', await createIdentity()).receive(0), /relay_rejected/);
    await d.close(); await assert.rejects(w.receive(1), /relay_rejected/);
  } finally {await f.mf.dispose();}
});
test('Cloudflare runtime: replay is atomically rejected, grants cannot read other sessions', async () => {
  const f = await fixture();
  try {
    const p = await createPairing(f.audience); const dId = await createIdentity(); const session = p.invitation.session;
    const created = await f.raw(session, 'dapp', dId, 'PUT', '', {pairExpires: p.invitation.expires}); assert.equal(created.response.status, 200);
    const read = await f.raw(session, 'dapp', dId, 'GET', '/peer'); assert.equal(read.response.status, 200);
    const replay = await f.raw(session, 'dapp', dId, 'GET', '/peer', undefined, read); assert.equal(replay.body.error, 'replayed_proof');
    const other = await f.raw(random(), 'dapp', dId, 'GET', '/peer', undefined, read); assert.equal(other.body.error, 'wrong_session');
    const race = await Promise.all([f.raw(session, 'dapp', dId, 'GET', '/peer'), f.raw(session, 'dapp', dId, 'GET', '/peer')]); assert.ok(race.every(r => r.response.ok));
    const absent = await f.fetcher(f.audience + `/v1/sessions/${session}/peer`); assert.equal(absent.status, 400);
  } finally {await f.mf.dispose();}
});
test('Cloudflare runtime: 32-frame mailbox bound, sequence enforcement and malicious cursor', async () => {
  const f = await fixture();
  try {
    const p = await createPairing(f.audience); const dId = await createIdentity(); const wId = await createIdentity(); const s = p.invitation.session;
    await f.raw(s, 'dapp', dId, 'PUT', '', {pairExpires: p.invitation.expires});
    const joined = await joinPairing(p.uri, f.audience); await f.raw(s, 'wallet', wId, 'PUT', '/peer', joined.hello); const channel = await p.accept(joined.hello);
    const first = await channel.seal({n: 1}); assert.equal((await f.raw(s, 'dapp', dId, 'POST', '/messages', first)).response.status, 200);
    assert.equal((await f.raw(s, 'dapp', dId, 'POST', '/messages', first)).body.error, 'invalid_frame');
    for (let n = 2; n <= 32; n++) assert.equal((await f.raw(s, 'dapp', dId, 'POST', '/messages', await channel.seal({n}))).response.status, 200);
    const extra = await channel.seal({n: 33}); assert.equal((await f.raw(s, 'dapp', dId, 'POST', '/messages', extra)).body.error, 'mailbox_full');
    assert.equal((await f.raw(s, 'wallet', wId, 'DELETE', '/messages?through=9999')).body.error, 'invalid_cursor');
    assert.equal((await f.raw(s, 'wallet', wId, 'DELETE', '/messages?through=32')).response.status, 200);
    assert.equal((await f.raw(s, 'dapp', dId, 'POST', '/messages', extra)).response.status, 200);
  } finally {await f.mf.dispose();}
});
test('global integrator allocation budget stops the 101st session', async () => {
  const f = await fixture();
  try {
    const identity = await createIdentity();
    for (let n = 0; n < 101; n++) {
      const p = await createPairing(f.audience);
      const result = await f.raw(p.invitation.session, 'dapp', identity, 'PUT', '', {pairExpires: p.invitation.expires});
      assert.equal(result.response.status, n < 100 ? 200 : 429);
      if (n === 100) assert.equal(result.body.error, 'project_capacity');
    }
  } finally {await f.mf.dispose();}
});

test('relay restart preserves encrypted mailboxes, replay protection and closure tombstones', async () => {
  const {mkdtemp, rm} = await import('node:fs/promises'); const {tmpdir} = await import('node:os'); const {join} = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'oathconnect-restart-')); const f = await fixture({persist: directory});
  try {
    const p = await createPairing(f.audience), session = p.invitation.session, dId = await createIdentity(), wId = await createIdentity();
    await f.raw(session, 'dapp', dId, 'PUT', '', {pairExpires: p.invitation.expires});
    const joined = await joinPairing(p.uri, f.audience); await f.raw(session, 'wallet', wId, 'PUT', '/peer', joined.hello);
    const channel = await p.accept(joined.hello), frame = await channel.seal({survives: 'relay restart'});
    await f.raw(session, 'dapp', dId, 'POST', '/messages', frame);
    const original = await f.raw(session, 'wallet', wId, 'GET', '/messages?after=0');
    await f.restart();
    const replay = await f.raw(session, 'wallet', wId, 'GET', '/messages?after=0', undefined, original);
    assert.equal(replay.body.error, 'replayed_proof');
    const read = await f.raw(session, 'wallet', wId, 'GET', '/messages?after=0');
    assert.deepEqual((read.body.messages as unknown[])[0], frame);
    await f.raw(session, 'dapp', dId, 'DELETE'); await f.restart();
    assert.equal((await f.raw(session, 'wallet', wId, 'GET', '/messages?after=0')).body.error, 'session_closed');
    assert.equal((await f.raw(session, 'dapp', dId, 'PUT', '', {pairExpires: p.invitation.expires})).body.error, 'session_exists');
  } finally {await f.mf.dispose(); await rm(directory, {recursive: true, force: true});}
});

test('revoking either integrator blocks existing peer traffic and queued messages', async () => {
  const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  for(const change of ['disable-dapp','expire-dapp','remove-origin','remove-role','replace-issuer','disable-wallet']) {
    const directory=await mkdtemp(join(tmpdir(),'oathconnect-revocation-'));
    const f=await fixture({persist:directory,splitProjects:true});
    try {
      const p=await createPairing(f.audience),session=p.invitation.session,dId=await createIdentity(),wId=await createIdentity();
      await f.raw(session,'dapp',dId,'PUT','',{pairExpires:p.invitation.expires});
      const joined=await joinPairing(p.uri,f.audience);await f.raw(session,'wallet',wId,'PUT','/peer',joined.hello);
      const channel=await p.accept(joined.hello);await f.raw(session,'dapp',dId,'POST','/messages',await channel.seal({fixture:'queued'}));
      const dapp=f.projects.find(p=>p.id==='test-dapp')!,wallet=f.projects.find(p=>p.id==='test-wallet')!;
      if(change==='disable-dapp')dapp.enabled=false;
      if(change==='expire-dapp')dapp.notAfter=1;
      if(change==='remove-origin')dapp.origins=[];
      if(change==='remove-role')dapp.roles=['wallet'];
      if(change==='replace-issuer')dapp.keys.one=(await createIdentity()).publicKey;
      if(change==='disable-wallet')wallet.enabled=false;
      await f.restart();
      const result=change==='disable-wallet' ? await f.raw(session,'dapp',dId,'GET','/peer') : await f.raw(session,'wallet',wId,'GET','/messages?after=0');
      assert.equal(result.response.status,409,change);assert.equal(result.body.error,'peer_not_approved',change);
      if(change==='disable-dapp') {
        dapp.enabled=true;await f.restart();
        assert.equal((await f.raw(session,'wallet',wId,'GET','/messages?after=0')).body.error,'session_closed');
      }
    } finally {await f.mf.dispose();await rm(directory,{recursive:true,force:true});}
  }
});

test('a stale Worker issuer snapshot cannot create a session after issuer rotation', async()=>{
  const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const directory=await mkdtemp(join(tmpdir(),'oathconnect-registry-rollout-'));
  const f=await fixture({persist:directory,splitProjects:true});
  try {
    const p=await createPairing(f.audience),identity=await createIdentity();
    const prior=await f.raw(p.invitation.session,'dapp',identity,'GET','/peer');
    const grant=JSON.parse(text(unb64(prior.token.split('.')[0]!,2048)));
    const issuer=f.projects[0]!.keys.one;
    f.projects[0]!.keys.one=(await createIdentity()).publicKey;await f.restart();
    const namespace=await f.mf.getDurableObjectNamespace('SESSIONS');
    // Simulates an already-verified request crossing an internal deployment boundary.
    const response=await namespace.get(namespace.idFromName(p.invitation.session)).fetch('https://internal/',{method:'POST',body:JSON.stringify({grant,verifiedPeer:{key:grant.clientKey,project:grant.project,kid:grant.kid,issuer,origin:grant.origin},nonce:random(16),proofAt:Math.floor(Date.now()/1000),method:'PUT',suffix:'',query:'',body:JSON.stringify({pairExpires:p.invitation.expires})})});
    assert.equal(response.status,409);assert.equal((await response.json() as {error:string}).error,'peer_not_approved');
  } finally {await f.mf.dispose();await rm(directory,{recursive:true,force:true});}
});
