const test=require('node:test');
const assert=require('node:assert/strict');
const audio=require('../src/Pronunciation.js');
const uk={name:'Google UK English Female',lang:'en-GB',voiceURI:'uk',localService:false};
const old={name:'Old English',lang:'en-GB',voiceURI:'old',localService:true};
const ru={name:'Russian Natural',lang:'ru-RU',voiceURI:'ru',localService:false};
const entry=(word='hello')=>[{word,phonetics:[{audio:'https://api.dictionaryapi.dev/media/pronunciations/en/hello-us.mp3'},
 {audio:'https://api.dictionaryapi.dev/media/pronunciations/en/hello-uk.mp3',text:'/həˈləʊ/',sourceUrl:'https://commons.wikimedia.org/w/index.php?curid=1',license:{name:'BY 3.0',url:'https://creativecommons.org/licenses/by/3.0/'}}]}];
function fixture(overrides={}){
 const spoken=[],played=[],reports=[],stored=new Map();let paused=0,cancelled=0,requests=[];
 const synth={getVoices:()=>[ru,old,uk],cancel:()=>cancelled++,speak:u=>spoken.push(u)};
 const options={synth,store:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)},fetchPage:async(url,opts)=>{requests.push({url,opts});return {ok:true,json:async()=>entry()};},
  makeAudio:url=>({play:async()=>{played.push(url);},pause:()=>paused++}),makeUtterance:text=>({text}),onStatus:s=>reports.push(s),...overrides};
 const engine=audio.create(options);
 return {engine,spoken,played,reports,stored,synth,requests,paused:()=>paused,cancelled:()=>cancelled};
}
test('pronunciation chooses an English quality voice and respects an explicit preference',()=>{
 assert.equal(audio.chooseVoice([ru,old,uk]).voiceURI,'uk');assert.equal(audio.chooseVoice([ru,old,uk],'old').voiceURI,'old');
 assert.equal(audio.chooseVoice([ru],'ru'),null);assert.equal(audio.chooseVoice([]),null);
});
test('dictionary records match the exact word, prefer UK, and retain attribution',()=>{
 const r=audio.pickRecording(entry(),'hello');assert.match(r.url,/-uk.mp3$/);assert.equal(r.accent,'UK');assert.ok(r.source);assert.ok(r.license);
 assert.equal(audio.pickRecording(entry(),'hell'),null);
 for(const url of ['http://api.dictionaryapi.dev/audio.mp3','https://evil.test/audio.mp3','javascript:alert(1)','https://api.dictionaryapi.dev@evil.test/x.mp3']){
  assert.equal(audio.pickRecording([{word:'hello',phonetics:[{audio:url}]}],'hello'),null);
 }
});
test('a dictionary recording plays without synthetic speech and repeated taps reuse the lookup',async()=>{
 const f=fixture();await f.engine.speak('hello');await f.engine.speak('hello');
 assert.equal(f.requests.length,1);assert.match(f.played[0],/-uk.mp3$/);assert.equal(f.spoken.length,0);assert.equal(f.reports.at(-1).source,'https://commons.wikimedia.org/w/index.php?curid=1');
 assert.equal(f.requests[0].opts.credentials,'omit');assert.equal(f.requests[0].url,'https://api.dictionaryapi.dev/api/v2/entries/en/hello');
});
test('missing recordings, failed lookup and failed playback fall back to a selected English voice',async()=>{
 for(const overrides of [{fetchPage:async()=>({ok:false})},{fetchPage:async()=>{throw Error('Offline');}},{makeAudio:()=>({play:async()=>{throw Error('Not available');},pause(){}})}]){
  const f=fixture(overrides);await f.engine.speak('hello');assert.equal(f.spoken.length,1);assert.equal(f.spoken[0].lang,'en-GB');assert.equal(f.spoken[0].voice.voiceURI,'uk');assert.equal(f.spoken[0].rate,0.95);
 }
});
test('phrases use the chosen English voice without requesting the dictionary or uploading recordings',async()=>{
 const f=fixture();f.engine.updatePreferences({voiceURI:'old',rate:0.85});await f.engine.speak("can't stand");
 assert.equal(f.requests.length,0);assert.equal(f.spoken[0].text,"can't stand");assert.equal(f.spoken[0].voice.voiceURI,'old');assert.equal(f.spoken[0].rate,0.85);
 assert.equal(JSON.parse(f.stored.get('wordpet-pronunciation-v1')).voiceURI,'old');
});
test('unavailable English voices produce an explanation and never use the device default voice',async()=>{
 const f=fixture({synth:{getVoices:()=>[ru],cancel(){},speak(){throw Error('must not speak Russian');}}});
 // A populated English list is deliberately absent; wait for the bounded initialization.
 assert.equal(await f.engine.speak('a phrase'),false);assert.match(f.reports.at(-1).message,/Английский голос недоступен/);
});
test('late voice loading is awaited before choosing a voice',async()=>{
 let ready=false,listener,spoken;
 const synth={getVoices:()=>ready?[uk]:[],cancel(){},speak:u=>spoken=u,addEventListener:(_,fn)=>{listener=fn;},removeEventListener(){}};
 const f=fixture({synth});const result=f.engine.speak('a phrase');await new Promise(setImmediate);assert.equal(typeof listener,'function');ready=true;listener();await result;
 assert.equal(spoken.voice.voiceURI,'uk');
});
test('stopping or replacing a pending lookup prevents late audio from the previous question',async()=>{
 let finish;const f=fixture({fetchPage:()=>new Promise(resolve=>finish=resolve)});
 const previous=f.engine.speak('hello');f.engine.stop();finish({ok:true,json:async()=>entry()});await previous;
 assert.equal(f.played.length,0);assert.equal(f.spoken.length,0);
});
