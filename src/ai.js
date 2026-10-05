import * as THREE from 'three';
import { MAX_HP, GUARD_MAX, DIVE } from './robot.js';

// CPU の操作。プレイヤーと同じ形の入力 { move, jump, gun, bomb, pod, missile, attack, guard } を毎フレーム作る (必殺技 special は使わない)。
// 好きな間合いを保って回り込みながら撃ち (ミサイルのボタンもときどき)、飛んでくる弾やミサイルはときどきジャンプや空中ダッシュでよけるか、シールドで防ぐ。
// 相手の核ミサイルの警告の輪からは、輪の外へ逃げる (気づくかは、核ミサイルごとに1回だけ決める)。
// 相手が近いとブレードで斬りかかり、当たれば続けて斬る。ブレードの技 (コマンド) は、斬るときのスティックの向きで選ぶ:
// 空中で相手が下にいれば急降下斬り、相手がシールドを構えていれば回り込み斬り、近ければ3回斬りか回り込み斬り、少し遠ければときどき突き。
// 相手が斬りかかってきたら、ときどきシールドで防ぐ (回り込み斬りは防げないので、ジャンプでよける)。
// 近くに相手より先に取れそうなアイテムがあれば、取りに行く (行くかどうかはアイテムごとに1回だけ決める)。
// 床の穴と、点滅して知らせているしびれマス (tiles.js) からは離れる (しびれマスに気づくかは、知らせるたびに1回だけ決める)。
// 4人対戦では、狙う相手 (ロックオン) をときどき選び直す: 近い相手ほど選び、いま狙っている相手と、さっき攻撃してきた相手は選びやすい。
// よける弾や離れるグレネード・マインは、相手全員のもの
// 強さはレベル (0〜10) で変わる。保ちたい距離は持っているショットで変わる。
// 大会のライバルは、戦い方のくせ (style: rivals.js) で間合いや撃つ回数などが変わる
const CPU_RANGES = { spread: [6, 12], rail: [12, 22], homing: [10, 18] }; // 保ちたい距離 (m)
const CPU_TRAP_RANGE = 10; // 置くマインは、相手がこれより近いときだけ置く (m)
const CPU_DEFAULT_RANGE = [9, 16];
const CPU_STRAFE_TIME = [1.0, 2.6]; // 回り込む向きを変えるまでの時間 (秒)
const CPU_THREAT_RANGE = 8; // これより近い弾を気にする (m)
const CPU_DODGE_LOCK = 0.5; // よけるか決めたあと、この間に来た弾ではもう決めない (連射の弾の数でよけやすさが変わらないように)
const CPU_ITEM_RANGE = 16; // これより近いアイテムを取りに行く (m)
const CPU_ITEM_LEAD = 3; // 相手のほうがこれ以上アイテムに近いと、あきらめる (m)
const CPU_HEAL_NEED = 150; // 体力がこれ以上減っていないと、回復のアイテムは取りに行かない
const CPU_TURRET_KEEP = 5; // 相手のミサイル砲台から離れておく距離 (m)
const CPU_GUARD_TIME = [0.45, 0.8]; // シールドを構える長さ (秒)
const CPU_GUARD_KEEP = 0.35; // シールドの耐久がこの割合より少ないときは構えない
const CPU_BLADE_WATCH = 12; // 相手がこれより近くで斬りかかってきたら、防ぐかよけるかを決める (m)
const CPU_THRUST_RANGE = [6, 11]; // 突きを出す、相手までの距離 (m)
const CPU_DIVE_RANGE = 7; // 急降下斬りを出す、相手までの水平の距離 (m)
const CPU_RETARGET_TIME = [1, 2.5]; // 狙う相手を選び直すまで (秒)
const CPU_TARGET_STICK = 0.75; // いま狙っている相手は、距離がこの倍に近いとみなす (すぐ乗りかえないように)
const CPU_REVENGE = 0.6; // さっき攻撃してきた相手は、距離がこの倍に近いとみなす
const CPU_REVENGE_TIME = 3; // 「さっき」とみなす時間 (秒)
const CPU_TARGET_WOBBLE = 0.3; // 距離をこの割合までばらつかせて比べる (同じくらいの距離なら、どの相手を選ぶかがばらける)
const CPU_TILE_KEEP = 1.6; // 床の穴や、電気が流れそうなしびれマスから、これだけ離れる (m)
const CPU_MISSILE_RANGE = [6, 30]; // ミサイルのボタンを使う、相手までの距離 (m)
const CPU_NUKE_KEEP = 1.8; // 核ミサイルの警告の輪のふちから、さらにこれだけ外へ逃げる (m)

