# Speech recordings

Recordings are generated privately with the British English voice `bf_emma`, model `kokoro-v1.0.onnx`, and the v1.1 voice-pack release. Recordings and private vocabulary are stored in the owner's Google Drive. Model weights are downloaded to the temporary runner directory and removed after generation.

- Kokoro 82M model weights: Apache License 2.0. Model source and card: https://huggingface.co/hexgrad/Kokoro-82M
- Kokoro ONNX wrapper: MIT license. Source: https://github.com/thewh1teagle/kokoro-onnx
- ONNX model and voice-pack release: https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1
- eSpeak NG phonemizer: https://github.com/espeak-ng/espeak-ng

The application distributes its generated recordings through authenticated access; the model and its runtime are not shipped to pupils' browsers. A recording can be replaced by regenerating its exact text with a new voice identifier. Clip filenames use a content hash, and an upload is checked against Drive's checksum before it is indexed.
