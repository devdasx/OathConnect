import {ProtocolError} from '@oathconnect/protocol';
// No custom endpoint or mainnet mode. A cluster reset requires a reviewed pin update.
const networks=Object.freeze({
 devnet:Object.freeze({name:'devnet',label:'Solana devnet',genesis:'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',chain:'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',endpoint:'https://api.devnet.solana.com'}),
 testnet:Object.freeze({name:'testnet',label:'Solana testnet',genesis:'4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',chain:'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z',endpoint:'https://api.testnet.solana.com'})
});
export function labNetwork(name='devnet'){
 if(typeof name!=='string'||!Object.hasOwn(networks,name))throw new ProtocolError('solana_lab_unsupported_network');
 return networks[name];
}