// レベルごとの強さ。レベルが上がるほど、よくよけて、間を空けずに撃つ
function cpuSkill(level) {
  const t = Math.min(Math.max(level, 0), 10) / 10;
  const mix = (a, b) => a + (b - a) * t;
  return {
    dodge: mix(0.3, 0.6), // 飛んでくる弾をよけようとする確率
    guard: mix(0.05, 0.12), // よけなかった弾を、シールドで防ぐ確率 (大きくすると試合が長びく。0.1〜0.25 で平均 10 秒ほど延びた)
    guardBlade: mix(0.2, 0.55), // 斬りかかってきた相手を、シールドで防ぐ確率
    reaction: mix(0.28, 0.1), // 斬りかかってきたのに気づいて、構えたり跳んだりするまで (秒)
    gunPause: [mix(0.6, 0.15), mix(1.6, 0.6)], // 撃てるようになってから実際に撃つまでの間 (秒)
    bombTime: [mix(3, 1.5), mix(5.5, 3)],
    podTime: [mix(6, 3), mix(10, 5)],
    missileTime: [mix(3, 1), mix(7, 3)], // ミサイルのボタンが使えるようになってから、実際に撃つまでの間 (秒)
    nuke: mix(0.5, 0.95), // 相手の核ミサイルの警告の輪に気づいて逃げる確率 (核ミサイルごとに1回だけ決める)
    jumpTime: [mix(3.5, 2), mix(7, 4)], // 気まぐれのジャンプ
    items: mix(0.5, 0.9), // 取れそうなアイテムを取りに行く確率
    combo: mix(0.6, 0.95), // ブレードの斬りが当たったとき、続けて斬る確率
    circle: mix(0.15, 0.4), // 近くで斬りかかるとき、回り込み斬りにする確率
    read: mix(0.3, 1), // シールドを構えた相手に、回り込み斬りで斬りかかる勢い (1秒あたりの回数の目安)
    tiles: mix(0.45, 0.95), // しびれマスが点滅して知らせているのに気づく確率 (気づかないと、乗ったまま しびれる)
  };
}

function randomIn([min, max]) {
  return min + Math.random() * (max - min);
}

export class Cpu {
  constructor(robot) {
    this.robot = robot;
    this.input = {
      move: { x: 0, z: 0 }, jump: false, step: false, gun: false, bomb: false, pod: false, missile: false, attack: false, guard: false, target: false, special: false,
    };
    this.style = {};
    this.setLevel(0);
    this.reset();
  }

  setLevel(level) {
    this.skill = cpuSkill(level);
  }

  // 戦い方のくせ (rivals.js の style)。{} ならふつう
  setStyle(style) {
    this.style = style ?? {};
  }

  // くせによる、回数の多さの倍率 (strafe / jumpy / bombs / pods / blade)
  more(name) {
    return this.style[name] ?? 1;
  }

  reset() {
    this.strafe = Math.random() < 0.5 ? -1 : 1;
    this.strafeTimer = randomIn(CPU_STRAFE_TIME) / this.more('strafe');
    this.gunWait = 0.6;
    this.bombWait = randomIn(this.skill.bombTime) / this.more('bombs');
    this.podWait = randomIn(this.skill.podTime) / this.more('pods');
    this.missileWait = randomIn(this.skill.missileTime);
    this.jumpWait = randomIn(this.skill.jumpTime) / this.more('jumpy');
    this.dashAt = -1; // この秒数のあとに空中ダッシュする (-1 は予定なし)
    this.dashDir = { x: 0, z: 0 };
    this.stuck = 0;
    this.seen = new WeakSet(); // よけるかどうか決めた弾
    this.dodgeLock = 0;
    this.itemChoice = new WeakMap(); // アイテム → 取りに行くと決めたか
    this.comboDecided = -1; // 続けて斬るか決めた斬り (ロボの swings)
    this.guardDelay = 0; // シールドを構え始めるまで (秒)
    this.guardLeft = 0; // シールドを構え続ける残り (秒)
    this.jumpAt = -1; // この秒数のあとにジャンプする (-1 は予定なし。回り込み斬りをよける)
    this.attackSeen = new Map(); // 相手 → その相手の技を、いくつ目まで見たか
    this.retargetWait = 0; // 狙う相手を選び直すまで (秒)
    this.tileNotice = new Map(); // しびれマス → { round: 何回目の知らせか, notice: 気づいたか }
    this.nukeNotice = new WeakMap(); // 核ミサイル → 警告の輪に気づいたか
  }

