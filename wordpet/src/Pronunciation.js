/* Play prepared private recordings. No device speech synthesis or third-party lookup. */
const WordPetAudio = (() => {
  const SAMPLE='I enjoy learning English. A little practice every day makes a difference.';
  const clean=text=>String(text||'').normalize('NFKC').replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim();
  function create(options={}){
    const fetchClip=options.fetchClip || (async()=>null),report=options.onStatus || (()=>{});
    const makeAudio=options.makeAudio || (url=>new Audio(url)),store=options.store;
    let preferences={rate:1},generation=0,playing=null;
    const cache=new Map();
    try{preferences.rate=Number(JSON.parse(store?.getItem('wordpet-recorded-audio-v1')||'{}').rate)||1;}catch{}
    function updatePreferences(value){
      preferences={rate:Math.min(1.1,Math.max(0.85,Number(value.rate)||1))};
      try{store?.setItem('wordpet-recorded-audio-v1',JSON.stringify(preferences));}catch{}
      return {...preferences};
    }
    updatePreferences(preferences);
    async function clip(text){
      const key=clean(text),cached=cache.get(key);
      if(cached&&cached.expires>Date.now())return cached.value;
      const request=(async()=>{
        try{
          const data=await fetchClip(key);
          if(!data?.ready||data.mime!=='audio/mpeg'||typeof data.audio!=='string'||data.audio.length>700000||data.audio.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(data.audio))return null;
          return {url:'data:audio/mpeg;base64,'+data.audio};
        }catch{return null;}
      })();
      if(cache.size>=50)cache.delete(cache.keys().next().value);
      cache.set(key,{value:request,expires:Date.now()+30000});
      const value=await request;
      if(value)cache.set(key,{value:Promise.resolve(value),expires:Date.now()+600000});
      return value;
    }
    function stop(){generation++;if(playing){playing.onerror=null;playing.pause();playing=null;}}
    async function speak(text){
      stop();const token=generation;
      report({message:'Загружаем британскую запись…'});
      const recording=await clip(text);
      if(token!==generation)return false;
      if(!recording){report({message:'Запись пока готовится или недоступна. Попробуй позже; задание на слух можно заменить.',error:true});return false;}
      try{
        const audio=makeAudio(recording.url);playing=audio;audio.playbackRate=preferences.rate;audio.preservesPitch=true;
        let timer;
        const failure=new Promise((_,reject)=>{audio.onerror=()=>reject(Error('Audio unavailable'));});
        try{await Promise.race([Promise.resolve(audio.play()),failure,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Audio timeout')),8000);})]);}
        finally{clearTimeout(timer);}
        if(token!==generation){audio.pause();return false;}
        audio.onerror=()=>{if(token===generation)report({message:'Не удалось воспроизвести запись. Нажми на динамик ещё раз.',error:true});};
        report({message:'Британская нейроозвучка · Emma'});return true;
      }catch{
        if(playing){playing.onerror=null;playing.pause();playing=null;}
        report({message:'Запись загружена. Нажми на динамик ещё раз, чтобы включить звук.',error:true});return false;
      }
    }
    const preload=words=>Promise.allSettled(words.slice(0,6).map(w=>clip(typeof w==='string'?w:w.english)));
    return {speak,stop,clear:()=>{stop();cache.clear();},preload,ready:()=>Promise.resolve(),preferences:()=>({...preferences}),updatePreferences};
  }
  return {SAMPLE,clean,create};
})();
if(typeof module!=='undefined')module.exports=WordPetAudio;
