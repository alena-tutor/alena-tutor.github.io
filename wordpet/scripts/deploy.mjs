import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.env.WORDPET_CONFIG_JSON)throw Error('Google project configuration is missing. Follow wordpet/SETUP.md.');
const config=JSON.parse(process.env.WORDPET_CONFIG_JSON);
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const credential=process.env.WORDPET_CLASPRC_JSON;
if(!credential)throw Error('Google authorization is missing. Follow wordpet/SETUP.md. No deployment was attempted.');
let parsed;
try {parsed=JSON.parse(credential);}catch {throw Error('Google authorization JSON is invalid. No deployment was attempted.');}
if(!parsed.tokens?.default?.refresh_token)throw Error('A clasp 3 Google refresh token is required. Run the WordPet setup again.');
function mask(value,key=''){
  if(typeof value==='object'&&value)Object.entries(value).forEach(([k,v])=>mask(v,k));
  else if(/token|secret/i.test(key)&&typeof value==='string'&&value)console.log('::add-mask::'+value.replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'));
}
if(process.env.GITHUB_ACTIONS)mask(parsed);
const deploymentId=new URL(config.webAppUrl).pathname.match(/^\/macros\/s\/([A-Za-z0-9_-]+)\/exec$/)?.[1];
if(!deploymentId||!/^[A-Za-z0-9_-]+$/.test(config.scriptProjectId))throw Error('Invalid Google project configuration.');
const rollback=process.env.WORDPET_ROLLBACK_VERSION||'';
if(rollback&&!/^[1-9][0-9]*$/.test(rollback))throw Error('Rollback version must be a positive integer.');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'wordpet-deploy-'));
const authPath=path.join(temp,'.clasprc.json'),uploadDirectory=path.join(temp,'upload'),inspectionDirectory=path.join(temp,'inspect');
const cli=path.join(root,'node_modules/@google/clasp/build/src/index.js');
function clasp(args,json=false,directory=uploadDirectory){
  const result=spawnSync(process.execPath,[cli,'--auth',authPath,'--project',path.join(directory,'.clasp.json'),...(json?['--json']:[]),...args],{cwd:directory,encoding:'utf8',timeout:180000,env:{...process.env,WORDPET_CLASPRC_JSON:'',WORDPET_CONFIG_JSON:''}});
  if(result.status!==0){
    // The OAuth response may contain credentials. Only return a fixed diagnosis.
    if(/401|invalid_grant|invalid credentials|invalid authentication|not logged in/i.test(result.stderr+result.stdout))throw Error('Google authorization expired or was revoked. Reconnect using WordPet setup.');
    if(/403|permission|disabled|not enabled/i.test(result.stderr+result.stdout))throw Error('Google refused access. Enable Apps Script API and connect the account that owns WordPet.');
    throw Error('clasp '+args[0]+' failed. Deployment state must be checked before retrying.');
  }
  if(json){try{return JSON.parse(result.stdout);}catch {throw Error('Unexpected clasp response. Check deployment state before retrying.');}}
}
const normalizeSource=text=>text.replace(/\r\n/g,'\n').trimEnd();
const canonical=value=>Array.isArray(value)?value.map(canonical).sort():value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const expectedManifest=JSON.parse(await fs.readFile(path.join(root,'output/appsscript.json'),'utf8'));

async function matchesPublishedSource(version,expected){
  await fs.rm(inspectionDirectory,{recursive:true,force:true});
  await fs.mkdir(inspectionDirectory);
  await fs.writeFile(path.join(inspectionDirectory,'.clasp.json'),JSON.stringify({scriptId:config.scriptProjectId,rootDir:'.'}));
  clasp(['pull','--versionNumber',String(version)],false,inspectionDirectory);
  for(const name of ['Code.js','Code.gs']){
    try {
      const code=await fs.readFile(path.join(inspectionDirectory,name),'utf8');
      if(normalizeSource(code)!==normalizeSource(expected))return false;
      const manifest=JSON.parse(await fs.readFile(path.join(inspectionDirectory,'appsscript.json'),'utf8'));
      return JSON.stringify(canonical(manifest))===JSON.stringify(canonical(expectedManifest));
    }
    catch(e){if(e.code!=='ENOENT')throw e;}
  }
  throw Error('Google did not return the deployed Code file. No new upload was attempted.');
}
try{
  await fs.writeFile(authPath,credential,{mode:0o600});
  await fs.mkdir(uploadDirectory);
  await fs.writeFile(path.join(uploadDirectory,'.clasp.json'),JSON.stringify({scriptId:config.scriptProjectId,rootDir:'.'}));
  const before=clasp(['list-deployments'],true).find(d=>d.deploymentId===deploymentId);
  if(!before?.versionNumber)throw Error('The existing published deployment was not found. No code was changed.');
  console.log('Current Google deployment version: '+Number(before.versionNumber));
  let version;
  const commit=process.env.GITHUB_SHA?.slice(0,12)||'local';
  const expected=rollback?'':await fs.readFile(path.join(root,'output/Code.gs'),'utf8');
  const alreadyPublished=!rollback&&await matchesPublishedSource(before.versionNumber,expected);
  if(alreadyPublished){version=Number(before.versionNumber);console.log('Published source already matches this build; no upload or redeployment was needed.');}
  else if(rollback)version=Number(rollback);
  else{
    for(const name of ['Code.gs','appsscript.json'])await fs.copyFile(path.join(root,'output',name),path.join(uploadDirectory,name));
    clasp(['push','--force']);
    const created=clasp(['create-version',`WordPet ${pkg.version} · ${commit}`],true);
    version=Number(created.versionNumber);
    if(!version)throw Error('Google did not return a new immutable version. Published deployment was not changed.');
  }
  if(!alreadyPublished){
    // Update the existing deployment; pupil links and the private spreadsheet stay in place.
    const acknowledged=clasp(['update-deployment',deploymentId,'--versionNumber',String(version),'--description',`WordPet ${rollback?'rollback':pkg.version} · ${commit}`],true);
    if(Number(acknowledged.versionNumber)!==version)throw Error('Google acknowledged a different version. Inspect the deployment before another attempt.');
    let verified=false;
    for(let attempt=0;attempt<5;attempt++){
      if(attempt)await new Promise(resolve=>setTimeout(resolve,1500));
      const after=clasp(['list-deployments'],true).find(d=>d.deploymentId===deploymentId);
      console.log('Observed Google deployment version: '+Number(after?.versionNumber||0));
      if(Number(after?.versionNumber)===version){verified=true;break;}
    }
    if(!verified)throw Error('Publication was not verified. Inspect the Google deployment before another attempt.');
    if(!rollback&&!await matchesPublishedSource(version,expected))throw Error('The deployed source does not match the compiled application. Inspect the deployment before another attempt.');
  }
  const receipt={previousVersion:before.versionNumber,version,commit,url:config.webAppUrl,sourceVerified:!rollback,reused:alreadyPublished,verifiedAt:new Date().toISOString()};
  await fs.writeFile(path.join(root,'deploy-receipt.json'),JSON.stringify(receipt,null,2));
  console.log(`Verified Google deployment version ${version}; previous version ${before.versionNumber}.`);
  if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,`\nPublished WordPet${rollback?' (rollback)':' '+pkg.version}. Google version: ${version}. Previous Google version: ${before.versionNumber}.\n\n${config.webAppUrl}\n`);
}finally{await fs.rm(temp,{recursive:true,force:true});}
