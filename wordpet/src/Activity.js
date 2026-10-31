/* Active practice clock: no input contents, recordings or background time. */
const WordPetActivity = (() => {
  function create({now = () => performance.now(), idleMs = 60000} = {}) {
    let id = '', visitId = '', total = 0, previous = now(), interaction = previous, active = false;
    function tick() {
      const current = now();
      if (active && id) total += Math.max(0, Math.min(current, interaction + idleMs) - previous);
      previous = current;
    }
    return {
      begin(sessionId, visit) { tick(); id = sessionId; visitId = visit; total = 0; previous = interaction = now(); active = false; },
      setActive(value) { tick(); active = Boolean(value); },
      interact() { tick(); interaction = now(); },
      sample() { tick(); return id ? {sessionId:id,visitId,totalSeconds:Math.floor(total / 1000)} : null; },
      stop() { tick(); active = false; id = ''; visitId = ''; total = 0; }
    };
  }
  return {create};
})();
if (typeof module !== 'undefined') module.exports = WordPetActivity;