  // 相手の核ミサイルの警告の輪に気づいたか (核ミサイルごとに1回だけ決める。弱い CPU ほど気づかない)
  noticeNuke(nuke) {
    if (!this.nukeNotice.has(nuke)) this.nukeNotice.set(nuke, Math.random() < this.skill.nuke);
    return this.nukeNotice.get(nuke);
  }

  // 床の仕掛けのマスを、いまよけるか。穴はいつも。しびれマスは、点滅して知らせている・電気が流れているときで、
  // それに気づいたとき (気づくかは、知らせるたびに1回だけ決める)
  fears(tile) {
    if (tile.open) return true;
    if (tile.kind !== 'shock' || tile.state === 'idle') return false;
    let seen = this.tileNotice.get(tile);
    if (seen?.round !== tile.round) {
      seen = { round: tile.round, notice: Math.random() < this.skill.tiles };
      this.tileNotice.set(tile, seen);
    }
    return seen.notice;
  }

  // 狙う相手を選ぶ (ときどきだけ選び直す。斬っている途中は変えない)。
  // 近い相手ほど選び (距離は少しばらつかせる)、いま狙っている相手と、さっき攻撃してきた相手は近いとみなす
  pickTarget(dt) {
    const me = this.robot;
    this.retargetWait -= dt;
    const lost = !me.target?.alive;
    if (!lost && (this.retargetWait > 0 || me.state === 'attack' || me.state === 'recover')) return;
    this.retargetWait = randomIn(CPU_RETARGET_TIME);
    let best = null;
    let bestScore = Infinity;
    for (const foe of me.foes) {
      if (!foe.alive) continue;
      let score = Math.hypot(foe.pos.x - me.pos.x, foe.pos.z - me.pos.z) * (1 + (Math.random() - 0.5) * CPU_TARGET_WOBBLE);
      if (foe === me.target) score *= CPU_TARGET_STICK;
      if (foe === me.lastAttacker && me.lastHitAge < CPU_REVENGE_TIME) score *= CPU_REVENGE;
      if (score < bestScore) {
        best = foe;
        bestScore = score;
      }
    }
    if (best) me.target = best;
  }

  // delay 秒あとから seconds 秒、シールドを構える (割れて使えないときや、耐久が少ないとき、もう構えるつもりのときはやめる)
  guardSoon(delay, seconds) {
    const me = this.robot;
    if (me.cooldowns.guard > 0 || me.guardHp < GUARD_MAX * CPU_GUARD_KEEP || this.guardLeft > 0) return;
    this.guardDelay = delay;
    this.guardLeft = seconds;
  }

  // 取りに行くアイテム (無ければ null)。近くて、相手より先に取れそうなもの。回復は体力が減っているときだけ
  itemGoal(items, me, foe) {
    let goal = null;
    let best = CPU_ITEM_RANGE;
    for (const item of items?.list ?? []) {
      if (item.kind === 'heal' && me.hp > MAX_HP - CPU_HEAL_NEED) continue;
      const d = Math.hypot(item.pos.x - me.pos.x, item.pos.z - me.pos.z);
      const foeD = Math.hypot(item.pos.x - foe.pos.x, item.pos.z - foe.pos.z);
      if (d >= best || d > foeD + CPU_ITEM_LEAD) continue;
      if (!this.itemChoice.has(item)) this.itemChoice.set(item, Math.random() < this.skill.items);
      if (!this.itemChoice.get(item)) continue;
      goal = item;
      best = d;
    }
    return goal;
  }

