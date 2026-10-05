import * as THREE from 'three';
import { MAX_HP, GUARD_MAX } from './robot.js';
import { TOTAL_PARTS, unlockedIds } from './parts.js';
import { RIVALS } from './rivals.js';
import { partLabel } from './cup.js';

// 画面の表示: 体力ゲージ (左は自分、右はロックオンしている相手。相手を切りかえると名前と色も変わる)、残り時間、空中ダッシュの残り、
// アイテムと加速マスの効き目の残り (パワーアップ・バリア・お助けロボ・加速)、4人対戦のときの、ほかのロボの頭の上の名前と体力 (タグ)、
// 大きな文字 (READY / FIGHT! など) と試合前の紹介、
// ダメージの数字、ボタンの再使用までの時間 (シールドは耐久の減り。割れて使えない間は赤い。必殺技はゲージがたまるほど明るくなり、満タンで光る)、
// タイトル・大会・組み立て・結果の画面の切り替え。HTML は index.html にある
const LAG_DELAY = 0.45; // 減った体力の跡が追いかけ始めるまで (秒)
const LAG_SPEED = 0.5; // 跡が縮む速さ (ゲージ全体に対する割合 / 秒)
const LOW_HP = 0.3;
const TAG_HEIGHT = 3; // タグを出す高さ (足元から m。倒れているときは低く)

