const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const root=path.resolve(__dirname,'..');
const core=require('../src/Core.js');
const seed=require('./fixtures/seed.cjs');
const source=JSON.parse(fs.readFileSync(root+'/tests/fixtures/source.json','utf8'));
const examples=JSON.parse(fs.readFileSync(root+'/src/examples.json','utf8'));
const keys={teacher:'a'.repeat(64),learner_b:'b'.repeat(64),learner_a:'c'.repeat(64),empty_learner:'d'.repeat(64)};
function backend(){
 const data=new Map(),files=new Map(),properties=new Map();
 let activeEmail='owner@example.test',failNextSessionWrite=false,failDelete='',failFile=false;
 const range=(name,row,col,nr,nc)=>({
  getValues:()=>Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>data.get(name)?.[row-1+i]?.[col-1+j]??'')),
  setValues:values=>{if(name==='Тренировки'&&failNextSessionWrite){failNextSessionWrite=false;throw Error('SIMULATED_WRITE_FAILURE');}const rows=data.get(name)||[];values.forEach((v,i)=>{rows[row-1+i]??=[];v.forEach((val,j)=>rows[row-1+i][col-1+j]=val);});data.set(name,rows);}
 });
 const sheet=name=>({getLastRow:()=>data.get(name)?.length||0,getLastColumn:()=>data.get(name)?.[0]?.length||0,getRange:(r,c,nr,nc)=>range(name,r,c,nr,nc),setFrozenRows(){},deleteRows:(start,count)=>{if(failDelete===name){failDelete='';throw Error('SIMULATED_DELETE_FAILURE');}data.get(name).splice(start-1,count);}});
 const db={getSheetByName:name=>data.has(name)?sheet(name):null,getOwner:()=>({getEmail:()=> 'owner@example.test'}),setSpreadsheetTimeZone(){},insertSheet:name=>{data.set(name,[]);return sheet(name);}};
 const sourceDb=id=>{const s=source.find(s=>s.id===id);if(!s)throw Error('Source not found');return {getSheetByName:name=>name===s.sheet?{getLastRow:()=>s.rows.length,getLastColumn:()=>5,getRange:()=>({getValues:()=>s.rows.map(r=>Array.from({length:5},(_,i)=>r[i]??''))})}:null};};
 const blob=(bytes,mime,name)=>{const buffer=typeof bytes==='string'?Buffer.from(bytes):Buffer.from(bytes);return {getBytes:()=>Array.from(buffer),getDataAsString:()=>buffer.toString('utf8'),getContentType:()=>mime,mime,name};};
 const folder=id=>({getId:()=>id,createFolder:()=>folder(crypto.randomUUID()),createFile:b=>{if(failFile){failFile=false;throw Error('SIMULATED_DRIVE_FAILURE');}const id=crypto.randomUUID();files.set(id,b);return {getId:()=>id};}});
 const context=vm.createContext({console,Date,JSON,Math,Error,Set,Map,Array,String,Number,Boolean,Object,RegExp,
  SpreadsheetApp:{openById:id=>id==='__DATABASE_ID__'?db:sourceDb(id)},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k),setProperty:(k,v)=>properties.set(k,v)})},
  Session:{getActiveUser:()=>({getEmail:()=>activeEmail})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
  Utilities:{getUuid:()=>crypto.randomUUID(),formatDate:()=> '2026-10-16',base64Decode:s=>Array.from(Buffer.from(s,'base64')),base64Encode:b=>Buffer.from(b).toString('base64'),newBlob:blob,DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(algo,text)=>Array.from(crypto.createHash('sha256').update(text).digest()),gzip:b=>blob(zlib.gzipSync(Buffer.from(b.getBytes()))),ungzip:b=>blob(zlib.gunzipSync(Buffer.from(b.getBytes())))},
  DriveApp:{createFolder:()=>folder('new-folder'),getFolderById:folder,getFileById:id=>({getId:()=>id,getBlob:()=>files.get(id),setContent:text=>files.set(id,blob(text,'application/json',id))}),getFilesByName:()=>({hasNext:()=>false})},
  ScriptApp:{getService:()=>({getUrl:()=> 'https://script.google.com/macros/s/TEST/exec'}),getProjectTriggers:()=>[{getHandlerFunction:()=> 'syncScheduled_'}]},
  HtmlService:{createHtmlOutput:()=>({setTitle(){return this;},addMetaTag(){return this;}})}
 });
 vm.runInContext(fs.readFileSync(root+'/src/Core.js','utf8')+'\n'+fs.readFileSync(root+'/src/Server.js','utf8')+'\n'+fs.readFileSync(root+'/src/Archive.js','utf8')+'\n'+fs.readFileSync(root+'/src/Speech.js','utf8')+'\nconst WORD_EXAMPLES_='+JSON.stringify(examples)+';',context);
 const schema=JSON.parse(vm.runInContext('JSON.stringify(SCHEMA)',context));
 Object.entries(schema).forEach(([name,headers])=>data.set(name,[headers]));
 const insert=(name,obj)=>data.get(name).push(schema[name].map(k=>obj[k]??''));
 seed.students.forEach(s=>insert('Ученики',s));seed.words.forEach(w=>insert('Слова',w));
 seed.students.forEach(s=>insert('Питомцы',{studentId:s.id,name:'Рыжик',species:'fox',xp:0,food:65,clean:75,coins:0,rations:1,lastDecay:'2026-10-16',lastRewardDay:'',lastBonusDay:'',accessory:'none'}));
 Object.entries(keys).forEach(([id,key])=>insert('Доступ',{personId:id==='teacher'?'alena':id,role:id==='teacher'?'teacher':'student',token:key,link:'https://example.test/#key='+key}));
 properties.set('RECORDINGS_FOLDER','audio-folder');
 const api=(who,action,args={})=>context.api({key:keys[who]||who,action,data:args});
 const records=name=>data.get(name).slice(1).map(r=>Object.fromEntries(schema[name].map((k,i)=>[k,r[i]])));
 const tasks=sessionId=>JSON.parse(records('Тренировки').find(s=>s.id===sessionId).payload).tasks;
 return {api,records,tasks,files,data,context,properties,failDelete:name=>failDelete=name,failFile:()=>failFile=true,failSessionWrite:()=>failNextSessionWrite=true,setActiveEmail:e=>activeEmail=e};
}
function finish(b,student,{wrong=0,retry=false}={}){
 let session=b.api(student,'start',{retry});let latest,original=0,guard=0;
 while(session.status!=='completed'){
  assert.ok(++guard<100,'mission must finish when review answers are correct');
  const t=b.tasks(session.id)[session.index];const input={sessionId:session.id,taskId:t.id};
  {input.answer=!t.isReview&&original++<wrong?'definitely incorrect':t.kind==='choose'?t.russian:t.answers[0];}
  latest=b.api(student,'answer',input);session=latest.session;
 }
 return latest;
}
test('parses synthetic glossaries, deduplicates and identifies difficulties',()=>{
 assert.equal(seed.words.length,21);assert.equal(seed.words.filter(w=>w.studentId==='learner_a').length,10);
 assert.equal(seed.words.filter(w=>w.studentId==='learner_b').length,11);
 assert.equal(seed.words.filter(w=>w.studentId==='empty_learner').length,0);
 assert.equal(seed.words.find(w=>w.id==='learner_b:opinion').hardOn,'2026-10-03');
 assert.equal(seed.words.find(w=>w.id==='learner_b:advice').hardOn,'2026-10-03');
 assert.equal(seed.words.filter(w=>w.studentId==='learner_a'&&w.hardOn==='2026-10-16').length,7);
});
test('round always includes available old, recent and hard words',()=>{
 const words=[{id:'a',english:'a',russian:'a',hardOn:'2026-10-16',lessonOn:'2026-10-16'},
  {id:'b',english:'b',russian:'b',lessonOn:'2026-10-16'},
  {id:'c',english:'c',russian:'c',lessonOn:'2026-09-01'}];
 const selection=core.selectWords(words,[],'2026-10-16',3,()=>.5);
 assert.deepEqual(new Set(selection.map(w=>core.category(w,[],'2026-10-16'))),new Set(['hard','recent','review']));
});
test('typed answers accept curated variants, punctuation and apostrophe forms',()=>{
 const ws=seed.words.filter(w=>w.studentId==='learner_a');
 const tasks=core.makeTasks(ws,ws,[],'2026-10-16',()=>.5);
 const word=seed.words.find(w=>w.english==="can't stand");
 assert.equal(core.grade({kind:'write_en',answers:["can't stand",'cannot stand']},'CAN’T STAND.'),true);
 assert.equal(core.grade({kind:'write_ru',answers:['иногда','изредка']},'изредка'),true);
 assert.equal(core.grade({kind:'sentence'},'Any valid sentence'),null);
 assert.equal(tasks.length,10);assert.equal(tasks.some(t=>['sentence','voice'].includes(t.kind)),false);
 assert.ok(word.example);
});
test('public tasks hide expected answers and use genuine authored gaps',()=>{
 const ws=seed.words.filter(w=>w.studentId==='learner_b');const ts=core.makeTasks(ws,ws,[],'2026-10-16',()=>.5);
 const gaps=ts.filter(t=>['gap','gap_choice'].includes(t.kind));assert.ok(gaps.length);gaps.forEach(t=>assert.match(t.prompt,/______/));
 ts.forEach(t=>assert.equal(Object.hasOwn(core.publicTask(t),'answers'),false));
 const write=ts.find(t=>t.kind==='write_en');assert.equal(Object.hasOwn(core.publicTask(write),'english'),false);
});
test('translation choices exclude distractors with equivalent meanings',()=>{
 const ws=seed.words.filter(w=>w.studentId==='learner_b');const target=ws.find(w=>w.english==='occasionally');
 const ts=core.makeTasks([target],ws,[],'2026-10-16',()=>.5);const choose=ts.find(t=>t.kind==='choose');
 assert.ok(choose.options.includes(target.russian));assert.equal(choose.options.includes('время от времени'),false);
});
test('spaced progress schedules 1, 3, 7 days; failure resets streak',()=>{
 let p=core.updateProgress(null,{wordId:'a',kind:'write_en'},true,'2026-10-16T09:00:00Z','2026-10-16');assert.equal(p.nextReview,'2026-10-17');
 p=core.updateProgress(p,{wordId:'a',kind:'write_en'},true,'2026-10-17T09:00:00Z','2026-10-17');assert.equal(p.nextReview,'2026-10-20');
 p=core.updateProgress(p,{wordId:'a',kind:'write_en'},false,'2026-10-20T09:00:00Z','2026-10-20');assert.equal(p.streak,0);assert.equal(p.nextReview,'2026-10-20');
});
test('invalid access and owner-only setup are rejected',()=>{
 const b=backend();assert.throws(()=>b.api('bad','bootstrap'),/личную ссылку/);assert.throws(()=>b.api('e'.repeat(64),'bootstrap'),/не найден/);
 b.setActiveEmail('');assert.throws(()=>b.context.setupWordPet(),/владельцу/);
 assert.throws(()=>b.api('learner_b','review',{answerId:'x',correct:true}),/недоступно/);
});
test('student bootstrap excludes other pupils, source IDs, tokens and teacher tools',()=>{
 const b=backend(),s=b.api('learner_b','bootstrap'),text=JSON.stringify(s);
 assert.ok(s.words.length);assert.ok(s.words.every(w=>w.id.startsWith('learner_b:')));
 assert.equal(text.includes('Ученик А'),false);assert.equal(text.includes(keys.teacher),false);
 assert.equal(text.includes('sourceId'),false);assert.equal(s.role,'student');
 assert.throws(()=>b.api('empty_learner','start'),/пока нет слов/);
});
test('saved mission resumes and one pupil cannot answer another pupil’s session',()=>{
 const b=backend(),s=b.api('learner_b','start'),again=b.api('learner_b','start');assert.equal(s.id,again.id);
 const t=b.tasks(s.id)[0];assert.throws(()=>b.api('learner_a','answer',{sessionId:s.id,taskId:t.id,answer:'x'}),/не найдена/);
 assert.throws(()=>b.api('learner_b','answer',{sessionId:s.id,taskId:'t500',answer:'x'}),/Порядок/);
});
test('ten automatic answers give the 90 percent bonus once without files or review work',()=>{
 const b=backend(),result=finish(b,'learner_b',{wrong:1});
 assert.equal(result.session.status,'completed');assert.equal(result.session.summary.score,90);
 assert.equal(result.session.summary.pending,0);assert.equal(result.session.summary.rations,2);assert.equal(result.pet.coins,10);
 assert.equal(b.files.size,0);assert.equal(b.records('Ответы').length,0);
 const s=b.api('learner_b','start');assert.equal(s.id,result.session.id);assert.equal(s.status,'completed');
 const before=result.pet.xp;const duplicate=b.api('learner_b','answer',{sessionId:s.id,taskId:b.tasks(s.id).at(-1).id,audio:'eA==',mime:'audio/webm'});
 assert.equal(duplicate.pet.xp,before);assert.equal(b.files.size,0);
 const retry=finish(b,'learner_b',{retry:true});assert.equal(retry.session.summary.xp,0);assert.equal(retry.pet.coins,10);assert.equal(retry.pet.xp,before);
});
test('a later retry can earn 90 percent bonus once without extra base rewards',()=>{
 const b=backend(),first=finish(b,'learner_a',{wrong:3});assert.equal(first.session.summary.score,70);assert.equal(first.pet.coins,0);assert.equal(first.session.summary.rations,1);
 const retry=finish(b,'learner_a',{retry:true});assert.equal(retry.session.summary.score,100);assert.equal(retry.session.summary.rations,1);assert.equal(retry.session.summary.xp,20);assert.equal(retry.pet.coins,10);
});
test('same answer after interrupted session write does not count twice',()=>{
 const b=backend(),s=b.api('learner_b','start'),t=b.tasks(s.id)[0],answer=t.kind==='choose'?t.russian:t.answers[0];
 b.failSessionWrite();assert.throws(()=>b.api('learner_b','answer',{sessionId:s.id,taskId:t.id,answer}),/SIMULATED/);
 b.api('learner_b','answer',{sessionId:s.id,taskId:t.id,answer});
 assert.equal(b.records('Прогресс').find(p=>p.wordId===t.wordId&&p.skill===t.kind).correct,1);
});
test('historical recordings stay accessible to their owner and can still receive feedback',()=>{
 const b=backend();
 const add=(name,obj)=>b.data.get(name).push(b.data.get(name)[0].map(k=>obj[k]??''));
 b.files.set('old-audio',{getBytes:()=>[1,2,3]});
 for(const kind of ['voice','sentence'])add('Ответы',{id:'legacy-'+kind,sessionId:'legacy',studentId:'learner_b',wordId:'learner_b:occasionally',kind,submittedAt:'2026-10-15',status:'pending',audioId:kind==='voice'?'old-audio':'',mime:'audio/webm',text:'I occasionally walk.'});
 const teacher=b.api('teacher','bootstrap');assert.equal(teacher.pending.length,2);
 const a=teacher.pending.find(a=>a.kind==='voice');const recording=b.api('teacher','audio',{answerId:a.id});assert.equal(recording.mime,'audio/webm');assert.ok(recording.audio);
 b.api('teacher','review',{answerId:a.id,correct:true,feedback:'Хорошее предложение. Обрати внимание на ударение.'});
 assert.equal(b.api('learner_b','bootstrap').reviews.length,1);assert.equal(b.api('learner_b','bootstrap').stats.pending,1);
 assert.throws(()=>b.api('teacher','review',{answerId:a.id,correct:true}),/уже проверен/);
 assert.throws(()=>b.api('learner_a','myAudio',{answerId:a.id}),/недоступна/);
});
test('teacher hard marks and glossary sync preserve authored fields and source files',()=>{
 const b=backend(),before=JSON.stringify(source),w=b.records('Слова').find(w=>w.id==='learner_b:frequently');
 b.api('teacher','addWord',{studentId:'learner_b',english:w.english,russian:w.russian,example:'I frequently read comics.',answers:'frequently',russianAliases:'часто|нередко',hard:true});
 b.api('teacher','sync');const after=b.records('Слова').find(w=>w.id===w.id&&w.english==='frequently');
 assert.equal(after.example,'I frequently read comics.');assert.equal(after.hardOn,'2026-10-16');assert.equal(JSON.stringify(source),before);
 assert.ok(b.api('learner_b','bootstrap').words.find(w=>w.english==='frequently').category==='hard');
});
test('rotating a learner link invalidates old key without affecting others',()=>{
 const b=backend(),rot=b.api('teacher','rotateKey',{studentId:'learner_b'});assert.match(rot.link,/#key=/);
 assert.throws(()=>b.api('learner_b','bootstrap'),/не найден/);assert.equal(b.api('learner_a','bootstrap').name,'Ученик А');
});
test('production HTML and Apps Script compile without demo data',()=>{
 const html=fs.readFileSync(root+'/output/App.html','utf8');const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.equal(scripts.length,1);new vm.Script(scripts[0][1]);
 const code=fs.readFileSync(root+'/output/Code.gs','utf8');new vm.Script(code);
 assert.equal(code.includes('const DemoStore'),false);assert.equal(code.includes('demo-teacher'),false);
 assert.match(code,/version: '1.7.0'/);
 assert.match(code,/archiveScheduled_/);
});

test('personal links use the published deployment and never convert a dev identifier into exec',()=>{
 const b=backend();
 b.context.ScriptApp.getService=()=>({getUrl:()=> 'https://script.google.com/macros/s/DEV_ID/dev'});
 assert.match(b.context.refreshStudentLinks(),/URL опубликованного/);
 vm.runInContext("APP_CONFIG.webAppUrl='https://script.google.com/macros/s/REAL_PUBLISHED_ID/exec'",b.context);
 b.context.refreshStudentLinks();
 b.records('Доступ').forEach(a=>assert.equal(a.link,'https://script.google.com/macros/s/REAL_PUBLISHED_ID/exec#key='+a.token));
});

test('preview shows exactly the selected words and survives legacy sessions without a stored list',()=>{
 const b=backend(),s=b.api('learner_b','start'),ids=new Set(b.tasks(s.id).map(t=>t.wordId));
 assert.equal(s.studyWords.length,ids.size);
 assert.deepEqual(new Set(s.studyWords.map(w=>w.id)),ids);
 assert.ok(s.studyWords.every(w=>w.id.startsWith('learner_b:')&&w.english&&w.russian));
 assert.equal(JSON.stringify(s.studyWords).includes(keys.teacher),false);
 const rows=b.data.get('Тренировки'),payload=JSON.parse(rows[1][6]);delete payload.studyWords;rows[1][6]=JSON.stringify(payload);
 const resumed=b.api('learner_b','start');assert.equal(resumed.id,s.id);
 assert.deepEqual(new Set(resumed.studyWords.map(w=>w.id)),ids);
});

test('unknown gap shows its answer, repeats after two tasks, persists, and is idempotent',()=>{
 const b=backend();let s=b.api('learner_b','start');
 while(!['gap','gap_choice'].includes(s.task.kind)){
  const t=b.tasks(s.id)[s.index];s=b.api('learner_b','answer',{sessionId:s.id,taskId:t.id,answer:t.kind==='choose'?t.russian:t.answers[0]}).session;
 }
 const original=b.tasks(s.id)[s.index],total=s.total;
 const result=b.api('learner_b','answer',{sessionId:s.id,taskId:original.id,unknown:true});
 assert.equal(result.result.correct,false);assert.equal(result.result.answer,'Не знаю');assert.equal(result.result.unknown,true);
 assert.equal(result.result.expected,original.gapAnswer||original.english);assert.equal(result.session.total,total+1);
 const ts=b.tasks(s.id),pos=ts.findIndex(t=>t.isReview&&t.wordId===original.wordId);
 assert.equal(pos,Math.min(result.session.index+2,total));assert.equal(ts[pos].prompt,original.prompt);
 const repeated=b.api('learner_b','answer',{sessionId:s.id,taskId:original.id,unknown:true});
 assert.equal(repeated.session.total,total+1);assert.equal(b.records('Прогресс').find(p=>p.wordId===original.wordId&&p.skill===original.kind).wrong,1);
 s=b.api('learner_b','start');assert.equal(s.total,total+1);
 while(!s.task.isReview){const t=b.tasks(s.id)[s.index];s=b.api('learner_b','answer',{sessionId:s.id,taskId:t.id,answer:t.kind==='choose'?t.russian:t.answers[0]}).session;}
 assert.equal(s.task.wordId,original.wordId);
 const again=b.api('learner_b','answer',{sessionId:s.id,taskId:s.task.id,unknown:true});assert.equal(again.session.total,total+2);
 const done=finish(b,'learner_b');assert.equal(done.session.status,'completed');assert.equal(done.session.summary.score,90);
 assert.equal(done.session.summary.xp,75);assert.equal(done.pet.coins,10);
});

test('an interrupted unknown send does not double-count failures or create two repeats',()=>{
 const b=backend(),s=b.api('learner_b','start'),task=s.task;
 b.failSessionWrite();assert.throws(()=>b.api('learner_b','answer',{sessionId:s.id,taskId:task.id,unknown:true}),/SIMULATED/);
 const retry=b.api('learner_b','answer',{sessionId:s.id,taskId:task.id,unknown:true});
 assert.equal(retry.session.total,s.total+1);
 assert.equal(b.records('Прогресс').find(p=>p.wordId===task.wordId&&p.skill===task.kind).wrong,1);
 assert.equal(b.tasks(s.id).filter(t=>t.isReview).length,1);
});

test('a mistake on the last task repeats before completion without requiring speech',()=>{
 const b=backend();let s=b.api('learner_b','start');
 while(s.index<9){const t=b.tasks(s.id)[s.index];s=b.api('learner_b','answer',{sessionId:s.id,taskId:t.id,answer:t.kind==='choose'?t.russian:t.answers[0]}).session;}
 const bad=b.api('learner_b','answer',{sessionId:s.id,taskId:s.task.id,unknown:true});
 assert.equal(bad.session.task.isReview,true);
 const t=b.tasks(s.id)[bad.session.index];s=b.api('learner_b','answer',{sessionId:s.id,taskId:t.id,answer:t.kind==='choose'?t.russian:t.answers[0]}).session;
 assert.equal(s.status,'completed');assert.equal(s.summary.pending,0);assert.equal(s.summary.score,90);
});

function oldSession(b,id,{studentId='learner_b',status='completed',day='2026-01-01',mode='daily',answerStatus}={}){
 const insert=(name,obj)=>b.data.get(name).push(b.data.get(name)[0].map(k=>obj[k]??''));
 insert('Тренировки',{id,studentId,createdAt:day+'T10:00:00Z',day,mode,status,payload:JSON.stringify({tasks:[],results:[{correct:true}],summary:{score:100}})});
 if(answerStatus)insert('Ответы',{id:id+':written',sessionId:id,studentId,wordId:studentId+':occasionally',kind:'sentence',submittedAt:day+'T10:00:00Z',text:'I occasionally walk.',status:answerStatus,correct:true,reviewedAt:day+'T11:00:00Z'});
}
test('archive verifies saved bytes, preserves current progress and totals, and excludes pending/recent/active work',()=>{
 const b=backend();oldSession(b,'old',{answerStatus:'reviewed'});oldSession(b,'pending',{answerStatus:'pending'});oldSession(b,'active',{status:'active',day:'2026-10-15'});oldSession(b,'recent',{day:'2026-10-16'});
 const before=['Ученики','Слова','Прогресс','Питомцы','Доступ'].map(n=>JSON.stringify(b.records(n)));
 const total=b.api('learner_b','bootstrap').stats.completed;
 const result=b.api('teacher','archiveHistory');assert.equal(result.archived,1);assert.equal(result.answers,1);
 assert.deepEqual(['Ученики','Слова','Прогресс','Питомцы','Доступ'].map(n=>JSON.stringify(b.records(n))),before);
 assert.deepEqual(b.records('Тренировки').map(s=>s.id),['pending','active','recent']);
 assert.equal(b.records('Ответы')[0].status,'pending');assert.equal(b.api('learner_b','bootstrap').stats.completed,total);
 const journal=b.records('Архивы')[0];assert.equal(journal.status,'committed');assert.equal(journal.year,'2026');
 const payload=JSON.parse(zlib.gunzipSync(Buffer.from(b.files.get(journal.fileId).getBytes())).toString());
 assert.equal(payload.sessions[0].id,'old');assert.equal(payload.answers[0].text,'I occasionally walk.');
 assert.equal(JSON.stringify(payload).includes(keys.teacher),false);
 assert.equal(b.api('teacher','archiveStatus').items.length,1);assert.throws(()=>b.api('learner_b','archiveStatus'),/недоступно/);
 assert.equal(JSON.stringify(b.api('learner_b','bootstrap')).includes(journal.fileId),false);
});
test('archival resumes after a partial deletion without losing or duplicating lifetime totals',()=>{
 const b=backend();oldSession(b,'old',{answerStatus:'reviewed'});b.failDelete('Тренировки');
 assert.throws(()=>b.api('teacher','archiveHistory'),/SIMULATED_DELETE/);
 assert.equal(b.records('Архивы')[0].status,'prepared');assert.equal(b.records('Итоги')[0].completed,1);
 assert.equal(b.api('learner_b','bootstrap').stats.completed,1);assert.equal(b.records('Тренировки').length,1);
 assert.equal(b.api('teacher','archiveHistory').archived,1);assert.equal(b.files.size,1);
 assert.equal(b.api('learner_b','bootstrap').stats.completed,1);assert.equal(b.records('Итоги')[0].completed,1);
 assert.equal(b.api('teacher','archiveHistory').archived,0);assert.equal(b.files.size,1);
});
test('a failed Drive write never prunes source history',()=>{
 const b=backend();oldSession(b,'old',{answerStatus:'reviewed'});b.failFile();
 assert.throws(()=>b.api('teacher','archiveHistory'),/SIMULATED_DRIVE/);
 assert.equal(b.records('Тренировки').length,1);assert.equal(b.records('Ответы').length,1);assert.equal(b.records('Итоги').length,0);assert.equal(b.records('Архивы').length,0);
});
test('corrupted archive blocks cleanup and can be resumed after bytes are restored',()=>{
 const b=backend();oldSession(b,'old');b.failDelete('Тренировки');assert.throws(()=>b.api('teacher','archiveHistory'),/SIMULATED_DELETE/);
 const j=b.records('Архивы')[0],original=b.files.get(j.fileId);
 b.files.set(j.fileId,{getBytes:()=>Array.from(zlib.gzipSync(Buffer.from('{}')))});
 assert.throws(()=>b.api('teacher','archiveHistory'),/не прошёл проверку/);assert.equal(b.records('Тренировки').length,1);
 b.files.set(j.fileId,original);assert.equal(b.api('teacher','archiveHistory').archived,1);assert.equal(b.api('learner_b','bootstrap').stats.completed,1);
});
test('archive work is bounded and retains totals across multiple batches',()=>{
 const b=backend();for(let i=0;i<101;i++)oldSession(b,'old-'+i);
 assert.equal(b.api('teacher','archiveHistory').archived,100);assert.equal(b.records('Тренировки').length,1);assert.equal(b.api('learner_b','bootstrap').stats.completed,101);
 assert.equal(b.api('teacher','archiveHistory').archived,1);assert.equal(b.records('Тренировки').length,0);assert.equal(b.api('learner_b','bootstrap').stats.completed,101);assert.equal(b.files.size,2);
});
test('scheduled archive uses the existing glossary trigger and reports errors without blocking glossary sync',()=>{
 const b=backend();oldSession(b,'old');b.failFile();b.context.syncScheduled_();
 assert.match(b.properties.get('ARCHIVE_ERROR'),/SIMULATED_DRIVE/);assert.equal(b.records('Тренировки').length,1);
 b.context.syncScheduled_();assert.equal(b.records('Тренировки').length,0);assert.equal(b.properties.get('ARCHIVE_ERROR'),'');
});

test('abandoned sessions older than retention are archived without counting them as completed',()=>{
 const b=backend();oldSession(b,'abandoned',{status:'active'});oldSession(b,'pending',{status:'active',answerStatus:'pending'});
 assert.equal(b.api('teacher','archiveHistory').archived,1);assert.equal(b.api('learner_b','bootstrap').stats.completed,0);assert.deepEqual(b.records('Тренировки').map(s=>s.id),['pending']);
});
test('the old eight-tab database can open before the archive trigger creates its extra tabs',()=>{
 const b=backend();b.data.delete('Итоги');b.data.delete('Архивы');assert.equal(b.api('learner_b','bootstrap').stats.completed,0);assert.equal(b.api('teacher','bootstrap').archive.items.length,0);b.context.syncScheduled_();assert.ok(b.data.has('Архивы'));
});

test('pet choice persists per pupil without changing earned rewards, vocabulary, progress or active training',()=>{
 const b=backend(),earned=finish(b,'learner_b');
 const before={words:JSON.stringify(b.records('Слова')),progress:JSON.stringify(b.records('Прогресс')),answers:JSON.stringify(b.records('Ответы')),sessions:JSON.stringify(b.records('Тренировки')),other:JSON.stringify(b.records('Питомцы').find(p=>p.studentId==='learner_a'))};
 for(const species of ['cat','dog','dragon','fox']){
  const selected=b.api('learner_b','savePet',{species,studentId:'learner_a',xp:99999,coins:99999});
  assert.equal(selected.species,species);assert.equal(selected.name,earned.pet.name);
  for(const key of ['xp','coins','rations','food','clean','accessory'])assert.equal(selected[key],earned.pet[key]);
  assert.equal(b.api('learner_b','bootstrap').pet.species,species);
 }
 assert.equal(JSON.stringify(b.records('Слова')),before.words);assert.equal(JSON.stringify(b.records('Прогресс')),before.progress);assert.equal(JSON.stringify(b.records('Ответы')),before.answers);assert.equal(JSON.stringify(b.records('Тренировки')),before.sessions);assert.equal(JSON.stringify(b.records('Питомцы').find(p=>p.studentId==='learner_a')),before.other);
 const active=b.api('learner_a','start');b.api('learner_a','savePet',{species:'dragon',name:'Листик'});assert.equal(b.api('learner_a','start').id,active.id);
});
test('pet name and species edits are compatible, validated atomically, and cannot be used from a teacher key',()=>{
 const b=backend();b.api('learner_b','savePet',{name:'Туман',species:'cat'});
 assert.equal(b.api('learner_b','savePet',{name:'Луна'}).species,'cat');assert.equal(b.api('learner_b','savePet',{species:'dog'}).name,'Луна');
 const before=JSON.stringify(b.records('Питомцы'));
 for(const data of [{name:'Изменить',species:'invalid'},{name:'x',species:'dragon'},{name:42,species:'dragon'},{species:{id:'fox'}},{}])assert.throws(()=>b.api('learner_b','savePet',data));
 assert.equal(JSON.stringify(b.records('Питомцы')),before);assert.throws(()=>b.api('teacher','savePet',{name:'Туман',species:'cat'}),/недоступно/);
});
function petUi(){
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',value:'',addEventListener(name,handler){this[name]=handler;},replaceChildren(){this.innerHTML='';}});return elements.get(id);};
 const context=vm.createContext({console,Date,JSON,Math,Error,Set,Map,Array,String,Number,Boolean,Object,RegExp,Intl,URLSearchParams,
  window:{google:{script:{run:{}}},addEventListener(){}},document:{getElementById:element,querySelector:selector=>selector==='input[name="petSpecies"]:checked'?{value:'dog'}:null,querySelectorAll:()=>[]},setTimeout(){}});
 const html=fs.readFileSync(root+'/output/App.html','utf8');
 const code=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\nboot\(\);\s*$/,'');
 vm.runInContext(code,context);
 vm.runInContext("state.data={pet:{species:'cat',name:'<Луна>',xp:75,coins:10,rations:2}};render=()=>{};toast=(message)=>{globalThis.lastToast=message;};",context);
 return {context,elements,element};
}
test('pet picker renders accessible choices with distinct images and escapes an existing name',()=>{
 const u=petUi();u.context.openPetPicker();const html=u.element('dialogs').innerHTML;
 assert.equal((html.match(/type="radio"/g)||[]).length,4);assert.match(html,/value="cat" checked/);assert.match(html,/value="&lt;Луна&gt;"/);assert.equal(html.includes('value="<Луна>"'),false);assert.match(html,/dialog-wide/);
 assert.equal(vm.runInContext('new Set(WordPetCore.petSpecies.map(p=>petImage(p.id))).size',u.context),4);
 for(const id of ['fox','cat','dog','dragon']){
  const image=vm.runInContext('petImage('+JSON.stringify(id)+')',u.context);assert.equal(Buffer.from(image.split(',')[1],'base64').subarray(0,2).toString('hex'),'ffd8');
 }
});
test('pet picker saves the selected species and name only after a successful server response',async()=>{
 const u=petUi();u.context.openPetPicker();u.element('chosenPetName').value='Облачко';
 vm.runInContext("rpc=async(action,data)=>{globalThis.request={action,data};return {...state.data.pet,...data};};",u.context);
 u.element('petForm').onsubmit({preventDefault(){}});await new Promise(setImmediate);
 const result=JSON.parse(vm.runInContext('JSON.stringify({request,pet:state.data.pet})',u.context));
 assert.deepEqual(result.request,{action:'savePet',data:{name:'Облачко',species:'dog'}});assert.equal(result.pet.species,'dog');assert.equal(result.pet.xp,75);assert.equal(u.element('dialogs').innerHTML,'');
});
test('failed pet saving leaves the previous profile intact and the choice dialog open',async()=>{
 const u=petUi();u.context.openPetPicker();u.element('chosenPetName').value='Облачко';
 vm.runInContext("rpc=async()=>{throw Error('Нет соединения');};",u.context);
 u.element('petForm').onsubmit({preventDefault(){}});await new Promise(setImmediate);
 assert.equal(vm.runInContext('state.data.pet.species',u.context),'cat');assert.equal(vm.runInContext('state.data.pet.name',u.context),'<Луна>');assert.match(u.element('dialogs').innerHTML,/petForm/);assert.equal(u.context.lastToast,'Нет соединения');
});