  // items: アイテム (items.js の Items)
  update(dt, arena, weapons, items) {
    const input = this.input;
    input.jump = input.gun = input.bomb = input.pod = input.missile = input.attack = input.guard = false;
    input.move.x = input.move.z = 0;
    const me = this.robot;
    if (!me.alive) return input;
    this.pickTarget(dt);
    const foe = me.target;
    if (!foe) return input;

    const dx = foe.pos.x - me.pos.x;
    const dz = foe.pos.z - me.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const fx = dx / dist; // 相手への向き
    const fz = dz / dist;
    const sx = fz; // 横 (回り込む向き)
    const sz = -fx;

    // 動く向き: 間合いの調整 + 回り込み
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      if (Math.random() < 0.6) this.strafe = -this.strafe;
      this.strafeTimer = randomIn(CPU_STRAFE_TIME) / this.more('strafe');
    }
    const range = this.style.range ?? CPU_RANGES[me.loadout.gun] ?? CPU_DEFAULT_RANGE;
    let radial = dist > range[1] ? 1 : dist < range[0] ? -1 : 0;
    if (foe.down) radial = dist > 8 ? 0.7 : 0; // 倒れた相手には少し近づく
    const strafe = this.strafe * (radial > 0 ? 0.5 : 1); // 遠すぎるときは、回り込むより近づくほうを優先する
    let mx = fx * radial + sx * strafe;
    let mz = fz * radial + sz * strafe;
    const goal = this.itemGoal(items, me, foe);
    if (goal) {
      // アイテムへまっすぐ向かう (台の上にあれば、引っかかったときのジャンプでのぼる)
      const gx = goal.pos.x - me.pos.x;
      const gz = goal.pos.z - me.pos.z;
      const gd = Math.hypot(gx, gz) || 1;
      mx = gx / gd;
      mz = gz / gd;
    } else {
      // 壁ぎわから離れる
      const edge = arena.half - 4;
      if (Math.abs(me.pos.x) > edge) mx -= Math.sign(me.pos.x) * 1.2;
      if (Math.abs(me.pos.z) > edge) mz -= Math.sign(me.pos.z) * 1.2;
    }
    // 相手 (全員) のグレネードの落ちる場所と、近くのマインやミサイル砲台から離れる (飛んでくるミサイルは、弾と同じくよける)。
    // 核ミサイルの警告の輪に気づいていれば、輪が止まって reaction 秒たってから、輪の外まで強く逃げる (輪の真ん中にいれば横へ)
    for (const item of weapons.items) {
      if (!me.isFoe(item.owner) || item.kind === 'bullet' || item.kind === 'missile' || item.kind === 'helper') continue;
      const nuke = item.kind === 'nuke';
      if (nuke && !(this.noticeNuke(item) && item.locked && item.age - item.lockedAt >= this.skill.reaction)) continue;
      const at = item.kind === 'bomb' || nuke ? item.land : item.pos;
      const ax = me.pos.x - at.x;
      const az = me.pos.z - at.z;
      const d = Math.hypot(ax, az);
      const keep = nuke ? item.spec.blast + CPU_NUKE_KEEP : item.kind === 'bomb' ? item.spec.blast + 1.7 : item.kind === 'turret' ? CPU_TURRET_KEEP : item.spec.kind === 'trap' ? 4 : 6;
      if (d < keep && (d > 1e-3 || nuke)) {
        const push = nuke ? 4 : 2;
        mx += (d > 1e-3 ? ax / d : sx) * push;
        mz += (d > 1e-3 ? az / d : sz) * push;
      }
    }
    // 床の穴と、電気が流れそうなしびれマスから離れる (マスの上にいれば、いちばん近いふちから出る)
    for (const tile of arena.tiles.list) {
      if (!this.fears(tile)) continue;
      let ax = me.pos.x - THREE.MathUtils.clamp(me.pos.x, tile.x0, tile.x1);
      let az = me.pos.z - THREE.MathUtils.clamp(me.pos.z, tile.z0, tile.z1);
      let d = Math.hypot(ax, az);
      let push = 3;
      if (d < 1e-3) {
        const exits = [[tile.x0 - me.pos.x, 0], [tile.x1 - me.pos.x, 0], [0, tile.z0 - me.pos.z], [0, tile.z1 - me.pos.z]];
        [ax, az] = exits.reduce((m, e) => (Math.abs(e[0] + e[1]) < Math.abs(m[0] + m[1]) ? e : m));
        d = Math.hypot(ax, az) || 1;
      } else if (d < CPU_TILE_KEEP) {
        push = 0.5 + 2.5 * (1 - d / CPU_TILE_KEEP);
      } else {
        continue;
      }
      mx += (ax / d) * push;
      mz += (az / d) * push;
    }
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    input.move.x = mx;
    input.move.z = mz;

