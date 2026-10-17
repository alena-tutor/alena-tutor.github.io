const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wordpet-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const cli=path.join(root,'node_modules/@google/clasp/build/src');
 fs.mkdirSync(cli,{recursive:true});fs.mkdirSync(path.join(root,'scripts'));fs.mkdirSync(path.join(root,'output'));
 fs.copyFileSync(path.join(__dirname,'../scripts/deploy.mjs'),path.join(root,'scripts/deploy.mjs'));
 const config={scriptProjectId:'script-test',webAppUrl:'https://script.google.com/macros/s/DEPLOY_TEST/exec'};
 fs.writeFileSync(path.join(root,'deployment.json'),JSON.stringify(config));fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'1.2.0'}));
 fs.writeFileSync(path.join(root,'output/Code.gs'),'function doGet(){}');fs.writeFileSync(path.join(root,'output/appsscript.json'),'{}');
 fs.writeFileSync(path.join(cli,'index.js'),`const fs=require('fs'),path=require('path');
const args=process.argv.slice(2),command=args.find(a=>['list-deployments','pull','push','create-version','update-deployment'].includes(a));
const trace=process.env.WORDPET_TEST_TRACE,events=fs.existsSync(trace)?JSON.parse(fs.readFileSync(trace)):[];
events.push({command,mode:fs.statSync(args[args.indexOf('--auth')+1]).mode&511,files:fs.readdirSync(process.cwd())});fs.writeFileSync(trace,JSON.stringify(events));
if(command==='list-deployments') {const updated=events.some(e=>e.command==='update-deployment');console.log(JSON.stringify(process.env.WORDPET_TEST_MISSING?[]:[{deploymentId:'DEPLOY_TEST',versionNumber:updated&&!(process.env.WORDPET_TEST_STALE&&events.filter(e=>e.command==='list-deployments').length===2)?Number(process.env.WORDPET_TEST_TARGET||17):Number(process.env.WORDPET_TEST_BASE||4)}]));}
if(command==='pull'){
fs.writeFileSync('Code.js',process.env.WORDPET_TEST_CURRENT_MATCH||Number(args[args.indexOf('--versionNumber')+1])>=17?'function doGet(){}':'function oldCode(){}');
fs.writeFileSync('appsscript.json',process.env.WORDPET_TEST_OLD_MANIFEST&&Number(args[args.indexOf('--versionNumber')+1])<17?'{"webapp":{"access":"MYSELF"}}':'{}');
}
if(command==='update-deployment')console.log(JSON.stringify({versionNumber:Number(args[args.indexOf('--versionNumber')+1])}));
if(command==='create-version')console.log(JSON.stringify({versionNumber:17}));
if(command==='push'&&process.env.WORDPET_TEST_FAIL){console.error('example-token-must-not-leak');process.exit(1);}
`);
 const trace=path.join(root,'trace.json');
 const run=extra=>spawnSync(process.execPath,[path.join(root,'scripts/deploy.mjs')],{encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'',WORDPET_CLASPRC_JSON:JSON.stringify({tokens:{default:{refresh_token:'example-token-must-not-leak'}}}),WORDPET_TEST_TRACE:trace,WORDPET_CONFIG_JSON:JSON.stringify(config),...extra}});
 return {root,config,run,events:()=>fs.existsSync(trace)?JSON.parse(fs.readFileSync(trace)):[]};
}
test('publisher updates the existing URL, verifies the version, and isolates credentials and upload files',t=>{
 const f=fixture(t),r=f.run({});assert.equal(r.status,0,r.stderr);
 const events=f.events();assert.deepEqual(events.map(e=>e.command),['list-deployments','pull','push','create-version','update-deployment','list-deployments','pull']);
 assert.ok(events.every(e=>e.mode===0o600));
 const pushed=events.find(e=>e.command==='push');assert.ok(pushed.files.includes('Code.gs'));assert.equal(pushed.files.includes('App.html'),false);
 const receipt=JSON.parse(fs.readFileSync(path.join(f.root,'deploy-receipt.json')));assert.equal(receipt.url,f.config.webAppUrl);assert.equal(receipt.previousVersion,4);assert.equal(receipt.version,17);
 assert.equal(r.stdout.includes('example-token-must-not-leak'),false);assert.equal(r.stderr.includes('example-token-must-not-leak'),false);
});
test('missing authorization or unknown deployment cannot overwrite Google code',t=>{
 const f=fixture(t);assert.notEqual(f.run({WORDPET_CLASPRC_JSON:''}).status,0);assert.equal(f.events().length,0);
 assert.notEqual(f.run({WORDPET_TEST_MISSING:'1'}).status,0);assert.deepEqual(f.events().map(e=>e.command),['list-deployments']);
});
test('rollback selects an immutable Google version without uploading source',t=>{
 const f=fixture(t),r=f.run({WORDPET_ROLLBACK_VERSION:'4',WORDPET_TEST_TARGET:'4'});assert.equal(r.status,0,r.stderr);
 assert.deepEqual(f.events().map(e=>e.command),['list-deployments','update-deployment','list-deployments']);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'deploy-receipt.json'))).version,4);
});
test('failed source upload neither deploys nor exposes raw authentication errors',t=>{
 const f=fixture(t),r=f.run({WORDPET_TEST_FAIL:'1'});assert.notEqual(r.status,0);
 assert.deepEqual(f.events().map(e=>e.command),['list-deployments','pull','push']);assert.equal(fs.existsSync(path.join(f.root,'deploy-receipt.json')),false);
 assert.equal(r.stderr.includes('example-token-must-not-leak'),false);
});

test('publisher inspects the current immutable source and skips an already applied release',t=>{
 const f=fixture(t),r=f.run({WORDPET_TEST_BASE:'17',WORDPET_TEST_CURRENT_MATCH:'1'});assert.equal(r.status,0,r.stderr);
 assert.deepEqual(f.events().map(e=>e.command),['list-deployments','pull']);
 const receipt=JSON.parse(fs.readFileSync(path.join(f.root,'deploy-receipt.json')));assert.equal(receipt.reused,true);assert.equal(receipt.sourceVerified,true);assert.equal(receipt.version,17);
});

test('a stale deployment listing is rechecked without uploading or creating a second version',t=>{
 const f=fixture(t),r=f.run({WORDPET_TEST_STALE:'1'});assert.equal(r.status,0,r.stderr);
 assert.equal(f.events().filter(e=>e.command==='push').length,1);assert.equal(f.events().filter(e=>e.command==='create-version').length,1);assert.equal(f.events().filter(e=>e.command==='list-deployments').length,3);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'deploy-receipt.json'))).sourceVerified,true);
});

test('matching source with a changed manifest is published instead of incorrectly skipped',t=>{
 const f=fixture(t),r=f.run({WORDPET_TEST_BASE:'4',WORDPET_TEST_CURRENT_MATCH:'1',WORDPET_TEST_OLD_MANIFEST:'1'});
 assert.equal(r.status,0,r.stderr);assert.equal(f.events().filter(e=>e.command==='push').length,1);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'deploy-receipt.json'))).reused,false);
});