// 0xrrggbb の色を CSS の色の文字にする
function cssColor(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export class Hud {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.sides = ['you', 'cpu'].map((side) => ({
      el: $(`hp-${side}`).closest('.side'),
      robot: null, // いま出しているロボ
      label: null, // いま出している名前
      fill: $(`hp-${side}`),
      lag: $(`lag-${side}`),
      num: $(`hp-${side}-num`),
      gauge: $(`hp-${side}`).parentElement,
      buffs: $(`buffs-${side}`),
      // ゲージの下の札: パワーアップの残り秒・バリアの残り (あと防げるダメージ)・お助けロボの残り秒・加速 (加速マス) の残り秒
      chips: [...$(`buffs-${side}`).children].map((chip, i) => ({
        chip,
        num: chip.querySelector('b'),
        value: [(robot) => robot.power, (robot) => robot.barrier, (robot) => robot.helperLeft, (robot) => robot.haste][i],
        shown: 0,
      })),
      shown: -1,
      lagRatio: 1,
      lagWait: 0,
    }));
    this.cpuName = $('cpu-name');
    this.clock = $('clock');
    this.clockShown = -1;
    this.pipBox = $('pips-you');
    this.pips = [];
    this.call = $('call');
    this.callTimer = 0;
    this.matchup = $('matchup');
    this.popups = $('popups');
    this.tagBox = $('tags');
    this.tags = []; // 4人対戦のときの、ほかのロボのタグ
    this.cools = [...document.querySelectorAll('[data-action]')].map((el) => ({ el, action: el.dataset.action, shown: -1, broken: false, ready: false }));
    this.progressLines = [...document.querySelectorAll('.progress-line')];
    this.screens = { title: $('title-screen'), cup: $('cup-screen'), garage: $('garage-screen'), result: $('result-screen') };
    this.screen = $('screen');
    this.result = {
      how: $('result-how'),
      title: $('result-title'),
      detail: $('result-detail'),
      line: $('result-line'),
      champion: $('result-champion'),
      unlock: $('result-unlock'),
      unlockNames: $('unlock-names'),
      again: $('again'),
      cup: $('result-cup'),
      toTitle: $('result-title-screen'),
    };
    this.tmp = new THREE.Vector3();
    this.viewW = innerWidth; // ゲームの画面の大きさ (横向きで遊ぶときは縦と横が入れかわる。main.js が resize で決める)
    this.viewH = innerHeight;
  }

  resize(width, height) {
    this.viewW = width;
    this.viewH = height;
  }

  // you: 左に出すロボ (プレイヤー) / foe: 右に出すロボ (ロックオンしている相手) / camera: タグの位置を決めるカメラ
  update(dt, you, foe, clock, camera) {
    [you, foe].forEach((robot, i) => {
      const side = this.sides[i];
      if (side.robot !== robot) {
        // 出すロボが変わった (相手を切りかえた): 体力の跡を消し、札を出し直す
        side.robot = robot;
        side.shown = -1;
        side.lagRatio = robot.hp / MAX_HP;
        for (const c of side.chips) c.shown = -1;
        side.el.style.setProperty('--foe', cssColor(robot.bulletColor));
      }
      if (i === 1 && side.label !== robot.label) {
        side.label = robot.label;
        this.cpuName.textContent = robot.label;
      }
      const ratio = robot.hp / MAX_HP;
      if (robot.hp !== side.shown) {
        if (robot.hp < side.shown) side.lagWait = LAG_DELAY;
        else side.lagRatio = ratio; // 回復 (試合のやり直し) はすぐ戻す
        side.shown = robot.hp;
        side.fill.style.transform = `scaleX(${ratio})`;
        side.num.textContent = robot.hp;
        side.gauge.classList.toggle('low', ratio < LOW_HP);
      }
      side.lagWait -= dt;
      if (side.lagWait <= 0 && side.lagRatio > ratio) {
        side.lagRatio = Math.max(ratio, side.lagRatio - LAG_SPEED * dt);
      }
      side.lag.style.transform = `scaleX(${side.lagRatio})`;
      // ゲージの下の札 (数が変わったときだけ書きかえる)
      let changed = false;
      for (const c of side.chips) {
        const value = Math.ceil(c.value(robot));
        if (value === c.shown) continue;
        c.shown = value;
        c.chip.hidden = value <= 0;
        c.num.textContent = value;
        changed = true;
      }
      if (changed) side.buffs.hidden = side.chips.every((c) => c.shown <= 0);
    });

    const seconds = Math.ceil(clock);
    if (seconds !== this.clockShown) {
      this.clockShown = seconds;
      this.clock.textContent = seconds;
      this.clock.classList.toggle('hurry', seconds <= 10);
    }

    // 空中ダッシュの残り (回数はパーツで変わる)
    if (this.pips.length !== you.stats.dashes) {
      this.pips = Array.from({ length: you.stats.dashes }, () => document.createElement('i'));
      this.pipBox.replaceChildren(...this.pips, Object.assign(document.createElement('span'), { textContent: '空中ダッシュ' }));
    }
    this.pips.forEach((pip, i) => pip.classList.toggle('used', i >= you.airDashes));

    for (const c of this.cools) {
      if (c.action === 'target') continue; // ターゲットのボタンは、いつでも押せる
      let value;
      if (c.action === 'jump') value = you.onGround || you.airDashes > 0 ? 0 : 1;
      else if (c.action === 'step' && !you.onGround) value = you.airDashes > 0 ? 0 : 1; // 空中では空中ダッシュになる
      else if (c.action === 'guard') value = Math.round((1 - you.guardHp / GUARD_MAX) * 50) / 50; // シールドは、耐久が減ったぶん暗くする
      else if (c.action === 'special') value = Math.round((1 - you.special) * 50) / 50; // 必殺技は、ゲージがたまっていないぶん暗くする
      else value = Math.round((you.cooldowns[c.action] / you.cooldownMax[c.action]) * 50) / 50;
      if (value !== c.shown) {
        c.shown = value;
        c.el.style.setProperty('--cool', value);
        c.el.classList.toggle('cooling', value > 0);
      }
      // 必殺技のゲージが満タンなら光らせる
      const ready = c.action === 'special' && you.special >= 1;
      if (ready !== c.ready) {
        c.ready = ready;
        c.el.classList.toggle('ready', ready);
      }
      // シールドが割れて構えられない間は、赤くする
      const broken = c.action === 'guard' && you.cooldowns.guard > 0;
      if (broken !== c.broken) {
        c.broken = broken;
        c.el.classList.toggle('broken', broken);
      }
    }

    if (this.callTimer > 0) {
      this.callTimer -= dt;
      if (this.callTimer <= 0) this.call.hidden = true;
    }
    this.updateTags(foe, camera);
  }

  // 4人対戦のとき、自分以外のロボの頭の上に、名前と体力のタグを出す (robots: 試合に出ているロボ。空なら出さない)。
  // タグの色はロボの弾の色
  setTags(robots) {
    this.tags = robots.map((robot) => {
      const el = document.createElement('div');
      el.className = 'tag';
      el.style.setProperty('--tag', cssColor(robot.bulletColor));
      const name = Object.assign(document.createElement('span'), { className: 'tag-name', textContent: robot.label });
      const bar = Object.assign(document.createElement('span'), { className: 'tag-bar' });
      const fill = document.createElement('i');
      bar.append(fill);
      el.append(name, bar);
      return { robot, el, fill, shown: -1, targeted: false };
    });
    this.tagBox.replaceChildren(...this.tags.map((tag) => tag.el));
  }

  // タグを、ロボの頭の上の画面の位置へ動かす。右の札に出している相手 (foe: ロックオンしている相手) のタグは目立たせる
  updateTags(foe, camera) {
    for (const tag of this.tags) {
      const robot = tag.robot;
      const lying = robot.down || !robot.alive;
      const p = this.tmp.set(robot.pos.x, robot.pos.y + (lying ? TAG_HEIGHT * 0.5 : TAG_HEIGHT), robot.pos.z).project(camera);
      const visible = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
      tag.el.hidden = !visible;
      if (!visible) continue;
      tag.el.style.transform = `translate(${(p.x + 1) * 0.5 * this.viewW}px, ${(1 - p.y) * 0.5 * this.viewH}px) translate(-50%, -100%)`;
      if (robot.hp !== tag.shown) {
        tag.shown = robot.hp;
        tag.fill.style.transform = `scaleX(${robot.hp / MAX_HP})`;
        tag.el.classList.toggle('ko', !robot.alive);
      }
      const targeted = robot === foe;
      if (targeted !== tag.targeted) {
        tag.targeted = targeted;
        tag.el.classList.toggle('target', targeted);
      }
    }
  }

  // 画面の真ん中の大きな文字。duration 秒で消える (0 なら出したまま)
  showCall(text, kind, duration = 0) {
    this.call.textContent = text;
    this.call.className = kind;
    this.call.hidden = false;
    void this.call.offsetWidth; // アニメーションを最初からやり直す
    this.call.classList.add('show');
    this.callTimer = duration;
  }

  hideCall() {
    this.call.hidden = true;
    this.callTimer = 0;
  }

  // 試合の前に出す、対戦相手の紹介 (1行ずつの文字列の配列)
  showMatchup(lines) {
    this.matchup.textContent = lines.join('\n');
    this.matchup.hidden = false;
  }

  hideMatchup() {
    this.matchup.hidden = true;
  }

  // robot が回復したとき、そのロボの体力ゲージ (左か右に出ていれば) を光らせる
  healed(robot) {
    const gauge = this.sides.find((side) => side.robot === robot)?.gauge;
    if (!gauge) return;
    gauge.classList.remove('healed');
    void gauge.offsetWidth; // アニメーションを最初からやり直す
    gauge.classList.add('healed');
  }

  setProgress(progress) {
    const text = `大会 ${progress.beaten.length} / ${RIVALS.length}　パーツ ${unlockedIds(progress.parts).size} / ${TOTAL_PARTS}`;
    for (const el of this.progressLines) el.textContent = text;
  }

  // ロボの上に浮かぶ文字 (ダメージの数字など)
  popup(text, at, camera, kind) {
    const p = this.tmp.copy(at).project(camera);
    if (p.z > 1) return; // カメラの後ろ
    const el = document.createElement('div');
    el.className = `pop ${kind}`;
    el.textContent = text;
    const x = (p.x + 1) * 0.5 * this.viewW + (Math.random() - 0.5) * 24;
    const y = (1 - p.y) * 0.5 * this.viewH;
    el.style.top = `${y}px`;
    setTimeout(() => el.remove(), 1200); // アニメーションを切っている設定でも消えるよう、時間で消す
    this.popups.append(el);
    // 長い文字 (アイテムの名前など) が画面の左右からはみ出さないように寄せる
    const half = el.offsetWidth / 2 + 6;
    el.style.left = `${Math.min(Math.max(x, half), this.viewW - half)}px`;
  }

  // name: 'title' / 'cup' / 'garage' / 'result' / null (どれも出さずに戦う)
  showScreen(name) {
    for (const [key, el] of Object.entries(this.screens)) el.hidden = key !== name;
    this.screen.hidden = !name;
    this.screen.dataset.mode = name ?? '';
    document.body.classList.toggle('in-battle', !name);
    if (!name) document.activeElement?.blur?.(); // 隠れたボタンにキーボードの入力が行かないように
  }

  // 結果の画面。rival: 大会のライバル (フリー対戦なら null) / unlocked: この勝利で手に入ったパーツの id /
  // champion: はじめて最後のライバルに勝った / next: 次に戦うライバル (いなければ null) /
  // rule: ルールの名前 (4人対戦のとき。決着の言葉の前に出す) / title: 大きな文字 (省略すると WIN / LOSE / DRAW。バトルロイヤルは順位) /
  // detail: のこり体力の行。いちばん押してほしいボタンを返す (main.js がそこへキーボードの選択を移す)
  setResult({ winner, how, rival, unlocked, champion, next, rule, title, detail }) {
    const r = this.result;
    const end = how === 'ko' ? 'K.O.' : 'TIME UP';
    r.how.textContent = rule ? `${rule}・${end}` : end;
    r.title.textContent = title ?? (winner === 'you' ? 'WIN' : winner === 'cpu' ? 'LOSE' : 'DRAW');
    r.title.className = winner ?? 'draw';
    r.detail.textContent = detail;
    const said = rival && winner ? (winner === 'you' ? rival.lines.lose : rival.lines.win) : null;
    r.line.hidden = !said;
    if (said) r.line.textContent = `${rival.name}「${said}」`;
    r.champion.hidden = !champion;
    r.unlock.hidden = !unlocked.length;
    r.unlockNames.textContent = unlocked.map(partLabel).join('、');
    // ボタン: 大会で勝ったら次のライバルへ、負けたらもう一回。フリー対戦はもう一回かタイトルへ
    const cupWin = Boolean(rival) && winner === 'you';
    r.again.hidden = cupWin;
    r.cup.hidden = !rival;
    r.cup.textContent = cupWin && next ? '次のライバルへ' : '大会へ';
    r.toTitle.hidden = Boolean(rival);
    const primary = cupWin ? r.cup : r.again;
    for (const button of [r.again, r.cup]) button.className = button === primary ? 'cta' : 'ghost';
    return primary;
  }
}
