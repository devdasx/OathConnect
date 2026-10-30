// Read-only; no keys, signatures, faucet calls or submissions.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {EvmRpc} from '@oathconnect/evm';
import {ProtocolError} from '@oathconnect/protocol';
import {writeEvidence} from '../support/evidence.mjs';
import {NETWORK,RECIPIENT,check,confirmReceipt} from './core.mjs';
try{
 const target=process.argv[2]??'local';check(['local','live'].includes(target)&&process.argv.length<=3,'bnb_invalid_target');
 const name='bnb-testnet'+(target==='live'?'-live':''),expected=JSON.parse(readFileSync('evidence/'+name+'.json','utf8'));
 check(expected.chain===NETWORK.chain&&expected.recipient===RECIPIENT&&typeof expected.hash==='string'&&/^0x[a-f0-9]{64}$/.test(expected.hash)&&/^[a-f0-9]{40}$/.test(expected.commit),'bnb_invalid_evidence');
 const rpc=new EvmRpc(NETWORK.endpoint),receipt=await rpc.request('eth_getTransactionReceipt',[expected.hash],AbortSignal.timeout(15000));
 const result=await confirmReceipt(rpc,receipt,expected,AbortSignal.timeout(15000));
 const evidence={checked:new Date().toISOString(),chain:NETWORK.chain,network:NETWORK.name,genesisHash:NETWORK.genesis,hash:expected.hash,...result,status:'finalized',transactionConfirmed:true,submissions:0,receiptCommit:expected.commit,reconcilerCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),reconcilerDirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().length>0,productionReady:false};
 writeEvidence(name+'-finality',evidence);console.log(JSON.stringify(evidence));
}catch(error){console.log(JSON.stringify({status:'failed',code:error instanceof ProtocolError?error.code:'bnb_reconciliation_failed',productionReady:false}));process.exitCode=1;}
