const test=require('node:test');
const assert=require('node:assert/strict');
const activity=require('../src/Activity.js');
test('active clock caps idle time, pauses hidden practice and resumes only after interaction',()=>{
 let time=0;const clock=activity.create({now:()=>time});
 clock.begin('session-a','visit-a');clock.setActive(true);
 time=20000;assert.equal(clock.sample().totalSeconds,20);
 time=180000;assert.equal(clock.sample().totalSeconds,60);
 clock.interact();time+=10000;assert.equal(clock.sample().totalSeconds,70);
 clock.setActive(false);time+=120000;assert.equal(clock.sample().totalSeconds,70);
 clock.setActive(true);time+=10000;assert.equal(clock.sample().totalSeconds,70);
 clock.interact();time+=5000;assert.equal(clock.sample().totalSeconds,75);
 clock.stop();assert.equal(clock.sample(),null);
});
test('a new visit starts a separate cumulative checkpoint without transferring another session time',()=>{
 let time=0;const clock=activity.create({now:()=>time});clock.begin('a','visit-a');clock.setActive(true);
 time=25000;assert.equal(clock.sample().totalSeconds,25);
 clock.begin('b','visit-b');clock.setActive(true);time+=5000;
 assert.deepEqual(clock.sample(),{sessionId:'b',visitId:'visit-b',totalSeconds:5});
});
