class Pcm16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.targetSamples = 16000; // ~1 s at 16 kHz
  }

  process(inputs) {
    const channels = inputs[0];
    const length = channels?.[0]?.length ?? 0;
    if (length === 0) return true;

    // Downsample from AudioContext sampleRate to 16 kHz, averaging all channels into mono
    // (some headsets put the mic on the right channel only, leaving the left one silent)
    const ratio = sampleRate / 16000;
    for (let i = 0; i < length; i += ratio) {
      const idx = Math.floor(i);
      let sum = 0;
      for (const ch of channels) sum += ch[idx] ?? 0;
      const s = Math.max(-1, Math.min(1, sum / channels.length));
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
