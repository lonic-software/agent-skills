'use strict';
const path=require('node:path');
const fixture=require('./managed-n0b-config-shape.json');
// All values below are synthetic. Native value hashes are absent from fixture.
function synthesize(s) {
  if(s.type==='null')return null;
  if(s.type==='string')return 'EXAMPLE';
  if(s.type==='number')return 0;
  if(s.type==='boolean')return false;
  if(s.type==='array')return (s.items||[]).map(synthesize);
  if(s.type==='object')return Object.fromEntries((s.fields||[]).map(f=>[f.name,synthesize(f)]));
  throw Error('UNSUPPORTED_REPLAY_TYPE');
}
function layerName(name) {
  if(Object.hasOwn(name,'file'))return {...name,type:'user',file:path.resolve('EXAMPLE/config.toml')};
  if(Object.hasOwn(name,'dotCodexFolder'))return {...name,type:'project',dotCodexFolder:path.resolve('EXAMPLE/.codex')};
  return {...name,type:'sessionFlags'};
}
function replay() {
  const response=synthesize(fixture.shape);
  response.config.projects={[path.resolve("EXAMPLE").toLowerCase()]:{trust_level:"trusted"}};
  for(const layer of response.layers)layer.name=layerName(layer.name);
  for(const origin of Object.values(response.origins))origin.name=layerName(origin.name);
  return response;
}
function observedScopes(response){const r=[{scope:'effective',value:response.config},{scope:'effective.features',value:response.config.features}];response.layers.forEach((l,i)=>r.push({scope:'layer['+i+'].config',value:l.config},{scope:'layer['+i+'].features',value:l.config.features}));return r;}
module.exports={replay,fixture,observedScopes};
