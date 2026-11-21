class Pcm16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.targetSamples = 16000; // ~1 s at 16 kHz
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;

    // Downsample from AudioContext sampleRate to 16 kHz
    const ratio = sampleRate / 16000;
    for (let i = 0; i < input.length; i += ratio) {
      const s = Math.max(-1, Math.min(1, input[Math.floor(i)] ?? 0));
      this.buffer.push(s < 0 ? s * 0x8000 : s * 0x7fff);
    }

    if (this.buffer.length >= this.targetSamples) {
      const chunk = Int16Array.from(this.buffer.splice(0, this.targetSamples));
      this.port.postMessage(chunk.buffer, [chunk.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm16-processor", Pcm16Processor);
