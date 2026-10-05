import * as THREE from 'three';
import { Sfx } from './sfx.js';
import { Effects } from './effects.js';
import { Entrance } from './entrance.js';
import { ARENAS, ARENA_IDS } from './arenas.js';
import { TILE_COLORS } from './tiles.js';
import { Arena } from './arena.js';
import { DEFAULT_LOADOUT, SLOTS, partOf, randomLoadout, sameLoadout, unlockedIds } from './parts.js';
import { RIVALS, rewardsOf } from './rivals.js';
import { Robot, ROBOT_RADIUS, MAX_HP, BARRIER_COLOR, PLAYER_ASSIST } from './robot.js';
import { Weapons } from './weapons.js';
import { Items, ITEM_KINDS } from './items.js';
import { Cpu } from './ai.js';
import { Input } from './input.js';
import { Save, normalizeProgress, mergeProgress } from './save.js';
import { Garage } from './garage.js';
import { Cup } from './cup.js';
import { Hud } from './hud.js';

// 試合の流れ: title (タイトル画面) → ready (登場の演出と READY) → fight (戦う) → finish (決着の演出) → result (結果画面)。
// 大会 (mode 'cup') では cup の画面でライバルを選んで戦い、勝つとそのライバルのパーツが手に入る。
// フリー対戦 (mode 'free') は、毎回ちがう闘技場で組み合わせがランダムな CPU と戦う練習 (パーツは増えない)。
// フリー対戦のルール (rule) はタイトル画面で選ぶ: 1対1 (duel) / バトルロイヤル (royal: 4人全員が敵) / 2対2 (team: 緑の CPU がなかま)。
// 大会はいつも1対1。どの試合でも、戦っている間は闘技場にアイテム (items.js) が現れ、床のマス目の仕掛け (tiles.js) が効く。
// タイトル・大会・結果の画面からは garage (組み立て画面) へ行ける。
// プレイヤーだけ、弾とミサイルが当たりやすく、動きの反応が速い (robot.js の PLAYER_ASSIST)。タイトル画面で「オートで撃つ」を選べる
// ルール。name: 画面に出す名前 / time: 試合の長さ (秒)
const RULES = {
  duel: { name: '1対1', time: 90 },
  royal: { name: 'バトルロイヤル', time: 120 },
  team: { name: '2対2', time: 120 },
};
const RULE_KEY = 'mini-robo-arena:rule'; // フリー対戦のルール (この端末だけに覚える)
const COLOR_NAMES = { cpu: 'オレンジ', green: 'グリーン', pink: 'ピンク' }; // 4人対戦の CPU の呼び名 (ロボの色)
const READY_TIME = 2.3; // 登場の演出が終わってから FIGHT! (動きを減らす設定のときは演出なしで 1.8 秒)
const READY_TIME_PLAIN = 1.8;
const FINISH_TIME = 2.4;
const FINISH_TIME_POSE = 3.4; // 勝ちポーズを映すときは、決着の演出を長くする (秒)
const POSE_CAMERA = { after: 0.6, distance: 4.6, height: 1.9, angle: 0.5, look: 1.5 }; // 勝ちポーズを映すカメラ (決着から after 秒あと、ロボの斜め前 angle rad から)
// ゲーム全体の速さ (1 がもとの速さ)。ロボ・弾・床の仕掛け・アイテム・残り時間など、試合の中の時間の進みが全部この倍率になる
// (登場と決着の演出の長さ・ヒットストップ・カメラのなめらかさ・画面の文字と音は、ふつうの時間のまま)
const GAME_SPEED = 0.6;
const KO_SLOW = 0.3; // 決着の瞬間のスロー (時間の進む速さ)
const KO_SLOW_TIME = 1.0;
// 当たった瞬間に止める時間 (秒): 爆発・ブレード・ブレードで倒した・ダウン・ブレードをシールドではじき返した・シールドが割れた・核の爆発
const HITSTOP = { blast: 0.06, blade: 0.05, finish: 0.1, down: 0.05, repel: 0.08, guardBreak: 0.08, nuke: 0.14 };
const GUARD_POP_GAP = 400; // シールドで防いだときの「ガード」の文字を、続けて出さない間 (ミリ秒。連射の弾で重ならないように)
const LOW_HP_SMOKE = 0.3; // 体力がこの割合より少ないと、体から煙が出る
const SMOKE = { color: 0x30363f, count: 3, speed: 0.4, rise: 1.6, size: 0.8, life: 1.1 };
const POWER_AURA = { color: 0xffd23f, count: 3, speed: 0.9, rise: 2.4, size: 0.4, life: 0.55 }; // パワーアップ中に立ちのぼる粒
const DUST = { color: 0x9aa7c0, count: 8, speed: 2.5, rise: 0.4, size: 0.6, life: 0.6 };
const HASTE_TRAIL = { color: TILE_COLORS.speed, count: 2, speed: 0.4, rise: 0.6, size: 0.5, life: 0.4 }; // 加速中に走ると、足元から出る粒
const LANDING_SPEED = 9; // これより速く落ちて着地すると、ほこりが立つ (m/秒)
const TILE_SOUND_RANGE = 16; // カメラで追っているロボから、これより近い床の仕掛けの音だけ鳴らす (m)
// 戦うときのカメラ。back: プレイヤーの後ろ (m) / height: 足元からの高さ / look: 注視点 (プレイヤーから相手までの、どのあたりを見るか) /
// fov: 縦の視野 (度) / shift: 映す中心を上へずらす割合。縦長の画面は、下のほうがボタンで隠れるので、少し高くから見下ろして中心を上げる
const CAMERA_VIEWS = {
  landscape: { back: 9, height: 4.6, look: 0.4, fov: 60, shift: 0 },
  portrait: { back: 9.5, height: 6.4, look: 0.45, fov: 78, shift: 0.1 },
};
const CAMERA_NEAR = [3, 9]; // 相手までの距離がこの範囲 (m) で、近いとき用のカメラへ少しずつ切り替える
const CAMERA_NEAR_LIFT = 3; // 相手が近いとき、カメラを上げる高さ (m)
const CAMERA_NEAR_BACK = 2; // 相手が近いとき、カメラを後ろへ下げる距離 (m)
const CAMERA_TURN = { far: 6, near: 1.2 }; // カメラが相手のほうへ向き直る速さ (1/秒)。近いときはゆっくり
const CAMERA_MAX_TURN = { far: 2.4, near: 1.5 }; // カメラが1秒に回れる角度の上限 (rad)。相手が頭の上を越えても、画面が急にぐるっと回らないように
const BATTLE_STATES = new Set(['ready', 'fight', 'finish']);
const MENU_STATES = new Set(['title', 'cup', 'result']); // 闘技場のまわりをカメラが回る画面
const IDLE = {
  move: { x: 0, z: 0 }, jump: false, step: false, gun: false, bomb: false, pod: false, missile: false, attack: false, guard: false, target: false, special: false,
};
const LANDSCAPE_KEY = 'mini-robo-arena:landscape'; // 「横向きで遊ぶ」の設定 (この端末だけに覚える)
const AUTO_KEY = 'mini-robo-arena:auto'; // 「オートで撃つ」の設定 (この端末だけに覚える。はじめは入)
// タッチのボタンの一式 (#pad) を、画面に入るよう縮める目安 (fitPad。px は CSS の大きさ)。
// hud: 横長の画面で、上の体力ゲージのためにあける高さ / stick: 縦長の画面で、左の親指のスティックのためにあける幅 /
// lower: 縦長の画面の、下の2段の幅 (ボタンの一式の右はしから。style.css の並びと合わせる) / tall: 縦長の画面で使ってよい高さの割合
const PAD_FIT = { hud: 70, stick: 150, lower: 216, tall: 0.52 };

