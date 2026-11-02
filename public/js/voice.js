// WebRTC ile sesli / görüntülü sohbet ve ekran paylaşımı (mesh topolojisi, "perfect negotiation").
// Giden ses bir WebAudio grafiğinden geçer: mikrofon → kapı (sustur/bas-konuş) → ses filtresi → çıkış
// Ses efektleri (soundboard) ve telsiz bipleri aynı çıkışa karışır.
import { store, playSound } from './util.js';

const PITCH_WORKLET = `
class PitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 1 }]; }
  constructor() { super(); this.size = 8192; this.buf = new Float32Array(this.size); this.w = 0; this.phase = 0; }
  read(pos) { pos = ((pos % this.size) + this.size) % this.size; const i = Math.floor(pos); const f = pos - i; const a = this.buf[i]; const b = this.buf[(i + 1) % this.size]; return a + (b - a) * f; }
  process(inputs, outputs, params) {
    const inp = inputs[0] && inputs[0][0]; const out = outputs[0][0];
    if (!inp) return true;
    const ratio = params.ratio[0]; const win = 2048;
    for (let i = 0; i < inp.length; i++) {
      this.buf[this.w] = inp[i];
      this.phase += (1 - ratio) / win;
      if (this.phase >= 1) this.phase -= 1; if (this.phase < 0) this.phase += 1;
      const p2 = (this.phase + 0.5) % 1;
      const g1 = Math.sin(Math.PI * this.phase); const g2 = Math.sin(Math.PI * p2);
      out[i] = this.read(this.w - this.phase * win) * g1 * g1 + this.read(this.w - p2 * win) * g2 * g2;
      this.w = (this.w + 1) % this.size;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}
registerProcessor('pitch-shifter', PitchShifter);`;

export const VOICE_FILTERS = {
  none: 'Filtre yok',
  robot: '🤖 Robot',
  chipmunk: '🐿️ Çipmunk',
  deep: '🎚️ Derin Bas',
  megaphone: '📢 Megafon',
  radio: '📻 Telsiz Operatörü',
  alien: '👽 Retro Uzaylı',
  bitcrush: '👾 8-bit Robot',
  npc: '🧙 NPC Sesi',
};

export const ACOUSTICS = {
  none: 'Normal oda',
  cathedral: '⛪ Dev Katedral',
  underwater: '🌊 Sualtı',
  parking: '🅿️ Boş Otopark',
  cave: '🦇 Terk Edilmiş Mağara',
  bathroom: '🚿 Banyo',
};

// Oda akustiği için yapay yankı (impulse response) üret
function makeImpulse(ac, seconds, decay, { dark = 0, early = false } = {}) {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      let n = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      if (dark) { lp += (n - lp) * (1 - dark); n = lp; }
      d[i] = n;
    }
    if (early) for (const ms of [23, 41, 67, 97, 131]) { const i = Math.floor(ac.sampleRate * ms / 1000); if (i < len) d[i] += 0.6 * (ch ? 0.9 : 1); }
  }
  return buf;
}

