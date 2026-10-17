/* Shared learning rules. No Google APIs, DOM or credentials. */
const WordPetCore = (() => {
  const petSpecies = Object.freeze([
    Object.freeze({id:'fox',label:'Лисёнок',description:'Любопытный исследователь'}),
    Object.freeze({id:'cat',label:'Котёнок',description:'Уютный напарник'}),
    Object.freeze({id:'dog',label:'Щенок',description:'Верный друг'}),
    Object.freeze({id:'dragon',label:'Дракончик',description:'Маленький любитель приключений'})
  ]);
  const dayMs = 86400000;
  const norm = value => String(value == null ? '' : value).normalize('NFKC').toLowerCase()
    .replace(/[‘’ʼ`]/g, "'").replace(/[‐‑–—]/g, '-').replace(/\s+/g, ' ').trim()
    .replace(/[.!?]+$/g, '');
  const day = value => {
    if (!value) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const text = String(value).trim();
    const ru = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    return ru ? `${ru[3]}-${ru[2].padStart(2,'0')}-${ru[1].padStart(2,'0')}` : text.slice(0,10);
  };
  const dateValue = value => Date.parse(day(value) + 'T00:00:00Z') || 0;
  const key = (student, english) => student + ':' + norm(english);
  const englishAnswers = word => [...new Set([word.english, ...String(word.answers || '').split('|')].map(norm).filter(Boolean))];
  const russianAnswers = word => [...new Set([word.russian, ...String(word.russian || '').split(/[;/]/), ...String(word.russianAliases || '').split('|')].map(norm).filter(Boolean))];
  function parseGlossary(rows, studentId) {
    if (!rows.length) return [];
    const headers = rows[0].map(norm);
    const idx = {
      date: headers.findIndex(x => /дата|date/.test(x)),
      topic: headers.findIndex(x => /тема|topic/.test(x)),
      vocabulary: headers.findIndex(x => /vocabulary|лексика|слова/.test(x)),
      phrases: headers.findIndex(x => /phrases|constructions|выражения|фразы/.test(x)),
      notes: headers.findIndex(x => /заметки|notes|комментарий/.test(x))
    };
    if (idx.vocabulary < 0) throw Error('Не найден столбец Vocabulary / Слова в глоссарии.');
    const result = {};
    rows.slice(1).forEach(row => {
      const lessonOn = day(row[idx.date]);
      const notes = String(row[idx.notes] || '');
      const lines = [row[idx.vocabulary], row[idx.phrases]].filter(Boolean).join('\n').split(/\r?\n/);
      const parsed = lines.map(line => {
        const m = String(line).trim().match(/^(.+?)\s+[—–-]\s+(.+)$/);
        return m ? { english: m[1].trim(), russian: m[2].trim() } : null;
      }).filter(Boolean);
      const hardNote = /трудн|запада|не запом|пута|не усво|не знает/i.test(notes);
      const named = parsed.filter(w => norm(notes).includes(norm(w.english)));
      parsed.forEach(w => {
        const id = key(studentId, w.english);
        const previous = result[id];
        const hard = hardNote && (!named.length || named.some(x => x.english === w.english));
        result[id] = {
          id, studentId, english: w.english, russian: w.russian,
          addedOn: previous ? previous.addedOn : lessonOn,
          lessonOn: lessonOn > (previous?.lessonOn || '') ? lessonOn : previous?.lessonOn || lessonOn,
          hardOn: hard ? lessonOn : previous?.hardOn || '', active: true,
          example: previous?.example || '', answers: '', topic: String(row[idx.topic] || ''),
          source: 'glossary', notes
        };
      });
    });
    return Object.values(result);
  }
  const shuffle = (arr, random = Math.random) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  function category(word, records, today) {
    const p = records.filter(r => r.wordId === word.id);
    const lastAt = p.reduce((v,r) => String(r.lastAt || '') > v ? String(r.lastAt) : v, '');
    if ((word.hardOn && dateValue(word.hardOn) >= dateValue(lastAt)) || p.some(r => Number(r.wrong) > 0 && Number(r.streak) < 2)) return 'hard';
    if (dateValue(today) - dateValue(word.lessonOn) <= 2 * dayMs) return 'recent';
    return 'review';
  }
  function selectWords(words, progress, today, limit = 6, random = Math.random) {
    const active = words.filter(w => w.active !== false && w.english && w.russian);
    const groups = { hard: [], recent: [], review: [] };
    active.forEach(w => groups[category(w, progress, today)].push(w));
    Object.keys(groups).forEach(k => {
      groups[k] = shuffle(groups[k], random).sort((a,b) => {
        const due = w => {
          const records = progress.filter(p => p.wordId === w.id);
          return records.length ? Math.min(...records.map(p => dateValue(p.nextReview))) : 0;
        };
        return due(a) - due(b);
      });
    });
    const chosen = [];
    // Every available category receives a place before extra hard words fill the round.
    ['hard', 'recent', 'review', 'hard', 'review', 'recent'].forEach(k => {
      if (chosen.length < limit && groups[k].length) chosen.push(groups[k].shift());
    });
    ['hard', 'review', 'recent'].forEach(k => {
      while (chosen.length < limit && groups[k].length) chosen.push(groups[k].shift());
    });
    return shuffle(chosen, random);
  }
  function makeTasks(selected, allWords, records, today, random = Math.random) {
    if (!selected.length) return [];
    const types = ['choose', 'write_en', 'write_ru', 'listen', 'gap'];
    const tasks = [];
    for (let i = 0; i < 10; i++) {
      const word = selected[i % selected.length];
      let kind = types[i % types.length];
      // A meaningful gap needs an authored example containing the literal target or alternatives.
      const match = [word.english, ...String(word.answers || '').split('|')].filter(Boolean)
        .find(answer => word.example && norm(word.example).includes(norm(answer)));
      if (kind === 'gap' && !match) kind = 'write_en';
      const escaped = match?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const prompt = kind === 'gap' ? word.example.replace(new RegExp(escaped, 'i'), '______') : '';
      let options = [];
      if (kind === 'choose') {
        const targetMeanings = russianAnswers(word);
        options = shuffle([word.russian, ...shuffle(allWords.filter(w => !russianAnswers(w).some(answer=>targetMeanings.includes(answer))), random)
          .map(w => w.russian).filter((v,ix,a) => a.indexOf(v) === ix).slice(0,3)], random);
        if (options.length < 2) kind = 'write_en';
      }
      tasks.push({ id: 't' + i, wordId: word.id, kind, english: word.english, russian: word.russian,
        answers: kind === 'write_ru' ? russianAnswers(word) : englishAnswers(word), options, prompt,
        gapAnswer: kind === 'gap' ? match : '', category: category(word, records, today) });
    }
    const words = shuffle(selected, random);
    ['sentence', 'voice'].forEach((kind,i) => {
      const w = words[i % words.length];
      tasks.push({ id: 't' + tasks.length, wordId: w.id, kind, english: w.english, russian: w.russian,
        prompt: 'Расскажи о себе: используй слово или выражение в своём предложении.', category: category(w,records,today) });
    });
    return shuffle(tasks.slice(0,10), random).concat(tasks.slice(10));
  }
  function publicTask(task) {
    if (!task) return null;
    const t = { id: task.id, wordId: task.wordId, kind: task.kind, options: task.options || [], prompt: task.prompt || '', category: task.category, isReview: Boolean(task.isReview) };
    if (['choose','write_ru','sentence','voice'].includes(task.kind)) t.english = task.english;
    if (['write_en','gap'].includes(task.kind)) t.russian = task.russian;
    if (task.kind === 'listen') t.speak = task.english;
    return t;
  }
  function grade(task, answer) {
    if (task.kind === 'choose') return norm(answer) === norm(task.russian);
    if (['sentence','voice'].includes(task.kind)) return null;
    return task.answers.includes(norm(answer));
  }
  function studyWords(tasks) {
    const seen = new Set();
    return tasks.filter(t => !seen.has(t.wordId) && seen.add(t.wordId))
      .map(t => ({id:t.wordId,english:t.english,russian:t.russian}));
  }
  function queueReview(payload, task, correct) {
    if (correct !== false || ['sentence','voice'].includes(task.kind)) return;
    const next = payload.results.length;
    const production = payload.tasks.findIndex((t,i) => i >= next && ['sentence','voice'].includes(t.kind));
    const boundary = production < 0 ? payload.tasks.length : production;
    const repeat = {...task,id:'r'+next+'-'+payload.tasks.length,isReview:true,reviewOf:task.reviewOf || task.id};
    payload.tasks.splice(Math.min(next+2,boundary),0,repeat);
  }
  function updateProgress(previous, task, correct, now, today) {
    const p = previous || { wordId: task.wordId, skill: task.kind, streak: 0, correct: 0, wrong: 0 };
    const streak = correct ? Number(p.streak || 0) + 1 : 0;
    const delay = correct ? [1, 3, 7, 14, 30, 60][Math.min(streak - 1,5)] : 0;
    return { ...p, streak, correct: Number(p.correct || 0) + (correct ? 1 : 0), wrong: Number(p.wrong || 0) + (correct ? 0 : 1),
      nextReview: new Date(dateValue(today) + delay * dayMs).toISOString().slice(0,10), lastAt: now };
  }
  const mastered = (word, progress) => {
    const p = progress.filter(x => x.wordId === word.id && ['write_en','listen','gap'].includes(x.skill));
    return p.some(x => Number(x.streak) >= 2);
  };
  return { petSpecies, norm, day, dateValue, key, parseGlossary, category, selectWords, makeTasks, publicTask, grade, studyWords, queueReview, updateProgress, mastered, shuffle };
})();
if (typeof module !== 'undefined') module.exports = WordPetCore;
