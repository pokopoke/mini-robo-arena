import * as THREE from 'three';
import { partOf, robotStats } from './parts.js';
import { buildRobotModel, disposeModel, LEG } from './models.js';
import { MISSILE_BUTTON } from './weapons.js';

// ロボ。状態は normal (ふつう) / airdash (空中ダッシュ) / attack (ブレードで斬っている。斬る前の踏み込みや突っこみも) /
// recover (斬り終わりの隙) / guard (シールドを構えている) /
// flinch (よろけて動けない。斬られた・シールドが割れた・ブレードをシールドではじかれた・しびれマスでしびれた) / down (ダウン) /
// getup (起き上がり) / fall (床の穴に落ちている。何もできず、攻撃も受けない) / ko (倒れた)。
// いつもロックオンした相手 (target) のほうを向く。相手は、ちがうチーム (team) のロボ (foes。main.js が試合の始まりに決める)。
// 4人対戦では、ターゲットのボタンで相手を順に切りかえ、ロックオンしていた相手が倒れたら、いちばん近い相手へ移る。
// 走る速さ・ジャンプ・倒れにくさなどの性能と武器は、組み合わせたパーツ (loadout) で決まる。どのロボもミサイルのボタンで両肩からミサイルを撃てる。
// 攻撃を当てたり受けたりすると必殺技のゲージ (special) がたまり、満タンで必殺技 (核ミサイル) を撃てる (ボタンはプレイヤーだけ)。
// アイテム (items.js) で体力がもどったり (heal)、しばらく与えるダメージが増えたり (powerUp)、バリアを張ったり (shieldUp) する。
// 床の仕掛け (tiles.js) で、しばらく速く走れたり (hasteUp)、穴に落ちたり (startFall → climbOut) する
export const MAX_HP = 1000;
export const BARRIER_COLOR = 0x7ec8ff; // バリアの色 (アイテムも同じ水色)
export const ROBOT_RADIUS = 0.8;
const ROBOT_HEIGHT = 2.3;
const CENTER_HEIGHT = 1.3; // 足元から体の中心まで (弾の当たり判定)
const GROUND_ACCEL = 85; // 地上での加速 (m/秒²)。大きいほど切り返しが速い
const AIR_ACCEL = 18;
// ステップ (ステップのボタン。CPU は使わない): 地上で、スティックの向きへ素早く動く (空中で押すと空中ダッシュ)。
// speed: 速さ (m/秒) / time: 動く長さ (秒) / cooldown: 次に地上でステップできるまで (秒)
const STEP = { speed: 22, time: 0.24, cooldown: 0.6 };
// 撃つ・動くときの助け。aim: 弾とミサイルが相手を追う強さ (spec.turn) の倍率 / lead: 弾の先読み (spec.lead) の下限 /
// ground, air: 地上・空中で動きを変える速さ (加速) の倍率。ふつうのロボは NO_ASSIST、プレイヤーは PLAYER_ASSIST (main.js が付ける)
const NO_ASSIST = { aim: 1, lead: 0, ground: 1, air: 1 };
export const PLAYER_ASSIST = { aim: 1.7, lead: 0.9, ground: 1.4, air: 2.5 };
// ブレード (光る刃で斬る)。押したときのスティックの向き (相手に対して) で技が変わる (コマンド):
// 倒していない・後ろ = 3回斬り (押すたびに3回まで続き、3回目で相手をダウンさせる。1回目は、相手が遠ければ先に踏み込む) /
// 前 = 突き / 横 = 回り込み斬り / 空中 (床から DIVE.height より上) = 急降下斬り
const BLADE_REACH = 2.6; // 刃が届く距離 (自分と相手の足元の、水平の距離 m)
const BLADE_ARC = 0.35; // 前からこの範囲 (向きとの cos。約70°) にいる相手に当たる
// 技ごとの性能。combo1〜3 は3回斬りの1〜3回目。damage: フレームの blade に対する割合 / down: 当たればダウン (ほかは、よろけさせる) /
// recover: 斬り終わりの隙 (秒。隙の間もスティックで動ける) / chain: 隙のあいだに押せば、3回斬りの次の斬りへ続く / pierce: シールドで防げない
const SLASHES = {
  combo1: { damage: 0.3, down: false, recover: 0.3, chain: true },
  combo2: { damage: 0.3, down: false, recover: 0.3, chain: true },
  combo3: { damage: 0.6, down: true, recover: 0.45, chain: false },
  thrust: { damage: 0.6, down: true, recover: 0.55, chain: false },
  circle: { damage: 0.3, down: false, recover: 0.3, chain: true, pierce: true },
  dive: { damage: 0.5, down: true, recover: 0.5, chain: false },
};
const COMMAND_STICK = 0.5; // スティックをこれ以上倒して押すと、向きの技になる (いっぱいに倒したときに対する割合)
const COMMAND_FRONT = 0.7; // スティックの向きと相手への向きの cos がこれより大きければ「前」(約45°以内)。-COMMAND_FRONT より小さければ「後ろ」
const SLASH_TIME = 0.28; // 1回の斬りの長さ (秒)
const SLASH_ACTIVE = [0.06, 0.16]; // 斬りのうち、刃が当たる時間 (秒)
const SLASH_STEP = 5; // 斬りながら前へ出る速さ (m/秒)
const LUNGE_SPEED = 17; // 3回斬りの1回目の踏み込みの速さ (m/秒)
const LUNGE_TIME = 0.35; // 踏み込みの長さの上限 (秒)
const LUNGE_STOP = 1.9; // 踏み込み・突き・回り込み・急降下で、ここまで近づいたら止まって斬る (m)
const LUNGE_INVINCIBLE = 0.3; // 3回斬りの1回目の出だしは攻撃を受けない (秒)
// 突き: 少しためてから、ためが終わったときの相手の場所へまっすぐ突っこんで突く (横へ動けばよけられる)。
// windup: ため (秒) / speed: 突っこむ速さ (m/秒) / time: 突っこむ長さの上限 (秒) / step: 突くときに前へ出る速さ (m/秒)
const THRUST = { windup: 0.16, speed: 25, time: 0.42, step: 9 };
// 回り込み斬り: 相手のまわりを横へ回りながら近づいて斬る (シールドの横から斬るので防げない)。
// speed: 横へ回る速さ / approach: 近づく速さ (m/秒) / minTime: 近くても回る時間 / time: 回る長さの上限 (秒)
const CIRCLE = { speed: 13, approach: 10, minTime: 0.16, time: 0.45 };
// 急降下斬り: 空中で一瞬止まってから、相手めがけて斜め下へ飛びこんで斬る。height: これより高いと空中の技になる (m) /
// windup: 止まる時間 / speed: 飛びこむ速さ (m/秒) / slope: 下へ向かう割合の最小 (上へは行かない) / time: 飛びこむ長さの上限 (秒)
export const DIVE = { height: 1.2, windup: 0.12, speed: 24, slope: 0.45, time: 0.7 };
const RECOVER_CANCEL = 0.1; // 隙がこれだけたてば、ほかのボタン (ジャンプ・ステップ・ショット・グレネード・マイン・ミサイル・シールド) で切り上げられる (秒)
const BLADE_COOLDOWN = 1.6; // 斬り (技) が終わってから、次に斬れるまで (秒)
const PENDING_ACTIONS = ['jump', 'step', 'gun', 'bomb', 'pod', 'missile']; // 斬っている間やよろけている間に押したら、覚えておくボタン
// 必殺技 (核ミサイル: weapons.js の NUKE) のゲージ。与えたダメージ SPECIAL_DEALT ぶん、または受けたダメージ SPECIAL_TAKEN ぶんで満タン
// (足し合わせる。1試合に2〜4回たまるくらい)。ボタンはプレイヤーだけにあり、CPU は使わない
const SPECIAL_DEALT = 450;
const SPECIAL_TAKEN = 650;
const LAUNCH_POSE_TIME = 0.6; // 核ミサイルを打ち上げるとき、胸を張って構える時間 (秒)
const FLINCH_TIME = 0.45; // 斬られた相手がよろけて動けない時間 (秒)
const FLINCH_PUSH = 3; // よろけて後ろへ下がる速さ (m/秒)
// シールド: ボタンを押している間、体の前に光の盾を構える。前から来た弾・爆発・ブレードを全部防ぐ (ブレードは、斬った側がはじかれてよろける)。
// 回り込み斬りと、真上や足元からの攻撃 (足元に落ちたグレネードなど) は防げない。構えている間は撃てず、ゆっくりしか動けない。
// 防いだダメージのぶん耐久が減り、0 になると割れて、よろけたうえ GUARD_BREAK_TIME 秒使えない。耐久は構えていないと少しずつもどる
export const GUARD_MAX = 260; // 耐久
const GUARD_ARC = 0.26; // 前からこの範囲 (向きとの cos。約75°) から来た攻撃を防ぐ
const GUARD_NEAR = 1; // 攻撃の来たところがこれより近い (水平の距離 m) と、真上や足元からなので防げない
const GUARD_MOVE = 0.35; // 構えている間の走る速さの割合
const GUARD_BLADE = 1.5; // ブレードを防いだときは、ダメージのこの倍だけ耐久が減る
const GUARD_PUSH = 2.5; // ブレードや爆発を防いだとき、後ろへ押される速さ (m/秒)
const GUARD_REGEN = 45; // 耐久がもどる速さ (/秒)
const GUARD_REGEN_WAIT = 0.8; // 構えるのをやめてから、耐久がもどり始めるまで (秒)
const GUARD_BREAK_TIME = 4; // 割れてから、また構えられるまで (秒)
const GUARD_CRUSH = 0.7; // 割れたときに、よろけて動けない時間 (秒)
const REPEL_TIME = 0.55; // ブレードをシールドではじかれた側が、よろけて動けない時間 (秒)
const GUARD_OFFSET = 0.95; // 盾の、体の軸から前への距離 (m)
const GUARD_HEIGHT = 1.3; // 盾の真ん中の、足元からの高さ (m)
const GUARD_REACH = 0.35; // 構えているとき、前から来た弾やミサイルはこれだけ手前 (盾のところ) で当たる (m)
const DOWN_TIME = 1.3;
const GETUP_TIME = 0.4;
const GETUP_INVINCIBLE = 1.0;
const STAGGER_DECAY = 70; // たまったダメージが減っていく速さ (/秒)
const POWER_RATE = 1.5; // パワーアップ (アイテム) 中に与えるダメージの倍率
const POWER_GLOW = new THREE.Color(0x8a5a00); // パワーアップ中に装甲を光らせる色
const HASTE_RATE = 1.4; // 加速マス (tiles.js) に乗ったあとの、走る速さの倍率
const FALL_FLIGHT = 0.75; // 穴から飛び出して、そばの床に降りるまで (秒。ダウンの長さ DOWN_TIME より短く)
const RUN_LEAN = 0.2; // 走る向きへ体を前へ傾ける大きさ (rad。いっぱいの速さのとき)
const RUN_ROLL = 0.14; // 横へ走るとき、その向きへ体を倒す大きさ (rad)
const LAND_POSE_SPEED = 6; // これより速く落ちて着地すると、決めポーズで着地する (m/秒)
const LAND_POSE_TIME = 0.45; // 着地の決めポーズから構えにもどるまで (秒)
const HIP_HEIGHT = LEG.thigh + LEG.shin; // 立っているときの、脚の付け根の高さ
// 姿勢。地上では feet と crouch から脚の曲げ方を決める (足の裏を床につけたまま腰を落とす)。
// feet: 右足・左足を置く前後の位置 (m。前が +) / crouch: 腰を下げる量 (m) / splay: 足を横へ開く角度 / twist: 腰から上ごと体をひねる角度 (+ で右肩が前) /
// torso: 上半身の [前へかがむ, ひねる (+ で右肩が前)] / gun, bomb: 右腕・左腕の [腕を上げる (− で前へ), 腕を左右へ回す (+ で左へ), 腕を横へ開く, ひじの曲げ (+ で前腕が下がる)]
const POSES = {
  // ふだんの構え: 左足を前に出して腰を落とし、左肩を前にして左腕を上げ、右手のショットを相手へ向ける
  ready: { feet: [-0.22, 0.16], crouch: 0.1, splay: 0.06, twist: -0.12, torso: [0.1, -0.06], gun: [-0.3, 0.18, -0.08, 0.3], bomb: [-0.45, 0.08, 0.15, 0.1] },
  // シールド: 腰をさらに落とし、左腕を胸の前に上げる
  guard: { feet: [-0.26, 0.2], crouch: 0.16, splay: 0.08, twist: -0.2, torso: [0.16, -0.1], gun: [-0.25, 0.3, -0.1, 0.25], bomb: [-1.25, -0.55, 0, 0] },
  // 勝ちポーズ: 足を開いて胸を張り、右腕で光の刃を高く掲げ、左のこぶしを腰に
  win: { feet: [-0.03, 0.03], crouch: 0.02, splay: 0.14, twist: 0.12, torso: [-0.12, 0.18], gun: [-2.5, 0.2, 0, -0.25], bomb: [0.35, -0.3, 0.25, 0] },
  // 着地の決めポーズ: 左ひざを前に深く曲げ、右ひざを床の近くまで落として前へかがみ、両腕を広げる
  land: { feet: [-0.42, 0.3], crouch: 0.34, splay: 0.12, twist: 0, torso: [0.42, 0], gun: [0.5, 0, -0.95, 0.4], bomb: [0.35, 0, 1.05, 0.4] },
  // よろけ: 上半身がのけぞり、腕が前へ投げ出される
  flinch: { feet: [-0.25, 0.15], crouch: 0.12, splay: 0.08, twist: 0, torso: [-0.4, 0], gun: [-0.7, 0, -0.35, 0], bomb: [-0.7, 0, 0.35, 0] },
  // 核ミサイルの打ち上げ: 足を開いて腰を落とし、胸を張って空を見上げ、両腕を後ろへ広げて踏んばる
  launch: { feet: [-0.2, 0.2], crouch: 0.18, splay: 0.14, twist: 0, torso: [-0.3, 0], gun: [0.45, 0, -0.55, 0.35], bomb: [0.45, 0, 0.55, 0.35] },
  // 空中: 腕を少し開く / 空中ダッシュ: 前へかがんで腕を後ろへ流す / 穴に落ちている: 両腕を上げてもがく / 倒れている: まっすぐ。
  // 空中では脚の曲げ方を角度で決めるので feet と crouch は使わないが、着地した瞬間に脚がのびきらないよう、ひざを曲げた形にしておく
  air: { feet: [-0.25, 0.2], crouch: 0.14, splay: 0.04, twist: 0, torso: [0.08, 0], gun: [-0.15, 0.1, -0.3, 0.2], bomb: [-0.2, -0.1, 0.3, 0.2] },
  dash: { feet: [-0.25, 0.2], crouch: 0.14, splay: 0.04, twist: 0, torso: [0.2, 0], gun: [0.5, 0, -0.2, 0.3], bomb: [0.5, 0, 0.2, 0.3] },
  fall: { feet: [0, 0], crouch: 0, splay: 0.1, twist: 0, torso: [-0.2, 0], gun: [-2.3, 0, -0.4, -0.2], bomb: [-2.3, 0, 0.4, -0.2] },
  lying: { feet: [0, 0], crouch: 0, splay: 0, twist: 0, torso: [0, 0], gun: [0, 0, 0, 0], bomb: [0, 0, 0, 0] },
};
const POSE_LISTS = ['feet', 'torso', 'gun', 'bomb'];
const POSE_VALUES = ['crouch', 'splay', 'twist'];
const UP = new THREE.Vector3(0, 1, 0);

