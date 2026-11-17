'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {rpc}=require('../codex/runtime/rpc-client.cjs');
test('Windows runtime requires a native executable, not an npm-style cmd shim',{skip:process.platform!=='win32'},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lonic-executable-'));
 t.after(()=>{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(root).startsWith('lonic-executable-'));assert.equal(fs.lstatSync(root).isSymbolicLink(),false);fs.rmSync(root,{recursive:true,force:true})});
 const name='EXAMPLE-lonic-review-shim',shim=path.join(root,name+'.cmd');fs.writeFileSync(shim,'@echo EXAMPLE-SHIM\r\n');
 const bare=rpc(name,[],{env:{PATH:root}});try{await assert.rejects(bare.call('initialize'),{code:'ENOENT'})}finally{bare.close()}
 assert.throws(()=>rpc(shim,[]),{code:'EINVAL'});
 const script="require('readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);console.log(JSON.stringify({id:m.id,result:'EXAMPLE-NATIVE'}))})";
 const native=rpc(process.execPath,['-e',script]);try{assert.equal(await native.call('initialize'),'EXAMPLE-NATIVE')}finally{native.close()}
 t.diagnostic(JSON.stringify({bareShim:'ENOENT',absoluteCmd:'EINVAL',nativeExecutable:process.execPath,nativeResult:'EXAMPLE-NATIVE'}));
});
