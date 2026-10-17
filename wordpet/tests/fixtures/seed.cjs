const core=require('../../src/Core.js');
const examples=require('../../src/examples.json');
const source=require('./source.json');
module.exports={students:source.map(s=>({id:s.studentId,name:s.name,sourceId:s.id,sourceSheet:s.sheet,lastSync:'2026-10-16T01:00:00Z',syncStatus:'Тестовые данные'})),words:source.flatMap(s=>core.parseGlossary(s.rows,s.studentId)).map(w=>({...w,...examples[core.norm(w.english)]}))};
