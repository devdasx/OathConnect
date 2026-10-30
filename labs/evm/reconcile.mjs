// This command has no signing or submission capability.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {EvmRpc} from '@oathconnect/evm';
import {ProtocolError} from '@oathconnect/protocol';
import {writeEvidence} from '../support/evidence.mjs';
import {reconcileReceipt} from './reconcile-core.mjs';
try {
  const target=process.argv[2]??'local';
  if(!['local','live'].includes(target)||process.argv.length>3)throw new ProtocolError('evm_reconciliation_invalid_target');
  const name=target==='live'?'evm-sepolia-live':'evm-sepolia';
  const expected=JSON.parse(readFileSync('evidence/'+name+'.json','utf8'));
  const endpoints=['https://gateway.tenderly.co/public/sepolia','https://ethereum-sepolia-rpc.publicnode.com'];
  const result=await reconcileReceipt(expected,endpoints.map(endpoint=>({endpoint,rpc:new EvmRpc(endpoint)})));
  const evidence={...result,receiptCommit:expected.commit,reconcilerCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),reconcilerDirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().length>0};
  writeEvidence(name+'-finality',evidence);console.log(JSON.stringify(evidence));
} catch(error) {
  console.log(JSON.stringify({status:'failed',code:error instanceof ProtocolError?error.code:'evm_reconciliation_failed',productionReady:false}));process.exitCode=1;
}