    // 箱に引っかかって進めないときはジャンプして、回り込む向きも変える
    const speed = Math.hypot(me.vel.x, me.vel.z);
    if (me.state === 'normal' && me.onGround && Math.hypot(mx, mz) > 0.5 && speed < 2) this.stuck += dt;
    else this.stuck = 0;
    if (this.stuck > 0.35) {
      input.jump = true;
      this.stuck = 0;
      if (Math.random() < 0.5) this.strafe = -this.strafe;
    }

    // 飛んでくる弾とミサイル (相手全員のもの) をよける
    this.dodgeLock = Math.max(0, this.dodgeLock - dt);
    for (const item of weapons.items) {
      if (!me.isFoe(item.owner) || (item.kind !== 'bullet' && item.kind !== 'missile') || this.seen.has(item)) continue;
      const rx = me.pos.x - item.pos.x;
      const ry = me.pos.y + 1.3 - item.pos.y;
      const rz = me.pos.z - item.pos.z;
      const d = Math.hypot(rx, ry, rz);
      if (d > CPU_THREAT_RANGE) continue;
      const toward = (rx * item.dir.x + ry * item.dir.y + rz * item.dir.z) / d >= 0.8;
      if (item.kind === 'missile' && !toward) continue; // ミサイルは曲がってくるので、こちらを向くまで待つ
      this.seen.add(item);
      if (!toward) continue; // こちらに向かっていない
      if (this.dodgeLock > 0) continue;
      this.dodgeLock = CPU_DODGE_LOCK;
      const roll = Math.random();
      const dodge = this.skill.dodge + (this.style.dodge ?? 0);
      if (roll >= dodge) {
        // よけないときは、ときどきシールドで防ぐ
        if (roll < dodge + this.skill.guard) this.guardSoon(0, randomIn(CPU_GUARD_TIME));
        continue;
      }
      const side = Math.random() < 0.5 ? -1 : 1;
      this.dashDir = { x: sx * side, z: sz * side };
      if (me.onGround) {
        input.jump = true;
        if (Math.random() < 0.6) this.dashAt = 0.12;
      } else {
        this.dashAt = 0;
      }
    }