test('sentence assembly uses an authored example, hides its order and falls back without an example',()=>{
 const w={id:'a',english:'occasionally',russian:'иногда',example:'I occasionally play chess with my friends.',lessonOn:'2026-10-16'};
 const ts=core.makeTasks([w],[w],[],'2026-10-16',()=>.5),t=ts.find(t=>t.kind==='assemble');
 assert.ok(t);assert.equal(core.grade(t,w.example),true);assert.equal(core.grade(t,'I occasionally with my play chess friends.'),false);
 const visible=core.publicTask(t);assert.equal(visible.opening,'I occasionally');
 assert.equal(Object.hasOwn(visible,'answers'),false);assert.equal(Object.hasOwn(visible,'sentenceAnswer'),false);
 assert.notEqual([visible.opening,...visible.parts].join(' '),w.example);
 assert.equal(core.makeTasks([{...w,example:''}],[w],[],'2026-10-16',()=>.5).some(t=>t.kind==='assemble'),false);
});
test('assembly unknown shows the full sentence and repeats until correct, with automatic grading',()=>{
 const b=backend();let s=b.api('learner_b','start');
 // Install a deterministic authored task to exercise the API independently of selection randomness.
 const w={id:'learner_b:occasionally',english:'occasionally',russian:'иногда',example:'I occasionally play chess with my friends.',lessonOn:'2026-10-16'};
 const t=core.makeTasks([w],[w],[],'2026-10-16',()=>.5).find(t=>t.kind==='assemble');
 const rows=b.data.get('Тренировки');rows[1][6]=JSON.stringify({tasks:[t],results:[],studyWords:[w]});
 const r=b.api('learner_b','answer',{sessionId:s.id,taskId:t.id,unknown:true});
 assert.equal(r.result.expected,w.example);assert.equal(r.result.correct,false);assert.equal(r.session.task.kind,'assemble');assert.equal(r.session.task.isReview,true);
 const done=b.api('learner_b','answer',{sessionId:s.id,taskId:r.session.task.id,answer:w.example});
 assert.equal(done.result.correct,true);assert.equal(done.session.status,'completed');assert.equal(done.session.summary.pending,0);assert.equal(b.records('Ответы').length,0);
});
function installLegacy(b){
 const s=b.api('learner_b','start');const rows=b.data.get('Тренировки'),p=JSON.parse(rows[1][6]);
 for(const kind of ['sentence','voice'])p.tasks.push({id:'legacy-'+kind,kind,wordId:'learner_b:occasionally',english:'occasionally',russian:'иногда',category:'review'});
 rows[1][6]=JSON.stringify(p);return s;
}
test('unfinished old sessions replace pending speech without resetting answers, score or rewards',()=>{
 const b=backend(),s=installLegacy(b),before=b.tasks(s.id).map(t=>t.id);
 const resumed=b.api('learner_b','start');assert.equal(resumed.id,s.id);assert.equal(resumed.total,12);
 assert.deepEqual(b.tasks(s.id).map(t=>t.id),before);assert.ok(b.tasks(s.id).slice(-2).every(t=>t.kind==='write_en'&&t.isReview));
 const result=finish(b,'learner_b');assert.equal(result.session.summary.score,100);assert.equal(result.session.summary.xp,80);assert.equal(result.session.summary.pending,0);assert.equal(b.files.size,0);assert.equal(b.records('Ответы').length,0);
});
test('stale voice submissions cannot upload files or create review work after migration',()=>{
 const b=backend(),s=installLegacy(b),rows=b.data.get('Тренировки'),p=JSON.parse(rows[1][6]);
 p.results=p.tasks.slice(0,10).map(t=>({taskId:t.id,correct:true,kind:t.kind,wordId:t.wordId}));rows[1][6]=JSON.stringify(p);
 assert.throws(()=>b.api('learner_b','answer',{sessionId:s.id,taskId:'legacy-sentence',audio:'eA==',mime:'audio/webm'}),/введи или выбери/);
 const resumed=b.api('learner_b','start');assert.equal(resumed.index,10);assert.equal(resumed.task.kind,'write_en');assert.equal(resumed.score,100);
 assert.equal(b.files.size,0);assert.equal(b.records('Ответы').length,0);
});
test('assembly controls add and return parts, submit their order, and never request a microphone',()=>{
 const u=petUi(),parts=[{dataset:{part:'0'}},{dataset:{part:'1'}}],remove=[{dataset:{removePart:'0'}}];
 u.context.document.querySelectorAll=selector=>selector==='[data-part]'?parts:selector==='[data-remove-part]'?remove:[];
 vm.runInContext("state.session={id:'s',task:{id:'t',kind:'assemble',english:'play',opening:'I often',parts:['play chess','after school.']}};submitAnswer=(answer)=>{globalThis.sent=answer;};",u.context);
 const initial=vm.runInContext('taskBody(state.session.task)',u.context);assert.match(initial,/id="checkAssembly"[^>]* disabled/);assert.match(initial,/unknownAnswer/);
 u.context.bindStudent();parts[0].onclick();parts[1].onclick();remove[0].onclick();parts[0].onclick();
 u.element('checkAssembly').click();assert.equal(u.context.sent,'I often after school. play chess');
 const html=fs.readFileSync(root+'/output/App.html','utf8');assert.equal(html.includes('getUserMedia'),false);assert.equal(html.includes('MediaRecorder'),false);assert.equal(html.includes('sendVoice'),false);
});

