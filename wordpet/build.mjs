import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const root=path.dirname(fileURLToPath(import.meta.url));
const read=name=>fs.readFile(path.join(root,name),'utf8');
const config=process.env.WORDPET_CONFIG_JSON?JSON.parse(process.env.WORDPET_CONFIG_JSON):JSON.parse(await read('deployment.example.json'));
if(!/^[a-zA-Z0-9_-]+$/.test(config.spreadsheetId)||!/^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(config.webAppUrl)) throw Error('Invalid deployment configuration');
const core=await read('src/Core.js'),archive=await read('src/Archive.js'),speech=await read('src/Speech.js');
const artwork=(await read('src/fox-room.base64')).trim();
if(!/^[A-Za-z0-9+/=]+$/.test(artwork))throw Error('Invalid artwork');
const petArt={fox:`data:image/jpeg;base64,${artwork}`};
for(const id of ['cat','dog','dragon']){
  const encoded=(await read(`src/${id}-room.base64`)).trim();
  if(!/^[A-Za-z0-9+/=]+$/.test(encoded))throw Error('Invalid pet artwork: '+id);
  petArt[id]=`data:image/jpeg;base64,${encoded}`;
}
const pronunciation=await read('src/Pronunciation.js');
const html=(await read('src/App.html')).replace('/*__CORE__*/',()=>core).replace('/*__PRONUNCIATION__*/',()=>pronunciation).replace('/*__DEMO__*/','').replace('/*__PET_ART__*/',()=>JSON.stringify(petArt));
const server=(await read('src/Server.js')).replace('__DATABASE_ID__',()=>config.spreadsheetId).replace("webAppUrl: ''",()=>`webAppUrl: ${JSON.stringify(config.webAppUrl)}`);
const code=core.replace(/if \(typeof module[^\n]+\n?/,'')+'\n'+server+'\n'+archive+'\n'+speech+'\nconst WORD_EXAMPLES_ = '+JSON.stringify(JSON.parse(await read('src/examples.json')))+';\nconst APP_HTML_ = '+JSON.stringify(html)+';\n';
new vm.Script(code);
await fs.mkdir(path.join(root,'output'),{recursive:true});
await fs.writeFile(path.join(root,'output/Code.gs'),code);
await fs.writeFile(path.join(root,'output/App.html'),html);
await fs.writeFile(path.join(root,'output/appsscript.json'),JSON.stringify({timeZone:'Asia/Irkutsk',runtimeVersion:'V8',exceptionLogging:'STACKDRIVER',webapp:{access:'ANYONE_ANONYMOUS',executeAs:'USER_DEPLOYING'},oauthScopes:['https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/drive','https://www.googleapis.com/auth/script.scriptapp','https://www.googleapis.com/auth/userinfo.email']},null,2));
console.log('WordPet production build ready. Student data is read from the private Google spreadsheet.');
