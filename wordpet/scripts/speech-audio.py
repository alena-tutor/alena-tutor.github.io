"""Generate private vocabulary recordings locally on the runner; never print text."""
import contextlib
import io
import json
import logging
import os
from pathlib import Path
import subprocess
import sys


def main():
    logging.disable(logging.CRITICAL)
    import numpy as np
    import onnxruntime as ort
    import soundfile as sf
    from kokoro_onnx import Kokoro
    work = Path(os.environ['WORDPET_SPEECH_WORKDIR'])
    model = Path(os.environ['WORDPET_SPEECH_MODEL_DIR'])
    plan = json.loads((work / 'plan.json').read_text())
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    options.log_severity_level = 3
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        session = ort.InferenceSession(str(model / 'kokoro-v1.0.onnx'), options, providers=['CPUExecutionProvider'])
        engine = Kokoro.from_session(session, str(model / 'voices-v1.0.bin'))
    for index, item in enumerate(plan['items']):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            samples, rate = engine.create(item['text'], voice='bf_emma', speed=0.98, lang='en-gb')
        if not np.isfinite(samples).all() or len(samples) < rate * 0.1 or len(samples) > rate * 40 or np.max(np.abs(samples)) < 0.001:
            raise ValueError('Invalid generated recording')
        wav = work / (item['hash'] + '.wav')
        mp3 = work / (item['hash'] + '.mp3')
        sf.write(wav, samples, rate)
        subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', str(wav), '-codec:a', 'libmp3lame', '-b:a', '48k', str(mp3)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        wav.unlink()
        print(f"Generated and checked recordings: {index + 1} / {len(plan['items'])}.", flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        import traceback
        frame = traceback.extract_tb(error.__traceback__)[-1]
        print('Speech generation failed: ' + type(error).__name__ + ' at ' + Path(frame.filename).name + ':' + str(frame.lineno) + '. Private vocabulary was not logged.', file=sys.stderr)
        sys.exit(1)
