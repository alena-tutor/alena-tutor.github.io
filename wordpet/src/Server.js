/* Google Apps Script backend. All helpers ending in _ are private to script.run. */
const APP_CONFIG = {
  title: 'WordPet', databaseId: '__DATABASE_ID__', timezone: 'Asia/Irkutsk', webAppUrl: '', version: '1.4.0',
  sourceSheet: 'Глоссарий'
};
const SCHEMA = {
  'Ученики': ['id','name','sourceId','sourceSheet','lastSync','syncStatus'],
  'Слова': ['id','studentId','english','russian','addedOn','lessonOn','hardOn','active','example','answers','topic','source','notes','russianAliases'],
  'Прогресс': ['studentId','wordId','skill','streak','correct','wrong','nextReview','lastAt','lastEventId'],
  'Питомцы': ['studentId','name','species','xp','food','clean','coins','rations','lastDecay','lastRewardDay','lastBonusDay','accessory'],
  'Тренировки': ['id','studentId','createdAt','day','mode','status','payload'],
  'Ответы': ['id','sessionId','studentId','wordId','kind','submittedAt','text','audioId','mime','status','correct','feedback','reviewedAt'],
  'Доступ': ['personId','role','token','link']
};
let DB_HANDLE_;
let SHEET_HANDLES_ = {};
let ROW_CACHE_ = {};
function doGet() {
  return HtmlService.createHtmlOutput(APP_HTML_).setTitle('WordPet — слова и питомец')
    .addMetaTag('viewport','width=device-width, initial-scale=1, viewport-fit=cover');
}
function onOpen() {
  SpreadsheetApp.getUi().createMenu('WordPet')
    .addItem('Первый запуск', 'setupWordPet')
    .addItem('Обновить ссылки после публикации', 'refreshStudentLinks')
    .addItem('Синхронизировать глоссарии', 'syncGlossaries')
    .addToUi();
}
function ownerOnly_() {
  const active = Session.getActiveUser().getEmail();
  const owner = db_().getOwner().getEmail();
  if (!active || active !== owner) throw Error('Эта операция доступна только владельцу таблицы из редактора Google.');
}
function db_() { if (!DB_HANDLE_) DB_HANDLE_ = SpreadsheetApp.openById(APP_CONFIG.databaseId); return DB_HANDLE_; }
function props_() { return PropertiesService.getScriptProperties(); }
function now_() { return new Date().toISOString(); }
function today_() { return Utilities.formatDate(new Date(), APP_CONFIG.timezone, 'yyyy-MM-dd'); }
function token_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g,''); }
function bool_(v) { return !(v === false || /^(false|нет|0)$/i.test(String(v))); }
function sheet_(name) {
  const sheet = SHEET_HANDLES_[name] || db_().getSheetByName(name);
  if (!sheet) throw Error('Не найден лист «' + name + '». Запустите setupWordPet.');
  SHEET_HANDLES_[name] = sheet;
  return sheet;
}
function rows_(name) {
  if (Object.prototype.hasOwnProperty.call(ROW_CACHE_,name)) return ROW_CACHE_[name];
  const sheet = sheet_(name);
  if (sheet.getLastRow() < 2) return ROW_CACHE_[name] = [];
  const keys = SCHEMA[name];
  const values = sheet.getRange(2,1,sheet.getLastRow()-1,keys.length).getValues();
  return ROW_CACHE_[name] = values.map((row,i) => {
    const out = { _row: i + 2 };
    const calendar = ['addedOn','lessonOn','hardOn','nextReview','lastDecay','lastRewardDay','lastBonusDay','day'];
    keys.forEach((k,j) => { out[k] = row[j] instanceof Date ? (calendar.includes(k) ? Utilities.formatDate(row[j],APP_CONFIG.timezone,'yyyy-MM-dd') : row[j].toISOString()) : row[j]; });
    return out;
  }).filter(r => r[keys[0]] !== '');
}
function cellValue_(value) {
  if (value == null) return '';
  // Plain-text input must not become a Sheets formula.
  if (typeof value === 'string' && /^[=+@\-]/.test(value)) return "'" + value;
  return value;
}
function put_(name, obj) {
  const sheet = sheet_(name);
  const row = SCHEMA[name].map(k => cellValue_(obj[k]));
  if (obj._row) sheet.getRange(obj._row,1,1,row.length).setValues([row]);
  else { obj._row = sheet.getLastRow() + 1; sheet.getRange(obj._row,1,1,row.length).setValues([row]); }
  if (ROW_CACHE_[name]) {
    const i = ROW_CACHE_[name].findIndex(r=>r._row===obj._row);
    if (i<0) ROW_CACHE_[name].push({...obj}); else ROW_CACHE_[name][i] = {...obj};
  }
  return obj;
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw Error('Сохранение уже выполняется. Попробуй ещё раз через несколько секунд.');
  try { return fn(); } finally { lock.releaseLock(); }
}
function setupWordPet() {
  ownerOnly_();
  ROW_CACHE_ = {};
  return withLock_(() => {
    const db = db_(); db.setSpreadsheetTimeZone(APP_CONFIG.timezone);
    Object.keys(SCHEMA).forEach(name => {
      const sh = db.getSheetByName(name) || db.insertSheet(name);
      if (sh.getLastRow() === 0) sh.getRange(1,1,1,SCHEMA[name].length).setValues([SCHEMA[name]]);
      const actual = sh.getRange(1,1,1,SCHEMA[name].length).getValues()[0];
      if (actual.join('|') !== SCHEMA[name].join('|')) throw Error('Структура листа «' + name + '» изменена. Сверьте заголовки.');
      sh.setFrozenRows(1);
    });
    const access = rows_('Доступ');
    if (!access.some(a => a.role === 'teacher')) put_('Доступ',{personId:'alena',role:'teacher',token:token_(),link:''});
    const pets = rows_('Питомцы');
    rows_('Ученики').forEach(s => {
      if (!access.some(a => a.personId === s.id)) put_('Доступ',{personId:s.id,role:'student',token:token_(),link:''});
      if (!pets.some(p => p.studentId === s.id)) put_('Питомцы',{studentId:s.id,name:'Рыжик',species:'fox',xp:0,food:65,clean:75,coins:0,rations:1,lastDecay:today_(),lastRewardDay:'',lastBonusDay:'',accessory:'none'});
    });
    refreshLinks_();
    syncGlossaries_();
    const existing = ScriptApp.getProjectTriggers();
    if (!existing.some(t => t.getHandlerFunction() === 'syncScheduled_')) ScriptApp.newTrigger('syncScheduled_').timeBased().everyHours(6).create();
    return 'Готово. После публикации веб-приложения запустите refreshStudentLinks. Личные ссылки появятся на листе «Доступ».';
  });
}
function refreshStudentLinks() { ownerOnly_(); return withLock_(refreshLinks_); }
function refreshLinks_() {
  const url = APP_CONFIG.webAppUrl || ScriptApp.getService().getUrl();
  if (!url || /\/dev$/.test(url)) return 'Сначала укажите URL опубликованного веб-приложения в APP_CONFIG.webAppUrl и обновите развертывание. Развернуть: Развернуть → Новое развертывание → Веб-приложение.';
  rows_('Доступ').forEach(row => { row.link = url + '#key=' + encodeURIComponent(row.token); put_('Доступ',row); });
  return 'Личные ссылки обновлены на листе «Доступ».';
}
function syncGlossaries() { ownerOnly_(); ROW_CACHE_ = {}; return withLock_(syncGlossaries_); }
function syncScheduled_() { ROW_CACHE_ = {}; return withLock_(() => { const sync=syncGlossaries_(); try { archiveScheduled_(); } catch(e) { props_().setProperty('ARCHIVE_ERROR',String(e.message).slice(0,300)); } return sync; }); }
function syncGlossaries_() {
  const results = [];
  const all = rows_('Слова');
  rows_('Ученики').forEach(student => {
    if (!student.sourceId) return;
    try {
      const sourceBook = SpreadsheetApp.openById(student.sourceId);
      const src = sourceBook.getSheetByName(student.sourceSheet || APP_CONFIG.sourceSheet);
      if (!src) throw Error('Не найден лист глоссария');
      if (src.getLastRow() > 5000) throw Error('Глоссарий больше 5000 строк: требуется отдельная настройка импорта.');
      const raw = src.getLastRow() ? src.getRange(1,1,src.getLastRow(),Math.min(src.getLastColumn(),12)).getValues().map(row=>row.map(v=>v instanceof Date?Utilities.formatDate(v,sourceBook.getSpreadsheetTimeZone(),'yyyy-MM-dd'):v)) : [];
      const parsed = WordPetCore.parseGlossary(raw, student.id);
      parsed.forEach(word => {
        const old = all.find(w => w.id === word.id);
        if (old) {
          const newer = WordPetCore.day(word.lessonOn) >= WordPetCore.day(old.lessonOn);
          const merged = {...old, russian:old.source==='teacher'?old.russian:word.russian, topic:word.topic, notes:word.notes};
          if (newer) merged.lessonOn = word.lessonOn;
          if (word.hardOn && word.hardOn > WordPetCore.day(old.hardOn)) merged.hardOn = word.hardOn;
          // Teacher-authored examples, accepted variants and explicit active setting survive sync.
          if (!old.example) merged.example = WORD_EXAMPLES_[WordPetCore.norm(word.english)]?.example || '';
          put_('Слова',merged);
        } else {
          const ex = WORD_EXAMPLES_[WordPetCore.norm(word.english)] || {};
          put_('Слова',{...word,example:ex.example || '',answers:ex.answers || '',russianAliases:ex.russianAliases || ''});
        }
      });
      student.lastSync = now_(); student.syncStatus = parsed.length ? 'Синхронизировано: ' + parsed.length + ' слов' : 'Глоссарий пока пуст';
      put_('Ученики',student); results.push({student:student.name,ok:true,count:parsed.length});
    } catch(e) {
      student.syncStatus = 'Ошибка: ' + String(e.message).slice(0,180); put_('Ученики',student);
      results.push({student:student.name,ok:false,error:'Не удалось прочитать глоссарий. Проверьте доступ владельца.'});
    }
  });
  return results;
}
function authenticate_(key) {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/i.test(key)) throw Error('Открой свою личную ссылку или введи код доступа.');
  const access = rows_('Доступ').find(a => a.token === key);
  if (!access) throw Error('Код доступа не найден. Попроси преподавателя проверить твою ссылку.');
  return access;
}
function api(request) {
  ROW_CACHE_ = {};
  if (!request || typeof request !== 'object') throw Error('Некорректный запрос.');
  const access = authenticate_(request.key);
  const action = request.action;
  const data = request.data || {};
  // Never dispatch arbitrary function names from user input.
  const methods = access.role === 'teacher' ? {
    bootstrap:() => teacherDashboard_(), sync:() => withLock_(syncGlossaries_),
    addWord:() => withLock_(() => teacherWord_(data)),
    markHard:() => withLock_(() => teacherHard_(data)),
    review:() => withLock_(() => review_(data)), audio:() => audio_(data),
    rotateKey:() => withLock_(() => rotateKey_(data)),
    archiveStatus:() => archiveStatus_(), archiveHistory:() => withLock_(archiveScheduled_)
  } : {
    bootstrap:() => withLock_(() => studentDashboard_(access.personId)),
    start:() => withLock_(() => start_(access.personId,data)),
    answer:() => withLock_(() => answer_(access.personId,data)),
    care:() => withLock_(() => care_(access.personId,data)),
    savePet:() => withLock_(() => savePet_(access.personId,data)),
    noAudio:() => withLock_(() => noAudio_(access.personId,data)),
    myAudio:() => myAudio_(access.personId,data)
  };
  if (!Object.prototype.hasOwnProperty.call(methods,action)) throw Error('Действие недоступно.');
  return methods[action]();
}
function words_(studentId) { return rows_('Слова').filter(w => w.studentId === studentId && bool_(w.active)); }
function progress_(studentId) { return rows_('Прогресс').filter(p => p.studentId === studentId); }
function pet_(studentId) {
  const p = rows_('Питомцы').find(p => p.studentId === studentId);
  if (!p) throw Error('Питомец ещё не создан. Преподавателю нужно запустить setupWordPet.');
  const days = Math.max(0,Math.floor((WordPetCore.dateValue(today_()) - WordPetCore.dateValue(p.lastDecay)) / 86400000));
  if (days) {
    p.food = Math.max(25, Number(p.food) - Math.min(days,7) * 8);
    p.clean = Math.max(25, Number(p.clean) - Math.min(days,7) * 6);
    p.lastDecay = today_(); put_('Питомцы',p);
  }
  return p;
}
function publicPet_(p) {
  return {name:p.name,species:p.species,xp:Number(p.xp),level:Math.floor(Number(p.xp)/100)+1,food:Number(p.food),clean:Number(p.clean),coins:Number(p.coins),rations:Number(p.rations),accessory:p.accessory};
}
function studentDashboard_(studentId) {
  const student = rows_('Ученики').find(s => s.id === studentId);
  if (!student) throw Error('Ученик не найден.');
  const words = words_(studentId), progress = progress_(studentId), today = today_();
  const sessions = rows_('Тренировки').filter(s => s.studentId === studentId);
  const answers = rows_('Ответы').filter(a => a.studentId === studentId);
  const seen = new Set(progress.map(p => p.wordId));
  const byCategory = {hard:0,recent:0,review:0};
  words.forEach(w => byCategory[WordPetCore.category(w,progress,today)]++);
  return {role:'student',name:student.name,studentId,today,pet:publicPet_(pet_(studentId)),
    words:words.map(w => ({id:w.id,english:w.english,russian:w.russian,example:w.example,topic:w.topic,category:WordPetCore.category(w,progress,today),mastered:WordPetCore.mastered(w,progress)})),
    counts:byCategory,stats:{total:words.length,seen:seen.size,mastered:words.filter(w => WordPetCore.mastered(w,progress)).length,
      completed:sessions.filter(s => s.status === 'completed' && s.mode === 'daily').length+archiveTotal_(studentId,sessions).completed,
      pending:answers.filter(a => a.status === 'pending').length},
    history:sessions.filter(s => s.status === 'completed').slice(-14).map(s => ({day:s.day,mode:s.mode,score:sessionScore_(JSON.parse(s.payload))})),
    reviews:answers.filter(a => a.status === 'reviewed').slice(-10).reverse().map(a => ({kind:a.kind,english:words.find(w => w.id === a.wordId)?.english || a.wordId,correct:a.correct,feedback:a.feedback,date:a.reviewedAt})),
    syncStatus:student.syncStatus,lastSync:student.lastSync,version:APP_CONFIG.version};
}
function sessionScore_(payload) {
  const auto = payload.results.filter(r => r.correct !== null && !r.isReview);
  return auto.length ? Math.round(100 * auto.filter(r => r.correct).length / auto.length) : null;
}
function sessionResponse_(s) {
  const payload = JSON.parse(s.payload);
  if (s.status === 'active' && WordPetCore.migrateTasks(payload)) {
    s.payload = JSON.stringify(payload); put_('Тренировки',s);
  }
  return {id:s.id,mode:s.mode,status:s.status,index:payload.results.length,total:payload.tasks.length,
    task:WordPetCore.publicTask(payload.tasks[payload.results.length]),score:sessionScore_(payload),
    studyWords:payload.studyWords || WordPetCore.studyWords(payload.tasks),
    previous:payload.results.length ? payload.results[payload.results.length-1] : null,
    summary:s.status === 'completed' ? payload.summary : null};
}
function start_(studentId,data) {
  const all = rows_('Тренировки').filter(s => s.studentId === studentId && s.day === today_());
  const active = all.find(s => s.status === 'active');
  if (active) return sessionResponse_(active);
  const daily = all.find(s => s.mode === 'daily' && s.status === 'completed');
  if (daily && !data.retry) return sessionResponse_(daily);
  if (all.length >= 4) throw Error('На сегодня достаточно тренировок. Завтра будут новые задания.');
  const words = words_(studentId), progress = progress_(studentId);
  if (!words.length) throw Error('В глоссарии пока нет слов. Преподаватель скоро добавит их.');
  let candidates = words;
  if (data.retry && daily) {
    const failed = JSON.parse(daily.payload).results.filter(r => r.correct === false).map(r => r.wordId);
    candidates = words.filter(w => failed.includes(w.id));
    if (!candidates.length) candidates = words;
  }
  const picked = WordPetCore.selectWords(candidates,progress,today_());
  let tasks = WordPetCore.makeTasks(picked,words,progress,today_());
  const studyWords = picked.map(w => ({id:w.id,english:w.english,russian:w.russian,example:w.example || ''}));
  const s = {id:Utilities.getUuid(),studentId,createdAt:now_(),day:today_(),mode:daily?'retry':'daily',status:'active',payload:JSON.stringify({tasks,studyWords,results:[]})};
  put_('Тренировки',s); return sessionResponse_(s);
}
function answer_(studentId,data) {
  const s = rows_('Тренировки').find(s => s.id === data.sessionId && s.studentId === studentId);
  if (!s) throw Error('Тренировка не найдена. Открой её заново.');
  const p = JSON.parse(s.payload);
  if (s.status === 'active' && WordPetCore.migrateTasks(p)) {
    s.payload = JSON.stringify(p); put_('Тренировки',s);
  }
  const old = p.results.find(r => r.taskId === data.taskId);
  if (old) return {result:old,session:sessionResponse_(s),pet:publicPet_(pet_(studentId))};
  if (s.status !== 'active' || s.day !== today_()) throw Error('Эта тренировка завершена или относится к другому дню. Начни новую.');
  const task = p.tasks[p.results.length];
  if (!task || task.id !== data.taskId) throw Error('Порядок заданий изменился. Обнови тренировку.');
  const unknown = data.unknown === true;
  const timestamp = now_();
  let text = String(data.answer || '').trim().slice(0,1500);
  if (!text && !unknown) throw Error('Сначала введи или выбери ответ.');
  if (unknown) text = 'Не знаю';
  const correct = unknown ? false : WordPetCore.grade(task,text);
  if (typeof correct !== 'boolean') throw Error('Задание изменилось. Обнови тренировку.');
  const records = progress_(studentId);
  const previous = records.find(r => r.wordId === task.wordId && r.skill === task.kind);
  const eventId = s.id + ':' + task.id;
  if (previous?.lastEventId !== eventId) {
    const record = {...WordPetCore.updateProgress(previous,task,correct,timestamp,today_()),studentId,lastEventId:eventId};
    put_('Прогресс',record);
  }
  const answerId = '';
  const result = {taskId:task.id,wordId:task.wordId,kind:task.kind,correct,answerId,unknown,isReview:Boolean(task.isReview),
    answer:text,
    expected:correct === false ? (task.kind === 'write_ru' || task.kind === 'choose' ? task.russian : task.sentenceAnswer || task.gapAnswer || task.english) : '',timestamp};
  p.results.push(result);
  WordPetCore.queueReview(p,task,correct);
  if (p.results.length === p.tasks.length) { s.status = 'completed'; p.summary = reward_(studentId,s,p); }
  s.payload = JSON.stringify(p); put_('Тренировки',s);
  return {result,session:sessionResponse_(s),pet:publicPet_(pet_(studentId))};
}
function reward_(studentId,s,p) {
  const pet = pet_(studentId), score = sessionScore_(p);
  let xp = 0, rations = 0, coins = 0;
  if (s.mode === 'daily' && pet.lastRewardDay !== today_()) {
    xp += p.results.filter(r => r.correct === true && !r.isReview).length * 5 + 10;
    rations += 1; pet.lastRewardDay = today_();
  }
  if (score >= 90 && pet.lastBonusDay !== today_()) {
    xp += 20; rations += 1; coins += 10; pet.lastBonusDay = today_();
  }
  pet.xp = Number(pet.xp) + xp; pet.rations = Number(pet.rations) + rations; pet.coins = Number(pet.coins) + coins;
  put_('Питомцы',pet);
  return {score,xp,rations,coins,pending:p.results.filter(r => r.correct === null).length,bonus:coins > 0};
}
function noAudio_(studentId,data) {
  const s = rows_('Тренировки').find(s=>s.id===data.sessionId && s.studentId===studentId && s.status==='active');
  if (!s) throw Error('Активная тренировка не найдена.');
  const p = JSON.parse(s.payload), task = p.tasks[p.results.length];
  if (!task || task.kind !== 'listen') throw Error('Это действие доступно только в задании на слух.');
  task.kind = 'write_en'; s.payload = JSON.stringify(p); put_('Тренировки',s); return sessionResponse_(s);
}
function care_(studentId,data) {
  const pet = pet_(studentId);
  if (data.kind === 'feed') {
    if (Number(pet.rations) < 1) throw Error('Корм закончился. Пройди тренировку, чтобы получить порцию.');
    if (Number(pet.food) >= 100) throw Error('Питомец уже сыт. Сохрани корм на потом.');
    pet.rations = Number(pet.rations) - 1; pet.food = Math.min(100,Number(pet.food)+30);
  } else if (data.kind === 'clean') {
    if (pet.lastRewardDay !== today_()) throw Error('Сначала выполни сегодняшнюю тренировку — откроется уборка комнаты.');
    pet.clean = 100;
  } else if (data.kind === 'toy') {
    if (pet.accessory === 'ball') throw Error('Мячик уже есть в комнате.');
    if (Number(pet.coins) < 20) throw Error('Для мячика нужно 20 монет. Бонус за 90% приносит 10 монет.');
    pet.coins = Number(pet.coins)-20; pet.accessory = 'ball';
  } else throw Error('Неизвестное действие.');
  put_('Питомцы',pet); return publicPet_(pet);
}
function savePet_(studentId,data) {
  if (data.name === undefined && data.species === undefined) throw Error('Выбери питомца или укажи имя.');
  const name = data.name === undefined ? null : typeof data.name === 'string' ? data.name.trim() : '';
  if (name !== null && (name.length < 2 || name.length > 20)) throw Error('Имя должно содержать от 2 до 20 символов.');
  if (data.species !== undefined && !WordPetCore.petSpecies.some(p => p.id === data.species)) throw Error('Выбери питомца из списка.');
  const pet = pet_(studentId);
  if (name !== null) pet.name = name;
  if (data.species !== undefined) pet.species = data.species;
  put_('Питомцы',pet); return publicPet_(pet);
}
function teacherDashboard_() {
  const words = rows_('Слова'), progress = rows_('Прогресс'), sessions = rows_('Тренировки'), answers = rows_('Ответы');
  return {role:'teacher',today:today_(),students:rows_('Ученики').map(s => {
    const ws = words.filter(w => w.studentId === s.id && bool_(w.active));
    const ps = progress.filter(p => p.studentId === s.id);
    const ss = sessions.filter(t => t.studentId === s.id && t.status === 'completed' && t.mode === 'daily');
    return {id:s.id,name:s.name,total:ws.length,mastered:ws.filter(w => WordPetCore.mastered(w,ps)).length,
      doneToday:ss.some(t => t.day === today_()),lastPractice:ss.length ? ss[ss.length-1].createdAt : archiveTotal_(s.id,sessions).lastPractice,
      syncStatus:s.syncStatus,lastSync:s.lastSync,pending:answers.filter(a => a.studentId===s.id && a.status==='pending').length,
      words:ws.map(w => ({id:w.id,english:w.english,russian:w.russian,example:w.example,answers:w.answers,russianAliases:w.russianAliases,hardOn:WordPetCore.day(w.hardOn),category:WordPetCore.category(w,ps,today_())})),
      history:ss.slice(-7).map(t => ({day:t.day,score:sessionScore_(JSON.parse(t.payload))}))};
  }),pending:answers.filter(a => a.status === 'pending').map(a => ({id:a.id,studentId:a.studentId,wordId:a.wordId,
    english:words.find(w=>w.id===a.wordId)?.english || a.wordId,kind:a.kind,text:a.text,date:a.submittedAt,hasAudio:Boolean(a.audioId)})),
    access:rows_('Доступ').map(a => ({personId:a.personId,role:a.role,link:a.link})),archive:archiveStatus_(),version:APP_CONFIG.version};
}
function teacherWord_(data) {
  const student = rows_('Ученики').find(s => s.id === data.studentId);
  if (!student) throw Error('Выбери ученика.');
  const english = String(data.english || '').trim(), russian = String(data.russian || '').trim();
  if (!english || !russian || english.length > 160 || russian.length > 300) throw Error('Укажи слово и перевод.');
  const id = WordPetCore.key(student.id,english), old = rows_('Слова').find(w => w.id === id);
  put_('Слова',{...(old || {}),id,studentId:student.id,english,russian,addedOn:old?.addedOn || today_(),lessonOn:today_(),
    hardOn:data.hard ? today_() : old?.hardOn || '',active:true,example:String(data.example || '').slice(0,500),
    answers:String(data.answers || '').slice(0,400),russianAliases:String(data.russianAliases || '').slice(0,400),topic:'С урока',source:'teacher',notes:old?.notes || ''});
  return {ok:true};
}
function teacherHard_(data) {
  const word = rows_('Слова').find(w => w.id === data.wordId);
  if (!word) throw Error('Слово не найдено.');
  word.hardOn = today_(); word.lessonOn = today_(); put_('Слова',word); return {ok:true};
}
function audio_(data) {
  const a = rows_('Ответы').find(a=>a.id===data.answerId && a.audioId);
  if (!a) throw Error('Запись не найдена.');
  const blob = DriveApp.getFileById(a.audioId).getBlob();
  return {audio:Utilities.base64Encode(blob.getBytes()),mime:a.mime};
}
function myAudio_(studentId,data) {
  const a = rows_('Ответы').find(a=>a.id===data.answerId && a.studentId===studentId);
  if (!a) throw Error('Запись недоступна.');
  return audio_(data);
}
function review_(data) {
  const a = rows_('Ответы').find(a => a.id === data.answerId);
  if (!a) throw Error('Ответ не найден.');
  if (a.status === 'reviewed') throw Error('Этот ответ уже проверен.');
  if (typeof data.correct !== 'boolean') throw Error('Выбери результат проверки.');
  a.status = 'reviewed'; a.correct = data.correct; a.feedback = String(data.feedback || '').slice(0,1500); a.reviewedAt = now_();
  put_('Ответы',a);
  const previous = progress_(a.studentId).find(p => p.wordId === a.wordId && p.skill === a.kind);
  put_('Прогресс',{...WordPetCore.updateProgress(previous,{wordId:a.wordId,kind:a.kind},data.correct,now_(),today_()),studentId:a.studentId,lastEventId:a.id});
  return {ok:true};
}
function rotateKey_(data) {
  const a = rows_('Доступ').find(a=>a.personId===data.studentId && a.role==='student');
  if (!a) throw Error('Ученик не найден.');
  a.token = token_(); put_('Доступ',a); refreshLinks_();
  return {ok:true,link:rows_('Доступ').find(r=>r.personId===a.personId).link};
}