export class VoiceClient {
  constructor({ socket, meId, iceServers, onChange, onSpeaking, toast }) {
    Object.assign(this, { socket, meId, iceServers, onChange, onSpeaking, toast });
    this.channelId = null;
    this.serverId = null;
    this.peers = new Map();
    this.rawMic = null;        // mikrofondan gelen ham akış
    this.localStream = null;   // karşıya giden (işlenmiş) akış
    this.videoStream = null;
    this.videoKind = null;
    this.muted = store.get('muted', false);
    this.deafened = store.get('deafened', false);
    this.serverMuted = false;
    this.canSpeak = true;
    this.canVideo = true;
    this.speaking = new Set();
    this.analysers = new Map();
    this.volumes = store.get('volumes', {});
    this.mode = store.get('voiceMode', 'vad');      // vad | ptt | walkie
    this.pttKey = store.get('pttKey', 'Backquote');
    this.filter = store.get('voiceFilter', 'none');
    this.pttActive = false;
    this.ctx = null;
    this.g = null;             // ses grafiği düğümleri
    this.timer = null;
    this.joining = false;
    this.prox = {};            // yakınlık sesi çarpanları (piksel lobi)
    this.levels = new Map();   // anlık ses seviyeleri (fizik odası)
    this.acoustic = 'none';
    this.screamUntil = 0;
    this.loud = 0;
    this.getScreamLimit = () => 0; // uygulama ayarlar: 0 = kapalı, 1-100 = eşik
    this.onScream = () => {};

    socket.on('voice:signal', ({ from, data }) => this.onSignal(from, data).catch((e) => console.warn('signal', e)));
    socket.on('voice:force-leave', () => { if (this.channelId) { this.cleanup(); this.toast('Ses bağlantın kesildi'); } });

    addEventListener('keydown', (e) => {
      if (!this.channelId || this.mode === 'vad' || e.code !== this.pttKey || e.repeat) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      this.setPtt(true);
    });
    addEventListener('keyup', (e) => { if (e.code === this.pttKey) this.setPtt(false); });
    addEventListener('blur', () => this.setPtt(false));
  }

  get connected() { return !!this.channelId; }