// 姿勢の写し
function copyPose(from, to = { feet: [], torso: [], gun: [], bomb: [] }) {
  for (const key of POSE_VALUES) to[key] = from[key];
  for (const key of POSE_LISTS) for (let i = 0; i < from[key].length; i++) to[key][i] = from[key][i];
  return to;
}

// 姿勢 pose を target へ、割合 t だけ近づける
function blendPose(pose, target, t) {
  for (const key of POSE_VALUES) pose[key] += (target[key] - pose[key]) * t;
  for (const key of POSE_LISTS) for (let i = 0; i < pose[key].length; i++) pose[key][i] += (target[key][i] - pose[key][i]) * t;
  return pose;
}

// 足の裏を、脚の付け根から前へ z・下へ reach の所に置くときの、ももの角度 (hip。− で前へ出る) とひざの曲げ (knee)。
// ひざは前へ出して曲げる。届かないときは、その向きに脚をのばしきる
function legAngles(z, reach, out) {
  const length = LEG.thigh + LEG.shin - 0.002;
  const far = Math.hypot(z, reach);
  const d = Math.min(far, length);
  const toward = Math.atan2(z, reach); // 付け根から足の裏への向き (前へ倒れるほど大きい)
  const inner = Math.acos(THREE.MathUtils.clamp((LEG.thigh ** 2 + d * d - LEG.shin ** 2) / (2 * LEG.thigh * d), -1, 1));
  const thigh = toward + inner; // ももが前へ出る角度
  const kneeZ = LEG.thigh * Math.sin(thigh);
  const kneeY = LEG.thigh * Math.cos(thigh);
  const shin = Math.atan2(kneeZ - (z * d) / far, (reach * d) / far - kneeY); // すねが後ろへ傾く角度
  out.hip = -thigh;
  out.knee = shin + thigh;
  return out;
}