    // 気まぐれにジャンプ (ときどき空中ダッシュも)
    this.jumpWait -= dt;
    if (this.jumpWait <= 0 && me.onGround) {
      input.jump = true;
      this.jumpWait = randomIn(this.skill.jumpTime) / this.more('jumpy');
      if (Math.random() < 0.4) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.dashDir = { x: sx * side, z: sz * side };
        this.dashAt = 0.25;
      }
    }
    if (this.dashAt >= 0) {
      this.dashAt -= dt;
      if (this.dashAt < 0 && !me.onGround && me.airDashes > 0) {
        input.jump = true;
        input.move.x = this.dashDir.x;
        input.move.z = this.dashDir.z;
      }
    }

    // 相手 (自分を狙っているだれか) が斬りかかってきたら、気づいてから (reaction 秒)、ときどきシールドで防ぐ。
    // 回り込み斬りは防げないので、ジャンプでよける
    for (const enemy of me.foes) {
      const seen = this.attackSeen.get(enemy);
      this.attackSeen.set(enemy, enemy.attacks);
      if (seen === undefined || seen === enemy.attacks) continue;
      if (enemy.state !== 'attack' || enemy.target !== me) continue;
      if (Math.hypot(enemy.pos.x - me.pos.x, enemy.pos.z - me.pos.z) >= CPU_BLADE_WATCH) continue;
      if (enemy.slashKind === 'circle') {
        if (Math.random() < this.skill.dodge) this.jumpAt = this.skill.reaction;
      } else if (Math.random() < this.skill.guardBlade) {
        this.guardSoon(this.skill.reaction, randomIn(CPU_GUARD_TIME) + 0.2);
      }
    }
    if (this.jumpAt >= 0) {
      this.jumpAt -= dt;
      if (this.jumpAt < 0 && me.onGround) input.jump = true;
    }
    // シールド: 構え始めるまで待ってから、決めた時間だけ構える (構えている間は撃てないので、攻撃は考えない)
    if (this.guardDelay > 0) {
      this.guardDelay -= dt;
    } else if (this.guardLeft > 0) {
      this.guardLeft -= dt;
      input.guard = me.cooldowns.guard <= 0;
    }
    if (input.guard) return input;

    // 攻撃
    if (!foe.alive) return input;
    if (me.cooldowns.gun <= 0) {
      this.gunWait -= dt;
      if (this.gunWait <= 0 && arena.lineOfSight(me.center, foe.center)) {
        input.gun = true;
        this.gunWait = randomIn(this.skill.gunPause);
      }
    }
    if (me.cooldowns.bomb <= 0) {
      this.bombWait -= dt * (foe.state === 'guard' ? 3 : 1); // シールドを構えた相手には、足元へ早めに投げる
      if (this.bombWait <= 0 && dist > 5 && dist < 26) {
        input.bomb = true;
        this.bombWait = randomIn(this.skill.bombTime) / this.more('bombs');
      }
    }
    if (me.cooldowns.pod <= 0) {
      this.podWait -= dt;
      if (this.podWait <= 0 && (me.parts.pod.kind !== 'trap' || dist < CPU_TRAP_RANGE)) {
        input.pod = true;
        this.podWait = randomIn(this.skill.podTime) / this.more('pods');
      }
    }
    if (me.cooldowns.missile <= 0) {
      this.missileWait -= dt;
      if (this.missileWait <= 0 && dist > CPU_MISSILE_RANGE[0] && dist < CPU_MISSILE_RANGE[1]) {
        input.missile = true;
        this.missileWait = randomIn(this.skill.missileTime);
      }
    }
    // ブレード。技は押すときのスティックの向きで選ぶ (robot.js の startBlade): 空中で相手が下にいれば急降下斬り、
    // 相手がシールドを構えていれば回り込み斬り、近ければ3回斬りか回り込み斬り (遠ければ踏み込んでから斬る。
    // ブレードの多いくせなら、少し遠くからでも出す)、少し遠くて間に箱がなければ、ときどき突き。穴に落ちている相手には斬りかからない
    if (me.state === 'normal' && me.cooldowns.attack <= 0 && !foe.down && foe.state !== 'fall' && foe.invincible <= 0) {
      const blade = this.more('blade');
      const reach = blade > 1 ? 6.5 : 5;
      const height = me.pos.y - arena.groundAt(me.pos.x, me.pos.z, me.pos.y);
      let command = null; // 'neutral' (倒さない) / 'front' (相手のほう) / 'side' (横)
      if (!me.onGround && height > DIVE.height) {
        if (foe.pos.y < me.pos.y - 1 && dist < CPU_DIVE_RANGE && Math.random() < dt * 2.5 * blade) command = 'neutral';
      } else if (foe.state === 'guard') {
        if (dist < reach + 2 && Math.random() < dt * 3 * this.skill.read) command = 'side';
      } else if (dist < reach) {
        if (Math.random() < dt * 2 * blade) command = Math.random() < this.skill.circle ? 'side' : 'neutral';
      } else if (dist >= CPU_THRUST_RANGE[0] && dist < CPU_THRUST_RANGE[1]) {
        if (Math.random() < dt * 0.25 * blade && arena.lineOfSight(me.center, foe.center)) command = 'front';
      }
      if (command) {
        const side = Math.random() < 0.5 ? -1 : 1;
        input.attack = true;
        input.move.x = command === 'front' ? fx : command === 'side' ? sx * side : 0;
        input.move.z = command === 'front' ? fz : command === 'side' ? sz * side : 0;
      }
    }
    // 斬りが当たったら、続けて斬るかを1回の斬りにつき1回だけ決める
    if (me.state === 'attack' && me.slashHit && me.combo < 3 && this.comboDecided !== me.swings) {
      this.comboDecided = me.swings;
      if (Math.random() < this.skill.combo) input.attack = true;
    }
    return input;
  }
}
