'use strict';
const {rpc}=require('./rpc-client.cjs');
async function readAccountUsage(codex,cwd){
 const client=rpc(codex,['app-server','--stdio','-c','features.hooks=false','-c','features.plugins=false','-c','features.apps=false'],{cwd});
 try{await client.call('initialize',{clientInfo:{name:'lonic-queue-usage',version:'1'}});client.notify('initialized');const response=await client.call('account/rateLimits/read');return {response,observedAt:Date.now()}}finally{client.close()}
}
module.exports={readAccountUsage};
