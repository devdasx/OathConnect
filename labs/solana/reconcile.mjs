// This command never creates keys, signs, simulates or submits transactions.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {ProtocolError} from '@oathconnect/protocol';
import {writeEvidence} from '../support/evidence.mjs';
import {SolanaLabRpc} from './rpc.mjs';
import {reconcileReceipt} from './reconcile-core.mjs';
try{
 const target=process.argv[2]??'local';
 if(!['local','live'].includes(target)||process.argv.length>3)throw new ProtocolError('solana_reconciliation_invalid_target');
 const name=target==='live'?'solana-devnet-live':'solana-devnet';
 const expected=JSON.parse(readFileSync('evidence/'+name+'.json','utf8'));
 const result=await reconcileReceipt(expected,new SolanaLabRpc());
 const evidence={...result,receiptCommit:expected.commit,reconcilerCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),reconcilerDirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().length>0};
 writeEvidence(name+'-finality',evidence);console.log(JSON.stringify(evidence));
}catch(error){
 console.log(JSON.stringify({status:'failed',code:error instanceof ProtocolError?error.code:'solana_reconciliation_failed',productionReady:false}));process.exitCode=1;
}
