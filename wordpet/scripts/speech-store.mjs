import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {pathToFileURL,fileURLToPath} from 'node:url';
export const VOICE='kokoro-v1.0-bf_emma-en-gb';
export const SAMPLE='I enjoy learning English. A little practice every day makes a difference.';
export const clean=text=>String(text||'').normalize('NFKC').replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim();
export const clipHash=text=>crypto.createHash('sha256').update(VOICE+'\n'+clean(text)).digest('hex');
export function pendingTexts(queue,index,existing){
  const texts=[...new Set([SAMPLE,...(queue.texts||[])].map(clean).filter(Boolean))];
  if(texts.length>5000||texts.some(t=>t.length>500))throw Error('Speech queue exceeds its bounds.');
  const clips={},items=[];
  for(const text of texts){
    const hash=clipHash(text),file=existing.find(f=>f.appProperties?.clipHash===hash&&Number(f.size)>500);
    const old=index.clips?.[text];
    if(file)clips[text]={id:file.id,hash,bytes:Number(file.size),voice:VOICE};
    else if(old?.hash===hash&&existing.some(f=>f.id===old.id))clips[text]=old;
    else items.push({text,hash});
  }
  return {clips,items,total:texts.length};
}
async function main(){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const config=JSON.parse(process.env.WORDPET_CONFIG_JSON||'{}');
 const secret=process.env.WORDPET_CLASPRC_JSON;
 if(!secret||!config.spreadsheetId)throw Error('Google publishing authorization is required.');
 const auth=JSON.parse(secret);
 const mask=value=>{if(value&&typeof value==='object')for(const [key,v] of Object.entries(value)){if(typeof v==='string'&&/token|secret/i.test(key)&&process.env.GITHUB_ACTIONS)console.log('::add-mask::'+v);else mask(v);}};mask(auth);
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'wordpet-speech-auth-'));
 const directory=process.env.WORDPET_SPEECH_WORKDIR;
 if(!directory||!path.isAbsolute(directory))throw Error('A private temporary speech directory is required.');
 await fs.mkdir(directory,{recursive:true});
 try{
  const authFile=path.join(temp,'.clasprc.json');await fs.writeFile(authFile,secret,{mode:0o600});
  const {initAuth}=await import(pathToFileURL(path.join(root,'node_modules/@google/clasp/build/src/auth/auth.js')));
  const {credentials}=await initAuth({authFilePath:authFile});
  const {google}=await import('googleapis');const drive=google.drive({version:'v3',auth:credentials});
  const tag=crypto.createHash('sha256').update(config.spreadsheetId).digest('hex').slice(0,24);
  const properties=kind=>({wordpet:'speech',database:tag,kind});
  const query=kind=>"trashed = false and appProperties has { key='wordpet' and value='speech' } and appProperties has { key='database' and value='"+tag+"' } and appProperties has { key='kind' and value='"+kind+"' }";
  async function list(kind){
   let files=[],pageToken;
   do{const r=await drive.files.list({q:query(kind),fields:'nextPageToken,files(id,name,size,md5Checksum,appProperties)',pageSize:1000,pageToken});files.push(...r.data.files);pageToken=r.data.nextPageToken;}while(pageToken);
   return files;
  }
  async function ensure(kind,name,mimeType,parent,initial){
   const found=(await list(kind))[0];if(found)return found;
   const r=await drive.files.create({requestBody:{name,mimeType,appProperties:properties(kind),...(parent?{parents:[parent]}:{})},...(initial?{media:{mimeType,body:Readable.from([JSON.stringify(initial)])}}:{}),fields:'id,name'});return r.data;
  }
  async function read(id){return (await drive.files.get({fileId:id,alt:'media'},{responseType:'json'})).data;}
  async function write(id,value){await drive.files.update({fileId:id,media:{mimeType:'application/json',body:Readable.from([JSON.stringify(value)])}});}
  const folder=await ensure('folder','WordPet — озвучка','application/vnd.google-apps.folder');
  const queueFile=await ensure('queue','WordPet — pronunciation queue.json','application/json',folder.id,{databaseId:config.spreadsheetId,texts:[SAMPLE]});
  const indexFile=await ensure('index','WordPet — pronunciation index.json','application/json',folder.id,{databaseId:config.spreadsheetId,voice:VOICE,clips:{}});
  if(process.argv[2]==='prepare'){
   const queue=await read(queueFile.id),index=await read(indexFile.id);
   if(queue.databaseId!==config.spreadsheetId||index.databaseId!==config.spreadsheetId)throw Error('Speech project mismatch.');
   const result=pendingTexts(queue,index,await list('clip'));
   await fs.writeFile(path.join(directory,'plan.json'),JSON.stringify({databaseId:config.spreadsheetId,folderId:folder.id,indexId:indexFile.id,index:{databaseId:config.spreadsheetId,voice:VOICE,clips:result.clips},items:result.items,total:result.total}),{mode:0o600});
   if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,'pending='+result.items.length+'\n');
   console.log('Speech preparation: '+result.items.length+' pending; '+Object.keys(result.clips).length+' cached.');
  }else if(process.argv[2]==='upload'){
   const plan=JSON.parse(await fs.readFile(path.join(directory,'plan.json'),'utf8'));
   if(plan.databaseId!==config.spreadsheetId)throw Error('Speech project mismatch.');
   for(let offset=0;offset<plan.items.length;offset+=4){
    await Promise.all(plan.items.slice(offset,offset+4).map(async item=>{
     const bytes=await fs.readFile(path.join(directory,item.hash+'.mp3'));
     if(bytes.length<500||bytes.length>500000)throw Error('Speech clip has an unexpected size.');
     const md5=crypto.createHash('md5').update(bytes).digest('hex');
     const r=await drive.files.create({requestBody:{name:item.hash+'.mp3',mimeType:'audio/mpeg',parents:[plan.folderId],appProperties:{...properties('clip'),clipHash:item.hash}},media:{mimeType:'audio/mpeg',body:Readable.from([bytes])},fields:'id,size,md5Checksum'});
     if(r.data.md5Checksum!==md5||Number(r.data.size)!==bytes.length)throw Error('Stored speech clip failed integrity verification.');
     plan.index.clips[item.text]={id:r.data.id,hash:item.hash,bytes:bytes.length,voice:VOICE};
    }));
    console.log('Verified uploaded clips: '+Math.min(offset+4,plan.items.length)+' / '+plan.items.length+'.');
   }
   plan.index.updatedAt=new Date().toISOString();await write(plan.indexId,plan.index);
   const check=await read(plan.indexId);
   if(JSON.stringify(check)!==JSON.stringify(plan.index))throw Error('Speech index verification failed.');
   console.log('Speech recordings ready: '+Object.keys(check.clips).length+'; bytes: '+Object.values(check.clips).reduce((n,c)=>n+c.bytes,0)+'.');
  }else throw Error('Unknown speech operation.');
 }finally{await fs.rm(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error('Speech storage operation failed. Private vocabulary and authorization were not logged. Status: '+(typeof error.code==='number'?error.code:'operation-error'));process.exitCode=1;});