test('production manifest publishes a web app that pupils can open without a Google account',()=>{
 const manifest=JSON.parse(fs.readFileSync(root+'/output/appsscript.json','utf8'));
 assert.deepEqual(manifest.webapp,{access:'ANYONE_ANONYMOUS',executeAs:'USER_DEPLOYING'});
});

test('guided vocabulary gets a context choice and familiar vocabulary gets typed gaps',()=>{
 const ws=seed.words.filter(w=>w.studentId==='learner_b');const target=ws.find(w=>w.english==='occasionally');
 const guided=core.makeTasks([target],ws,[],'2026-10-16',()=>.5);assert.ok(guided.some(t=>t.kind==='gap_choice'));assert.equal(guided.some(t=>t.kind==='gap'),false);
 const progress=[{wordId:target.id,skill:'write_en',streak:2,correct:2,wrong:0}];
 const learned=core.makeTasks([target],ws,progress,'2026-10-16',()=>.5);assert.ok(learned.some(t=>t.kind==='gap'));assert.equal(learned.some(t=>t.kind==='gap_choice'),false);
 const gap=learned.find(t=>t.kind==='gap');assert.equal(core.grade(gap,gap.gapAnswer),true);assert.equal(core.publicTask(gap).english,undefined);
});
test('context choices exclude synonymous distractors and grade the actual form in the example',()=>{
 const w={id:'keen',english:'be keen on',russian:'увлекаться',answers:'am keen on | is keen on',example:'I am keen on chess.',lessonOn:'2026-10-16'};
 const all=[w,{id:'like',english:'like',russian:'увлекаться'},{id:'play',english:'play',russian:'играть'}];
 const t=core.makeTasks([w],all,[],'2026-10-16',()=>.5).find(t=>t.kind==='gap_choice');
 assert.equal(t.gapAnswer,'am keen on');assert.equal(t.prompt,'I ______ chess.');assert.ok(t.options.includes('am keen on'));assert.equal(t.options.includes('like'),false);
 assert.equal(core.grade(t,'am keen on'),true);assert.equal(core.grade(t,'is keen on'),false);assert.equal(core.grade(t,'be keen on'),false);
 assert.equal(core.gapData({english:'own',example:'I go down the street.'}),null);
});
test('letter tasks support duplicate letters, spaces and apostrophes while hiding the answer',()=>{
 const w={id:'stand',english:"can't stand",russian:'терпеть не могу',example:"I can't stand wet socks."};
 const t=core.makeTasks([w],[w],[],'2026-10-16',()=>.5).find(t=>t.kind==='letters');assert.ok(t);
 assert.equal(t.pattern,"___'_ _____");assert.equal(t.parts.length,9);assert.equal(t.parts.filter(x=>x==='t').length,2);
 assert.equal(core.grade(t,"CAN’T STAND"),true);assert.equal(core.grade(t,'cant stand'),false);
 const visible=core.publicTask(t);assert.equal(visible.english,undefined);assert.equal(visible.answers,undefined);assert.equal(visible.russian,w.russian);assert.equal(visible.pattern,t.pattern);
 assert.equal(core.letterParts({english:'a'}),null);assert.equal(core.letterParts({english:'café'}),null);
});
test('a new mission mixes translations, context, letters, listening and sentence assembly without pending answers',()=>{
 const ws=seed.words.filter(w=>w.studentId==='learner_b');const w=ws.find(w=>w.english==='occasionally');
 const tasks=core.makeTasks([w],ws,[],'2026-10-16',()=>.5);
 assert.equal(tasks.length,10);for(const kind of ['choose','letters','write_ru','listen','gap_choice','assemble','write_en'])assert.ok(tasks.some(t=>t.kind===kind),kind);
 const b=backend(),done=finish(b,'learner_b');assert.equal(done.session.summary.score,100);assert.equal(done.session.summary.pending,0);assert.equal(b.records('Ответы').length,0);assert.equal(b.files.size,0);
});
test('letter controls keep duplicate tiles distinct and allow undo and reset before automatic checking',()=>{
 const u=petUi(),letters=[{dataset:{letter:'0'}},{dataset:{letter:'1'}},{dataset:{letter:'2'}}];
 u.context.document.querySelectorAll=selector=>selector==='[data-letter]'?letters:[];
 vm.runInContext("state.session={id:'s',task:{id:'t',kind:'letters',russian:'весь',parts:['l','a','l'],pattern:'___'}};submitAnswer=(answer)=>{globalThis.sent=answer;};",u.context);
 const initial=vm.runInContext('taskBody(state.session.task)',u.context);assert.match(initial,/id="checkLetters"[^>]*disabled/);assert.match(initial,/unknownAnswer/);
 u.context.bindStudent();letters[1].onclick();letters[0].onclick();letters[0].onclick();assert.equal(vm.runInContext('state.assembly.length',u.context),2);
 u.element('undoLetter').click();letters[2].onclick();letters[0].onclick();u.element('checkLetters').click();assert.equal(u.context.sent,'all');
 u.element('resetLetters').click();assert.equal(vm.runInContext('state.assembly.length',u.context),0);
});
test('navigation and settings use prepared British recordings without device voices',async()=>{
 const html=fs.readFileSync(root+'/output/App.html','utf8');assert.equal(html.includes('stopRecording('),false);assert.match(html,/id="audioPreferences"/);assert.equal(html.includes('getUserMedia'),false);
 const u=petUi();await u.context.openAudioPreferences();const markup=u.element('dialogs').innerHTML;assert.match(markup,/Британская озвучка/);assert.match(markup,/id="testAudioVoice"/);assert.match(markup,/нейроголосом Emma/);
});

