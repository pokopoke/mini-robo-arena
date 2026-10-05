// 効果音。音声ファイルは使わず、WebAudio でその場で合成する。
// ブラウザの決まりで、最初のタップ・クリックのあと (unlock) でないと鳴らせない
const SFX_VOLUME = 0.35;
// [始めの高さ, 終わりの高さ (Hz), 長さ (秒), 波の形, 音量]
const GUN_SOUNDS = {
  triple: [1400, 500, 0.07, 'square', 0.18],
  gatling: [1900, 1100, 0.035, 'square', 0.12],
  spread: [900, 260, 0.12, 'sawtooth', 0.2],
  rail: [2600, 180, 0.28, 'sawtooth', 0.25],
  homing: [600, 1200, 0.14, 'triangle', 0.25],
  beam: [1800, 140, 0.45, 'sawtooth', 0.3],
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.noise = null;
  }

  unlock() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      this.ctx = new AudioContextClass();
      // 1秒分の雑音を作っておき、爆発などに使い回す
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // 周波数が from → to へ変わる音
  tone(from, to, duration, type, volume) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume * SFX_VOLUME, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  // 雑音を帯域で絞った音
  burst(frequency, duration, volume) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume * SFX_VOLUME, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  // ショットの種類 (parts.js の id) ごとに音を変える
  gun(id) {
    const [from, to, duration, type, volume] = GUN_SOUNDS[id] ?? GUN_SOUNDS.triple;
    this.tone(from, to, duration, type, volume);
  }

  bombLaunch() {
    this.tone(220, 480, 0.18, 'triangle', 0.35);
  }

  podLaunch() {
    this.tone(700, 350, 0.15, 'sine', 0.3);
  }

  boom() {
    this.burst(420, 0.45, 0.9);
    this.tone(120, 40, 0.4, 'sine', 0.6);
  }

  hit() {
    this.tone(900, 1500, 0.05, 'square', 0.15);
  }

  down() {
    this.tone(300, 80, 0.3, 'sawtooth', 0.3);
  }

  jump() {
    this.tone(380, 760, 0.1, 'triangle', 0.18);
  }

  dash() {
    this.burst(2600, 0.12, 0.25);
  }

  // ブレードを振った音 (n: 何回目か。3回目の振り下ろしは重く)
  slash(n) {
    if (n === 3) {
      this.burst(900, 0.28, 0.5);
      this.tone(260, 90, 0.25, 'sawtooth', 0.22);
    } else {
      this.burst(2600, 0.14, 0.35);
      this.tone(700 + n * 150, 300, 0.12, 'triangle', 0.15);
    }
  }

  // ブレードが当たった音
  bladeHit() {
    this.tone(2200, 1100, 0.09, 'square', 0.18);
    this.burst(3200, 0.08, 0.3);
  }

  // 突き・急降下斬りの、ためる音
  charge() {
    this.tone(320, 1100, 0.16, 'sawtooth', 0.12);
    this.burst(1800, 0.16, 0.2);
  }

  // ロックオンする相手を切りかえた
  lockOn() {
    this.tone(1300, 1700, 0.06, 'square', 0.1);
  }

  // シールドを構えた
  guardUp() {
    this.tone(520, 880, 0.09, 'sine', 0.12);
  }

  // シールドが攻撃を防いだ
  guard() {
    this.tone(1500, 900, 0.07, 'square', 0.12);
    this.burst(5200, 0.06, 0.22);
  }

  // シールドでブレードをはじき返した (高い金属の音)
  repel() {
    this.tone(2600, 2100, 0.18, 'triangle', 0.26);
    this.tone(1300, 1050, 0.2, 'square', 0.1);
    this.burst(4600, 0.12, 0.3);
  }

  // シールドが割れた
  guardBreak() {
    this.burst(3600, 0.35, 0.5);
    this.tone(900, 180, 0.35, 'sawtooth', 0.22);
  }

  ready() {
    this.tone(440, 440, 0.25, 'square', 0.2);
  }

  // 試合の始まりに、ロボの入った箱が着地した音
  land() {
    this.burst(260, 0.25, 0.6);
    this.tone(150, 55, 0.3, 'sine', 0.5);
  }

  // 箱がはじけて、ロボが現れる音
  open() {
    this.burst(1800, 0.25, 0.35);
    this.tone(330, 990, 0.3, 'triangle', 0.3);
  }

  // ブレイク (ショットでダウンさせて、相手の飛び道具が消えた)
  breakShot() {
    this.tone(1800, 700, 0.18, 'square', 0.2);
    this.tone(2400, 1200, 0.22, 'triangle', 0.18);
  }

  // アイテムが現れた
  itemAppear() {
    this.tone(1180, 1580, 0.12, 'triangle', 0.14);
  }

  // アイテムを取った (種類で音を変える。missile は砲台が立つ音)
  pickup(kind) {
    if (kind === 'heal') {
      [660, 880, 1320].forEach((f, i) => setTimeout(() => this.tone(f, f * 1.02, 0.14, 'sine', 0.3), i * 70));
    } else if (kind === 'power') {
      this.tone(260, 1300, 0.38, 'sawtooth', 0.22);
      this.tone(520, 2600, 0.38, 'square', 0.08);
    } else if (kind === 'helper') {
      [784, 988, 1175, 1568].forEach((f, i) => setTimeout(() => this.tone(f, f, 0.1, 'square', 0.12), i * 60));
    } else if (kind === 'barrier') {
      this.tone(400, 1600, 0.4, 'sine', 0.3);
      this.tone(800, 2400, 0.4, 'triangle', 0.12);
    } else {
      this.burst(300, 0.22, 0.5);
      this.tone(220, 520, 0.25, 'square', 0.16);
    }
  }

  // お助けロボが撃った
  helperShot() {
    this.tone(1700, 900, 0.05, 'square', 0.08);
  }

  // バリアが攻撃を防いだ
  barrierHit() {
    this.tone(1200, 700, 0.12, 'sine', 0.22);
  }

  // バリアが割れた
  barrierBreak() {
    this.burst(4200, 0.3, 0.45);
    this.tone(1400, 300, 0.3, 'triangle', 0.2);
  }

  // 砲台がミサイルを撃った
  missile() {
    this.burst(1500, 0.25, 0.28);
    this.tone(260, 640, 0.22, 'sawtooth', 0.12);
  }

  // もろい床にひびが入った
  crack() {
    this.burst(1400, 0.12, 0.4);
    this.tone(520, 260, 0.1, 'square', 0.1);
  }

  // もろい床が割れて、穴があいた
  crumble() {
    this.burst(320, 0.5, 0.7);
    this.tone(170, 50, 0.45, 'sawtooth', 0.22);
  }

  // 穴が、もとの床にもどった
  restore() {
    this.tone(480, 960, 0.22, 'triangle', 0.12);
  }

  // しびれマスが点滅して、電気が流れると知らせ始めた (乗っているときに鳴らす)
  zapWarn() {
    [0, 120, 240].forEach((ms) => setTimeout(() => this.tone(1650, 1650, 0.06, 'square', 0.1), ms));
  }

  // しびれマスに電気が流れ始めた
  zap() {
    this.burst(5200, 0.25, 0.22);
    this.tone(110, 95, 0.25, 'sawtooth', 0.14);
  }

  // ロボがしびれた
  shocked() {
    this.tone(1900, 500, 0.22, 'square', 0.18);
    this.burst(4200, 0.32, 0.35);
  }

  // 加速マスに乗った
  haste() {
    this.tone(500, 1700, 0.2, 'triangle', 0.18);
    this.burst(3000, 0.15, 0.15);
  }

  // 穴に落ちた (下がっていく音)
  fall() {
    this.tone(950, 140, 0.45, 'triangle', 0.22);
  }

  // 穴の底から飛び出した
  popOut() {
    this.burst(520, 0.2, 0.4);
    this.tone(220, 560, 0.16, 'square', 0.12);
  }

  // 必殺技のゲージが満タンになった
  specialReady() {
    [880, 1175, 1760].forEach((f, i) => setTimeout(() => this.tone(f, f * 1.01, 0.16, 'triangle', 0.22), i * 90));
  }

  // 核ミサイルを打ち上げた (ごうっと上がっていく音)
  nukeLaunch() {
    this.burst(700, 0.9, 0.55);
    this.tone(90, 420, 0.9, 'sawtooth', 0.22);
  }

  // 核ミサイルの警告の輪が止まった (警報)
  nukeWarn() {
    [0, 260, 520].forEach((ms) => setTimeout(() => this.tone(1180, 760, 0.22, 'square', 0.16), ms));
  }

  // 核ミサイルの大爆発 (重い爆音と、長く続く地鳴り)
  nuke() {
    this.burst(240, 1, 1);
    this.tone(110, 28, 1.6, 'sine', 0.9);
    this.tone(60, 24, 2.2, 'triangle', 0.5);
    setTimeout(() => this.burst(160, 1, 0.6), 450);
  }

  go() {
    this.tone(660, 1320, 0.4, 'square', 0.25);
  }

  win() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, f, 0.25, 'triangle', 0.35), i * 130));
  }

  lose() {
    [392, 330, 262].forEach((f, i) => setTimeout(() => this.tone(f, f * 0.98, 0.35, 'triangle', 0.3), i * 200));
  }
}
