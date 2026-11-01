// WebRTC ile sesli / görüntülü sohbet ve ekran paylaşımı (mesh topolojisi, "perfect negotiation")
import { store, playSound } from './util.js';

export class VoiceClient {
  constructor({ socket, meId, iceServers, onChange, onSpeaking, toast }) {
    Object.assign(this, { socket, meId, iceServers, onChange, onSpeaking, toast });
    this.channelId = null;
    this.serverId = null;
    this.peers = new Map();       // uid -> { pc, polite, makingOffer, ignoreOffer, audio, videoStream, videoSender }
    this.localStream = null;
    this.videoStream = null;
    this.videoKind = null;        // 'camera' | 'screen'
    this.muted = store.get('muted', false);
    this.deafened = store.get('deafened', false);
    this.serverMuted = false;
    this.canSpeak = true;
    this.canVideo = true;
    this.speaking = new Set();
    this.analysers = new Map();
    this.volumes = store.get('volumes', {});
    this.ctx = null;
    this.timer = null;
    this.joining = false;

    socket.on('voice:signal', ({ from, data }) => this.onSignal(from, data).catch((e) => console.warn('signal', e)));
    socket.on('voice:force-leave', () => { if (this.channelId) { this.cleanup(); this.toast('Ses bağlantın kesildi'); } });
  }

  get connected() { return !!this.channelId; }

  async join(channelId) {
    if (this.joining || this.channelId === channelId) return;
    this.joining = true;
    try {
      if (this.channelId) this.leave();
      this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      this.ctx.resume?.();
      this.localStream = await this.getMic();
      const res = await new Promise((r) => this.socket.emit('voice:join', {
        channel_id: channelId, self_mute: this.muted || !this.localStream, self_deaf: this.deafened,
      }, r));
      if (!res?.ok) {
        this.stopStream(this.localStream);
        this.localStream = null;
        this.toast(res?.error || 'Ses kanalına bağlanılamadı', 'error');
        return;
      }
      this.channelId = res.channel_id;
      this.serverId = res.server_id;
      this.canSpeak = res.can_speak;
      this.canVideo = res.can_video;
      this.serverMuted = false;
      this.applyMute();
      if (this.localStream) this.monitor(this.meId, this.localStream);
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
    const constraints = {
      audio: {
        deviceId: micId ? { ideal: micId } : undefined,
        echoCancellation: store.get('echo', true),
        noiseSuppression: store.get('noise', true),
        autoGainControl: store.get('agc', true),
      },
    };
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
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

  cleanup() {
    for (const uid of [...this.peers.keys()]) this.closePeer(uid);
    this.stopStream(this.localStream);
    this.stopStream(this.videoStream);
    this.localStream = this.videoStream = null;
    this.videoKind = null;
    for (const a of this.analysers.values()) a.src.disconnect();
    this.analysers.clear();
    this.speaking.clear();
    clearInterval(this.timer);
    this.timer = null;
    this.channelId = this.serverId = null;
    this.onChange();
  }

  stopStream(s) { s?.getTracks().forEach((t) => t.stop()); }

  // ---------- eşler
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
        peer.audio.srcObject = stream;
        peer.audio.muted = this.deafened;
        peer.audio.volume = Math.min(1, (this.volumes[uid] ?? 100) / 100);
        const spk = store.get('speakerId', '');
        if (spk && peer.audio.setSinkId) peer.audio.setSinkId(spk).catch(() => {});
        peer.audio.play().catch(() => {});
        this.monitor(uid, stream);
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
    const a = this.analysers.get(uid);
    if (a) { a.src.disconnect(); this.analysers.delete(uid); }
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

  // Sunucudan gelen ses durumu değişikliği
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

  // ---------- konuşma algılama
  monitor(uid, stream) {
    if (!this.ctx || !stream.getAudioTracks().length) return;
    const old = this.analysers.get(uid);
    if (old) old.src.disconnect();
    const src = this.ctx.createMediaStreamSource(stream);
    const an = this.ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    this.analysers.set(uid, { src, an, buf: new Uint8Array(an.fftSize), hold: 0 });
  }

  startLoop() {
    clearInterval(this.timer);
    const threshold = () => store.get('sensitivity', 0.035);
    this.timer = setInterval(() => {
      const th = threshold();
      for (const [uid, a] of this.analysers) {
        a.an.getByteTimeDomainData(a.buf);
        let sum = 0;
        for (const v of a.buf) { const x = (v - 128) / 128; sum += x * x; }
        const rms = Math.sqrt(sum / a.buf.length);
        const silenced = uid === this.meId ? this.isMicOff() : false;
        if (rms > th && !silenced) a.hold = 3; else if (a.hold > 0) a.hold--;
        const now = a.hold > 0;
        if (now !== this.speaking.has(uid)) {
          now ? this.speaking.add(uid) : this.speaking.delete(uid);
          this.onSpeaking(uid, now);
        }
      }
    }, 80);
  }

  // ---------- kontroller
  isMicOff() { return this.muted || this.deafened || this.serverMuted || !this.canSpeak || !this.localStream; }

  applyMute() {
    const off = this.isMicOff();
    this.localStream?.getAudioTracks().forEach((t) => { t.enabled = !off; });
    for (const p of this.peers.values()) if (p.audio) p.audio.muted = this.deafened;
    if (this.channelId) this.sendState();
  }

  sendState() {
    this.socket.emit('voice:update', {
      self_mute: this.muted || !this.localStream || !this.canSpeak,
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
    const p = this.peers.get(uid);
    if (p?.audio) p.audio.volume = Math.min(1, v / 100);
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

  async switchMic() {
    if (!this.channelId) return;
    const s = await this.getMic();
    if (!s) return;
    const track = s.getAudioTracks()[0];
    for (const p of this.peers.values()) {
      const sender = p.pc.getSenders().find((x) => x.track?.kind === 'audio');
      if (sender) sender.replaceTrack(track).catch(() => {});
      else p.pc.addTrack(track, s);
    }
    this.stopStream(this.localStream);
    this.localStream = s;
    this.monitor(this.meId, s);
    this.applyMute();
  }
}