test('bilingual examples and usage survive teacher edits and glossary sync without crossing pupils',()=>{
 const b=backend();b.api('teacher','addWord',{studentId:'learner_b',english:'occasionally',russian:'иногда',example:'I occasionally visit my grandparents.',exampleRu:'Я иногда навещаю бабушку и дедушку.',usage:'occasionally + смысловой глагол',answers:'occasionally',hard:true});
 b.api('teacher','sync');const w=b.api('learner_b','bootstrap').words.find(w=>w.english==='occasionally');
 assert.equal(w.example,'I occasionally visit my grandparents.');assert.equal(w.exampleRu,'Я иногда навещаю бабушку и дедушку.');assert.equal(w.usage,'occasionally + смысловой глагол');assert.equal(w.exampleFocus,'occasionally');
 assert.equal(JSON.stringify(b.api('learner_a','bootstrap')).includes('навещаю бабушку'),false);
 const teacher=b.api('teacher','bootstrap');assert.ok(teacher.students.find(s=>s.id==='learner_b').words.some(w=>w.exampleRu==='Я иногда навещаю бабушку и дедушку.'));
});
test('existing sessions receive example translations only when their saved English example matches',()=>{
 const b=backend();let s=b.api('learner_b','start');assert.ok(s.studyWords.every(w=>w.example&&w.exampleRu&&w.usage));
 const rows=b.data.get('Тренировки'),payload=JSON.parse(rows[1][6]);const target=payload.studyWords[0];delete target.exampleRu;delete target.usage;delete target.exampleFocus;
 rows[1][6]=JSON.stringify(payload);const resumed=b.api('learner_b','start');assert.equal(resumed.id,s.id);assert.ok(resumed.studyWords[0].exampleRu);
 target.example='A different saved sentence.';rows[1][6]=JSON.stringify(payload);const old=b.api('learner_b','start');assert.equal(old.studyWords[0].example,target.example);assert.equal(old.studyWords[0].exampleRu,'');
});
test('the old fourteen-column word table remains readable with common context defaults',()=>{
 const b=backend();b.data.set('Слова',b.data.get('Слова').map(row=>row.slice(0,14)));
 const d=b.api('learner_b','bootstrap');assert.equal(d.words.length,11);assert.ok(d.words.every(w=>w.exampleRu&&w.usage));
});
test('dictionary and study cards show highlighted bilingual context; unanswered questions hide it',()=>{
 const u=petUi();const word={id:'w',english:'be keen on',russian:'увлекаться',example:'I am keen on chess.',exampleRu:'Я увлекаюсь шахматами.',usage:'be keen on + существительное / -ing',exampleFocus:'am keen on',category:'recent'};
 u.context.word=word;
 const card=vm.runInContext('exampleHTML(word)',u.context);assert.match(card,/<mark[^>]*>am keen on<\/mark>/);assert.match(card,/Я увлекаюсь шахматами/);assert.match(card,/Как использовать:/);assert.match(card,/Послушать пример/);
 vm.runInContext('state.data.words=[word];state.session={id:"s",index:0,total:10,status:"active",task:{id:"t",wordId:"w",kind:"gap",prompt:"I ______ chess.",russian:word.russian,category:"recent"},studyWords:[word]};',u.context);
 assert.match(vm.runInContext('wordsPage()',u.context),/Я увлекаюсь шахматами/);assert.match(vm.runInContext('studyPage()',u.context),/Я увлекаюсь шахматами/);
 assert.equal(vm.runInContext('lessonPage()',u.context).includes('Я увлекаюсь шахматами'),false);
 vm.runInContext('state.feedback={task:state.session.task,result:{correct:false,unknown:true,expected:"am keen on"}};',u.context);
 assert.match(vm.runInContext('lessonPage()',u.context),/Я увлекаюсь шахматами/);
 u.context.word={...word,example:'I am keen on <script>alert(1)</script>.'};const safe=vm.runInContext('exampleHTML(word)',u.context);assert.equal(safe.includes('<script>'),false);assert.match(safe,/&lt;script&gt;/);
});

