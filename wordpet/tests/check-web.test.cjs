const test=require('node:test');
const assert=require('node:assert/strict');
const url='https://script.google.com/macros/s/TEST_DEPLOYMENT/exec';
const load=()=>import('../scripts/check-web.mjs');
test('public page check follows the web app redirect without a personal access key',async()=>{
 const {verifyWebApp}=await load();let requested;
 const result=await verifyWebApp(url,{fetchPage:async(u,options)=>{requested={u,options};return {ok:true,status:200,url:'https://script.googleusercontent.com/macros/echo?x=test',text:async()=>'<title>WordPet — слова и питомец</title>'};}});
 assert.equal(result.status,200);assert.equal(requested.u,url);assert.equal(requested.options.redirect,'follow');
});
test('Google file error, login pages and unrelated success pages cannot pass deployment verification',async()=>{
 const {verifyWebApp}=await load();
 for(const page of [{ok:false,status:404,url,text:async()=>'Page Not Found'},{ok:true,status:200,url:'https://accounts.google.com/login',text:async()=>'WordPet login'},{ok:true,status:200,url,text:async()=>'Google Drive'}]){
  await assert.rejects(verifyWebApp(url,{attempts:1,fetchPage:async()=>page}),/did not open/);
 }
 await assert.rejects(verifyWebApp(url+'#key=secret',{attempts:1}),/without personal keys/);
});
test('public verification retries transient errors and succeeds after the deployment appears',async()=>{
 const {verifyWebApp}=await load();let calls=0,pauses=0;
 await verifyWebApp(url,{pause:async()=>pauses++,fetchPage:async()=>{if(++calls===1)throw Error('Temporary');return {ok:true,status:200,url,text:async()=>'WordPet'};}});
 assert.equal(calls,2);assert.equal(pauses,1);
});
