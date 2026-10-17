/* Dictionary recordings first; an explicitly selected English voice for the rest. */
const WordPetAudio = (() => {
  const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim();
  const englishVoices = voices => Array.from(voices || []).filter(v => /^en(?:[-_]|$)/i.test(v.lang));
  function chooseVoice(voices,preferred='') {
    const all = englishVoices(voices);
    const selected = all.find(v=>v.voiceURI === preferred);
    if (selected) return selected;
    const score = v => (/natural|neural|premium|enhanced|online/i.test(v.name)?80:0) + (/google/i.test(v.name)?65:0)
      + (/^en[-_]GB$/i.test(v.lang)?30:/^en[-_]US$/i.test(v.lang)?10:0) + (v.localService === false?4:0);
    return all.sort((a,b)=>score(b)-score(a))[0] || null;
  }
  function safeUrl(value,hosts) {
    try {
      const url = new URL(String(value || '').replace(/^\/\//,'https://'));
      return url.protocol === 'https:' && !url.username && !url.password && hosts.includes(url.hostname) ? url.href : '';
    } catch { return ''; }
  }
  function pickRecording(entries,word) {
    if (!Array.isArray(entries)) return null;
    const records = entries.filter(e=>normalize(e.word) === normalize(word)).flatMap(entry=>(entry.phonetics || []).map(p=>{
      const url = safeUrl(p.audio,['api.dictionaryapi.dev','ssl.gstatic.com','upload.wikimedia.org']);
      if (!url || !/\.(mp3|ogg|wav)$/i.test(new URL(url).pathname)) return null;
      const uk = /[-_]uk\.|[-_]gb[-_.]|_gb_/i.test(url), us = /[-_]us[-_.]/i.test(url);
      return {url,accent:uk?'UK':us?'US':'EN',phonetic:String(p.text || '').slice(0,100),
        source:safeUrl(p.sourceUrl || entry.sourceUrls?.[0],['commons.wikimedia.org','en.wiktionary.org','wiktionary.org']) || 'https://dictionaryapi.dev/',
        license:safeUrl(p.license?.url || entry.license?.url,['creativecommons.org']),licenseName:String(p.license?.name || entry.license?.name || '').slice(0,80)};
    }).filter(Boolean));
    return records.sort((a,b)=>({UK:3,US:2,EN:1}[b.accent]-{UK:3,US:2,EN:1}[a.accent]))[0] || null;
  }
  function create(options={}) {
    const synth = options.synth || globalThis.speechSynthesis;
    const fetchPage = options.fetchPage || globalThis.fetch?.bind(globalThis);
    const makeAudio = options.makeAudio || (url=>new Audio(url));
    const makeUtterance = options.makeUtterance || (text=>new SpeechSynthesisUtterance(text));
    const store = options.store;
    const report = options.onStatus || (()=>{});
    let preferences={mode:'auto',voiceURI:'',rate:0.95},generation=0,playing=null;
    const cache=new Map();
    try {preferences={...preferences,...JSON.parse(store?.getItem('wordpet-pronunciation-v1') || '{}')};} catch {}
    function updatePreferences(value) {
      preferences={mode:value.mode === 'voice'?'voice':'auto',voiceURI:String(value.voiceURI || '').slice(0,250),rate:Math.min(1.1,Math.max(0.8,Number(value.rate)||0.95))};
      try {store?.setItem('wordpet-pronunciation-v1',JSON.stringify(preferences));} catch {}
      return {...preferences};
    }
    updatePreferences(preferences);
    function voices() {try {return englishVoices(synth?.getVoices() || []);} catch {return [];}}
    async function ready() {
      if (voices().length || !synth) return voices();
      await new Promise(resolve=>{
        let timer;
        const done=()=>{clearTimeout(timer);synth.removeEventListener?.('voiceschanged',done);resolve();};
        synth.addEventListener?.('voiceschanged',done,{once:true});timer=setTimeout(done,1200);
      });
      return voices();
    }
    async function recording(text) {
      const word=normalize(text);
      if (!/^[a-z]+(?:['-][a-z]+)*$/.test(word) || word.length>60 || !fetchPage) return null;
      const cached=cache.get(word);
      if (cached && cached.expires>Date.now()) return cached.value;
      const request=(async()=>{
        try {
          const response=await fetchPage('https://api.dictionaryapi.dev/api/v2/entries/en/'+encodeURIComponent(word),{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(4000)});
          if (!response.ok) return null;
          return pickRecording(await response.json(),word);
        } catch {return null;}
      })();
      if (cache.size>=100) cache.delete(cache.keys().next().value);
      cache.set(word,{value:request,expires:Date.now()+600000});
      return request;
    }
    function stop() {
      generation++;
      if (playing) {playing.onerror=null;playing.pause();playing=null;}
      synth?.cancel();
    }
    async function browserSpeech(text,token) {
      const available=await ready();
      if (token!==generation) return false;
      const voice=chooseVoice(available,preferences.voiceURI);
      if (!voice || !synth) {report({message:'Английский голос недоступен. Выбери другой в «Озвучка» или замени задание на слух.',error:true});return false;}
      const utterance=makeUtterance(text);utterance.lang=voice.lang;utterance.voice=voice;utterance.rate=preferences.rate;utterance.pitch=1;
      utterance.onerror=e=>{if(token===generation&&!['canceled','interrupted'].includes(e.error))report({message:'Голос недоступен. Выбери другой в «Озвучка» или замени задание на слух.',error:true});};
      try {synth.speak(utterance);report({message:'Голос для слов и фраз: '+voice.name});return true;} catch {report({message:'Не удалось включить английский голос. Выбери другой в «Озвучка».',error:true});return false;}
    }
    async function speak(text,{forceVoice=false}={}) {
      stop();const token=generation;
      const clean=String(text || '').trim().slice(0,200);
      if (!clean) return false;
      report({message:'Загружаем произношение…'});
      const clip=!forceVoice && preferences.mode==='auto'?await recording(clean):null;
      if (token!==generation) return false;
      if (clip) {
        try {
          const audio=makeAudio(clip.url);playing=audio;
          let timer;
          const failure=new Promise((_,reject)=>{audio.onerror=()=>reject(Error('Audio unavailable'));});
          try {await Promise.race([Promise.resolve(audio.play()),failure,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Audio timeout')),6000);})]);}
          finally {clearTimeout(timer);}
          audio.onerror=()=>{if(token===generation && playing===audio){audio.onerror=null;audio.pause();playing=null;void browserSpeech(clean,token);}};
          if (token!==generation) {audio.pause();return false;}
          report({message:'Словарная запись · '+clip.accent+(clip.phonetic?' · '+clip.phonetic:''),source:clip.source,license:clip.license,licenseName:clip.licenseName});
          return true;
        } catch {
          if(playing){playing.onerror=null;playing.pause();playing=null;}
        }
      }
      return browserSpeech(clean,token);
    }
    function preload(words) {return preferences.mode==='auto'?Promise.allSettled(words.slice(0,6).map(w=>recording(typeof w==='string'?w:w.english))):Promise.resolve([]);}
    voices();
    return {speak,stop,ready,voices,preload,preferences:()=>({...preferences}),updatePreferences};
  }
  return {englishVoices,chooseVoice,pickRecording,create};
})();
if (typeof module !== 'undefined') module.exports=WordPetAudio;
