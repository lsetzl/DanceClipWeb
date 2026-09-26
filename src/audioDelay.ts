// AAC エンコーダーが先頭に足す無音(priming)のサンプル数を、エンコード → デコードの往復で実測する。
// MP4 に edit list を書かないので、再生時にはこの分だけ音が遅れて聞こえる

export async function measureAacDelay(sampleRate = 44100, channels = 2, bitrate = 192_000): Promise<number> {
  const len = sampleRate;
  const burstAt = Math.round(sampleRate * 0.25);
  const burstLen = Math.round(sampleRate * 0.02);
  const input = new Float32Array(len);
  let seed = 1;
  for (let i = 0; i < burstLen; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    input[burstAt + i] = (seed / 0x7fffffff - 0.5) * 1.6;
  }

  const chunks: EncodedAudioChunk[] = [];
  let decoderConfig: AudioDecoderConfig | undefined;
  const enc = new AudioEncoder({
    output: (c, meta) => {
      chunks.push(c);
      if (meta?.decoderConfig) decoderConfig = meta.decoderConfig;
    },
    error: (e) => {
      throw e;
    },
  });
  enc.configure({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels, bitrate });
  const planar = new Float32Array(len * channels);
  for (let c = 0; c < channels; c++) planar.set(input, c * len);
  const block = 1024;
  for (let i = 0; i < len; i += block) {
    const n = Math.min(block, len - i);
    const data = new Float32Array(n * channels);
    for (let c = 0; c < channels; c++) data.set(input.subarray(i, i + n), c * n);
    enc.encode(new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round((i / sampleRate) * 1e6), data }));
  }
  await enc.flush();
  enc.close();
  if (!decoderConfig) throw new Error('no decoder config');

  const out: Float32Array[] = [];
  const dec = new AudioDecoder({
    output: (a) => {
      const f = new Float32Array(a.numberOfFrames);
      a.copyTo(f, { planeIndex: 0, format: 'f32-planar' });
      out.push(f);
      a.close();
    },
    error: (e) => {
      throw e;
    },
  });
  dec.configure(decoderConfig);
  for (const c of chunks) dec.decode(c);
  await dec.flush();
  dec.close();
  const total = out.reduce((s, f) => s + f.length, 0);
  const y = new Float32Array(total);
  let o = 0;
  for (const f of out) {
    y.set(f, o);
    o += f.length;
  }

  // 入力のバーストとの相互相関が最大になるずれ
  const burst = input.subarray(burstAt, burstAt + burstLen);
  let best = 0, bestLag = 0;
  for (let lag = -2048; lag <= 8192; lag++) {
    const s0 = burstAt + lag;
    if (s0 < 0 || s0 + burstLen > y.length) continue;
    let s = 0;
    for (let i = 0; i < burstLen; i++) s += burst[i] * y[s0 + i];
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  return bestLag;
}