function installSpeech(b,{wrongDatabase=false}={}){
 const voice='kokoro-v1.0-bf_emma-en-gb';
 const blob=(text,mime='application/json')=>({getBytes:()=>Array.from(Buffer.from(text)),getDataAsString:()=>text,getContentType:()=>mime});
 const word=b.records('Слова').find(w=>w.studentId==='learner_b');
 const index={databaseId:wrongDatabase?'OTHER_DB':'__DATABASE_ID__',voice,clips:{[word.english]:{id:'prepared-word',voice},[word.example]:{id:'prepared-example',voice},'I enjoy learning English. A little practice every day makes a difference.':{id:'prepared-word',voice}}};
 b.files.set('speech-index',blob(JSON.stringify(index)));b.files.set('prepared-word',blob('x'.repeat(1000),'audio/mpeg'));b.files.set('prepared-example',blob('y'.repeat(1000),'audio/mpeg'));b.properties.set('SPEECH_INDEX_ID','speech-index');return {word,index,blob};
}
test('prepared pronunciation is authorized by pupil and word and does not expose Drive identifiers',()=>{
 const b=backend(),{word}=installSpeech(b);
 for(const kind of ['word','example']){const response=b.api('learner_b','speech',{kind,wordId:word.id});assert.equal(response.ready,true);assert.equal(response.mime,'audio/mpeg');assert.ok(response.audio);assert.equal(JSON.stringify(response).includes('prepared-word'),false);}
 assert.throws(()=>b.api('learner_a','speech',{kind:'word',wordId:word.id,studentId:'learner_b',fileId:'prepared-word'}),/недоступна/);
 assert.equal(b.api('teacher','speech',{kind:'word',wordId:word.id}).ready,true);assert.equal(b.api('learner_a','speech',{kind:'sample'}).ready,true);
 assert.equal(b.api('learner_b','speech',{kind:'example',wordId:word.id,text:'Some other private phrase'}).ready,false);
});
test('missing or mismatched speech indexes return pending instead of another project’s audio',()=>{
 const b=backend(),{word}=installSpeech(b,{wrongDatabase:true});assert.equal(b.api('learner_b','speech',{kind:'word',wordId:word.id}).ready,false);
 const other=backend(),prepared=installSpeech(other);other.files.delete('prepared-word');assert.equal(other.api('learner_b','speech',{kind:'word',wordId:prepared.word.id}).ready,false);
});
test('the pronunciation queue contains only words, examples and the sample and updates with glossary edits',()=>{
 const b=backend(),{blob}=installSpeech(b);b.files.set('speech-queue',blob(JSON.stringify({databaseId:'__DATABASE_ID__',texts:[]})));b.properties.set('SPEECH_QUEUE_ID','speech-queue');
 b.api('teacher','sync');let queue=JSON.parse(b.files.get('speech-queue').getDataAsString());assert.ok(queue.texts.includes('occasionally'));assert.equal(JSON.stringify(queue).includes(keys.teacher),false);assert.equal(JSON.stringify(queue).includes('learner_b'),false);
 b.api('teacher','addWord',{studentId:'learner_b',english:'a new expression',russian:'новое выражение',example:'I use a new expression today.'});
 queue=JSON.parse(b.files.get('speech-queue').getDataAsString());assert.ok(queue.texts.includes('a new expression'));assert.ok(queue.texts.includes('I use a new expression today.'));
});
