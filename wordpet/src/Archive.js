/* Private, resumable archival. Current words, progress, pets and access are never pruned. */
const ARCHIVE_POLICY_={days:180,batch:100,format:1};
const ARCHIVE_SCHEMA_={
  'Итоги':['studentId','completed','lastPractice','lastArchiveId'],
  'Архивы':['id','year','createdAt','fileId','sha256','status','manifest']
};
Object.assign(SCHEMA,ARCHIVE_SCHEMA_);
function ensureArchiveSheets_(){
  Object.entries(ARCHIVE_SCHEMA_).forEach(([name,headers])=>{
    const sh=db_().getSheetByName(name)||db_().insertSheet(name);
    if(!sh.getLastRow())sh.getRange(1,1,1,headers.length).setValues([headers]);
    if(sh.getRange(1,1,1,headers.length).getValues()[0].join('|')!==headers.join('|'))throw Error('Не совпадают заголовки архива: '+name);
    sh.setFrozenRows(1);
  });
}
function archiveRows_(name){return db_().getSheetByName(name)?rows_(name):[];}
function archiveTotal_(studentId,sessions){
  const total=archiveRows_('Итоги').find(r=>r.studentId===studentId);
  if(!total)return {completed:0,lastPractice:''};
  // During a resumed archive, some summarized source rows may still exist.
  const journal=archiveRows_('Архивы').find(r=>r.id===total.lastArchiveId&&r.status==='prepared');
  const ids=new Set(journal?JSON.parse(journal.manifest).sessions.map(s=>s.id):[]);
  const overlap=sessions.filter(s=>ids.has(s.id)&&s.studentId===studentId&&s.mode==='daily'&&s.status==='completed').length;
  return {completed:Number(total.completed)-overlap,lastPractice:total.lastPractice};
}
function archiveFolder_(year){
  let rootId=props_().getProperty('ARCHIVE_FOLDER');
  if(!rootId){rootId=DriveApp.createFolder('WordPet — архив тренировок').getId();props_().setProperty('ARCHIVE_FOLDER',rootId);}
  const key='ARCHIVE_YEAR_'+year;
  let yearId=props_().getProperty(key);
  if(!yearId){yearId=DriveApp.getFolderById(rootId).createFolder(String(year)).getId();props_().setProperty(key,yearId);}
  return DriveApp.getFolderById(yearId);
}
function archiveDigest_(text){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8).map(b=>(b&255).toString(16).padStart(2,'0')).join('');}
function verifyArchive_(journal){
  const text=Utilities.ungzip(DriveApp.getFileById(journal.fileId).getBlob()).getDataAsString('UTF-8');
  if(archiveDigest_(text)!==journal.sha256)throw Error('Архив не прошёл проверку. Исходные строки сохранены.');
  const payload=JSON.parse(text),manifest=JSON.parse(journal.manifest);
  if(payload.format!==ARCHIVE_POLICY_.format||payload.id!==journal.id||JSON.stringify(payload.sessions.map(s=>({id:s.id,studentId:s.studentId,mode:s.mode,status:s.status,createdAt:s.createdAt})))!==JSON.stringify(manifest.sessions)||JSON.stringify(payload.answers.map(a=>a.id))!==JSON.stringify(manifest.answers))throw Error('Состав архива не совпадает. Исходные строки сохранены.');
  return payload;
}
function removeArchiveRows_(name,ids){
  ROW_CACHE_={};
  const selected=rows_(name).filter(r=>ids.has(r.id)).map(r=>r._row).sort((a,b)=>b-a);
  // Delete from the bottom so retries remain safe after a partial deletion.
  const sh=sheet_(name);
  for(let i=0;i<selected.length;){let high=selected[i],low=high;i++;while(i<selected.length&&selected[i]===low-1){low=selected[i++];}sh.deleteRows(low,high-low+1);}
  ROW_CACHE_={};
}
function finishArchive_(journal){
  const payload=verifyArchive_(journal),manifest=JSON.parse(journal.manifest);
  const groups={};
  manifest.sessions.forEach(s=>{const g=groups[s.studentId]||(groups[s.studentId]={completed:0,lastPractice:''});if(s.mode==='daily'&&s.status==='completed'){g.completed++;g.lastPractice=[g.lastPractice,s.createdAt].sort().at(-1);}});
  Object.entries(groups).forEach(([studentId,delta])=>{
    const old=rows_('Итоги').find(r=>r.studentId===studentId);
    if(old?.lastArchiveId===journal.id)return;
    put_('Итоги',{...(old||{}),studentId,completed:Number(old?.completed||0)+delta.completed,lastPractice:[old?.lastPractice||'',delta.lastPractice].sort().at(-1),lastArchiveId:journal.id});
  });
  removeArchiveRows_('Ответы',new Set(manifest.answers));
  removeArchiveRows_('Тренировки',new Set(manifest.sessions.map(s=>s.id)));
  const current=rows_('Архивы').find(r=>r.id===journal.id);
  put_('Архивы',{...current,status:'committed'});
  props_().setProperty('ARCHIVE_LAST_OK',now_());
  props_().setProperty('ARCHIVE_ERROR','');
  return {archived:payload.sessions.length,answers:payload.answers.length};
}
function archiveScheduled_(){
  ensureArchiveSheets_();
  const pending=rows_('Архивы').find(r=>r.status==='prepared');
  if(pending)return finishArchive_(pending);
  const cutoff=new Date(WordPetCore.dateValue(today_())-ARCHIVE_POLICY_.days*86400000).toISOString().slice(0,10);
  const answers=rows_('Ответы'),blocked=new Set(answers.filter(a=>a.status==='pending').map(a=>a.sessionId));
  const sessions=rows_('Тренировки').filter(s=>['completed','active'].includes(s.status)&&s.day&&s.day<cutoff&&!blocked.has(s.id)).slice(0,ARCHIVE_POLICY_.batch);
  if(!sessions.length){props_().setProperty('ARCHIVE_LAST_OK',now_());props_().setProperty('ARCHIVE_ERROR','');return {archived:0,answers:0};}
  const year=String(sessions[0].day).slice(0,4),selected=sessions.filter(s=>String(s.day).startsWith(year)),ids=new Set(selected.map(s=>s.id));
  const plain=r=>Object.fromEntries(Object.entries(r).filter(([k])=>k!=='_row'));
  const id=Utilities.getUuid(),payload={format:ARCHIVE_POLICY_.format,id,createdAt:now_(),schemas:{sessions:SCHEMA['Тренировки'],answers:SCHEMA['Ответы']},sessions:selected.map(plain),answers:answers.filter(a=>ids.has(a.sessionId)).map(plain)};
  const text=JSON.stringify(payload),sha256=archiveDigest_(text);
  const blob=Utilities.gzip(Utilities.newBlob(text,'application/json','wordpet-'+id+'.json'),'wordpet-'+id+'.json.gz');
  const file=archiveFolder_(year).createFile(blob);
  const journal={id,year,createdAt:now_(),fileId:file.getId(),sha256,status:'prepared',manifest:JSON.stringify({sessions:payload.sessions.map(s=>({id:s.id,studentId:s.studentId,mode:s.mode,status:s.status,createdAt:s.createdAt})),answers:payload.answers.map(a=>a.id)})};
  // Verify the actual Drive bytes before writing the resumable journal or pruning.
  verifyArchive_(journal);
  put_('Архивы',journal);
  return finishArchive_(journal);
}
function archiveStatus_(){return {retentionDays:ARCHIVE_POLICY_.days,lastOk:props_().getProperty('ARCHIVE_LAST_OK')||'',error:props_().getProperty('ARCHIVE_ERROR')||'',items:archiveRows_('Архивы').filter(r=>r.status==='committed').slice(-30).reverse().map(r=>({id:r.id,year:r.year,date:r.createdAt,url:'https://drive.google.com/file/d/'+r.fileId+'/view'}))};}