export class Robot {
  // side: 'you' (プレイヤー) / 'cpu'。色分けに使う
  constructor(scene, side, bulletColor, loadout) {
    this.scene = scene;
    this.side = side;
    this.bulletColor = bulletColor;
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(ROBOT_RADIUS * 1.1, 8).rotateX(-Math.PI / 2), // 足元の影 (角ばった八角形)
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    scene.add(this.shadow);
    // バリアの光の膜 (角ばった球と、その稜線)。バリアがあるときだけ見せる
    const glow = { color: BARRIER_COLOR, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    this.barrierMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35, 1), new THREE.MeshBasicMaterial({ ...glow, opacity: 0.18, side: THREE.DoubleSide }));
    this.barrierMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(this.barrierMesh.geometry), new THREE.LineBasicMaterial({ ...glow, opacity: 0.55 })));
    this.barrierMesh.visible = false;
    scene.add(this.barrierMesh);
    // シールドの光の盾 (縦長の六角形の板と、そのふちと内側の線)。ロボの弾の色。構えている間だけ見せる
    const plate = new THREE.CircleGeometry(0.9, 6).rotateZ(Math.PI / 2).scale(1, 1.15, 1);
    const shine = { color: bulletColor, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    this.guardMesh = new THREE.Mesh(plate, new THREE.MeshBasicMaterial({ ...shine, opacity: 0.16, side: THREE.DoubleSide }));
    this.guardEdge = new THREE.LineBasicMaterial({ ...shine, opacity: 0.7 });
    this.guardMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(plate), this.guardEdge));
    this.guardMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(plate.clone().scale(0.55, 0.55, 1)), this.guardEdge));
    this.guardMesh.visible = false;
    scene.add(this.guardMesh);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.lungeDir = new THREE.Vector3(); // 突き・急降下で突っこむ向き
    this.centerPoint = new THREE.Vector3();
    this.glow = new THREE.Color(); // 装甲の光る色 (animate で決める)
    this.landGoal = copyPose(POSES.ready); // 着地の決めポーズを重ねた目標の姿勢 (animate が使う入れ物)
    this.legGoals = [{ hip: 0, knee: 0 }, { hip: 0, knee: 0 }]; // 右脚・左脚の曲げ方 (animate が使う入れ物)
    this.team = 0; // チーム (同じチームのロボには、弾もブレードも当たらない)
    this.foes = []; // 相手のロボ (ちがうチームのロボ全部)
    this.target = null; // ロックオンしている相手
    this.label = ''; // 画面に出す名前
    this.present = true; // 試合に出ている (4人対戦でないときは、増えた CPU を隠す)
    this.assist = NO_ASSIST; // 撃つ・動くときの助け (プレイヤーは main.js が PLAYER_ASSIST にする)
    this.dashLength = 0; // いまの空中ダッシュかステップの長さ (秒)
    this.model = null;
    this.setLoadout(loadout);
    this.reset(0, 0, 0);
  }

  // パーツを付け替える。見た目を作り直し、性能と武器を入れ替える
  setLoadout(loadout) {
    this.loadout = { ...loadout };
    this.stats = robotStats(this.loadout);
    this.parts = {
      gun: partOf('gun', this.loadout.gun).spec,
      bomb: partOf('bomb', this.loadout.bomb).spec,
      pod: partOf('pod', this.loadout.pod).spec,
    };
    this.cooldownMax = {
      gun: this.parts.gun.cooldown, bomb: this.parts.bomb.cooldown, pod: this.parts.pod.cooldown, missile: MISSILE_BUTTON.cooldown, attack: BLADE_COOLDOWN, guard: GUARD_BREAK_TIME, step: STEP.cooldown,
    };
    const visible = this.model ? this.model.root.visible : true;
    if (this.model) {
      this.scene.remove(this.model.root);
      disposeModel(this.model.root);
    }
    this.model = buildRobotModel(this.loadout, this.side);
    this.model.root.visible = visible;
    this.scene.add(this.model.root);
    this.root = this.model.root;
    this.body = this.model.body;
    this.torso = this.model.torso;
    this.head = this.model.head;
    this.flashMaterials = this.model.flash;
    this.legs = this.model.legs;
    this.arms = this.model.arms;
    this.elbows = this.model.elbows;
    // 肩は、上げた腕をそのまま左右へ回せる順に回す (腕を上げる x のあとに、縦の軸のまわりの y)
    for (const arm of Object.values(this.arms)) arm.rotation.order = 'YXZ';
    this.blade = this.model.blade;
    this.thrusters = this.model.thrusters;
    this.muzzles = this.model.muzzles;
    this.airDashes = Math.min(this.airDashes ?? this.stats.dashes, this.stats.dashes);
  }

  reset(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.hp = MAX_HP;
    this.state = 'normal';
    this.stateTime = 0;
    this.onGround = true;
    this.airDashes = this.stats.dashes;
    this.invincible = 0;
    this.stagger = 0;
    this.flash = 0;
    this.power = 0; // パワーアップの残り時間 (秒)
    this.barrier = 0; // バリアがあと防げるダメージ
    this.barrierTime = 0; // バリアが消えるまで (秒)
    this.barrierHit = 0; // バリアが攻撃を防いで光っている時間 (秒)
    this.blocks = 0; // バリアが攻撃を防いだ回数 (main.js が「ガード」を出すのに使う)
    this.barrierBreaks = 0; // バリアが割れた回数
    this.helperLeft = 0; // お助けロボがいる残り時間 (秒。HUD に出す。weapons.js の callHelper が決める)
    this.haste = 0; // 加速の残り時間 (秒)
    this.zapped = 0; // しびれマスでしびれて、火花が散っている残り時間 (秒。tiles.js が決め、main.js が火花を出す)
    this.pit = null; // 落ちている穴 (tiles.js のマス)。穴の中にいる間は、穴の壁から出られない
    this.pose = null; // 'win' なら勝ちポーズ (celebrate)
    this.rig = copyPose(POSES.ready); // いまの姿勢 (animate が、目標の姿勢へ少しずつ近づける)
    this.landing = 0; // 着地の決めポーズの残り (1 → 0)
    this.landPower = 0; // 着地の決めポーズの強さ (速く落ちるほど大きい)
    this.special = 0; // 必殺技のゲージ (0〜1。1 で撃てる)
    this.launchTime = 0; // 核ミサイルを打ち上げる構えの残り (秒)
    this.idleTime = 0; // 立っているときのゆれに使う時間 (秒)
    this.walk = 0;
    this.burstLeft = 0;
    this.burstTimer = 0;
    this.combo = 0; // 何回目の斬りか (0 は斬っていない。3回斬りの2・3回目は 2・3、ほかの技は 1)
    this.slashKind = 'combo1'; // いまの技 (SLASHES)
    this.slashSide = 1; // 回り込み斬りで回る向き (1 は右、-1 は左)
    this.attacks = 0; // 技を出した回数 (ai.js が、相手が斬りかかってきたのに気づくのに使う)
    this.slashHit = false; // いまの斬りが当たったか
    this.slashHits = new Set(); // いまの斬りが当たった相手 (4人対戦では、刃が届く相手全部に当たる)
    this.lastAttacker = null; // 最後に攻撃してきたロボ (CPU が狙う相手を選ぶのと、main.js の演出に使う)
    this.lastHitAge = Infinity; // 最後に攻撃されてからの時間 (秒)
    this.queued = false; // 斬っている間に次を押した
    this.swung = false; // いまの斬りで刃を振り始めたか
    this.lunging = false; // 斬る前の動き (踏み込み・ため・突っこみ・回り込み) の途中
    this.lungeTime = 0;
    this.swings = 0; // 刃を振った回数 (main.js が斬った跡を出すのに使う)
    this.bladeSize = 0;
    this.flinchTime = FLINCH_TIME; // いまのよろけが続く時間 (秒)
    this.guardHp = GUARD_MAX; // シールドの耐久
    this.guardWait = 0; // 耐久がもどり始めるまで (秒)
    this.guardHit = 0; // シールドが攻撃を防いで光っている時間 (秒)
    this.guardSize = 0; // 盾の出ぐあい (0〜1)
    this.guardCause = null; // 最後にシールドで防いだ攻撃の種類
    this.guardBlocks = 0; // シールドで防いだ回数 (main.js が火花と「ガード」を出すのに使う)
    this.guardBreaks = 0; // シールドが割れた回数
    this.repels = 0; // 自分のブレードを、相手にシールドではじかれた回数
    this.clearPending();
    this.cooldowns = { gun: 0, bomb: 0, pod: 0, missile: 0, attack: 0, guard: 0, step: 0 };
    this.root.visible = true;
    this.shadow.visible = true;
    this.body.rotation.set(0, 0, 0);
    this.body.position.y = 0;
    this.torso.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    for (const joint of [this.arms.gun, this.arms.bomb, this.elbows.gun, this.elbows.bomb]) joint.rotation.set(0, 0, 0);
    this.blade.visible = false;
    this.guardMesh.visible = false;
  }

  get center() {
    return this.centerPoint.set(this.pos.x, this.pos.y + CENTER_HEIGHT, this.pos.z);
  }

  get alive() {
    return this.state !== 'ko';
  }

  get down() {
    return this.state === 'down' || this.state === 'getup';
  }

  // 与えるダメージの倍率 (パワーアップ中は大きい)
  get attackRate() {
    return this.power > 0 ? POWER_RATE : 1;
  }

  // 必殺技のゲージをためる (amount: 満タンに対する割合)
  chargeSpecial(amount) {
    this.special = Math.min(1, this.special + Math.max(0, amount));
  }

  // 体力をもどす (MAX_HP まで)。もどった量を返す
  heal(amount) {
    const before = this.hp;
    this.hp = Math.min(MAX_HP, this.hp + amount);
    return this.hp - before;
  }

  // seconds 秒のあいだ、与えるダメージが POWER_RATE 倍になる
  powerUp(seconds) {
    this.power = Math.max(this.power, seconds);
  }

  // バリアを張る。合計 amount のダメージまで防ぎ (防いでいる間はダウンもよろけもしない)、seconds 秒で消える
  shieldUp(amount, seconds) {
    this.barrier = amount;
    this.barrierTime = seconds;
  }

  // 加速マスに乗った。seconds 秒のあいだ、走る速さが HASTE_RATE 倍になる
  hasteUp(seconds) {
    this.haste = Math.max(this.haste, seconds);
  }

  // 床の穴 (pit: tiles.js の、割れたもろい床のマス) に落ちた。底から飛び出す (climbOut) まで何もできない。倒れたロボは穴の中に残る
  startFall(pit) {
    this.pit = pit;
    if (!this.alive) return;
    this.burstLeft = 0;
    this.resetCombo();
    this.clearPending();
    this.vel.x = 0;
    this.vel.z = 0;
    this.setState('fall');
  }

  // 穴の底から、spot (穴のそばの床の点) へ飛び出す。damage を受け (バリアがあれば先に受け止める)、倒れたまま飛んで
  // FALL_FLIGHT 秒で spot に降り、起き上がる。体力がなくなれば、穴の中で倒れたまま
  climbOut(spot, damage) {
    const hurt = this.absorb(damage * this.stats.armor);
    if (hurt > 0) {
      this.hp = Math.max(0, Math.round(this.hp - hurt));
      this.flash = 0.12;
      this.lastCause = 'fall';
    }
    this.stagger = 0;
    if (this.hp <= 0) {
      this.setState('ko');
      return;
    }
    // 穴の口のすぐ下から、山なりに飛び出す (もう穴の壁にはじゃまされない)
    this.pit = null;
    this.pos.y = Math.max(this.pos.y, -0.6);
    const t = FALL_FLIGHT;
    this.vel.set((spot.x - this.pos.x) / t, (spot.y - this.pos.y) / t + 0.5 * this.stats.gravity * t, (spot.z - this.pos.z) / t);
    this.onGround = false;
    this.setState('down');
  }

  // ロボの向きを考えて、体の中の位置 (local) をワールド座標にする
  toWorld(local, target = new THREE.Vector3()) {
    return target.copy(local).applyAxisAngle(UP, this.yaw).add(this.pos);
  }

  // input: { move: {x, z} (ワールドの向き、長さ 1 まで), jump, gun, bomb, pod, missile, attack, guard (押している間 true),
  //          target (相手を切りかえる), special (必殺技) }
  update(dt, input, arena, weapons, sfx) {
    this.stateTime += dt;
    this.lastHitAge += dt;
    // ロックオン: ターゲットのボタンで次の相手へ。ロックオンしていた相手が倒れたら、いちばん近い相手へ
    if (input.target) this.nextTarget();
    if (!this.target?.alive) this.lockNearest();
    this.invincible = Math.max(0, this.invincible - dt);
    this.stagger = Math.max(0, this.stagger - STAGGER_DECAY * dt);
    this.flash = Math.max(0, this.flash - dt);
    this.power = Math.max(0, this.power - dt);
    this.helperLeft = Math.max(0, this.helperLeft - dt);
    this.haste = Math.max(0, this.haste - dt);
    this.zapped = Math.max(0, this.zapped - dt);
    this.landing = Math.max(0, this.landing - dt / LAND_POSE_TIME);
    this.launchTime = Math.max(0, this.launchTime - dt);
    this.idleTime += dt;
    this.barrierHit = Math.max(0, this.barrierHit - dt);
    this.barrierTime = Math.max(0, this.barrierTime - dt);
    if (this.barrierTime <= 0) this.barrier = 0;
    this.guardHit = Math.max(0, this.guardHit - dt);
    // シールドの耐久は、構えるのをやめて少したつと、もどり始める
    this.guardWait = this.state === 'guard' ? GUARD_REGEN_WAIT : Math.max(0, this.guardWait - dt);
    if (this.guardWait <= 0) this.guardHp = Math.min(GUARD_MAX, this.guardHp + GUARD_REGEN * dt);
    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    const target = this.target;
    // 斬っている間・よろけている間・空中ダッシュやステップの間に押したボタンは覚えておき、動けるようになったらすぐ出す
    const free = this.state === 'normal';
    if (this.state === 'attack' || this.state === 'recover' || this.state === 'flinch' || this.state === 'airdash') {
      for (const action of PENDING_ACTIONS) this.pending[action] ||= input[action];
    }
    const press = (action) => input[action] || this.pending[action];
    // シールドは、ボタンを押している間だけ構える (割れてから GUARD_BREAK_TIME 秒は構えられない)。
    // 離したコマにほかのボタンを押していれば、そのまま出る (指をすべらせてボタンを押しかえたとき)
    if (this.state === 'guard' && !input.guard) this.setState('normal');
    if (this.state === 'normal' && input.guard && this.cooldowns.guard <= 0) this.setState('guard');

    if (this.state === 'normal') {
      this.moveBy(input.move, dt);
      if (press('jump')) this.jumpOrDash(input.move, sfx);
      else if (press('step')) this.stepOrDash(input.move, sfx);
      if (input.attack && this.cooldowns.attack <= 0 && target?.alive && this.state === 'normal') this.startBlade(input.move, arena);
    } else if (this.state === 'guard') {
      // 構えている間はゆっくり動ける。ジャンプかステップを押すと構えを解いて跳ぶ・動く (押したままなら、次のコマでまた構える)
      if (press('jump') || press('step')) {
        this.setState('normal');
        if (press('jump')) this.jumpOrDash(input.move, sfx);
        else this.stepOrDash(input.move, sfx);
      } else {
        this.moveBy(input.move, dt, GUARD_MOVE);
      }
    } else if (this.state === 'airdash') {
      if (this.stateTime >= this.dashLength) this.setState('normal');
    } else if (this.state === 'attack') {
      this.updateSlash(dt, input, target);
    } else if (this.state === 'recover') {
      // 斬り終わりの隙。スティックで動ける。3回斬りの2回目までは、ここで押せば次の斬りへ続き、
      // 少したてば、ほかのボタンで切り上げられる (そのボタンはすぐ出る。シールドは次のコマで構える)
      this.moveBy(input.move, dt);
      const spec = SLASHES[this.slashKind];
      const other = input.guard || PENDING_ACTIONS.some((action) => press(action));
      if (input.attack && spec.chain) this.startSlash(this.combo + 1);
      else if (this.stateTime >= spec.recover || (other && this.stateTime >= RECOVER_CANCEL)) this.endCombo();
    } else if (this.state === 'flinch') {
      if (this.onGround) this.brake(dt, 20);
      if (this.stateTime >= this.flinchTime) this.setState('normal');
    } else if (this.state === 'down') {
      if (this.onGround) this.brake(dt, 40);
      if (this.stateTime >= DOWN_TIME) this.setState('getup');
    } else if (this.state === 'getup') {
      this.brake(dt, 30);
      if (this.stateTime >= GETUP_TIME) {
        this.setState('normal');
        this.invincible = GETUP_INVINCIBLE;
      }
    } else if (this.state === 'fall') {
      // 穴の中。何もできない (tiles.js が、少しあとに底から飛び出させる)
    } else if (this.state === 'ko') {
      if (this.onGround) this.brake(dt, 25);
    }

    // 撃つ (ふつうの状態と空中ダッシュ中だけ)。ショットは spec.shots 回を spec.interval おきに撃つ
    if ((this.state === 'normal' || this.state === 'airdash') && target?.alive) {
      if (press('gun') && this.cooldowns.gun <= 0) {
        this.burstLeft = this.parts.gun.shots;
        this.burstTimer = 0;
        this.cooldowns.gun = this.cooldownMax.gun;
      }
      if (press('bomb') && this.cooldowns.bomb <= 0) {
        weapons.fireBomb(this);
        this.cooldowns.bomb = this.cooldownMax.bomb;
      }
      if (press('pod') && this.cooldowns.pod <= 0) {
        weapons.firePod(this);
        this.cooldowns.pod = this.cooldownMax.pod;
      }
      if (press('missile') && this.cooldowns.missile <= 0) {
        weapons.fireMissiles(this);
        this.cooldowns.missile = this.cooldownMax.missile;
      }
    } else {
      this.burstLeft = 0;
    }
    // 必殺技 (核ミサイル): ゲージが満タンなら、ダウン・よろけ・穴の中のとき以外はいつでも撃てる (ゲージは空になる)
    const steady = this.state === 'normal' || this.state === 'airdash' || this.state === 'guard' || this.state === 'recover';
    if (input.special && this.special >= 1 && steady && target?.alive) {
      weapons.fireNuke(this);
      this.special = 0;
      this.launchTime = LAUNCH_POSE_TIME;
    }
    if (free) this.clearPending(); // 動けるようになって1コマ使ったら、覚えていたボタンは忘れる
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        weapons.fireGun(this);
        this.burstLeft--;
        this.burstTimer = this.parts.gun.interval;
      }
    }

    // 重力と移動、着地
    if (!this.floating) this.vel.y -= this.stats.gravity * dt;
    this.pos.addScaledVector(this.vel, dt);
    // 穴の中にいる間は、穴の壁から出られない (床の高さまで飛び出すか、穴がもとにもどったら終わり)
    if (this.pit && (!this.pit.open || this.pos.y >= 0)) this.pit = null;
    if (this.pit) {
      const p = this.pit;
      const inset = Math.min(ROBOT_RADIUS, (p.x1 - p.x0) / 2 - 0.1);
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, p.x0 + inset, p.x1 - inset);
      this.pos.z = THREE.MathUtils.clamp(this.pos.z, p.z0 + inset, p.z1 - inset);
    }
    const ground = this.pit ? this.pit.bottom : arena.groundAt(this.pos.x, this.pos.z, this.pos.y);
    const falling = this.vel.y;
    const airborne = !this.onGround;
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
      this.airDashes = this.stats.dashes;
      // 速く落ちて着地したら、決めポーズで着地する (速いほど深く)
      if (airborne && falling < -LAND_POSE_SPEED) {
        this.landing = 1;
        this.landPower = THREE.MathUtils.clamp((-falling - 4) / 9, 0.5, 1);
      }
    } else {
      this.onGround = false;
    }
    arena.collide(this.pos, ROBOT_RADIUS, ROBOT_HEIGHT);

    // 相手のほうへ向く (ダウン中は向きを変えない)
    if (target && !this.down && this.state !== 'ko') {
      const want = Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
      let diff = want - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * Math.min(1, dt * (this.charging ? 3 : 12)); // 突っこんでいる間は曲がりにくい
    }
    this.animate(dt, arena);
  }

  setState(state) {
    this.state = state;
    this.stateTime = 0;
  }

  // other が相手 (ちがうチーム) か
  isFoe(other) {
    return Boolean(other) && other !== this && other.team !== this.team;
  }

  // 生きている相手のうち、いちばん近いロボ (いなければ null)
  nearestFoe() {
    let best = null;
    let bestD = Infinity;
    for (const foe of this.foes) {
      if (!foe.alive) continue;
      const d = Math.hypot(foe.pos.x - this.pos.x, foe.pos.z - this.pos.z);
      if (d < bestD) {
        best = foe;
        bestD = d;
      }
    }
    return best;
  }

  // いちばん近い相手にロックオンする (生きている相手がいなければ、いまのまま)
  lockNearest() {
    const foe = this.nearestFoe();
    if (foe) this.target = foe;
  }

  // ロックオンを次の相手へ (生きている相手を、決まった順に回る)
  nextTarget() {
    const alive = this.foes.filter((foe) => foe.alive);
    if (!alive.length) return;
    this.target = alive[(alive.indexOf(this.target) + 1) % alive.length];
  }

  // 試合に出すか。出さないロボ (1対1のときの、4人対戦用の CPU) は見えなくする
  setPresent(present) {
    this.present = present;
    this.root.visible = present;
    this.shadow.visible = present;
    if (present) return;
    this.barrierMesh.visible = false;
    this.guardMesh.visible = false;
  }

  // 重力を受けない (空中ダッシュ中と、急降下斬りで空中に止まったり飛びこんだりしている間)
  get floating() {
    return this.state === 'airdash' || (this.state === 'attack' && this.lunging && this.slashKind === 'dive');
  }

  // 踏み込み・突き・急降下で突っこんでいる間 (ためや、空中に止まっている間は入れない)。向きを変えにくい
  get charging() {
    if (this.state !== 'attack' || !this.lunging) return false;
    if (this.slashKind === 'thrust') return this.lungeTime >= THRUST.windup;
    if (this.slashKind === 'dive') return this.lungeTime >= DIVE.windup;
    return this.slashKind === 'combo1';
  }

  facing() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  // スティックの向きへ走る。rate: 走る速さの割合 (シールドを構えている間は遅い。加速マスに乗ったあとは速い)
  moveBy(move, dt, rate = 1) {
    const accel = (this.onGround ? GROUND_ACCEL * this.assist.ground : AIR_ACCEL * this.assist.air) * dt;
    const run = this.stats.run * rate * (this.haste > 0 ? HASTE_RATE : 1);
    const tx = move.x * run;
    const tz = move.z * run;
    this.vel.x += THREE.MathUtils.clamp(tx - this.vel.x, -accel, accel);
    this.vel.z += THREE.MathUtils.clamp(tz - this.vel.z, -accel, accel);
  }

  brake(dt, rate) {
    const k = Math.max(0, 1 - rate * dt * 0.1);
    this.vel.x *= k;
    this.vel.z *= k;
  }

  // 地上ならジャンプ、空中なら空中ダッシュ
  jumpOrDash(move, sfx) {
    if (this.onGround) {
      this.vel.y = this.stats.jump;
      this.onGround = false;
      sfx?.jump();
      return;
    }
    this.airDash(move, sfx);
  }

  // ステップのボタン: 地上ならステップ (空中ダッシュの回数は使わず、STEP.cooldown 秒おきにできる)、空中なら空中ダッシュ
  stepOrDash(move, sfx) {
    if (!this.onGround) {
      this.airDash(move, sfx);
      return;
    }
    if (this.cooldowns.step > 0) return;
    this.cooldowns.step = STEP.cooldown;
    this.dash(move, STEP.speed, STEP.time);
    sfx?.dash();
  }

  airDash(move, sfx) {
    if (this.airDashes <= 0) return;
    this.airDashes--;
    this.dash(move, this.stats.dashSpeed, this.stats.dashTime);
    sfx?.dash();
  }

  // スティックの向き (入力が無ければ横) へ、speed (m/秒) で time 秒すべるように動く (空中ダッシュとステップ。そのあいだは落ちない)
  dash(move, speed, time) {
    const dir = new THREE.Vector3(move.x, 0, move.z);
    if (dir.lengthSq() < 0.04) dir.copy(this.facing().cross(UP));
    dir.normalize();
    this.vel.set(dir.x * speed, 0, dir.z * speed);
    this.dashLength = time;
    this.setState('airdash');
  }

  // ブレードを押した。技はスティックの向き (相手に対して) と高さで決まる:
  // 空中 (床から DIVE.height より上) なら急降下斬り、前へ倒していれば突き、横なら回り込み斬り、ほか (倒していない・後ろ) は3回斬りの1回目
  startBlade(move, arena) {
    const height = this.pos.y - arena.groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (!this.onGround && height > DIVE.height) {
      this.startSlash(1, 'dive');
      return;
    }
    const len = Math.hypot(move.x, move.z);
    const dx = this.target.pos.x - this.pos.x;
    const dz = this.target.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (len >= COMMAND_STICK && d > 1e-3) {
      const front = (move.x * dx + move.z * dz) / (len * d);
      if (front > COMMAND_FRONT) {
        this.startSlash(1, 'thrust');
        return;
      }
      if (front > -COMMAND_FRONT) {
        const right = (move.z * dx - move.x * dz) / (len * d); // 相手を前にして、右へ倒しているほど大きい
        this.startSlash(1, 'circle', right >= 0 ? 1 : -1);
        return;
      }
    }
    this.startSlash(1);
  }

  // n 回目の斬りを始める。kind: 技 (SLASHES。3回斬りなら省略) / side: 回り込む向き (1 は右、-1 は左)。
  // 3回斬りの1回目は出だしに無敵があり、相手が遠ければ先に踏み込む。突き・回り込み斬り・急降下斬りは、斬る前に必ず動く (approach)
  startSlash(n, kind = `combo${n}`, side = 1) {
    this.combo = n;
    this.slashKind = kind;
    this.slashSide = side;
    this.slashHit = false;
    this.slashHits.clear();
    this.queued = false;
    this.swung = false;
    this.lungeTime = 0;
    const far = Math.hypot(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z) > LUNGE_STOP;
    this.lunging = kind === 'combo1' ? far : kind === 'thrust' || kind === 'circle' || kind === 'dive';
    if (kind === 'combo1') this.invincible = Math.max(this.invincible, LUNGE_INVINCIBLE);
    if (n === 1) this.attacks++;
    this.setState('attack');
  }

  // 斬っている間。斬る前の動き (approach) が終わってから斬りの時間を進め、刃が当たる時間に、届くところにいる相手全員に当てる
  // (1回の斬りで同じ相手には1回だけ)。シールドで防がれたら、はじかれてよろける
  updateSlash(dt, input, target) {
    const spec = SLASHES[this.slashKind];
    if (this.lunging) {
      if (!this.approach(dt, target)) return;
      this.lunging = false;
      this.vel.x *= 0.3;
      this.vel.z *= 0.3;
      if (this.slashKind === 'dive') this.vel.y *= 0.3;
    }
    const t = this.stateTime;
    if (t < SLASH_ACTIVE[1]) {
      // 斬りながら少し前へ出る (突きは大きく)
      const f = this.facing();
      const step = this.slashKind === 'thrust' ? THRUST.step : SLASH_STEP;
      this.vel.x = f.x * step;
      this.vel.z = f.z * step;
    } else {
      this.brake(dt, 30);
    }
    if (t >= SLASH_ACTIVE[0] && !this.swung) {
      this.swung = true;
      this.swings++;
    }
    if (this.swung && t <= SLASH_ACTIVE[1]) {
      for (const foe of this.foes) {
        if (!foe.alive || this.slashHits.has(foe) || !this.bladeReaches(foe)) continue;
        this.slashHits.add(foe);
        this.slashHit = true;
        const result = foe.takeHit({
          damage: this.stats.blade * spec.damage * this.attackRate, knockdown: spec.down, flinch: !spec.down, from: this.pos, cause: 'blade', pierce: spec.pierce, by: this,
        });
        if (result === 'guarded') {
          this.repels++;
          this.flinchFor(REPEL_TIME, foe.pos);
          return;
        }
      }
    }
    if (input.attack && spec.chain) this.queued = true; // 斬っている間に押しておけば、斬り終わりにすぐ次へ
    if (t >= SLASH_TIME) {
      if (this.queued) this.startSlash(this.combo + 1);
      else this.setState('recover');
    }
  }

  // 斬る前の動き (3回斬りの1回目の踏み込み・突き・回り込み・急降下)。終わったら true (相手に届くところまで来たか、時間切れ)
  approach(dt, target) {
    this.lungeTime += dt;
    this.stateTime = 0;
    const t = this.lungeTime;
    const dx = target.pos.x - this.pos.x;
    const dz = target.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1e-3;
    const near = d <= LUNGE_STOP;
    const kind = this.slashKind;
    if (kind === 'thrust') {
      if (t < THRUST.windup) {
        // ためる (止まって相手のほうへ向く)。ためが終わったときの相手の向きへ、まっすぐ突っこむ
        this.brake(dt, 60);
        this.lungeDir.set(dx / d, 0, dz / d);
        return false;
      }
      if (near || t >= THRUST.windup + THRUST.time) return true;
      this.vel.x = this.lungeDir.x * THRUST.speed;
      this.vel.z = this.lungeDir.z * THRUST.speed;
      return false;
    }
    if (kind === 'circle') {
      if ((near && t >= CIRCLE.minTime) || t >= CIRCLE.time) return true;
      // 横 (相手を前にしたときの右か左) へ回りながら、遠ければ近づく
      const around = this.slashSide * CIRCLE.speed;
      const toward = near ? 0 : CIRCLE.approach;
      this.vel.x = (-dz / d) * around + (dx / d) * toward;
      this.vel.z = (dx / d) * around + (dz / d) * toward;
      return false;
    }
    if (kind === 'dive') {
      if (t < DIVE.windup) {
        this.vel.set(0, 0, 0); // 空中で一瞬止まる
        return false;
      }
      const dy = target.pos.y - this.pos.y;
      if ((near && Math.abs(dy) < 1.5) || this.onGround || t >= DIVE.windup + DIVE.time) return true;
      // 相手めがけて飛びこむ。上へは行かず、少なくとも DIVE.slope の割合で下へ向かう
      const dir = this.lungeDir.set(dx, Math.min(dy, 0), dz).normalize();
      if (dir.y > -DIVE.slope) {
        const k = Math.sqrt(1 - DIVE.slope ** 2) / (Math.hypot(dir.x, dir.z) || 1);
        dir.set(dir.x * k, -DIVE.slope, dir.z * k);
      }
      this.vel.copy(dir).multiplyScalar(DIVE.speed);
      return false;
    }
    // 3回斬りの1回目の踏み込み
    if (near || t >= LUNGE_TIME) return true;
    this.vel.x = (dx / d) * LUNGE_SPEED;
    this.vel.z = (dz / d) * LUNGE_SPEED;
    return false;
  }

  // 刃が相手に届くか (前のほうの BLADE_REACH 以内。高さが大きくちがうと届かない)
  bladeReaches(target) {
    const dx = target.pos.x - this.pos.x;
    const dz = target.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > BLADE_REACH || Math.abs(target.pos.y - this.pos.y) > 2) return false;
    return d < 0.5 || (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / d > BLADE_ARC;
  }

  // 連続の斬りを終える (次に斬れるのは BLADE_COOLDOWN 秒あと)
  endCombo() {
    this.resetCombo();
    this.setState('normal');
  }

  // 斬りを途中でやめる (斬られたり倒れたりしたときも)
  resetCombo() {
    if (this.combo > 0) this.cooldowns.attack = BLADE_COOLDOWN;
    this.combo = 0;
    this.lunging = false;
    this.queued = false;
  }

  // 動けないあいだに押したボタン (PENDING_ACTIONS) を忘れる
  clearPending() {
    this.pending = { jump: false, step: false, gun: false, bomb: false, pod: false, missile: false };
  }

  // 攻撃を受ける。結果 ('hit' / 'flinch' / 'down' / 'ko' / 'blocked' / 'guarded' / 'guardbreak') を返す。
  // 無敵中・ダウン中 (倒れている間と起き上がり)・穴に落ちている間・倒れた後は null (攻撃を受けない)。
  // from: 攻撃したもの (押される向き) / at: 攻撃が来たところ (シールドで防げるかを決める。省略すると from) /
  // flinch: ブレードの斬りやしびれマス (倒れなければ、少しのあいだよろけて動けない。数なら、その秒数) /
  // pierce: シールドで防げない / by: 攻撃したロボ。
  // シールドを構えていて前から来た攻撃なら、全部防ぐ ('guarded'。耐久が尽きると割れてよろける: 'guardbreak')。
  // バリアがあれば先にバリアが受け止め、防ぎきれなかったぶんだけ、ふつうに受ける ('blocked' は全部防いだ)
  takeHit({ damage, knockdown, flinch = false, from, at = from, cause, pierce = false, by = null }) {
    if (this.state === 'ko' || this.state === 'fall' || this.down || this.invincible > 0) return null;
    if (by && by !== this) {
      this.lastAttacker = by;
      this.lastHitAge = 0;
    }
    if (this.state === 'guard' && !pierce && this.guardCovers(at)) {
      this.guardHp -= damage * (cause === 'blade' ? GUARD_BLADE : 1);
      this.guardHit = 0.15;
      this.guardCause = cause;
      this.guardBlocks++;
      if (this.guardHp > 0) {
        if (cause !== 'gun') this.knock(from, GUARD_PUSH, this.vel.y);
        return 'guarded';
      }
      this.guardHp = 0;
      this.cooldowns.guard = GUARD_BREAK_TIME;
      this.guardBreaks++;
      this.flinchFor(GUARD_CRUSH, from);
      return 'guardbreak';
    }
    damage *= this.stats.armor;
    if (this.barrier > 0) {
      damage = this.absorb(damage);
      if (damage <= 0) return 'blocked';
    }
    const before = this.hp;
    this.hp = Math.max(0, Math.round(this.hp - damage));
    this.flash = 0.12;
    this.lastCause = cause;
    // 必殺技のゲージ: 受けたダメージと、攻撃したロボが与えたダメージでたまる (核の爆発ではたまらない)
    if (cause !== 'nuke') {
      this.chargeSpecial((before - this.hp) / SPECIAL_TAKEN);
      if (by && by !== this) by.chargeSpecial((before - this.hp) / SPECIAL_DEALT);
    }
    if (this.hp <= 0) {
      this.resetCombo();
      this.clearPending();
      this.knock(from, 10, 8);
      this.setState('ko');
      return 'ko';
    }
    this.stagger += damage;
    if (knockdown || this.stagger >= this.stats.endurance) {
      this.stagger = 0;
      this.burstLeft = 0;
      this.resetCombo();
      this.clearPending(); // ダウンしたら、押しておいたボタンは起き上がったときに出さない
      this.knock(from, 7, 6);
      this.setState('down');
      return 'down';
    }
    if (flinch) {
      this.flinchFor(flinch === true ? FLINCH_TIME : flinch, from);
      return 'flinch';
    }
    return 'hit';
  }

  // バリアが先にダメージを受け止める。防ぎきれなかったぶんを返す
  absorb(damage) {
    if (this.barrier <= 0 || damage <= 0) return damage;
    const blocked = Math.min(this.barrier, damage);
    this.barrier -= blocked;
    this.barrierHit = 0.15;
    this.blocks++;
    if (this.barrier <= 0) {
      this.barrier = 0;
      this.barrierTime = 0;
      this.barrierBreaks++;
    }
    return damage - blocked;
  }

  // よろけて seconds 秒動けない (from から離れるほうへ少し下がる)
  flinchFor(seconds, from) {
    this.burstLeft = 0;
    this.resetCombo();
    this.knock(from, FLINCH_PUSH, this.vel.y);
    this.flinchTime = seconds;
    this.setState('flinch');
  }

  // 点 at (攻撃が来たところ) が、シールドで守れる前のほうにあるか。近すぎる (真上や足元) と守れない
  guardCovers(at) {
    const dx = at.x - this.pos.x;
    const dz = at.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    return d >= GUARD_NEAR && (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / d > GUARD_ARC;
  }

  // 弾やミサイルの当たり判定を広げる距離 (weapons.js が使う)。シールドを構えていて at (飛んできたほう) が前なら、盾のところで当たる
  guardReach(at) {
    return this.state === 'guard' && this.guardCovers(at) ? GUARD_REACH : 0;
  }

  // シールドの盾の真ん中 (体の前)
  guardCenter(out = new THREE.Vector3()) {
    return out.set(this.pos.x + Math.sin(this.yaw) * GUARD_OFFSET, this.pos.y + GUARD_HEIGHT, this.pos.z + Math.cos(this.yaw) * GUARD_OFFSET);
  }

  knock(from, horizontal, up) {
    const dir = new THREE.Vector3(this.pos.x - from.x, 0, this.pos.z - from.z);
    if (dir.lengthSq() < 1e-4) dir.copy(this.facing()).negate();
    dir.normalize();
    this.vel.set(dir.x * horizontal, up, dir.z * horizontal);
  }

  // 勝ちポーズをとる (main.js が決着のときに呼ぶ)。足を開いて胸を張り、光の刃を高く掲げる
  celebrate() {
    this.pose = 'win';
  }

  // 見た目: 地上ではいつも身構える (ひざを曲げて左足を前に出し、腕を上げる。腰を落としても足の裏は床につけたまま)。
  // 走ると足と腕を振って進む向きへ傾き、速く着地すると決めポーズ、立ち止まっているときは息をするようにゆれる。
  // 斬るときは足を前後に大きく開いて腰を落とし、腰と上半身を大きくひねる (頭は相手へ向けたまま)。空中ではひざをたたんで腕を開き、
  // 空中ダッシュは飛ぶ向きへ大きく傾く。背中の噴射の炎、ダウンで仰向けに倒れる、勝ちポーズ、撃たれると白く光る、パワーアップ中は金色に光る
  animate(dt, arena) {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const lying = this.state === 'down' || this.state === 'ko';
    const ease = (from, to, rate) => THREE.MathUtils.lerp(from, to, Math.min(1, dt * rate));
    // 地上に立っている (ステップの間は、地上でも足を浮かせてすべる)
    const standing = this.onGround && !lying && this.state !== 'getup' && this.state !== 'fall' && this.state !== 'airdash';
    const still = standing && speed < 1 && (this.state === 'normal' || this.state === 'guard');
    const winning = this.pose === 'win' && this.state === 'normal' && this.onGround;
    const attacking = this.state === 'attack';
    const dashing = this.state === 'airdash';
    const amount = Math.min(speed / this.stats.run, 1);
    // 目標の姿勢 (斬っている間は、振りの進みで決まる)。速く着地したあとは、着地の決めポーズを重ねる
    let target;
    if (attacking) target = this.slashFrame(THREE.MathUtils.clamp((this.stateTime - 0.02) / 0.18, 0, 1));
    else if (lying) target = POSES.lying;
    else if (this.state === 'fall') target = POSES.fall;
    else if (this.state === 'flinch') target = POSES.flinch;
    else if (this.state === 'guard') target = POSES.guard;
    else if (winning) target = POSES.win;
    else if (this.launchTime > 0 && this.onGround && this.state === 'normal') target = POSES.launch;
    else if (dashing) target = POSES.dash;
    else if (!this.onGround && this.state !== 'getup') target = POSES.air;
    else target = POSES.ready;
    const land = standing && !attacking && !winning ? this.landPower * THREE.MathUtils.smoothstep(this.landing, 0, 0.6) : 0;
    if (land > 0) target = blendPose(copyPose(target, this.landGoal), POSES.land, land);
    const rig = blendPose(this.rig, target, Math.min(1, dt * (attacking ? 30 : land > 0 ? 24 : 12)));

    // 脚: 地上では、足を置く場所から曲げ方を決める (腰を落としても、足の裏は床につけたまま)。走るときは足を前後に振る。空中ではひざをたたむ
    const [right, left] = this.legs; // legs[0] が右 (-x)、legs[1] が左 (+x)
    const breathe = still ? Math.sin(this.idleTime * 2.4) * 0.012 : 0;
    const run = standing && !attacking ? amount : 0; // 足を振る割合
    if (standing) {
      const reach = (HIP_HEIGHT - rig.crouch + breathe) / Math.cos(rig.splay);
      const r = legAngles(rig.feet[0], reach, this.legGoals[0]);
      const l = legAngles(rig.feet[1], reach, this.legGoals[1]);
      this.walk += speed * dt * 1.3;
      const swing = Math.sin(this.walk) * 0.6;
      right.hip.rotation.x = THREE.MathUtils.lerp(r.hip, swing - 0.1, run);
      left.hip.rotation.x = THREE.MathUtils.lerp(l.hip, -swing - 0.1, run);
      right.knee.rotation.x = THREE.MathUtils.lerp(r.knee, 0.3 + Math.max(0, -swing) * 1.3, run);
      left.knee.rotation.x = THREE.MathUtils.lerp(l.knee, 0.3 + Math.max(0, swing) * 1.3, run);
    } else {
      // 上がっている間はひざを深くたたみ、速く落ちているときは床へ向けて脚を少しのばす
      const reaching = !lying && this.vel.y < -4;
      right.hip.rotation.x = ease(right.hip.rotation.x, reaching ? -0.4 : -0.55, 10);
      left.hip.rotation.x = ease(left.hip.rotation.x, reaching ? -0.05 : -0.15, 10);
      right.knee.rotation.x = ease(right.knee.rotation.x, reaching ? 0.7 : 1.1, 10);
      left.knee.rotation.x = ease(left.knee.rotation.x, reaching ? 0.35 : 0.6, 10);
    }
    right.hip.rotation.z = -rig.splay;
    left.hip.rotation.z = rig.splay;
    // 体の傾き (前 x と横 z): 地上を走るときは進む向きへ (前へは前傾、横へはその向きへ少し倒れる)、空中ダッシュは飛ぶ向きへ大きく、
    // 踏み込み・突っこみは前へ (回り込みは回る向きへも)、よろけたり穴に落ちたりすると後ろへ。ひねり y は姿勢で決まる
    const forward = this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw);
    const sideways = this.vel.z * Math.sin(this.yaw) - this.vel.x * Math.cos(this.yaw); // 右 (-x 側) へ動くほど大きい
    let lean = 0;
    let roll = 0;
    if (dashing) {
      lean = 0.15 + (forward / this.stats.dashSpeed) * 0.3;
      roll = (sideways / this.stats.dashSpeed) * 0.35;
    } else if (attacking) {
      lean = target.lean;
      if (this.lunging) roll = THREE.MathUtils.clamp(sideways / this.stats.run, -1, 1) * 0.25;
    } else if (this.state === 'flinch') {
      lean = -0.12;
    } else if (this.state === 'fall') {
      lean = -0.45;
    } else if (standing) {
      lean = THREE.MathUtils.clamp(forward / this.stats.run, -0.6, 1) * RUN_LEAN;
      roll = THREE.MathUtils.clamp(sideways / this.stats.run, -1, 1) * RUN_ROLL;
    }
    const tilt = lying ? -Math.PI / 2 : this.state === 'getup' ? -Math.PI / 2 * (1 - this.stateTime / GETUP_TIME) : lean;
    this.body.rotation.x = ease(this.body.rotation.x, tilt, lying ? 14 : 10);
    this.body.rotation.z = ease(this.body.rotation.z, lying ? 0 : roll, 10);
    this.body.rotation.y = rig.twist;
    // 体の上下: 倒れているときは床から浮かせ、構えでは腰を落とし (息をするようにゆれる)、走ると小さくはずむ
    const bob = Math.abs(Math.sin(this.walk)) * 0.035;
    const drop = standing ? THREE.MathUtils.lerp(rig.crouch - breathe, 0.05 + bob, run) : 0;
    this.body.position.y = lying ? 0.5 : -drop;
    // 上半身: かがむ・ひねる (息に合わせて少しゆれる)。頭は、腰や上半身をひねっても相手のほうへ向け直し、かがんでも前を見る
    this.torso.rotation.set(rig.torso[0] + breathe * 1.5, rig.torso[1], 0);
    this.head.rotation.set(-rig.torso[0] * 0.6, THREE.MathUtils.clamp(-(rig.twist + rig.torso[1]), -0.9, 0.9), 0);
    // 腕: 姿勢の形に、走るときの振り (足と反対)・立ち止まっているときの息のゆれ・穴に落ちたときのもがきを足す
    const sway = still ? Math.sin(this.idleTime * 2.4 + 1) * 0.035 : 0;
    const armSwing = Math.sin(this.walk) * 0.25 * run;
    const flail = this.state === 'fall' ? Math.sin(this.stateTime * 14) * 0.35 : 0;
    const [gx, gy, gz, ge] = rig.gun;
    const [bx, by, bz, be] = rig.bomb;
    this.arms.gun.rotation.set(gx + sway - armSwing + flail, gy, gz);
    this.elbows.gun.rotation.x = ge;
    this.arms.bomb.rotation.set(bx - sway + armSwing - flail, by, bz);
    this.elbows.bomb.rotation.x = be;
    // シールド: 構えている間は、体の前に光の盾を出す (出るときは大きくなる)。ブレード: 斬っている間と勝ちポーズでは、光の刃を出す (出るときはのびる)
    const guarding = this.state === 'guard';
    this.guardSize = guarding ? Math.min(1, this.guardSize + dt * 10) : Math.max(0, this.guardSize - dt * 8);
    const bladeOn = (this.combo > 0 && (this.state === 'attack' || this.state === 'recover')) || winning;
    this.bladeSize = bladeOn ? Math.min(1, this.bladeSize + dt * 12) : 0;
    this.blade.visible = this.bladeSize > 0;
    this.blade.scale.set(1, 1, Math.max(0.01, this.bladeSize));
    // 背中の炎: 空中ダッシュと踏み込みで大きく、上がっている間は中くらい、地上では小さくゆらぐ。穴に落ちるとふかしてもがく。倒れているときは消す
    const thrust = lying || this.state === 'getup' ? 0 : this.state === 'airdash' || this.lunging ? 1.7 : this.state === 'fall' ? 1.4
      : !this.onGround ? (this.vel.y > 0 ? 1.1 : 0.6) : 0.25;
    this.thrust = ease(this.thrust ?? 0, thrust, 12);
    for (const flame of this.thrusters) {
      const length = this.thrust * (0.85 + Math.random() * 0.3);
      flame.scale.set(1, length, 1);
      flame.visible = length > 0.05;
    }
    // 装甲の光: 撃たれると白、起き上がりの無敵中は青く点滅、パワーアップ中は金色に脈打つ (終わりぎわは速く)
    const glow = this.glow;
    if (this.flash > 0) glow.setHex(0xffffff);
    else if (this.invincible > 0 && Math.floor(this.invincible * 20) % 2) glow.setHex(0x335577);
    else if (this.power > 0) glow.copy(POWER_GLOW).multiplyScalar(0.6 + 0.4 * Math.sin(this.power * (this.power < 2 ? 24 : 9)));
    else glow.setHex(0x000000);
    for (const material of this.flashMaterials) material.emissive.copy(glow);

    // 足元の影 (高く跳ぶほど小さく薄く)
    const ground = arena.groundAt(this.pos.x, this.pos.z, this.pos.y);
    const h = this.pos.y - ground;
    this.shadow.position.set(this.pos.x, ground + 0.03, this.pos.z);
    this.shadow.scale.setScalar(Math.max(0.4, 1 - h * 0.08));
    this.shadow.material.opacity = Math.max(0.1, 0.35 - h * 0.03);

    // バリアの膜: ゆっくり回り、攻撃を防ぐと明るく光ってふくらむ。消える前の2秒は点滅する
    const shield = this.barrierMesh;
    shield.visible = this.barrier > 0 && (this.barrierTime > 2 || Math.floor(this.barrierTime * 8) % 2 === 0);
    if (shield.visible) {
      const hit = this.barrierHit > 0 ? 1 : 0;
      shield.position.set(this.pos.x, this.pos.y + (lying ? 0.6 : 1.2), this.pos.z);
      shield.rotation.y += dt * 0.6;
      shield.scale.setScalar(1 + hit * 0.08);
      shield.material.opacity = 0.14 + 0.05 * Math.sin(this.barrierTime * 4) + hit * 0.3;
    }

    // シールドの盾: 体の前に、相手のほうへ向けて出す。攻撃を防ぐと明るく光ってふくらみ、耐久が少ないと点滅する
    const plate = this.guardMesh;
    plate.visible = this.guardSize > 0 && (this.guardHp > GUARD_MAX * 0.25 || Math.floor(this.stateTime * 12) % 2 === 0);
    if (plate.visible) {
      const hit = this.guardHit > 0 ? 1 : 0;
      this.guardCenter(plate.position);
      plate.rotation.set(0, this.yaw, 0);
      plate.scale.setScalar(this.guardSize * (1 + hit * 0.1));
      plate.material.opacity = 0.16 + hit * 0.3;
      this.guardEdge.opacity = 0.7 + hit * 0.3;
    }
  }

  // ブレードを振る姿勢 (POSES と同じ形に、体の前への傾き lean をつける)。p: 振りの進み (0〜1)。
  // 足を前後に大きく開いて腰を落とし、腰と上半身を大きくひねって振り、左腕は反対へ引く (頭は相手へ向けたまま)。
  // 3回斬りの1回目は右から左へ、2回目は左から右へ横に振り、3回目と急降下斬りは右上から斜めに振り下ろす (上半身を反らしてから、前へかがむ)。
  // 回り込み斬りは、右へ回るときは右から左へ、左へ回るときは左から右へ振る。踏み込みと回り込みの間は、低く構えて刃を引いておく。
  // 突きは、ためで右肩と刃を引き、突っこむときは右足を前へ大きく踏み出して、腕と刃をまっすぐ相手へのばす
  slashFrame(p) {
    const e = 1 - (1 - p) ** 3; // 振りはじめが速く、終わりはゆっくり
    const mix = THREE.MathUtils.lerp;
    const kind = this.slashKind;
    if (kind === 'thrust') {
      if (this.lunging && this.lungeTime < THRUST.windup) {
        return { feet: [-0.34, 0.22], crouch: 0.2, splay: 0.08, twist: -0.25, torso: [-0.06, -0.4], gun: [0.45, 0.3, -0.1, -0.5], bomb: [-0.7, -0.35, 0.15, 0.3], lean: -0.05 };
      }
      // 右肩を前へ出してまっすぐ突く (腕は、腰と上半身をひねったぶん右へ回して、相手へ向ける)
      return { feet: [0.48, -0.42], crouch: 0.26, splay: 0.06, twist: 0.25, torso: [0.3, 0.4], gun: [-1.45, -0.65, 0, 1.4], bomb: [0.6, 0, 0.35, 0.2], lean: this.lunging ? 0.3 : 0.15 };
    }
    if (kind === 'combo3' || kind === 'dive') {
      const t = this.lunging ? 0 : e;
      const lean = !this.lunging ? 0.15 : kind === 'dive' ? (this.lungeTime < DIVE.windup ? 0.1 : 0.5) : 0.3;
      return {
        feet: [-0.4, 0.32], crouch: mix(0.1, 0.28, t), splay: 0.08, twist: mix(-0.15, 0.15, t), torso: [mix(-0.25, 0.45, t), mix(-0.35, 0.35, t)],
        gun: [mix(-2.6, 0.3, t), mix(0.15, -0.1, t), mix(-0.3, 0, t), 0], bomb: [mix(-0.6, 0.5, t), -0.2, 0.3, 0.2], lean,
      };
    }
    const s = kind === 'combo2' || (kind === 'circle' && this.slashSide < 0) ? -1 : 1; // 右から左へ振るとき 1、左から右へ振るとき -1
    if (this.lunging) {
      return { feet: [-0.5, 0.3], crouch: 0.26, splay: 0.08, twist: -0.15 * s, torso: [0.3, -0.45 * s], gun: [-0.45, -1.0 * s, -0.15, 0.1], bomb: [0.3, 0, 0.3, 0.3], lean: kind === 'circle' ? 0.15 : 0.3 };
    }
    return {
      feet: [-0.38, 0.32], crouch: 0.2, splay: 0.08, twist: mix(-0.15 * s, 0.15 * s, e), torso: [0.15, mix(-0.5 * s, 0.55 * s, e)],
      gun: [-0.45, mix(-1.1 * s, 0.9 * s, e), -0.1, 0.1], bomb: [mix(-0.4 * s, 0.45 * s, e), -0.2, 0.3, 0.2], lean: 0.08,
    };
  }
}