  // ---------------------------------------------------------------- ses grafiği
  async ensureAudio() {
    this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    if (!this.workletReady && this.ctx.audioWorklet) {
      this.workletReady = this.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([PITCH_WORKLET], { type: 'application/javascript' }))).catch(() => null);
    }
    await this.workletReady;
    return this.ctx;
  }

  buildGraph() {
    const c = this.ctx;
    const g = {};
    g.dest = c.createMediaStreamDestination();
    g.out = c.createGain();
    g.out.connect(g.dest);
    g.gate = c.createGain();
    g.filterIn = c.createGain();
    g.filterOut = c.createGain();
    g.gate.connect(g.filterIn);
    g.filterOut.connect(g.out);
    g.sfx = c.createGain();
    g.sfx.gain.value = store.get('sfxVolume', 0.8);
    g.sfx.connect(g.out);
    g.monitor = c.createGain();
    g.monitor.gain.value = 0.5;
    g.sfx.connect(g.monitor);
    g.monitor.connect(c.destination);
    // gelen sesler: kişi başı kazanç → dinleme hattı → (akustik) → hoparlör
    g.listen = c.createGain();
    g.dry = c.createGain();
    g.wet = c.createGain();
    g.verb = c.createConvolver();
    g.tone = c.createBiquadFilter();
    g.tone.type = 'lowpass';
    g.tone.frequency.value = 20000;
    g.listen.connect(g.tone);
    g.tone.connect(g.dry).connect(c.destination);
    g.tone.connect(g.verb).connect(g.wet).connect(c.destination);
    this.g = g;
    this.applyFilter();
    this.applyAcoustic();
    this.localStream = g.dest.stream;
    const spk = store.get('speakerId', '');
    if (spk && c.setSinkId) c.setSinkId(spk).catch(() => {});
  }

  setAcoustic(name) {
    this.acoustic = ACOUSTICS[name] ? name : 'none';
    this.applyAcoustic();
  }

  applyAcoustic() {
    const g = this.g;
    if (!g) return;
    const c = this.ctx;
    const a = this.acoustic;
    const presets = {
      cathedral: { ir: [4.5, 2.2, { dark: 0.3, early: true }], wet: 0.75, dry: 0.55, tone: 9000 },
      underwater: { ir: [1.6, 3, { dark: 0.85 }], wet: 0.6, dry: 0.5, tone: 550 },
      parking: { ir: [2.4, 3.2, { early: true }], wet: 0.6, dry: 0.7, tone: 12000 },
      cave: { ir: [3.4, 2.6, { dark: 0.6, early: true }], wet: 0.7, dry: 0.5, tone: 4000 },
      bathroom: { ir: [0.9, 2.5, { early: true }], wet: 0.5, dry: 0.8, tone: 14000 },
    };
    const p = presets[a];
    if (!p) { g.wet.gain.value = 0; g.dry.gain.value = 1; g.tone.frequency.value = 20000; return; }
    g.verb.buffer = makeImpulse(c, ...p.ir);
    g.wet.gain.value = p.wet;
    g.dry.gain.value = p.dry;
    g.tone.frequency.value = p.tone;
  }

  setProximity(uid, f) {
    this.prox[uid] = f;
    this.updatePeerGain(uid);
  }

  updatePeerGain(uid) {
    const p = this.peers.get(uid);
    if (!p?.gain) return;
    const v = Math.min(2, (this.volumes[uid] ?? 100) / 100) * (this.prox[uid] ?? 1);
    p.gain.gain.setTargetAtTime(this.deafened ? 0 : v, this.ctx.currentTime, 0.08);
  }

  attachMic(stream) {
    if (this.g.src) { try { this.g.src.disconnect(); } catch { /* yok */ } }
    this.g.src = null;
    this.rawMic = stream;
    if (stream?.getAudioTracks().length) {
      this.g.src = this.ctx.createMediaStreamSource(stream);
      this.g.src.connect(this.g.gate);
      this.monitor(this.meId, null, this.g.gate);
    }
  }

  applyFilter() {
    const g = this.g;
    if (!g) return;
    const c = this.ctx;
    try { g.filterIn.disconnect(); } catch { /* yok */ }
    (g.fx || []).forEach((n) => { try { n.disconnect(); if (n.stop) n.stop(); } catch { /* yok */ } });
    g.fx = [];
    const chain = (...nodes) => {
      let prev = g.filterIn;
      for (const n of nodes) { prev.connect(n); prev = n; g.fx.push(n); }
      prev.connect(g.filterOut);
    };
    const shaper = (amount) => {
      const ws = c.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = (i / 512) - 1; curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x)); }
      ws.curve = curve;
      return ws;
    };
    const biquad = (type, freq, q = 0.7, gain = 0) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = freq; b.Q.value = q; b.gain.value = gain; return b; };
    const pitch = (ratio) => {
      if (!this.workletReady || typeof AudioWorkletNode === 'undefined') return c.createGain();
      try { const n = new AudioWorkletNode(c, 'pitch-shifter'); n.parameters.get('ratio').value = ratio; return n; } catch { return c.createGain(); }
    };
    const f = this.filter;
    if (f === 'robot') {
      const ring = c.createGain();
      ring.gain.value = 0;
      const osc = c.createOscillator();
      osc.frequency.value = 50;
      osc.connect(ring.gain);
      osc.start();
      g.fx.push(osc);
      const boost = c.createGain();
      boost.gain.value = 1.8;
      chain(ring, boost);
    } else if (f === 'chipmunk') chain(pitch(1.65), biquad('highpass', 180));
    else if (f === 'deep') chain(pitch(0.68), biquad('lowshelf', 220, 0.7, 9));
    else if (f === 'megaphone') chain(biquad('highpass', 600), biquad('lowpass', 3200), shaper(25), (() => { const gg = c.createGain(); gg.gain.value = 0.7; return gg; })());
    else if (f === 'radio') chain(biquad('bandpass', 1500, 1.4), shaper(8), (() => { const gg = c.createGain(); gg.gain.value = 1.6; return gg; })());
    else if (f === 'alien') {
      const ring = c.createGain();
      ring.gain.value = 0.4;
      const osc = c.createOscillator();
      osc.frequency.value = 420;
      const depth = c.createGain();
      depth.gain.value = 0.6;
      osc.connect(depth).connect(ring.gain);
      osc.start();
      g.fx.push(osc);
      const lfo = c.createOscillator();
      lfo.frequency.value = 5;
      const lg = c.createGain();
      lg.gain.value = 300;
      const bp = biquad('bandpass', 1200, 2);
      lfo.connect(lg).connect(bp.frequency);
      lfo.start();
      g.fx.push(lfo);
      chain(pitch(1.35), ring, bp, (() => { const gg = c.createGain(); gg.gain.value = 2.2; return gg; })());
    } else if (f === 'bitcrush') {
      const ws = c.createWaveShaper();
      const steps = 6;
      const curve = new Float32Array(2048);
      for (let i = 0; i < 2048; i++) { const x = (i / 1024) - 1; curve[i] = Math.round(x * steps) / steps; }
      ws.curve = curve;
      chain(biquad('lowpass', 3500), ws, biquad('highpass', 250), (() => { const gg = c.createGain(); gg.gain.value = 0.8; return gg; })());
    } else if (f === 'npc') chain(pitch(0.88), biquad('bandpass', 1100, 0.9), shaper(4), (() => { const gg = c.createGain(); gg.gain.value = 1.8; return gg; })());
    else g.filterIn.connect(g.filterOut);
  }

  setFilter(name) {
    this.filter = VOICE_FILTERS[name] ? name : 'none';
    store.set('voiceFilter', this.filter);
    this.applyFilter();
    this.onChange();
  }

  setMode(mode) {
    this.mode = ['vad', 'ptt', 'walkie'].includes(mode) ? mode : 'vad';
    store.set('voiceMode', this.mode);
    if (this.mode === 'walkie' && this.filter === 'none') this.setFilter('radio');
    this.pttActive = false;
    this.applyMute();
    this.onChange();
  }

  setPttKey(code) { this.pttKey = code; store.set('pttKey', code); }

  setPtt(on) {
    if (this.mode === 'vad' || this.pttActive === on || !this.channelId) return;
    this.pttActive = on;
    if (this.mode === 'walkie') this.walkieBeep(on);
    this.applyMute();
    this.onChange();
  }

  // Telsiz: basınca kısa bip, bırakınca "ksst" cızırtısı
  walkieBeep(start) {
    if (!this.ctx || !this.g) return;
    const c = this.ctx;
    const t = c.currentTime + 0.01;
    const dest = c.createGain();
    dest.connect(this.g.out);
    dest.connect(this.g.monitor);
    if (start) {
      const o = c.createOscillator();
      const env = c.createGain();
      o.frequency.value = 1750;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(env).connect(dest);
      o.start(t);
      o.stop(t + 0.14);
    } else {
      const len = Math.floor(c.sampleRate * 0.28);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = c.createBufferSource();
      s.buffer = buf;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2500;
      const env = c.createGain();
      env.gain.value = 0.18;
      s.connect(bp).connect(env).connect(dest);
      s.start(t);
    }
    setTimeout(() => dest.disconnect(), 600);
  }

  // Ses efekti çal (bağlıysan herkes duyar; değilsen yalnızca önizleme)
  async playEffect(buffer, meta) {
    await this.ensureAudio();
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = buffer;
    if (this.channelId && this.g && !this.deafened) {
      s.connect(this.g.sfx);
      if (meta) this.socket.emit('sound:played', meta);
    } else {
      const pv = c.createGain();
      pv.gain.value = 0.7;
      s.connect(pv).connect(c.destination);
    }
    s.start();
  }

  setSfxVolume(v) { store.set('sfxVolume', v); if (this.g) this.g.sfx.gain.value = v; }

  // ---------------------------------------------------------------- bağlantı
  async join(channelId) {
    if (this.joining || this.channelId === channelId) return;
    this.joining = true;
    try {
      if (this.channelId) this.leave();
      await this.ensureAudio();
      this.buildGraph();
      this.attachMic(await this.getMic());
      const res = await new Promise((r) => this.socket.emit('voice:join', {
        channel_id: channelId, self_mute: this.muted || !this.rawMic, self_deaf: this.deafened,
      }, r));
      if (!res?.ok) {
        this.teardownAudio();
        this.toast(res?.error || 'Ses kanalına bağlanılamadı', 'error');
        return;
      }
      this.channelId = res.channel_id;
      this.serverId = res.server_id;
      this.canSpeak = res.can_speak;
      this.canVideo = res.can_video;
      this.serverMuted = false;
      this.applyMute();
      for (const uid of res.peers) this.createPeer(uid);
      this.startLoop();
      playSound('join');
      this.onChange();
    } finally {
      this.joining = false;
    }
  }

  async getMic() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.toast('Tarayıcın mikrofon erişimini desteklemiyor (site HTTPS üzerinden açılmalı)', 'error');
      return null;
    }
    const micId = store.get('micId', '');
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: micId ? { ideal: micId } : undefined,
          echoCancellation: store.get('echo', true),
          noiseSuppression: store.get('noise', true),
          autoGainControl: store.get('agc', true),
        },
      });
    } catch {
      this.toast('Mikrofona erişilemedi — sadece dinleme modundasın', 'error');
      return null;
    }
  }

  leave() {
    if (!this.channelId) return;
    this.socket.emit('voice:leave');
    playSound('leave');
    this.cleanup();
  }

  teardownAudio() {
    this.stopStream(this.rawMic);
    this.rawMic = null;
    if (this.g) {
      for (const n of Object.values(this.g)) { try { n.disconnect?.(); } catch { /* yok */ } }
      (this.g.fx || []).forEach((n) => { try { n.disconnect(); n.stop?.(); } catch { /* yok */ } });
    }
    this.g = null;
    this.localStream = null;
  }

  cleanup() {
    for (const uid of [...this.peers.keys()]) this.closePeer(uid);
    this.teardownAudio();
    this.stopStream(this.videoStream);
    this.videoStream = null;
    this.videoKind = null;
    for (const a of this.analysers.values()) { try { a.src.disconnect(); } catch { /* yok */ } }
    this.analysers.clear();
    this.speaking.clear();
    clearInterval(this.timer);
    this.timer = null;
    this.pttActive = false;
    this.channelId = this.serverId = null;
    this.onChange();
  }

  stopStream(s) { s?.getTracks().forEach((t) => t.stop()); }

  // ---------------------------------------------------------------- eşler
  createPeer(uid) {
    if (this.peers.has(uid)) return this.peers.get(uid);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer = { pc, polite: this.meId > uid, makingOffer: false, ignoreOffer: false, audio: null, videoStream: null, videoSender: null };
    this.peers.set(uid, peer);

    if (this.localStream) for (const t of this.localStream.getAudioTracks()) pc.addTrack(t, this.localStream);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    if (this.videoStream) peer.videoSender = pc.addTrack(this.videoStream.getVideoTracks()[0], this.videoStream);

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.send(uid, { description: pc.localDescription });
      } catch (e) { console.warn('negotiation', e); } finally { peer.makingOffer = false; }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) this.send(uid, { candidate }); };
    pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === 'failed') pc.restartIce?.(); };
    pc.ontrack = ({ track, streams }) => {
      if (track.kind === 'audio') {
        const stream = streams[0] || new MediaStream([track]);
        if (!peer.audio) {
          peer.audio = new Audio();
          peer.audio.autoplay = true;
          peer.audio.style.display = 'none';
          document.body.appendChild(peer.audio);
        }
        // Chrome, uzak sesin WebAudio'ya akması için bir <audio> öğesine bağlı olmasını ister; ses WebAudio'dan çalınır
        peer.audio.srcObject = stream;
        peer.audio.muted = true;
        peer.audio.play().catch(() => {});
        if (peer.src) { try { peer.src.disconnect(); } catch { /* yok */ } }
        peer.src = this.ctx.createMediaStreamSource(stream);
        peer.gain ||= this.ctx.createGain();
        peer.src.connect(peer.gain);
        peer.gain.connect(this.g.listen);
        this.updatePeerGain(uid);
        this.monitor(uid, null, peer.src);
      } else {
        peer.videoStream = new MediaStream([track]);
        track.onunmute = () => this.onChange();
        track.onended = () => { if (peer.videoStream?.getVideoTracks()[0] === track) peer.videoStream = null; this.onChange(); };
        this.onChange();
      }
    };
    return peer;
  }

  closePeer(uid) {
    const p = this.peers.get(uid);
    if (!p) return;
    p.pc.close();
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    try { p.src?.disconnect(); p.gain?.disconnect(); } catch { /* yok */ }
    this.levels.delete(uid);
    const a = this.analysers.get(uid);
    if (a) { try { a.src.disconnect(); } catch { /* yok */ } this.analysers.delete(uid); }
    this.speaking.delete(uid);
    this.peers.delete(uid);
  }

  send(to, data) { this.socket.emit('voice:signal', { to, data }); }

  async onSignal(from, { description, candidate } = {}) {
    if (!this.channelId) return;
    const peer = this.peers.get(from) || this.createPeer(from);
    const { pc } = peer;
    if (description) {
      const collision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;
      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        this.send(from, { description: pc.localDescription });
      }
    } else if (candidate) {
      try { await pc.addIceCandidate(candidate); } catch (e) { if (!peer.ignoreOffer) console.warn('ice', e); }
    }
  }

  onVoiceState(st) {
    if (st.user_id === this.meId) {
      if (this.channelId && st.channel_id !== this.channelId && st.prev_channel_id === this.channelId) this.cleanup();
      else if (st.channel_id === this.channelId && this.serverMuted !== !!st.server_mute) {
        this.serverMuted = !!st.server_mute;
        this.applyMute();
        if (this.serverMuted) this.toast('Bir moderatör seni susturdu');
      }
      return;
    }
    if (!this.channelId) return;
    if (st.channel_id !== this.channelId && this.peers.has(st.user_id)) {
      this.closePeer(st.user_id);
      playSound('leave');
    } else if (st.channel_id === this.channelId && !this.peers.has(st.user_id)) {
      playSound('join');
    }
  }

  // ---------------------------------------------------------------- konuşma algılama
  monitor(uid, stream, node) {
    if (!this.ctx) return;
    const old = this.analysers.get(uid);
    if (old) { try { old.src.disconnect(old.an); } catch { /* yok */ } }
    let src = node;
    if (!src) {
      if (!stream?.getAudioTracks().length) return;
      src = this.ctx.createMediaStreamSource(stream);
    }
    const an = this.ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    this.analysers.set(uid, { src, an, buf: new Uint8Array(an.fftSize), hold: 0 });
  }

  startLoop() {
    clearInterval(this.timer);
    const interval = document.documentElement.dataset.lowend ? 200 : 80;
    this.timer = setInterval(() => {
      const th = store.get('sensitivity', 0.035);
      for (const [uid, a] of this.analysers) {
        a.an.getByteTimeDomainData(a.buf);
        let sum = 0;
        for (const v of a.buf) { const x = (v - 128) / 128; sum += x * x; }
        const rms = Math.sqrt(sum / a.buf.length);
        this.levels.set(uid, rms);
        if (uid === this.meId) this.checkScream(rms, interval);
        if (rms > th) a.hold = 3; else if (a.hold > 0) a.hold--;
        const now = a.hold > 0;
        if (now !== this.speaking.has(uid)) {
          now ? this.speaking.add(uid) : this.speaking.delete(uid);
          this.onSpeaking(uid, now);
        }
      }
    }, interval);
  }

  // Çığlık ölçer: kanal eşiği aşılırsa kendini 30 saniyeliğine "uzaya fırlat" (sustur + sağırlaştır)
  checkScream(rms, interval) {
    const limit = this.getScreamLimit();
    if (!limit || Date.now() < this.screamUntil) return;
    const threshold = 0.08 + (limit / 100) * 0.5;
    this.loud = rms > threshold ? this.loud + interval : 0;
    if (this.loud < 350) return;
    this.loud = 0;
    this.screamUntil = Date.now() + 30000;
    const was = { muted: this.muted, deafened: this.deafened };
    this.muted = true;
    this.deafened = true;
    this.applyMute();
    this.socket.emit('scream');
    this.onScream(true);
    this.onChange();
    setTimeout(() => {
      this.muted = was.muted;
      this.deafened = was.deafened;
      this.applyMute();
      this.onScream(false);
      this.onChange();
    }, 30000);
  }

  // ---------------------------------------------------------------- kontroller
  isMicOff() {
    if (this.muted || this.deafened || this.serverMuted || !this.canSpeak || !this.rawMic) return true;
    return this.mode !== 'vad' && !this.pttActive;
  }

  applyMute() {
    if (this.g) {
      const t = this.ctx.currentTime;
      this.g.gate.gain.setTargetAtTime(this.isMicOff() ? 0 : 1, t, 0.01);
      this.g.out.gain.setTargetAtTime(this.serverMuted || !this.canSpeak ? 0 : 1, t, 0.01);
    }
    for (const uid of this.peers.keys()) this.updatePeerGain(uid);
    if (this.channelId) this.sendState();
  }

  sendState() {
    this.socket.emit('voice:update', {
      self_mute: this.muted || !this.rawMic || !this.canSpeak || (this.mode !== 'vad' && !this.pttActive),
      self_deaf: this.deafened,
      self_video: this.videoKind === 'camera',
      self_stream: this.videoKind === 'screen',
    });
  }

  toggleMute() {
    if (this.deafened) { this.deafened = false; this.muted = false; } else this.muted = !this.muted;
    store.set('muted', this.muted); store.set('deafened', this.deafened);
    playSound(this.muted ? 'mute' : 'unmute');
    this.applyMute();
    this.onChange();
  }

  toggleDeafen() {
    this.deafened = !this.deafened;
    store.set('deafened', this.deafened);
    playSound(this.deafened ? 'mute' : 'unmute');
    this.applyMute();
    this.onChange();
  }

  setVolume(uid, v) {
    this.volumes[uid] = v;
    store.set('volumes', this.volumes);
    this.updatePeerGain(uid);
  }

  setSpeaker(id) {
    store.set('speakerId', id);
    this.ctx?.setSinkId?.(id || '').catch(() => {});
  }

  async toggleCamera() {
    if (!this.channelId) return;
    if (this.videoKind === 'camera') return this.stopVideo();
    if (!this.canVideo) return this.toast('Bu kanalda kamera açma yetkin yok', 'error');
    try {
      const camId = store.get('camId', '');
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, deviceId: camId ? { ideal: camId } : undefined } });
      this.setVideo(s, 'camera');
    } catch { this.toast('Kameraya erişilemedi', 'error'); }
  }

  async toggleScreen() {
    if (!this.channelId) return;
    if (this.videoKind === 'screen') return this.stopVideo();
    if (!this.canVideo) return this.toast('Bu kanalda yayın yapma yetkin yok', 'error');
    if (!navigator.mediaDevices?.getDisplayMedia) return this.toast('Tarayıcın ekran paylaşımını desteklemiyor', 'error');
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false });
      this.setVideo(s, 'screen');
    } catch { /* kullanıcı iptal etti */ }
  }

  setVideo(stream, kind) {
    const old = this.videoStream;
    const track = stream.getVideoTracks()[0];
    if (kind === 'screen') track.contentHint = 'detail';
    this.videoStream = stream;
    this.videoKind = kind;
    track.onended = () => { if (this.videoStream === stream) this.stopVideo(); };
    for (const p of this.peers.values()) {
      if (p.videoSender) p.videoSender.replaceTrack(track).catch(() => {});
      else p.videoSender = p.pc.addTrack(track, stream);
    }
    this.stopStream(old);
    this.sendState();
    this.onChange();
  }

  stopVideo() {
    this.stopStream(this.videoStream);
    this.videoStream = null;
    this.videoKind = null;
    for (const p of this.peers.values()) {
      if (p.videoSender) { try { p.pc.removeTrack(p.videoSender); } catch { /* kapalı */ } p.videoSender = null; }
    }
    this.sendState();
    this.onChange();
  }

  videoFor(uid) {
    if (uid === this.meId) return this.videoStream;
    return this.peers.get(uid)?.videoStream || null;
  }

  // Mikrofon değişince yalnızca kaynak düğümü değişir; giden ses izi aynı kalır
  async switchMic() {
    if (!this.channelId || !this.g) return;
    const s = await this.getMic();
    if (!s) return;
    this.stopStream(this.rawMic);
    this.attachMic(s);
    this.applyMute();
  }
}
