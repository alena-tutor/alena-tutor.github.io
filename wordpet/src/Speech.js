/* Prepared neural recordings remain private in the owner's Google Drive. */
const SPEECH_SAMPLE_TEXT_='I enjoy learning English. A little practice every day makes a difference.';
const SPEECH_VOICE_='kokoro-v1.0-bf_emma-en-gb';
let SPEECH_INDEX_CACHE_;
function speechText_(value){return String(value||'').normalize('NFKC').replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim();}
function speechFile_(kind){
  const property='SPEECH_'+kind.toUpperCase()+'_ID',saved=props_().getProperty(property);
  const valid=file=>{try{const blob=file.getBlob();if(blob.getBytes().length>2000000)return null;const data=JSON.parse(blob.getDataAsString());return data.databaseId===APP_CONFIG.databaseId?{file,data}:null;}catch{return null;}};
  if(saved){try{const result=valid(DriveApp.getFileById(saved));if(result)return result;}catch{}}
  if(typeof DriveApp.getFilesByName!=='function')return null;
  const files=DriveApp.getFilesByName('WordPet — pronunciation '+kind+'.json');
  let attempts=0;
  while(files.hasNext()&&attempts++<10){const result=valid(files.next());if(result){props_().setProperty(property,result.file.getId());return result;}}
  return null;
}
function speechIndex_(){
  if(SPEECH_INDEX_CACHE_ && Date.now()-SPEECH_INDEX_CACHE_.at<60000)return SPEECH_INDEX_CACHE_.value;
  const record=speechFile_('index');
  const value=record?.data.voice===SPEECH_VOICE_?record.data:null;
  SPEECH_INDEX_CACHE_={at:Date.now(),value};return value;
}
function speech_(studentId,data,teacher){
  let text;
  if(data.kind==='sample')text=SPEECH_SAMPLE_TEXT_;
  else{
    if(!['word','example'].includes(data.kind))throw Error('Неизвестная запись.');
    const word=rows_('Слова').find(w=>w.id===data.wordId&&bool_(w.active)&&(teacher||w.studentId===studentId));
    if(!word)throw Error('Запись для этого слова недоступна.');
    text=data.kind==='example'?exampleContext_(word).example:word.english;
    if(data.text && speechText_(data.text)!==speechText_(text))return {ready:false};
  }
  const key=speechText_(text),entry=speechIndex_()?.clips?.[key];
  if(!entry?.id||entry.voice!==SPEECH_VOICE_)return {ready:false};
  try{
    const blob=DriveApp.getFileById(entry.id).getBlob(),bytes=blob.getBytes();
    if(blob.getContentType()!=='audio/mpeg'||bytes.length<500||bytes.length>500000)return {ready:false};
    return {ready:true,mime:'audio/mpeg',audio:Utilities.base64Encode(bytes)};
  }catch{return {ready:false};}
}
function refreshSpeechQueue_(){
  try{
    const record=speechFile_('queue');if(!record)return {ready:false};
    const texts=[SPEECH_SAMPLE_TEXT_];
    rows_('Слова').filter(w=>bool_(w.active)).forEach(word=>texts.push(word.english,exampleContext_(word).example));
    const unique=[...new Set(texts.map(speechText_).filter(Boolean))].sort();
    if(unique.length>5000||unique.some(t=>t.length>500))return {ready:false};
    if(JSON.stringify([...(record.data.texts||[])].sort())!==JSON.stringify(unique))record.file.setContent(JSON.stringify({databaseId:APP_CONFIG.databaseId,texts:unique}));
    return {ready:true,count:unique.length};
  }catch{return {ready:false};}
}