const touchMode = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
document.body.classList.toggle('touch', touchMode);

// 横向きで遊ぶか。画面が回らないアプリでも横で遊べるよう、縦長の画面のときはゲームを 90° 回して表示する
let wantLandscape = (() => {
  try {
    return localStorage.getItem(LANDSCAPE_KEY) === '1';
  } catch {
    return false;
  }
})();
// フリー対戦のルール (タイトル画面で選ぶ)
let freeRule = (() => {
  try {
    const rule = localStorage.getItem(RULE_KEY);
    return RULES[rule] ? rule : 'duel';
  } catch {
    return 'duel';
  }
})();
// オートで撃つか (タイトル画面で選ぶ。はじめは入)
let autoShot = (() => {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0';
  } catch {
    return true;
  }
})();
const app = document.getElementById('app');
let screenW = innerWidth; // ゲームの画面の大きさ (回しているときは、縦と横が入れかわる)
let screenH = innerHeight;

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('view'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
const sfx = new Sfx();
const effects = new Effects(scene);
const entrance = new Entrance(scene, effects, sfx);
const arena = new Arena(scene, effects);
const tiles = arena.tiles; // 床のマス目の仕掛け
// ロボの金属に映り込む景色。闘技場を入れ替えるたびに、その闘技場の色で作り直す
const pmrem = new THREE.PMREMGenerator(renderer);
let environment = null;
function applyEnvironment() {
  environment?.dispose();
  environment = arena.makeEnvironment(pmrem);
  scene.environment = environment.texture;
  scene.environmentIntensity = 1.4;
}
applyEnvironment();
function loadArena(id) {
  arena.load(id);
  applyEnvironment();
}
const showcase = new THREE.Vector3(); // 組み立て画面でロボを置く場所 (中央広場の真ん中の台の上)
const weapons = new Weapons(scene, arena, effects, sfx);
const items = new Items(scene, arena, weapons, effects, sfx);
const save = new Save();
let progress = normalizeProgress(save.loadLocal());
const you = new Robot(scene, 'you', 0x5ee7ff, progress.loadout);
you.assist = PLAYER_ASSIST; // プレイヤーだけ、弾とミサイルが当たりやすく、動きの反応が速い
const cpu = new Robot(scene, 'cpu', 0xff8a3d, DEFAULT_LOADOUT);
// 4人対戦で増える CPU (ふだんは隠しておく)。2対2では、緑 (extras[0]) がプレイヤーのなかま
const extras = [new Robot(scene, 'green', 0x8dff5a, DEFAULT_LOADOUT), new Robot(scene, 'pink', 0xff5ad1, DEFAULT_LOADOUT)];
const cpus = [cpu, ...extras];
const ais = new Map(cpus.map((robot) => [robot, new Cpu(robot)])); // CPU のロボ → その操作
const ai = ais.get(cpu);
let robots = [you, cpu]; // 試合に出ているロボ (はじめがプレイヤー)
const input = new Input(touchMode);
const hud = new Hud();
const cup = new Cup();
const garage = new Garage((loadout) => {
  progress = { ...progress, loadout, updatedAt: Date.now() };
  save.save(progress);
  you.setLoadout(loadout);
  you.animate(0, arena);
});

const game = {
  state: 'title',
  mode: 'free', // 'cup' (大会) / 'free' (フリー対戦)
  rule: 'duel', // 'duel' (1対1) / 'royal' (バトルロイヤル) / 'team' (2対2)
  place: null, // バトルロイヤルの順位
  rival: null, // 大会で戦っているライバル
  cupIndex: null, // 大会の画面で選んでいたライバルの番号
  garageFrom: 'title', // 組み立て画面を開いた画面 ('title' / 'cup')
  time: 0, // いまの状態になってからの時間 (実時間)
  clock: RULES.duel.time,
  slow: 0,
  hitstop: 0,
  winner: null,
  how: null,
  spotlight: null, // 決着のあと、勝ちポーズを前から映すロボ (いなければ null)
  unlocked: [], // この勝利で手に入ったパーツ
  champion: false, // この勝利で、はじめて大会で優勝した
  camYaw: 0,
  orbit: 0,
  shake: 0,
};
let view = CAMERA_VIEWS.landscape; // 画面の向きで変わる (resize)
// ロボごとの演出の待ち時間。guardPop: 最後に「ガード」の文字を出したとき (performance.now) /
// smoke: 次に煙を出すまで / aura: 次にパワーアップの粒を出すまで / zap: 次にしびれの火花を出すまで / haste: 次に加速の粒を出すまで (秒)
const fxTimers = new Map([you, ...cpus].map((robot) => [robot, { guardPop: 0, smoke: 0, aura: 0, zap: 0, haste: 0 }]));
const camPos = new THREE.Vector3(0, 12, 30);
const lookAt = new THREE.Vector3(0, 1, 0);
const camWant = new THREE.Vector3();
const lookWant = new THREE.Vector3();
const head = new THREE.Vector3();
const probe = new THREE.Vector3();

// 近くの爆発で画面を揺らす
weapons.onExplode = (at) => {
  if (reduceMotion) return;
  game.shake = Math.max(game.shake, 0.4 * Math.max(0, 1 - at.distanceTo(you.pos) / 14));
};

// ブレイク (ショットでダウンさせて、相手の飛び道具が消えた)
weapons.onBreak = (robot) => {
  hud.popup('ブレイク', probe.set(robot.pos.x, robot.pos.y + 4, robot.pos.z), camera, `${robot === you ? 'to-you' : 'to-cpu'} big`);
  sfx.breakShot();
};

// 砲台が壊された
weapons.onTurretBroken = (turret) => {
  hud.popup('砲台を破壊', probe.set(turret.pos.x, turret.pos.y + 2.2, turret.pos.z), camera, 'missile big');
};

// 必殺技の核ミサイルを打ち上げた: 大きな文字と、狙われた相手の頭の上に「ロックオン」
weapons.onNukeLaunch = (nuke) => {
  hud.showCall('核ミサイル発射', 'nuke', 1.4);
  const target = nuke.target;
  hud.popup('ロックオン', probe.set(target.pos.x, target.pos.y + 3.6, target.pos.z), camera, 'nuke big');
};

// 核ミサイルが爆発した: 画面を白く光らせ、大きく揺らし、一瞬止める
weapons.onNuke = (at) => {
  flashScreen();
  if (!reduceMotion) game.shake = Math.max(game.shake, 1.4 * Math.max(0.35, 1 - at.distanceTo(you.pos) / 40));
  if (game.state === 'fight') game.hitstop = Math.max(game.hitstop, HITSTOP.nuke);
};

// 画面を白く光らせる (核の爆発。動きを減らす設定では弱く)
const flashEl = document.getElementById('flash');
function flashScreen() {
  flashEl.classList.remove('show');
  void flashEl.offsetWidth; // アニメーションを最初からやり直す
  flashEl.classList.toggle('soft', reduceMotion);
  flashEl.classList.add('show');
}

// アイテムを取ったときの文字 (回復は、もどった体力)
items.onPick = (robot, item, healed) => {
  const at = probe.set(robot.pos.x, robot.pos.y + 3.3, robot.pos.z);
  if (item.kind === 'heal') {
    hud.popup(`+${healed}`, at, camera, 'heal');
    hud.healed(robot);
  } else {
    hud.popup(ITEM_KINDS[item.kind].name, at, camera, `${item.kind} big`);
  }
};

// 床の仕掛け (tiles.js)。音は、戦っているときに、カメラで追っているロボの近くで起きたものだけ鳴らす
function nearView(tile) {
  const me = viewer();
  return BATTLE_STATES.has(game.state) && Math.hypot(tile.cx - me.pos.x, tile.cz - me.pos.z) < TILE_SOUND_RANGE;
}
tiles.onCrack = (tile) => {
  if (nearView(tile)) sfx.crack();
};
tiles.onBreak = (tile) => {
  if (nearView(tile)) sfx.crumble();
};
tiles.onRestore = (tile) => {
  if (nearView(tile)) sfx.restore();
};
// しびれマスが点滅し始めたとき、プレイヤーが乗っていれば知らせの音
tiles.onWarn = (tile) => {
  if (game.state === 'fight' && you.alive && tiles.tileAt(you.pos.x, you.pos.z) === tile) sfx.zapWarn();
};
tiles.onZap = (tile) => {
  if (game.state === 'fight' && nearView(tile)) sfx.zap();
};
tiles.onShock = (robot) => {
  hud.popup('しびれ', probe.set(robot.pos.x, robot.pos.y + 3.3, robot.pos.z), camera, 'shock big');
  sfx.shocked();
};
tiles.onHaste = (robot) => {
  hud.popup('加速', probe.set(robot.pos.x, robot.pos.y + 3.3, robot.pos.z), camera, 'haste');
  if (robot === you) sfx.haste();
};

// 登場の箱が着地したら画面を揺らす
entrance.onLand = (robot) => {
  if (!reduceMotion) game.shake = Math.max(game.shake, robot === you ? 0.35 : 0.2);
};

// claude.ai の保存機能に前の進み具合があれば合わせる (別の端末で遊んだ分など)
save.connect((remote) => {
  const merged = mergeProgress(progress, remote);
  if (JSON.stringify(merged) !== JSON.stringify(progress)) {
    progress = merged;
    hud.setProgress(progress);
    if (MENU_STATES.has(game.state)) useLoadout();
    if (game.state === 'cup') cup.open(progress, cup.index);
    if (game.state === 'garage') {
      useLoadout();
      garage.open(progress.loadout, unlockedIds(progress.parts));
    }
  }
  return merged;
});

function useLoadout() {
  if (!sameLoadout(you.loadout, progress.loadout)) you.setLoadout(progress.loadout);
}

// 1対1の並び (タイトル・大会・組み立ての画面や、1対1の試合)。4人対戦用の CPU は隠す
function useDuelLineup() {
  robots = [you, cpu];
  for (const robot of extras) robot.setPresent(false);
  hud.setTags([]);
  document.body.classList.remove('multi');
}

// 闘技場の両はしに向き合って置く (1対1の並び)
function placeRobots() {
  useDuelLineup();
  you.reset(0, -arena.def.start, 0);
  cpu.reset(0, arena.def.start, Math.PI);
  setTeams();
}

// 試合に出ているロボのチームを、いまのルールで決める (2対2では緑がプレイヤーのなかま、ほかは全員ちがうチーム)。
// そのうえで相手 (foes) を決め、ロックオンする: プレイヤーは正面の相手 (始まりの場所の向かい)、
// CPU は、相手が1人ならその相手、4人対戦では始まりに選び直す (ai.js の pickTarget) までのあいだ、相手のだれか
function setTeams() {
  const rule = robots.length > 2 ? game.rule : 'duel';
  const teams = { you: 0, cpu: 1, green: rule === 'team' ? 0 : 2, pink: rule === 'team' ? 1 : 3 };
  for (const robot of robots) robot.team = teams[robot.side];
  for (const robot of robots) {
    robot.foes = robots.filter((other) => robot.isFoe(other));
    robot.target = robot === you ? robot.foes[0] : robot.foes[Math.floor(Math.random() * robot.foes.length)];
  }
}

// 試合の始まりの並び。1対1は闘技場の両はしに向き合い、4人対戦は arenas.js の spawns の場所で真ん中を向く
// (2対2は、プレイヤーとなかま (緑) が手前、相手のチームが奥)
function placeMatch() {
  if (game.rule === 'duel') {
    placeRobots();
    return;
  }
  const spots = arena.def.spawns[game.rule];
  const order = game.rule === 'team' ? [you, extras[0], cpu, extras[1]] : [you, cpu, ...extras];
  order.forEach((robot, i) => {
    const [x, z] = spots[i];
    robot.setPresent(true);
    robot.reset(x, z, Math.atan2(-x, -z));
  });
  setTeams();
}

function setState(state) {
  game.state = state;
  game.time = 0;
  updateViewOffset();
}

// フリー対戦の CPU の強さ (大会で勝ったライバルが多いほど強い)
function freeLevel() {
  return Math.min(10, Math.round(progress.beaten.length * 1.25));
}

// 大会で次に戦うライバルの番号 (全員に勝っていれば null)
function nextRivalIndex() {
  const i = RIVALS.findIndex((rival) => !progress.beaten.includes(rival.id));
  return i < 0 ? null : i;
}

// 試合を始める。mode: 'cup' (rival と戦う。いつも1対1) / 'free' (タイトル画面で選んだルール)
function startMatch(mode, rival = null) {
  sfx.unlock();
  input.clear();
  weapons.clear();
  items.clear();
  effects.clear();
  entrance.clear();
  game.mode = mode;
  game.rival = mode === 'cup' ? rival : null;
  game.rule = mode === 'cup' ? 'duel' : freeRule;
  game.place = null;
  game.spotlight = null;
  const level = game.rival ? game.rival.level : freeLevel();
  // フリー対戦は、前とちがう闘技場をくじで選ぶ
  const others = ARENA_IDS.filter((id) => id !== arena.id);
  loadArena(game.rival ? game.rival.arena : others[Math.floor(Math.random() * others.length)]);
  useLoadout();
  const multi = game.rule !== 'duel';
  robots = multi ? [you, ...cpus] : [you, cpu];
  for (const robot of robots) {
    if (robot === you) continue;
    robot.setLoadout(game.rival ? game.rival.loadout : randomLoadout(level));
    robot.label = game.rival ? game.rival.name : !multi ? `CPU Lv.${level + 1}` : game.rule === 'team' && robot === extras[0] ? 'なかま' : COLOR_NAMES[robot.side];
    ais.get(robot).setLevel(level);
    ais.get(robot).setStyle(game.rival?.style);
  }
  placeMatch();
  for (const robot of robots) ais.get(robot)?.reset();
  document.body.classList.toggle('multi', multi);
  hud.setTags(multi ? robots.filter((robot) => robot !== you) : []);
  setState('ready');
  game.clock = RULES[game.rule].time;
  game.slow = 0;
  game.hitstop = 0;
  game.camYaw = 0;
  const parts = SLOTS.map((slot) => partOf(slot, cpu.loadout[slot]).name).join('・');
  if (game.rival) {
    const r = game.rival;
    hud.showMatchup([`第${RIVALS.indexOf(r) + 1}試合・${r.round}　${r.name}（${r.title}）`, `「${r.lines.intro}」`, ARENAS[arena.id].name]);
  } else if (game.rule === 'royal') {
    hud.showMatchup([`バトルロイヤル　CPU Lv.${level + 1} ×3`, '全員が敵。最後まで残れば勝ち', ARENAS[arena.id].name]);
  } else if (game.rule === 'team') {
    hud.showMatchup([`2対2　CPU Lv.${level + 1}`, 'なかまはグリーン。オレンジとピンクを両方倒せば勝ち', ARENAS[arena.id].name]);
  } else {
    hud.showMatchup([`フリー対戦　CPU Lv.${level + 1}`, parts, ARENAS[arena.id].name]);
  }
  hud.showScreen(null);
  hud.showCall('READY', 'ready');
  if (!reduceMotion) entrance.start(robots);
  sfx.ready();
}

// 試合の決着 (決まっていなければ null)。winner: 'you' / 'cpu' / null (引き分け) / how: 'ko' / 'time' / place: バトルロイヤルの順位。
// 1対1とバトルロイヤルは、プレイヤーが倒れたら終わり (順位は、そのとき残っていたロボの数 + 1)、相手が全員倒れたら勝ち。
// 2対2は、どちらかのチームが全員倒れたら終わり (プレイヤーが倒れても、なかまが残っていれば続く)。
// 時間切れ (timeUp) は、残っている体力で決める (2対2はチームの合計)
function decide(timeUp) {
  if (game.rule === 'team') {
    const mine = robots.filter((robot) => robot.team === you.team);
    const theirs = robots.filter((robot) => robot.team !== you.team);
    const standing = (team) => team.some((robot) => robot.alive);
    if (!standing(mine) || !standing(theirs)) return { winner: standing(mine) ? 'you' : standing(theirs) ? 'cpu' : null, how: 'ko' };
    if (!timeUp) return null;
    const hp = (team) => team.reduce((sum, robot) => sum + robot.hp, 0);
    return { winner: hp(mine) > hp(theirs) ? 'you' : hp(theirs) > hp(mine) ? 'cpu' : null, how: 'time' };
  }
  const others = robots.filter((robot) => robot !== you && robot.alive);
  if (!you.alive) return { winner: others.length ? 'cpu' : null, how: 'ko', place: others.length + 1 };
  if (!others.length) return { winner: 'you', how: 'ko', place: 1 };
  if (!timeUp) return null;
  const ahead = others.filter((robot) => robot.hp > you.hp).length;
  const even = others.some((robot) => robot.hp === you.hp);
  return { winner: ahead ? 'cpu' : even ? null : 'you', how: 'time', place: ahead + 1 };
}

// 決着。place: バトルロイヤルの順位。
// 勝ったロボは勝ちポーズをとる (プレイヤーのチームが勝てば、残っている全員。1対1で負けたら相手。2対2で負けたら相手のチーム)。
// プレイヤーのチームが勝ったとき (プレイヤーが倒れていれば、なかま) と、1対1で負けたとき (相手) は、カメラが前へ回ってポーズを映す
function finish({ winner, how, place = null }) {
  setState('finish');
  game.winner = winner;
  game.how = how;
  game.place = place;
  game.unlocked = [];
  game.champion = false;
  weapons.fizzle();
  items.fizzle();
  const mine = winner === 'you';
  const winners = !winner || (!mine && game.rule === 'royal') ? [] : robots.filter((robot) => robot.alive && (robot.team === you.team) === mine);
  for (const robot of winners) robot.celebrate();
  game.spotlight = mine ? winners.find((robot) => robot === you) ?? winners[0] ?? null : game.rule === 'duel' ? winners[0] ?? null : null;
  if (winner === 'you') {
    // 大会で勝つと、そのライバルのパーツのうち、まだ持っていないものが手に入る
    const rival = game.rival;
    if (rival) {
      game.unlocked = rewardsOf(rival).filter((id) => !progress.parts.includes(id));
      game.champion = rival === RIVALS.at(-1) && !progress.beaten.includes(rival.id);
    }
    progress = normalizeProgress({
      ...progress,
      wins: progress.wins + 1,
      beaten: rival ? [...progress.beaten, rival.id] : progress.beaten,
      parts: [...progress.parts, ...game.unlocked],
      updatedAt: Date.now(),
    });
    save.save(progress);
  }
  if (how === 'ko') {
    game.slow = KO_SLOW_TIME;
    hud.showCall('K.O.', 'ko');
  } else {
    hud.showCall('TIME UP', 'timeup');
  }
}

// 結果の画面の、のこり体力の行 (2対2はチームの合計)
function resultDetail() {
  if (game.rule === 'team') {
    const hp = (mine) => robots.filter((robot) => (robot.team === you.team) === mine).reduce((sum, robot) => sum + robot.hp, 0);
    return `のこり体力　あなたのチーム ${hp(true)}　／　相手のチーム ${hp(false)}`;
  }
  return `のこり体力　${robots.map((robot) => `${robot === you ? 'あなた' : robot.label} ${robot.hp}`).join('　／　')}`;
}

function showResult() {
  setState('result');
  hud.hideCall();
  const next = nextRivalIndex();
  const primary = hud.setResult({
    winner: game.winner,
    how: game.how,
    rival: game.rival,
    unlocked: game.unlocked,
    champion: game.champion,
    next: next === null ? null : RIVALS[next],
    rule: game.rule === 'duel' ? null : RULES[game.rule].name,
    title: game.rule === 'royal' && game.winner ? `${game.place}位` : undefined,
    detail: resultDetail(),
  });
  hud.setProgress(progress);
  hud.showScreen('result');
  if (game.winner === 'you') sfx.win();
  else if (game.winner === 'cpu') sfx.lose();
  primary.focus({ preventScroll: true });
}

// 大会の画面。index: はじめに選んでおくライバル (null なら次に戦うライバル)
function openCup(index = null) {
  sfx.unlock();
  weapons.clear();
  items.clear();
  tiles.clear();
  entrance.clear();
  hud.hideCall();
  placeRobots();
  setState('cup');
  cup.open(progress, index);
  hud.setProgress(progress);
  hud.showScreen('cup');
}

// 組み立て画面。from: もどる先 ('title' / 'cup')
function openGarage(from) {
  game.garageFrom = from;
  sfx.unlock();
  weapons.clear();
  items.clear();
  tiles.clear();
  effects.clear();
  entrance.clear();
  hud.hideCall();
  if (arena.id !== 'plaza') loadArena('plaza');
  showcase.set(0, arena.groundAt(0, 0, 100), 0);
  useLoadout();
  useDuelLineup();
  you.reset(showcase.x, showcase.z, 0);
  you.pos.y = showcase.y;
  cpu.root.visible = false;
  cpu.shadow.visible = false;
  setState('garage');
  garage.open(progress.loadout, unlockedIds(progress.parts));
  hud.setProgress(progress);
  hud.showScreen('garage');
}

function toTitle() {
  entrance.clear();
  items.clear();
  tiles.clear();
  placeRobots();
  setState('title');
  hud.setProgress(progress);
  hud.showScreen('title');
}

// 大会で選んでいるライバル (まだ戦えないライバルなら、次に戦うライバル)
function chosenRival() {
  const next = nextRivalIndex() ?? RIVALS.length - 1;
  const i = game.cupIndex ?? next;
  return RIVALS[Math.min(i, next)];
}

// カメラで追うロボ。ふだんはプレイヤー。2対2でプレイヤーが倒れたら、なかまを追う
function viewer() {
  if (you.alive || game.rule !== 'team') return you;
  return robots.find((robot) => robot !== you && robot.team === you.team && robot.alive) ?? you;
}

function step(realDt) {
  // 当たった瞬間の一瞬の止まり (ヒットストップ)。止まっているあいだも、カメラのゆれと画面の表示は動かす
  if (game.hitstop > 0) {
    game.hitstop -= realDt;
    updateCamera(0, realDt);
    hud.update(realDt, you, viewer().target ?? cpu, game.clock, camera);
    return;
  }
  let dt = realDt * GAME_SPEED; // 試合の中の時間
  if (game.slow > 0) {
    game.slow -= realDt;
    dt *= KO_SLOW;
  }
  game.time += realDt;
  arena.update(dt);
  const controls = input.read(game.camYaw); // 動く向きの「前」はカメラの向き (スティックの向きと画面の向きをそろえる)
  if (game.state === 'fight') autoFire(controls);
  if (game.state === 'garage') {
    // 台の上でゆっくり回して見せる
    you.yaw += realDt * 0.5;
    you.animate(realDt, arena);
  } else {
    const fighting = game.state === 'fight';
    const before = robots.map((robot) => ({
      hp: robot.hp, state: robot.state, onGround: robot.onGround, vy: robot.vel.y, swings: robot.swings, blocks: robot.blocks, breaks: robot.barrierBreaks,
      guards: robot.guardBlocks, guardBreaks: robot.guardBreaks, repels: robot.repels, target: robot.target, special: robot.special,
    }));
    // CPU の入力を先に全部決めてから、全員を動かす
    const inputs = robots.map((robot) => {
      if (!fighting) return IDLE;
      return robot === you ? controls : ais.get(robot).update(dt, arena, weapons, items);
    });
    robots.forEach((robot, i) => robot.update(dt, inputs[i], arena, weapons, sfx));
    separateAll();
    weapons.update(dt);
    tiles.update(robots, fighting);
    robots.forEach((robot, i) => react(robot, before[i]));
    items.update(dt, robots, fighting);
    if (BATTLE_STATES.has(game.state)) {
      for (const robot of robots) {
        smoke(robot, dt);
        aura(robot, dt);
        sparks(robot, dt);
        trail(robot, dt);
      }
    }
  }
  effects.update(dt);

  if (game.state === 'ready') {
    entrance.update(game.time);
    if (game.time >= (reduceMotion ? READY_TIME_PLAIN : READY_TIME)) {
      entrance.finish();
      setState('fight');
      hud.hideMatchup();
      hud.showCall('FIGHT!', 'fight', 0.8);
      sfx.go();
    }
  } else if (game.state === 'fight') {
    game.clock = Math.max(0, game.clock - dt);
    const result = decide(game.clock <= 0);
    if (result) finish(result);
  } else if (game.state === 'finish') {
    if (game.spotlight && game.time > POSE_CAMERA.after + 0.5) hud.hideCall(); // 勝ちポーズを映すときは、K.O. の文字をどける
    if (game.time >= (game.spotlight ? FINISH_TIME_POSE : FINISH_TIME)) showResult();
  }
  updateCamera(dt, realDt);
  hud.update(realDt, you, viewer().target ?? cpu, game.clock, camera);
}

// オートで撃つ: ショットが撃てるようになったら、ロックオンしている相手が見えていて (間に箱がない)、倒れたり穴に落ちたりしていなければ撃つ
// (プレイヤーだけ。ボタンで撃つのも、そのまま使える)
function autoFire(controls) {
  if (!autoShot || you.cooldowns.gun > 0 || (you.state !== 'normal' && you.state !== 'airdash')) return;
  const target = you.target;
  if (target?.alive && !target.down && target.state !== 'fall' && arena.lineOfSight(you.center, target.center)) controls.gun = true;
}

// 戦っている間だけ、当たった瞬間に一瞬止める。4人対戦では、プレイヤーがかかわったときだけ
// (robot: 当たったロボ。プレイヤーか、プレイヤーが攻撃したロボのとき止める。CPU 同士のたびに止まらないように)
function hitstop(seconds, robot) {
  if (game.state !== 'fight') return;
  if (game.rule !== 'duel' && robot !== you && robot.lastAttacker !== you) return;
  game.hitstop = Math.max(game.hitstop, seconds);
}

// ブレードを振ったとき・バリアやシールドが防いだり割れたりしたとき・ブレードをはじき返されたとき・体力が減ったとき・
// 倒れたとき・着地したとき・突きや急降下斬りをためたとき・シールドを構えたとき・プレイヤーがロックオンを切りかえたとき・
// プレイヤーの必殺技のゲージが満タンになったとき・床の穴に落ちたときと、穴から飛び出したときの演出
function react(robot, before) {
  const kind = robot.team === you.team ? 'to-you' : 'to-cpu';
  if (robot === you && robot.target !== before.target && game.state === 'fight') sfx.lockOn();
  if (robot === you && before.special < 1 && robot.special >= 1 && game.state === 'fight') {
    hud.popup('必殺技OK', probe.set(robot.pos.x, robot.pos.y + 3.6, robot.pos.z), camera, 'nuke big');
    sfx.specialReady();
  }
  if (robot.barrierBreaks !== before.breaks) {
    effects.explosion(probe.set(robot.pos.x, robot.pos.y + 1.2, robot.pos.z), 1.6, BARRIER_COLOR);
    hud.popup('バリア破壊', probe.set(robot.pos.x, robot.pos.y + 3.3, robot.pos.z), camera, 'barrier big');
    sfx.barrierBreak();
  } else if (robot.blocks !== before.blocks) {
    hud.popup('ガード', probe.set(robot.pos.x, robot.pos.y + 2.7, robot.pos.z), camera, 'barrier');
    sfx.barrierHit();
  }
  // シールド: 割れたら光がはじけ、防いだら盾から火花 (ブレードを防いだときの文字は、斬った側の「はじき返し」で出す)
  if (robot.guardBreaks !== before.guardBreaks) {
    effects.explosion(robot.guardCenter(probe), 1.2, robot.bulletColor);
    effects.burst(probe, 0xffffff, 20, 7);
    hud.popup('シールド破壊', probe.set(robot.pos.x, robot.pos.y + 3.3, robot.pos.z), camera, `${kind} big`);
    sfx.guardBreak();
    hitstop(HITSTOP.guardBreak, robot);
  } else if (robot.guardBlocks !== before.guards) {
    effects.burst(robot.guardCenter(probe), 0xffffff, 8, 4);
    sfx.guard();
    const now = performance.now();
    const timers = fxTimers.get(robot);
    if (robot.guardCause !== 'blade' && now - timers.guardPop > GUARD_POP_GAP) {
      timers.guardPop = now;
      hud.popup('ガード', probe.set(robot.pos.x, robot.pos.y + 2.7, robot.pos.z), camera, 'guard');
    }
  }
  if (robot.repels !== before.repels) {
    // robot のブレードを、相手がシールドではじき返した (はじいたのは、たいていロックオンしている相手)
    const foe = robot.slashHits.size ? [...robot.slashHits].at(-1) : robot.target;
    effects.burst(foe.guardCenter(probe), 0xffffff, 18, 7);
    hud.popup('はじき返し', probe.set(foe.pos.x, foe.pos.y + 3.3, foe.pos.z), camera, 'guard big');
    sfx.repel();
    hitstop(HITSTOP.repel, foe);
  }
  if (robot.swings !== before.swings) {
    // ブレードを振った跡。突きは前へのびる光、ほかは光る弧 (3回斬りの3回目と急降下斬りは斜めに振り下ろす)
    if (robot.slashKind === 'thrust') {
      effects.stab(probe.set(robot.pos.x, robot.pos.y + 1.4, robot.pos.z), robot.yaw, robot.bulletColor);
      sfx.slash(3);
    } else {
      const downward = robot.slashKind === 'combo3' || robot.slashKind === 'dive';
      effects.slash(probe.set(robot.pos.x, robot.pos.y + (downward ? 1.5 : 1.35), robot.pos.z), robot.yaw, downward, robot.bulletColor);
      sfx.slash(downward ? 3 : robot.combo);
    }
  }
  const lost = before.hp - robot.hp;
  if (lost > 0) {
    hud.popup(String(lost), probe.set(robot.pos.x, robot.pos.y + 2.7, robot.pos.z), camera, kind);
    sfx.hit();
    if (robot.lastCause === 'blade') {
      effects.burst(robot.center, 0xffffff, 14, 6);
      sfx.bladeHit();
      hitstop(robot.state === 'down' || robot.state === 'ko' ? HITSTOP.finish : HITSTOP.blade, robot);
    } else if (robot.lastCause === 'bomb' || robot.lastCause === 'pod' || robot.lastCause === 'missile') {
      hitstop(HITSTOP.blast, robot);
    }
    if (robot === you && !reduceMotion) game.shake = Math.max(game.shake, 0.15);
  }
  if (!before.onGround && robot.onGround && before.vy < -LANDING_SPEED) {
    effects.puff(probe.set(robot.pos.x, robot.pos.y + 0.1, robot.pos.z), DUST);
  }
  if (robot.state === before.state) return;
  if (robot.state === 'attack' && (robot.slashKind === 'thrust' || robot.slashKind === 'dive')) {
    sfx.charge();
  } else if (robot.state === 'guard') {
    sfx.guardUp();
  } else if (robot.state === 'airdash' && robot.onGround) {
    effects.puff(probe.set(robot.pos.x, robot.pos.y + 0.1, robot.pos.z), DUST); // 地上でステップした
  } else if (robot.state === 'fall') {
    sfx.fall();
    hud.popup('落下', probe.set(robot.pos.x, robot.pos.y + 3.3, robot.pos.z), camera, `${kind} big`);
  } else if (robot.state === 'down' && before.state === 'fall') {
    // 穴の底から飛び出した (ダウンの文字とヒットストップは出さない)
    effects.puff(probe.set(robot.pos.x, 0.2, robot.pos.z), DUST);
    sfx.popOut();
  } else if (robot.state === 'down') {
    sfx.down();
    hitstop(HITSTOP.down, robot);
    hud.popup('ダウン', probe.set(robot.pos.x, robot.pos.y + 3.3, robot.pos.z), camera, `${kind} big`);
  } else if (robot.state === 'ko') {
    effects.explosion(robot.center, 2.2, 0xffffff);
    sfx.boom();
    // 4人対戦では、試合の途中でも倒れたロボがわかるように
    if (game.rule !== 'duel' && game.state === 'fight') hud.popup('K.O.', probe.set(robot.pos.x, robot.pos.y + 3.3, robot.pos.z), camera, `${kind} big`);
  }
}

// 体力が少ないロボは、体から煙を出す (ときどき火花も)
function smoke(robot, dt) {
  if (!robot.alive || robot.hp > MAX_HP * LOW_HP_SMOKE) return;
  const timers = fxTimers.get(robot);
  timers.smoke -= dt;
  if (timers.smoke > 0) return;
  timers.smoke = 0.12 + Math.random() * 0.1;
  const top = probe.set(robot.pos.x, robot.pos.y + (robot.down ? 0.8 : 2), robot.pos.z);
  effects.puff(top, SMOKE);
  if (Math.random() < 0.25) effects.burst(top, 0xffc773, 3, 2.5);
}

// パワーアップ中のロボは、体から金色の粒が立ちのぼる
function aura(robot, dt) {
  if (!robot.alive || robot.power <= 0) return;
  const timers = fxTimers.get(robot);
  timers.aura -= dt;
  if (timers.aura > 0) return;
  timers.aura = 0.1;
  effects.puff(probe.set(robot.pos.x, robot.pos.y + (robot.down ? 0.5 : 1.2), robot.pos.z), POWER_AURA);
}

// しびれマスでしびれているロボは、体のあちこちから電気の火花が散る
function sparks(robot, dt) {
  if (robot.zapped <= 0) return;
  const timers = fxTimers.get(robot);
  timers.zap -= dt;
  if (timers.zap > 0) return;
  timers.zap = 0.07;
  const at = probe.set(robot.pos.x + (Math.random() - 0.5) * 1.2, robot.pos.y + 0.4 + Math.random() * 1.6, robot.pos.z + (Math.random() - 0.5) * 1.2);
  effects.burst(at, Math.random() < 0.5 ? TILE_COLORS.shock : 0xffffff, 5, 3.5);
}

// 加速しているロボは、地面を走ると足元から光の粒が出る
function trail(robot, dt) {
  if (robot.haste <= 0 || !robot.onGround || Math.hypot(robot.vel.x, robot.vel.z) < 3) return;
  const timers = fxTimers.get(robot);
  timers.haste -= dt;
  if (timers.haste > 0) return;
  timers.haste = 0.06;
  effects.puff(probe.set(robot.pos.x, robot.pos.y + 0.2, robot.pos.z), HASTE_TRAIL);
}

// a から b へ回る角度 (-π〜π)
function angleDiff(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

// 試合に出ているロボ全部の組で、重ならないように押し分ける
function separateAll() {
  for (let i = 0; i < robots.length; i++) {
    for (let j = i + 1; j < robots.length; j++) separate(robots[i], robots[j]);
  }
}

// ロボ同士が重ならないように押し分ける (倒れたロボは、ほかのロボのじゃまをしない)
function separate(a, b) {
  if (!a.alive || !b.alive) return;
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  const d = Math.hypot(dx, dz);
  const min = ROBOT_RADIUS * 2;
  if (d >= min || Math.abs(a.pos.y - b.pos.y) > 2) return;
  const nx = d > 1e-4 ? dx / d : 1;
  const nz = d > 1e-4 ? dz / d : 0;
  const push = (min - d) / 2;
  a.pos.x -= nx * push;
  a.pos.z -= nz * push;
  b.pos.x += nx * push;
  b.pos.z += nz * push;
}

// 戦っている間は、プレイヤー (2対2でプレイヤーが倒れたら、なかま) の後ろから、ロックオンしている相手のほうを見る。
// タイトル・大会・結果の画面では闘技場のまわりを回り、組み立て画面では台の上のロボを正面から映す
function updateCamera(dt, realDt) {
  if (MENU_STATES.has(game.state)) {
    game.orbit += realDt * 0.12;
    const radius = arena.half * 1.5;
    camWant.set(Math.sin(game.orbit) * radius, 12, Math.cos(game.orbit) * radius);
    lookWant.set(0, 1, 0);
  } else if (game.state === 'garage') {
    camWant.set(showcase.x, showcase.y + 2.1, showcase.z + 4.8);
    lookWant.set(showcase.x, showcase.y + 1.25, showcase.z);
  } else if (game.state === 'finish' && game.spotlight && game.time > POSE_CAMERA.after) {
    // 勝ちポーズを、ロボの斜め前から映す
    const star = game.spotlight;
    const yaw = star.yaw + POSE_CAMERA.angle;
    const lim = arena.half - 0.6;
    camWant.set(
      THREE.MathUtils.clamp(star.pos.x + Math.sin(yaw) * POSE_CAMERA.distance, -lim, lim),
      Math.max(star.pos.y, 0) + POSE_CAMERA.height,
      THREE.MathUtils.clamp(star.pos.z + Math.cos(yaw) * POSE_CAMERA.distance, -lim, lim),
    );
    clearView(head.set(star.pos.x, Math.max(star.pos.y, 0) + 1.6, star.pos.z), camWant);
    lookWant.set(star.pos.x, Math.max(star.pos.y, 0) + POSE_CAMERA.look, star.pos.z);
  } else {
    const me = viewer();
    const foe = me.target ?? cpu;
    const dx = foe.pos.x - me.pos.x;
    const dz = foe.pos.z - me.pos.z;
    const dist = Math.hypot(dx, dz);
    // 相手が近いほど 1 に近づく。近いときは高く引いて見下ろし、向きはゆっくり変える
    const close = 1 - THREE.MathUtils.smoothstep(dist, CAMERA_NEAR[0], CAMERA_NEAR[1]);
    if (dist > 0.5) {
      const rate = THREE.MathUtils.lerp(CAMERA_TURN.far, CAMERA_TURN.near, close);
      const limit = THREE.MathUtils.lerp(CAMERA_MAX_TURN.far, CAMERA_MAX_TURN.near, close) * dt;
      const turn = angleDiff(Math.atan2(dx, dz), game.camYaw) * (1 - Math.exp(-dt * rate));
      game.camYaw += THREE.MathUtils.clamp(turn, -limit, limit);
    }
    const back = view.back + close * CAMERA_NEAR_BACK;
    const fx = Math.sin(game.camYaw);
    const fz = Math.cos(game.camYaw);
    // 床の穴に落ちても、カメラは床の高さから下げない
    camWant.set(me.pos.x - fx * back, Math.max(me.pos.y, 0) + view.height + close * CAMERA_NEAR_LIFT, me.pos.z - fz * back);
    // 壁の外には出さない。近づいたぶんは高くして、ロボで画面がふさがらないようにする
    const lim = arena.half - 0.6;
    camWant.x = THREE.MathUtils.clamp(camWant.x, -lim, lim);
    camWant.z = THREE.MathUtils.clamp(camWant.z, -lim, lim);
    const room = Math.hypot(camWant.x - me.pos.x, camWant.z - me.pos.z);
    camWant.y += Math.max(0, back - room) * 0.5;
    clearView(head.set(me.pos.x, Math.max(me.pos.y, 0) + 2.2, me.pos.z), camWant);
    lookWant.lerpVectors(me.center, foe.center, view.look);
    lookWant.y = Math.max(lookWant.y, 1);
  }
  const k = 1 - Math.exp(-realDt * 8);
  camPos.lerp(camWant, k);
  lookAt.lerp(lookWant, k);
  camera.position.copy(camPos);
  if (game.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * game.shake;
    camera.position.y += (Math.random() - 0.5) * game.shake;
    game.shake = Math.max(0, game.shake - realDt * 1.6);
  }
  camera.lookAt(lookAt);
}

// カメラが箱に埋まらないよう、from (ロボの頭) から見て箱の手前まで寄せる
function clearView(from, to) {
  for (let i = 1; i <= 20; i++) {
    if (arena.blockAt(probe.lerpVectors(from, to, i / 20))) {
      to.lerpVectors(from, to, Math.max(0, (i - 1.5) / 20));
      return;
    }
  }
}

// 映す範囲をずらす。組み立て画面では、パネルに隠れない側 (横長なら左、縦長なら上) にロボが来るように。
// 縦長の画面で戦うときは、下のボタンに隠れないよう上へ
function updateViewOffset() {
  const w = screenW;
  const h = screenH;
  if (game.state === 'garage') {
    if (w >= h) camera.setViewOffset(w, h, w * 0.26, 0, w, h);
    else camera.setViewOffset(w, h, 0, h * 0.27, w, h);
  } else if (view.shift > 0 && BATTLE_STATES.has(game.state)) {
    camera.setViewOffset(w, h, 0, h * view.shift, w, h);
  } else {
    camera.clearViewOffset();
  }
}

function resize() {
  // 横向きで遊ぶ設定で、画面が縦長のときだけ回す。スマホの上を左に向けて持つと、ゲームがまっすぐ見える
  const rotated = touchMode && wantLandscape && innerWidth < innerHeight;
  document.body.classList.toggle('rotated', rotated);
  screenW = rotated ? innerHeight : innerWidth;
  screenH = rotated ? innerWidth : innerHeight;
  app.style.width = rotated ? `${screenW}px` : '';
  app.style.height = rotated ? `${screenH}px` : '';
  app.style.transform = rotated ? `translateX(${innerWidth}px) rotate(90deg)` : '';
  document.body.classList.toggle('portrait', screenW < screenH); // CSS の縦向き用の並び
  input.rotated = rotated;
  hud.resize(screenW, screenH);
  renderer.setSize(screenW, screenH, false);
  view = screenW < screenH ? CAMERA_VIEWS.portrait : CAMERA_VIEWS.landscape;
  camera.aspect = screenW / screenH;
  camera.fov = view.fov;
  camera.updateProjectionMatrix();
  updateViewOffset();
  // 「横向きで遊ぶ」ボタンは、縦長の画面のスマホだけに出す (はじめから横長なら回す必要がない)
  const toggle = document.getElementById('rotate-toggle');
  toggle.hidden = !(touchMode && (rotated || innerWidth < innerHeight));
  toggle.textContent = rotated ? '縦向きにもどす' : '横向きで遊ぶ';
  document.getElementById('rotate-hint').hidden = toggle.hidden || rotated;
  fitPad();
}

// タッチのボタンの一式を、画面に入る大きさにする (小さな画面では縮める。大きくはしない)。横長の画面では、右半分の、
// 上の体力ゲージより下に入れる。縦長の画面では、下の2段が左の親指のスティックにかからず、高さが画面の PAD_FIT.tall まで
function fitPad() {
  const pad = document.getElementById('pad');
  pad.style.scale = '';
  const style = getComputedStyle(pad); // 試合の外の画面で隠れていても、CSS で決めた大きさが読める
  const width = parseFloat(style.width);
  const height = parseFloat(style.height);
  const right = parseFloat(style.right) || 0;
  const bottom = parseFloat(style.bottom) || 0;
  if (!width || !height) return;
  const room = screenW < screenH
    ? Math.min((screenW - right - PAD_FIT.stick) / PAD_FIT.lower, (screenH * PAD_FIT.tall) / height)
    : Math.min((screenW / 2 - right) / width, (screenH - bottom - PAD_FIT.hud) / height);
  if (room < 1) pad.style.scale = room.toFixed(3);
}

function toggleLandscape() {
  wantLandscape = !wantLandscape;
  try {
    localStorage.setItem(LANDSCAPE_KEY, wantLandscape ? '1' : '0');
  } catch {
    // 覚えられなくても、いまは切りかえる
  }
  resize();
}

// いまの画面でいちばん押してほしいボタン (Enter で押す)
function primaryButton() {
  const screen = { title: 'title-screen', cup: 'cup-screen', garage: 'garage-screen', result: 'result-screen' }[game.state];
  return screen ? document.querySelector(`#${screen} .cta:not([hidden]):not(:disabled)`) : null;
}

const onClick = (id, handler) => document.getElementById(id).addEventListener('click', handler);
onClick('open-cup', () => openCup());
onClick('start-free', () => startMatch('free'));
onClick('open-garage', () => openGarage('title'));
onClick('cup-back', toTitle);
onClick('cup-garage', () => {
  game.cupIndex = cup.index;
  openGarage('cup');
});
onClick('cup-fight', () => {
  if (!cup.available(cup.index)) return;
  game.cupIndex = cup.index;
  startMatch('cup', cup.rival);
});
onClick('garage-back', () => (game.garageFrom === 'cup' ? openCup(game.cupIndex) : toTitle()));
onClick('garage-fight', () => (game.garageFrom === 'cup' ? startMatch('cup', chosenRival()) : startMatch('free')));
onClick('again', () => startMatch(game.mode, game.rival));
onClick('result-cup', () => openCup(game.winner === 'you' ? null : game.cupIndex));
onClick('result-garage', () => {
  if (game.rival) game.cupIndex = RIVALS.indexOf(game.rival);
  openGarage(game.mode === 'cup' ? 'cup' : 'title');
});
onClick('result-title-screen', toTitle);
onClick('rotate-toggle', toggleLandscape);

// フリー対戦のルールの切りかえ (タイトル画面)。選んだルールはこの端末に覚える
const ruleButtons = [...document.querySelectorAll('[data-rule]')];
function showRule() {
  for (const button of ruleButtons) button.setAttribute('aria-pressed', String(button.dataset.rule === freeRule));
}
for (const button of ruleButtons) {
  button.addEventListener('click', () => {
    freeRule = button.dataset.rule;
    try {
      localStorage.setItem(RULE_KEY, freeRule);
    } catch {
      // 覚えられなくても、いまは切りかえる
    }
    showRule();
  });
}
showRule();

// オートで撃つの切りかえ (タイトル画面)。選んだほうはこの端末に覚える。入のときは、ショットのボタンに AUTO と出す (body.auto-shot)
const autoButtons = [...document.querySelectorAll('[data-auto]')];
function showAuto() {
  for (const button of autoButtons) button.setAttribute('aria-pressed', String((button.dataset.auto === 'on') === autoShot));
  document.body.classList.toggle('auto-shot', autoShot);
}
for (const button of autoButtons) {
  button.addEventListener('click', () => {
    autoShot = button.dataset.auto === 'on';
    try {
      localStorage.setItem(AUTO_KEY, autoShot ? '1' : '0');
    } catch {
      // 覚えられなくても、いまは切りかえる
    }
    showAuto();
  });
}
showAuto();
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Escape') {
    if (game.state === 'garage') document.getElementById('garage-back').click();
    else if (game.state === 'cup') toTitle();
    return;
  }
  if (e.code !== 'Enter' && e.code !== 'Space') return;
  // ボタンを選んでいるときはそのボタンを押す (Space はジャンプに使うので、ここで押し直す)
  if (e.target instanceof HTMLButtonElement) {
    if (e.code === 'Space' && !document.body.classList.contains('in-battle')) {
      e.preventDefault();
      e.target.click();
    }
    return;
  }
  const button = primaryButton();
  if (button) {
    e.preventDefault();
    button.click();
  }
});
addEventListener('resize', resize);
resize();
placeRobots();
hud.setProgress(progress);
hud.showScreen('title');

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const realDt = Math.min((now - last) / 1000, 0.05);
  last = now;
  step(realDt);
  renderer.render(scene, camera);
});

// デバッグ用
window.game = {
  game, you, cpu, cpus, ai, ais, weapons, items, arena, tiles, camera, input, cup, entrance, startMatch, openCup, openGarage,
  get robots() {
    return robots;
  },
  get progress() {
    return progress;
  },
};
