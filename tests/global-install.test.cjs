'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const {plan,apply}=require('../bin/install-codex.cjs'),{savePlan,transact}=require('../bin/manage-codex.cjs'),resolve=require('../codex/runtime/resolve-installation.cjs');
const repo=path.resolve(__dirname,'..');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'lonic-global-')),project=path.join(root,'project space'),home=path.join(root,'codex-home'),source=path.join(root,'source');for(const p of [project,home,source])fs.mkdirSync(p);t.after(()=>{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});return {root,project,home,source};}
function put(p,s){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);}
function source(f){put(path.join(f.source,'codex/manifest.json'),JSON.stringify({schema:1,selections:{sample:{skills:['sample'],agents:['lonic-sample']}},blocked:{}}));put(path.join(f.source,'codex/skills/sample/SKILL.md'),'EXAMPLE original');put(path.join(f.source,'codex/agents/lonic-sample.toml'),'EXAMPLE agent');}
test('global CLI default previews, installs once and serves a second project without project writes',t=>{
 const f=fixture(t),args=[path.join(repo,'bin/install-codex.cjs'),'--skill','core-preview','--project',f.project,'--codex-home',f.home];
 const env={...process.env,CODEX_HOME:f.home,HOME:f.root,USERPROFILE:f.root};
 const run=extra=>spawnSync(process.execPath,[...args,...extra],{env,encoding:'utf8'});
 const preview=run([]);assert.equal(preview.status,0,preview.stderr);assert.equal(JSON.parse(preview.stdout).scope,'global');assert.deepEqual(fs.readdirSync(f.home),[]);
 for(const expected of [12,0]){const r=run(['--apply']);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,new RegExp('Created '+expected+' files'));}
 const other=path.join(f.root,'other-project');fs.mkdirSync(other);assert.equal(resolve.skill(other,'consult',f.home),path.join(f.home,'skills/consult/SKILL.md'));
 assert.ok(fs.existsSync(path.join(f.home,'agents/lonic-advisor-low.toml')));assert.deepEqual(fs.readdirSync(f.project),[]);assert.equal(fs.existsSync(path.join(f.home,'config.toml')),false);
});
test('cross-scope collision requires a decision, including a collision appearing after preview',t=>{
 const f=fixture(t);source(f);apply(plan(f.source,f.project,'sample',{scope:'global',codexHome:f.home}));
 const p=plan(f.source,f.project,'sample',{scope:'project',codexHome:f.home});assert.equal(p.duplicates.length,1);assert.throws(()=>apply(p),/Cross-scope/);assert.deepEqual(fs.readdirSync(f.project),[]);
 apply(plan(f.source,f.project,'sample',{scope:'project',codexHome:f.home,onDuplicate:'keep-both'}));
 const bytes=fs.readFileSync(path.join(f.home,'skills/sample/SKILL.md'));assert.equal(bytes.toString(),'EXAMPLE original');assert.equal(resolve.skill(f.project,'sample',f.home),path.join(f.project,'.agents/skills/sample/SKILL.md'));
 const g=fixture(t);source(g);const delayed=plan(g.source,g.project,'sample',{scope:'global',codexHome:g.home});put(path.join(g.project,'.agents/skills/sample/SKILL.md'),'EXAMPLE opposite');assert.throws(()=>apply(delayed),/Cross-scope/);assert.deepEqual(fs.readdirSync(g.home),[]);
});
for(const scope of ['global','project'])test(scope+' update/removal use hashed plans and rollback, preserving operator configuration',t=>{
 const f=fixture(t);source(f);const options={scope,codexHome:f.home};const p=plan(f.source,f.project,'sample',options);apply(p);assert.equal(apply(plan(f.source,f.project,'sample',options)),0);
 const target=p.files.find(x=>x.relative.endsWith('SKILL.md')).target,configuration=path.join(p.project,...(scope==='global'?['lonic']:['.codex','lonic']),'runtime-config.json');put(configuration,'EXAMPLE operator-owned');
 put(path.join(f.source,'codex/skills/sample/SKILL.md'),'EXAMPLE updated');const update=path.join(f.root,'update.json'),u=savePlan(f.source,f.project,'sample',update,options);assert.equal(fs.readFileSync(target,'utf8'),'EXAMPLE original');assert.throws(()=>transact(update,'0'.repeat(64)),/digest/);transact(update,u.sha256);assert.equal(fs.readFileSync(target,'utf8'),'EXAMPLE updated');transact(update,u.sha256,{rollback:true});assert.equal(fs.readFileSync(target,'utf8'),'EXAMPLE original');
 put(path.join(f.source,'codex/skills/sample/SKILL.md'),'EXAMPLE original');const removal=path.join(f.root,'remove.json'),r=savePlan(f.source,f.project,'sample',removal,{...options,remove:true});transact(removal,r.sha256);assert.equal(fs.existsSync(target),false);assert.equal(fs.readFileSync(configuration,'utf8'),'EXAMPLE operator-owned');transact(removal,r.sha256,{rollback:true});assert.equal(fs.readFileSync(target,'utf8'),'EXAMPLE original');
 put(target,'EXAMPLE edit');assert.throws(()=>savePlan(f.source,f.project,'sample',path.join(f.root,'refuse.json'),{...options,remove:true}),/edited files/);
});
test('runtime and configuration lookup prefer project, merge top-level overrides, and fail on invalid project data',t=>{
 const f=fixture(t);put(path.join(f.home,'lonic/runtime/queue.cjs'),'EXAMPLE global');put(path.join(f.home,'lonic/runtime/evidence.cjs'),'EXAMPLE global');put(path.join(f.home,'lonic/runtime-config.json'),JSON.stringify({schema:1,model:'EXAMPLE-global',codex:'EXAMPLE',allowedCommands:[['EXAMPLE-global']]}));
 assert.equal(resolve.runtime(f.project,'queue',f.home),path.join(f.home,'lonic/runtime/queue.cjs'));assert.equal(resolve.config(f.project,f.home).model,'EXAMPLE-global');
 const entry=path.join(f.project,'.codex/lonic/runtime/queue.cjs'),config=path.join(f.project,'.codex/lonic/runtime-config.json');put(entry,'EXAMPLE project');put(config,JSON.stringify({model:'EXAMPLE-project',allowedCommands:[]}));assert.equal(resolve.runtime(f.project,'queue',f.home),entry);assert.equal(resolve.config(f.project,f.home).codex,'EXAMPLE');assert.equal(resolve.config(f.project,f.home).model,'EXAMPLE-project');assert.deepEqual(resolve.config(f.project,f.home).allowedCommands,[]);
 put(config,'{');assert.throws(()=>resolve.config(f.project,f.home));assert.throws(()=>resolve.runtime(f.project,'invalid',f.home));
});
test('global hook-only selection refuses and all runtime packaging leaves actual configuration untouched',t=>{
 const f=fixture(t);assert.throws(()=>plan(repo,f.project,'test-filter-hook',{scope:'global',codexHome:f.home}),/project-only/);
 put(path.join(f.home,'config.toml'),'EXAMPLE private config');put(path.join(f.home,'lonic/runtime-config.json'),'EXAMPLE operator config');apply(plan(repo,f.project,'powerup-auto',{scope:'global',codexHome:f.home}));
 assert.equal(fs.readFileSync(path.join(f.home,'config.toml'),'utf8'),'EXAMPLE private config');assert.equal(fs.readFileSync(path.join(f.home,'lonic/runtime-config.json'),'utf8'),'EXAMPLE operator config');assert.ok(fs.existsSync(path.join(f.home,'lonic/runtime-config.example.json')));assert.equal(fs.existsSync(path.join(f.home,'hooks.json')),false);
});
test('managed inventory accepts stable user skills but preserves SKILL_PIN, COVERAGE, METADATA and loaded-skill refusal',async t=>{
 const f=fixture(t),{createInventory}=require('../codex/runtime/managed-inventory.cjs'),{BUILTIN_CONTEXT_KEYS}=require('../codex/runtime/managed-instruction-config.cjs');
 const globalSkill={path:path.join(f.home,'skills/powerup/SKILL.md'),name:'powerup',description:'EXAMPLE global',scope:'user',enabled:true};let rows=[globalSkill],wrongCwd=false;
 const reader={async call(method){if(method==='config/read')return {config:{projects:{[f.project.toLowerCase()]:{trust_level:'trusted'}},...Object.fromEntries(BUILTIN_CONTEXT_KEYS.map(k=>[k,false])),features:{plugins:false,hooks:false,apps:false}},origins:{},layers:[{name:{type:'sessionFlags'},config:{},version:'1'}]};return {data:[{cwd:wrongCwd&&method==='skills/list'?f.root:f.project,errors:[],warnings:[],hooks:[],skills:rows}]};}};
 const inv=createInventory({project:f.project,profile:f.home,baseInstructions:'EXAMPLE',developerInstructions:'EXAMPLE'});await inv.cwd(reader);await inv.cwd(reader);assert.deepEqual(inv.disabledSkills(),[globalSkill.path]);
 rows=[{...globalSkill,path:path.join(f.home,'skills/other/SKILL.md')}];await assert.rejects(inv.cwd(reader),e=>e.rule==='SKILL_PIN'||e.ruleId==='SKILL_PIN'||/SKILL_PIN/.test(e.message));
 rows=[{...globalSkill,scope:'unknown'}];await assert.rejects(inv.cwd(reader),/SKILL_METADATA/);rows=[globalSkill];wrongCwd=true;await assert.rejects(inv.cwd(reader),/SKILL_COVERAGE/);wrongCwd=false;
 const response={cwd:f.project,thread:{id:'EXAMPLE'},instructionSources:[]};await assert.rejects(inv.thread(reader,response),/LOADED_SKILLS/);rows=[{...globalSkill,enabled:false}];await inv.thread(reader,response);
});
