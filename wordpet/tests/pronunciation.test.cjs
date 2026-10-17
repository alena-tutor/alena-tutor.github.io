const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const audio=require('../src/Pronunciation.js');
const payload=()=>({ready:true,mime:'audio/mpeg',audio:Buffer.alloc(1024,5).toString('base64')});
function fixture(overrides={}){
 const played=[],reports=[],requested=[],storage=new Map();let paused=0;
 const engine=audio.create({fetchClip:async text=>{requested.push(text);return payload();},makeAudio:url=>({play:async()=>played.push(url),pause:()=>paused++}),onStatus:s=>reports.push(s),store:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},...overrides});
 return {engine,played,reports,requested,storage,paused:()=>paused};
}
test('words and full sentences play prepared recordings without a device voice',async()=>{
 const f=fixture();await f.engine.speak("can't stand");await f.engine.speak('I am keen on playing chess.');
 assert.equal(f.played.length,2);assert.ok(f.played.every(url=>url.startsWith('data:audio/mpeg;base64,')));assert.deepEqual(f.requested,["can't stand",'I am keen on playing chess.']);assert.match(f.reports.at(-1).message,/Emma/);
 const source=fs.readFileSync(require.resolve('../src/Pronunciation.js'),'utf8');assert.equal(source.includes('speechSynthesis'),false);assert.equal(source.includes('dictionaryapi'),false);
});
test('repeat taps reuse the loaded clip, including across a playback interruption',async()=>{
 const f=fixture();await f.engine.speak('hello');await f.engine.speak('hello');assert.equal(f.requested.length,1);assert.equal(f.played.length,2);assert.ok(f.paused()>0);
});
test('missing, malformed and failed recordings explain the problem without synthetic fallback',async()=>{
 for(const value of [null,{ready:false},{...payload(),mime:'text/html'},{...payload(),audio:'<html>not audio</html>'},{...payload(),audio:'A'.repeat(700004)}]){
  const f=fixture({fetchClip:async()=>value});assert.equal(await f.engine.speak('hello'),false);assert.equal(f.played.length,0);assert.match(f.reports.at(-1).message,/Запись пока готовится/);
 }
 const f=fixture({fetchClip:async()=>{throw Error('Offline');}});assert.equal(await f.engine.speak('hello'),false);assert.equal(f.played.length,0);
});
test('speed changes apply to the recording and keep its pitch',async()=>{
 let player;const f=fixture({makeAudio:()=>player={play:async()=>{},pause(){}}});f.engine.updatePreferences({rate:0.9});await f.engine.speak('hello');
 assert.equal(player.playbackRate,0.9);assert.equal(player.preservesPitch,true);assert.equal(JSON.parse(f.storage.get('wordpet-recorded-audio-v1')).rate,0.9);
});
test('a clip arriving after navigation cannot start playing the previous question',async()=>{
 let finish;const f=fixture({fetchClip:()=>new Promise(resolve=>finish=resolve)});const playing=f.engine.speak('hello');f.engine.stop();finish(payload());await playing;assert.equal(f.played.length,0);
});
test('autoplay rejection offers another tap and never switches to the device voice',async()=>{
 const f=fixture({makeAudio:()=>({play:async()=>{throw Error('NotAllowedError');},pause(){}})});assert.equal(await f.engine.speak('hello'),false);assert.match(f.reports.at(-1).message,/Нажми на динамик ещё раз/);
});
test('the private voice plan reuses recordings by exact voice and text and excludes duplicate work',async()=>{
 const {pendingTexts,clipHash,VOICE,SAMPLE}=await import('../scripts/speech-store.mjs');
 const existing=[{id:'clip',size:2000,appProperties:{clipHash:clipHash('hello')}}];
 const result=pendingTexts({texts:['hello','hello','new phrase']},{clips:{}},existing);
 assert.equal(result.clips.hello.id,'clip');assert.equal(result.clips.hello.voice,VOICE);assert.deepEqual(result.items.map(i=>i.text),[SAMPLE,'new phrase']);
 assert.equal(audio.SAMPLE,SAMPLE);assert.notEqual(clipHash('Hello'),clipHash('hello'));assert.throws(()=>pendingTexts({texts:['a'.repeat(501)]},{},[]),/bounds/);
});

test('logging out clears the previous learner’s loaded recordings',async()=>{
 const f=fixture();await f.engine.speak('hello');f.engine.clear();await f.engine.speak('hello');assert.equal(f.requested.length,2);
});
