const TARGET_RATE = 16000;
const CUTOFF_HZ = 7500;
const TRANSITION_HZ = 1000;

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

/** Blackman-windowed sinc low-pass, one filter per fractional output position. */
function buildFilters(inputRate, up) {
  const cutoff = Math.min(CUTOFF_HZ, inputRate * (CUTOFF_HZ / TARGET_RATE)) / inputRate;
  const taps = Math.ceil((5.5 * inputRate) / TRANSITION_HZ) | 1;
  const center = (taps - 1) / 2;
  const halfWidth = center + 1;
  const filters = [];
  for (let phase = 0; phase < up; phase++) {
    const filter = new Float32Array(taps);
    let sum = 0;
    for (let j = 0; j < taps; j++) {
      const d = center - j - phase / up;
      const sinc = d === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * d) / (Math.PI * d);
      const u = (d + halfWidth) / (2 * halfWidth);
      const window = 0.42 - 0.5 * Math.cos(2 * Math.PI * u) + 0.08 * Math.cos(4 * Math.PI * u);
      filter[j] = sinc * window;
      sum += filter[j];
    }
    for (let j = 0; j < taps; j++) filter[j] /= sum;
    filters.push(filter);
  }
  return filters;
}

class Pcm16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    const inputRate = Math.round(sampleRate);
    const divisor = gcd(inputRate, TARGET_RATE);
    this.up = TARGET_RATE / divisor;
    this.down = inputRate / divisor;
    this.filters = buildFilters(inputRate, this.up);
    this.history = new Float32Array(this.filters[0].length);
    this.head = 0;
    this.phase = 0;
    this.wait = 0;
    this.frame = new Int16Array(TARGET_RATE); // ~1 s at 16 kHz
    this.frameLength = 0;
  }

  emit() {
    const filter = this.filters[this.phase];
    const size = this.history.length;
    let at = this.head;
    let value = 0;
    for (let j = 0; j < size; j++) {
      value += filter[j] * this.history[at];
      at = at === 0 ? size - 1 : at - 1;
    }
    const s = Math.max(-1, Math.min(1, value));
    this.frame[this.frameLength++] = s < 0 ? s * 0x8000 : s * 0x7fff;
    if (this.frameLength === this.frame.length) {
      this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
      this.frame = new Int16Array(TARGET_RATE);
      this.frameLength = 0;
    }
  }

  process(inputs) {
    const channels = inputs[0];
    const length = channels?.[0]?.length ?? 0;
    if (length === 0) return true;

    // Average all channels into mono (some headsets put the mic on the right channel only,
    // leaving the left one silent), then resample to 16 kHz. Position carries across blocks
    // so the output length stays exact.
    for (let i = 0; i < length; i++) {
      let sum = 0;
      for (const ch of channels) sum += ch[i] ?? 0;
      this.history[this.head] = sum / channels.length;
      while (this.wait === 0) {
        this.emit();
        const next = this.phase + this.down;
        this.wait = Math.floor(next / this.up);
        this.phase = next % this.up;
      }
      this.wait -= 1;
      this.head = (this.head + 1) % this.history.length;
    }
    return true;
  }
}

registerProcessor("pcm16-processor", Pcm16Processor);
