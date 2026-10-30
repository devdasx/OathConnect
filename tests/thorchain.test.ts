import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewQuote} from '@oathconnect/thorchain';
const input = {fromAsset:'ETH.ETH',toAsset:'BTC.BTC',amount:'100000000',destination:'testonlydestination',maxSlippageBps:100};
const inbound = {chain:'ETH', address:'testonlyvault', halted:false, global_trading_paused:false,chain_trading_paused:false};
const quote = {inbound_address:inbound.address,expiry:1700000100,expected_amount_out:'100000',dust_threshold:'1',memo:'=:BTC.BTC:testonlydestination:99000/1/0'};
test('THORChain example rejects stale vaults, expiry, halts, redirected destinations and hidden fees', () => {
  assert.equal(reviewQuote(quote,input,inbound,1700000000).minimumOut,'99000');
  for (const q of [{...quote,inbound_address:'other'}, {...quote,expiry:1699999999}, {...quote,memo:'=:BTC.BTC:attacker:99000/1/0'}, {...quote,memo:quote.memo+':affiliate:100'}, {...quote,memo:'=:BTC.BTC:testonlydestination:0/1/0'}]) assert.throws(() => reviewQuote(q,input,inbound,1700000000));
  assert.throws(() => reviewQuote(quote,input,{...inbound,halted:true},1700000000));
  assert.throws(() => reviewQuote(quote,{...input,amount:'0'},inbound,1700000000));
});
