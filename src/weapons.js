import * as THREE from 'three';

// 飛び道具。性能はパーツの spec (parts.js) で決まる。画面での名前は gun = ショット、bomb = グレネード、pod = マイン。
// - bullet: ショットの弾。spec.turn が大きいほど相手を追う。spec.count が2以上なら扇形に同時に撃つ
// - bomb: 山なりに飛んで相手の足元で爆発する。落ちる場所に爆風の大きさの輪を出す
// - pod: kind が 'homing' は浮いて相手を追う、'bounce' は床をはねてまっすぐ進む、'trap' は後ろに置いて待つ。
//   どれも相手が近づくと爆発し、壁や箱で跳ね返る
// - turret: ミサイル砲台 (アイテムで立つ: items.js)。拾ったロボの相手へ、左右の筒から missile を撃つ。相手のショットや爆発で壊れる
// - missile: 打ち上がってから曲がって相手を追い、当たると爆発する。砲台・ミサイルのボタン (MISSILE_BUTTON)・グレネードのハイミサイル
//   (spec.kind が 'rocket') で、動きの数字 (spec) だけがちがう
// - helper: お助けロボ (アイテムで来る)。持ち主の肩の横を飛びながら、持ち主の相手を弱い弾 (持ち主の弾として当たる) で撃つ。こわれない
// - nuke: 必殺技の核ミサイル (NUKE)。打ち上げてから相手の足元に警告の輪を出し、空から落ちて輪の中を大爆発させる
// ショットのマイクロミサイル (spec.missile) は、ミサイルの形で煙を引く bullet (当たり方はふつうの弾と同じで、爆発しない)。
// ショットのビームキャノン (spec.beam) は、白い芯の入った太い光の bullet。spec.knockdown の弾は、当たると相手がダウンする。
// 当たるのは撃った本人の相手 (ちがうチームのロボ: robot.foes) だけで、4人対戦では相手の誰にでも当たる (味方には当たらない)。
// 追いかけるもの (弾・マイン・ミサイル) は、撃ったときにロックオンしていた相手 (target) を追う。
// 弾とミサイルの追う強さと弾の先読みは、撃ったロボの助け (robot.assist。プレイヤーは強い) で変わる。
// マインとミサイルは相手の弾で撃ち落とせる。ダメージはパワーアップ中なら増える (robot.attackRate)。
// 相手がシールドを構えていれば、前から来たものは防がれる (robot.js の takeHit。弾とミサイルは盾のところで当たる。核は防げない)。
// ブレイク: ショットの弾で相手をダウンさせると、その相手が出していた飛び道具がすべて消える (砲台とお助けロボと核ミサイルは残る)
const HIT_RADIUS = 0.75; // ロボの体の軸からの当たり判定の距離 (弾の大きさのぶん広げる)
const POD_HOVER = 1.6; // 追いかけるマインの床からの高さ
const TRAP_HOVER = 0.45;
const TRAP_SLIDE_TIME = 0.4; // 置くマインが後ろへ滑る時間
const WEAPON_UP = new THREE.Vector3(0, 1, 0);
// ミサイル砲台。life: 立っている時間 / rise: 床から立ち上がるまで / first: 最初に撃つまで / interval: 次の2発までの間 /
// gap: 左右の2発の間 (秒) / hp: 相手のショットや爆発でこれだけダメージを受けると壊れる / reach: 当たり判定の半径 / height: 高さ (m) /
// size: 形の大きさの倍率
const TURRET = { life: 8, rise: 0.4, first: 0.9, interval: 2.4, gap: 0.18, hp: 200, reach: 1, height: 1.7, size: 1.2 };
// 砲台のミサイル。speed: [出たとき, いちばん速いとき] (m/秒) / accel: 加速 / turn: 相手を追う強さ (向きを変える速さ rad/秒) / life (秒) /
// blast: 爆風の半径 / damage / reach: 相手の弾で撃ち落とされる半径 (m) /
// boost: 撃ってから追い始めるまで (秒。そのあいだは、まっすぐ飛ぶ。書かなければ 0)
const MISSILE = { speed: [5, 15], accel: 16, turn: 2.6, life: 3.2, blast: 1.8, damage: 70, reach: 0.6 };
// ミサイルのボタン (どのロボでも撃てる)。両肩の後ろから外へ開くように count 発を打ち上げ、少しあとから相手を追う。
// 数字の意味は MISSILE と同じ。cooldown: 次に撃てるまで (秒。robot.js が使う)
export const MISSILE_BUTTON = { count: 2, speed: [7, 19], accel: 22, turn: 3, boost: 0.22, life: 3.2, blast: 1.8, damage: 50, reach: 0.6, cooldown: 6 };
// ミサイルが追うときの決まり (updateMissile)。相手との向きのちがいがこれ (rad) より小さくなったら「ねらいがついた」とし、
// そのあとで相手を通り過ぎたら (相手が後ろになったら)、もう追わない (ぎりぎりでよければ外れる)
const MISSILE_AIM = 0.5;
// ねらいがつくまでは、曲がる半径が「相手までの距離 × これ」より小さくなるよう、相手が近いほど速く向き直る
// (打ち上げたあと、近くの相手のまわりを回ったまま落ちないように)
const MISSILE_SWING = 0.5;
const MISSILE_CEILING = 40; // ミサイルがこれより高く上がったら、そこで爆発させる (m)
const MISSILE_PORT = { x: 0.42, y: 2.05, z: -0.3 }; // ミサイルのボタンで撃つときの、両肩の後ろの発射口 (ロボの中の位置 m)
const ROCKET_PORT = { x: 0.24, y: 2.12, z: -0.4 }; // ハイミサイル (グレネード) の、背中の発射口
const MISSILE_TRAIL = { color: 0xb8c2d6, count: 1, speed: 0.15, rise: 0.3, size: 0.5, life: 0.4 }; // ミサイルの煙の尾
const SWARM_TRAIL = { color: 0xb8c2d6, count: 1, speed: 0.1, rise: 0.2, size: 0.35, life: 0.3 }; // マイクロミサイル (ショット) の煙の尾
const SWARM_TRAIL_GAP = 0.09; // マイクロミサイルが煙を出す間 (秒)
const BEAM_TRAIL_GAP = 0.03; // ビーム (ショットのビームキャノン) が光の粒を出す間 (秒)
// ビームが撃った所から先まで引く光の帯。width: 太さ (半径 m) / opacity: 濃さ / fade: 当たったり消えたりしたあと、薄くなって消えるまで (秒)
const BEAM_STREAK = { width: 0.2, opacity: 0.55, fade: 0.25 };
// 必殺技の核ミサイル。背中から真上へ打ち上げ (rise 秒)、相手の足元に警告の輪を出す。輪は track 秒のあいだ相手についていき、
// 止まってから lock 秒で空から落ちてくる (最後の fall 秒で、height の高さから落ちる)。輪の中 (半径 blast m) を大爆発させる。
// damage: 真ん中でのダメージ (ふちでは falloff の割合だけ減る)。シールドでは防げない。輪の外へ逃げれば当たらない。size: 形の大きさの倍率
// follow: 輪が相手についていく速さ (1/秒)
export const NUKE = { rise: 0.8, track: 1.1, lock: 0.9, fall: 0.45, height: 42, blast: 7.5, damage: 450, falloff: 0.4, size: 1.3, follow: 14 };
const NUKE_RING_COLOR = 0xff3b2a; // 警告の輪と光の柱の色
const NUKE_TRAIL = { color: 0xd8dee8, count: 2, speed: 0.6, rise: 0.4, size: 1.2, life: 0.7 }; // 核ミサイルの打ち上げの煙
const TURRET_TILT = 0.9; // 砲台の筒の上向きの角度 (rad)
// お助けロボ。life: いる時間 / first: 最初に撃つまで / interval: 次を撃つまで (秒) /
// side: 持ち主の横へのずれ / height: 足元からの高さ / back: 後ろへのずれ (m) / size: 形の大きさの倍率
const HELPER = { life: 15, first: 0.8, interval: 1, side: 1.5, height: 2.4, back: 0.5, size: 1.3 };
// お助けロボの弾 (ショットの spec と同じ形。parts.js の gun を見る)
const HELPER_SHOT = { shots: 1, interval: 0, count: 1, fan: 0, speed: 26, turn: 1.6, lead: 0.3, damage: 18, spread: 0.06, life: 1.6, size: 0.75, stretch: 2.2, cooldown: 0 };

// 点からロボの体までの距離。体は縦の線として扱い、倒れているときは低い位置にする
export function distanceToRobot(p, robot) {
  const low = robot.down || !robot.alive;
  const y = THREE.MathUtils.clamp(p.y, robot.pos.y + (low ? 0.2 : 0.35), robot.pos.y + (low ? 0.8 : 2.2));
  return Math.hypot(p.x - robot.pos.x, p.y - y, p.z - robot.pos.z);
}

const TURN_AXIS = new THREE.Vector3();

// 向き dir (長さ 1) を want (長さ 1) のほうへ、いちばん大きくて angle (rad) だけ回す。
// 向きのちがいが大きくても同じ速さで曲がる (dir.lerp だと、ちがいが大きいほど曲がり方が小さくなる)
function turnToward(dir, want, angle) {
  if (dir.angleTo(want) <= angle) {
    dir.copy(want);
    return;
  }
  TURN_AXIS.crossVectors(dir, want);
  if (TURN_AXIS.lengthSq() < 1e-8) {
    // 真うしろ: 横へ回る (真上か真下を向いているときは、前後へ回る)
    if (Math.abs(dir.y) < 0.99) TURN_AXIS.set(0, 1, 0);
    else TURN_AXIS.set(1, 0, 0);
  }
  dir.applyAxisAngle(TURN_AXIS.normalize(), angle).normalize();
}

export class Weapons {
  constructor(scene, arena, effects, sfx) {
    this.scene = scene;
    this.arena = arena;
    this.effects = effects;
    this.sfx = sfx;
    this.items = [];
    this.onExplode = null; // 爆発したときに呼ぶ (位置, 半径)。main.js が画面を揺らすのに使う
    this.onBreak = null; // ブレイクしたときに呼ぶ (ダウンしたロボ)。main.js が文字と音を出す
    this.onTurretBroken = null; // 砲台が壊されたときに呼ぶ (砲台)。main.js が文字を出す
    this.onNukeLaunch = null; // 核ミサイルを打ち上げたときに呼ぶ (核ミサイル)。main.js が文字を出す
    this.onNuke = null; // 核ミサイルが爆発したときに呼ぶ (位置, 半径)。main.js が画面を光らせて揺らす
    // 形はどれも角ばった多面体 (ロボと同じ、荒いポリゴンの見た目)。ショットの弾は飛ぶ向きにのびた八面体
    this.geometries = {
      bullet: new THREE.OctahedronGeometry(0.2),
      bomb: new THREE.IcosahedronGeometry(0.34),
      pod: new THREE.OctahedronGeometry(0.42),
      marker: new THREE.RingGeometry(0.86, 1, 12).rotateX(-Math.PI / 2),
      missile: new THREE.ConeGeometry(0.19, 0.78, 5).rotateX(Math.PI / 2), // 先が +z
      turretBase: new THREE.CylinderGeometry(0.55, 0.7, 0.36, 6).translate(0, 0.18, 0),
      turretPost: new THREE.CylinderGeometry(0.15, 0.2, 0.62, 6).translate(0, 0.66, 0),
      turretHead: new THREE.BoxGeometry(0.8, 0.36, 0.56),
      turretTube: new THREE.CylinderGeometry(0.11, 0.13, 0.62, 6).rotateX(Math.PI / 2),
      turretLight: new THREE.BoxGeometry(0.46, 0.06, 0.04),
      turretRing: new THREE.RingGeometry(0.95, 1.1, 6).rotateX(-Math.PI / 2),
      helperBody: new THREE.IcosahedronGeometry(0.32, 0),
      helperVisor: new THREE.BoxGeometry(0.4, 0.09, 0.1),
      helperFin: new THREE.BoxGeometry(0.16, 0.05, 0.3),
      helperAntenna: new THREE.CylinderGeometry(0.015, 0.015, 0.22, 4),
      helperTip: new THREE.OctahedronGeometry(0.05),
      helperGun: new THREE.CylinderGeometry(0.04, 0.05, 0.25, 6).rotateX(Math.PI / 2),
      helperFlame: new THREE.ConeGeometry(0.1, 0.35, 5, 1, true).rotateX(Math.PI).translate(0, -0.175, 0), // 下向きの炎
      // 核ミサイル (先が +y): 太い胴・先・4枚の羽 (1枚の形を回して使う)・光る帯・下の炎。警告の輪 (半径 1。NUKE.blast 倍で使う)・中の面・光の柱
      nukeBody: new THREE.CylinderGeometry(0.32, 0.32, 1.9, 8),
      nukeNose: new THREE.ConeGeometry(0.32, 0.85, 8).translate(0, 1.37, 0),
      nukeFin: new THREE.BoxGeometry(0.05, 0.62, 0.5).translate(0, -0.72, 0.42),
      nukeBand: new THREE.CylinderGeometry(0.34, 0.34, 0.14, 8).translate(0, 0.45, 0),
      nukeFlame: new THREE.ConeGeometry(0.28, 1.7, 8, 1, true).rotateX(Math.PI).translate(0, -1.8, 0),
      warnRing: new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2),
      warnInner: new THREE.RingGeometry(0.46, 0.5, 48).rotateX(-Math.PI / 2),
      warnDisc: new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
      warnBeam: new THREE.CylinderGeometry(0.18, 0.18, 30, 6, 1, true).translate(0, 15, 0),
      // ビームの光の帯 (半径 1、長さ 1。+z へのびる。BEAM_STREAK の太さと、撃った所からの長さにのばして使う)
      beamStreak: new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5),
    };
    this.glowMaterials = new Map();
    this.bombMaterials = new Map();
    this.turretMetal = new THREE.MeshLambertMaterial({ color: 0x8a94a8, flatShading: true });
    this.tmp = new THREE.Vector3();
    this.probe = new THREE.Vector3();
  }

  glowMaterial(color) {
    if (!this.glowMaterials.has(color)) {
      this.glowMaterials.set(color, new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }));
    }
    return this.glowMaterials.get(color);
  }

  bombMaterial(color) {
    if (!this.bombMaterials.has(color)) {
      this.bombMaterials.set(color, new THREE.MeshLambertMaterial({ color: 0x39404f, emissive: color, emissiveIntensity: 0.55, flatShading: true }));
    }
    return this.bombMaterials.get(color);
  }

  add(item) {
    item.mesh.position.copy(item.pos);
    this.scene.add(item.mesh);
    this.items.push(item);
  }

  fireGun(robot) {
    const spec = robot.parts.gun;
    const pos = robot.toWorld(robot.muzzles.gun);
    this.shoot(robot, spec, pos);
    if (spec.beam) this.effects.burst(pos, robot.bulletColor, 18, 5);
    else this.effects.burst(pos, robot.bulletColor, 4, 2);
    this.sfx.gun(robot.loadout.gun);
  }

  // owner の相手へ、spec (ショットの性能) の弾を pos から撃つ。先読みして狙い、count が2以上なら扇形に出す
  // (先読みは、撃つロボの助け owner.assist.lead より弱くしない)。
  // マイクロミサイル (spec.missile) は、ミサイルの形で少し上 (spec.rise) へ向けて出す (広がって飛び、曲がって相手を追う)。
  // ビーム (spec.beam) は、白い芯の入った太い光
  shoot(owner, spec, pos) {
    const target = owner.target;
    const aim = target.center.clone();
    const time = aim.distanceTo(pos) / spec.speed;
    const lead = Math.max(spec.lead, owner.assist.lead);
    aim.x += target.vel.x * time * lead;
    aim.z += target.vel.z * time * lead;
    const base = aim.sub(pos).normalize();
    for (let i = 0; i < spec.count; i++) {
      const dir = base.clone();
      if (spec.count > 1) dir.applyAxisAngle(WEAPON_UP, (i / (spec.count - 1) - 0.5) * spec.fan);
      if (spec.missile) dir.y += spec.rise;
      dir.x += (Math.random() - 0.5) * spec.spread;
      dir.y += (Math.random() - 0.5) * spec.spread * 0.5;
      dir.z += (Math.random() - 0.5) * spec.spread;
      dir.normalize();
      const mesh = spec.missile
        ? new THREE.Mesh(this.geometries.missile, this.bombMaterial(owner.bulletColor))
        : new THREE.Mesh(this.geometries.bullet, this.glowMaterial(owner.bulletColor));
      mesh.scale.set(spec.size, spec.size, spec.size * spec.stretch);
      let streak = null;
      if (spec.beam) {
        const core = new THREE.Mesh(this.geometries.bullet, this.glowMaterial(0xffffff));
        core.scale.setScalar(0.45);
        mesh.add(core);
        streak = new THREE.Mesh(this.geometries.beamStreak, new THREE.MeshBasicMaterial({
          color: owner.bulletColor, transparent: true, opacity: BEAM_STREAK.opacity, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        this.scene.add(streak);
      }
      const bullet = { kind: 'bullet', owner, target, spec, pos: pos.clone(), start: pos.clone(), dir, mesh, streak, trail: Math.random() * SWARM_TRAIL_GAP, age: 0 };
      this.add(bullet);
      if (streak) this.stretchStreak(bullet);
    }
  }

  fireBomb(robot) {
    const spec = robot.parts.bomb;
    if (spec.kind === 'rocket') {
      this.fireRockets(robot, spec);
      return;
    }
    const target = robot.target;
    const from = robot.toWorld(robot.muzzles.bomb);
    const dist = Math.hypot(target.pos.x - from.x, target.pos.z - from.z);
    const time = THREE.MathUtils.clamp(dist / spec.speed, spec.flight[0], spec.flight[1]);
    const cx = target.pos.x + target.vel.x * time * spec.lead;
    const cz = target.pos.z + target.vel.z * time * spec.lead;
    const lim = this.arena.half - 0.5;
    const turn = Math.random() * Math.PI * 2;
    for (let i = 0; i < spec.count; i++) {
      const a = turn + (i / spec.count) * Math.PI * 2;
      const lx = THREE.MathUtils.clamp(cx + Math.cos(a) * spec.scatter, -lim, lim);
      const lz = THREE.MathUtils.clamp(cz + Math.sin(a) * spec.scatter, -lim, lim);
      const land = new THREE.Vector3(lx, this.arena.groundAt(lx, lz, 100), lz); // 落ちる場所のいちばん上の面
      const t = time * (1 + i * 0.08); // 何発かあるときは少しずつずらして落とす
      const vel = new THREE.Vector3(
        (land.x - from.x) / t,
        (land.y - from.y + 0.5 * spec.gravity * t * t) / t,
        (land.z - from.z) / t,
      );
      const mesh = new THREE.Mesh(this.geometries.bomb, this.bombMaterial(robot.bulletColor));
      mesh.scale.setScalar(spec.size);
      const marker = new THREE.Mesh(
        this.geometries.marker,
        new THREE.MeshBasicMaterial({ color: robot.bulletColor, transparent: true, opacity: 0.6, depthWrite: false }),
      );
      marker.scale.setScalar(spec.blast);
      marker.position.set(land.x, land.y + 0.04, land.z);
      this.scene.add(marker);
      this.add({ kind: 'bomb', owner: robot, spec, pos: from.clone(), vel, mesh, marker, land, age: 0 });
    }
    this.sfx.bombLaunch();
  }

  firePod(robot) {
    const spec = robot.parts.pod;
    const from = robot.toWorld(robot.muzzles.pod);
    for (let i = 0; i < spec.count; i++) {
      let heading;
      if (spec.kind === 'homing') {
        // 横へ飛び出してから、弧をえがいて相手へ向かう (2つなら左右に1つずつ)
        const side = spec.count > 1 ? (i === 0 ? -1 : 1) : Math.random() < 0.5 ? -1 : 1;
        heading = robot.yaw + side * 1.3;
      } else if (spec.kind === 'bounce') {
        heading = robot.yaw + (Math.random() - 0.5) * 0.3; // 相手のほうへまっすぐ
      } else {
        heading = robot.yaw + Math.PI; // 後ろへ置く
      }
      const material = new THREE.MeshLambertMaterial({ color: 0x1b2230, emissive: robot.bulletColor, flatShading: true });
      const mesh = new THREE.Mesh(this.geometries.pod, material);
      mesh.scale.setScalar(spec.size);
      this.add({ kind: 'pod', owner: robot, target: robot.target, spec, pos: from.clone(), heading, mesh, age: 0 });
    }
    this.sfx.podLaunch();
  }

  // ミサイル砲台を at (床か箱の上の点) に立てる。robot (アイテムを拾ったロボ) の相手のうち、砲台にいちばん近いロボを撃つ
  placeTurret(robot, at) {
    const { root, head, tubes, shell } = this.turretModel(robot.bulletColor);
    const target = robot.target;
    const yaw = Math.atan2(target.pos.x - at.x, target.pos.z - at.z);
    head.rotation.y = yaw;
    root.scale.set(TURRET.size, 0.05, TURRET.size);
    this.add({ kind: 'turret', owner: robot, target, spec: TURRET, pos: at.clone(), mesh: root, head, tubes, shell, yaw, hp: TURRET.hp, shots: 0, hit: 0, age: 0 });
    this.effects.puff(at, { color: 0x9aa7c0, count: 10, speed: 2.5, rise: 0.5, size: 0.7, life: 0.6 });
  }

  // 砲台の形: 六角の台・柱・相手を向く頭 (左右に上向きの筒、前に光る線)・足元に持ち主の色の輪
  turretModel(color) {
    const g = this.geometries;
    const shell = new THREE.MeshLambertMaterial({ color: 0x2a3140, emissive: color, emissiveIntensity: 0.4, flatShading: true });
    const root = new THREE.Group();
    const head = new THREE.Group();
    head.position.y = 0.95;
    const ring = new THREE.Mesh(g.turretRing, this.glowMaterial(color));
    ring.position.y = 0.04;
    root.add(new THREE.Mesh(g.turretBase, shell), new THREE.Mesh(g.turretPost, this.turretMetal), head, ring);
    head.add(new THREE.Mesh(g.turretHead, shell));
    const light = new THREE.Mesh(g.turretLight, this.glowMaterial(color));
    light.position.set(0, 0.06, 0.285);
    head.add(light);
    const tubes = [-1, 1].map((side) => {
      const tube = new THREE.Mesh(g.turretTube, this.turretMetal);
      tube.position.set(side * 0.34, 0.12, 0.12);
      tube.rotation.x = -TURRET_TILT;
      head.add(tube);
      return tube;
    });
    return { root, head, tubes, shell };
  }

  // 砲台の筒 (side: -1 / 1 で左右) からミサイルを1発。上へ外向きに飛び出し、曲がりながら相手へ向かう
  fireMissile(t, side) {
    t.mesh.updateMatrixWorld(true);
    const pos = t.tubes[side < 0 ? 0 : 1].localToWorld(new THREE.Vector3(0, 0, 0.34));
    const dir = new THREE.Vector3(side * 0.4, 1, 0.25).applyAxisAngle(WEAPON_UP, t.yaw).normalize();
    this.launchMissile(t.owner, t.target, MISSILE, pos, dir);
    this.sfx.missile();
  }

  // ミサイルのボタン: 両肩の後ろから、外へ開くように上へ打ち上げる (MISSILE_BUTTON。少しあとから相手を追う)
  fireMissiles(robot) {
    const spec = MISSILE_BUTTON;
    for (let i = 0; i < spec.count; i++) {
      const side = i % 2 ? 1 : -1;
      const pos = robot.toWorld(this.tmp.set(side * MISSILE_PORT.x, MISSILE_PORT.y, MISSILE_PORT.z));
      const dir = new THREE.Vector3(side * 0.8, 1, -0.35).normalize().applyAxisAngle(WEAPON_UP, robot.yaw);
      this.launchMissile(robot, robot.target, spec, pos, dir);
    }
    this.sfx.missile();
  }

  // ハイミサイル (グレネード。spec.kind が 'rocket'): 背中の発射口から真上へ打ち上げ、上から相手を追って落ちてくる
  fireRockets(robot, spec) {
    for (let i = 0; i < spec.count; i++) {
      const side = spec.count > 1 ? (i % 2 ? 1 : -1) : 0;
      const pos = robot.toWorld(this.tmp.set(side * ROCKET_PORT.x, ROCKET_PORT.y, ROCKET_PORT.z));
      const dir = new THREE.Vector3(side * 0.12, 1, -0.15).normalize().applyAxisAngle(WEAPON_UP, robot.yaw);
      this.launchMissile(robot, robot.target, spec, pos, dir);
    }
    this.sfx.missile();
  }

  // ミサイルを1発出す (砲台・ミサイルのボタン・ハイミサイルで共通。動きは spec で決まる)
  launchMissile(owner, target, spec, pos, dir) {
    const mesh = new THREE.Mesh(this.geometries.missile, this.bombMaterial(owner.bulletColor));
    mesh.scale.setScalar(spec.size ?? 1);
    this.add({ kind: 'missile', owner, target, spec, pos, dir, speed: spec.speed[0], mesh, trail: 0, aimed: false, passed: false, age: 0 });
    this.effects.burst(pos, owner.bulletColor, 6, 2);
  }

  // 必殺技の核ミサイルを、robot の背中から打ち上げる。ロックオンしている相手の足元に警告の輪を出す (updateNuke)
  fireNuke(robot) {
    const target = robot.target;
    const { root, flame, materials } = this.nukeModel(robot.bulletColor);
    const pos = robot.toWorld(this.tmp.set(0, 2.3, -0.45));
    const land = new THREE.Vector3(target.pos.x, Math.max(0, this.arena.groundAt(target.pos.x, target.pos.z, target.pos.y + 0.5)), target.pos.z);
    // 警告の輪: ふちの輪・内側の輪・うっすら赤い面と、止まったあとに空から立つ光の柱 (どれも持ち主に関係なく赤)
    const glow = { color: NUKE_RING_COLOR, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    const ringMaterials = {
      edge: new THREE.MeshBasicMaterial({ ...glow, opacity: 0.9 }),
      fill: new THREE.MeshBasicMaterial({ ...glow, opacity: 0.12 }),
      beam: new THREE.MeshBasicMaterial({ ...glow, opacity: 0.5, side: THREE.DoubleSide }),
    };
    const ring = new THREE.Group();
    const g = this.geometries;
    ring.add(new THREE.Mesh(g.warnRing, ringMaterials.edge), new THREE.Mesh(g.warnInner, ringMaterials.edge), new THREE.Mesh(g.warnDisc, ringMaterials.fill));
    const beam = new THREE.Mesh(g.warnBeam, ringMaterials.beam);
    beam.visible = false;
    this.scene.add(ring, beam);
    const nuke = {
      kind: 'nuke', owner: robot, target, spec: NUKE, pos, land, mesh: root, flame, materials, ring, beam, ringMaterials,
      speed: 4, trail: 0, locked: false, age: 0,
    };
    this.add(nuke);
    this.effects.burst(pos, 0xffd27a, 24, 5);
    this.effects.puff(robot.pos, { color: 0x9aa7c0, count: 14, speed: 3.5, rise: 0.6, size: 1, life: 0.8 });
    this.sfx.nukeLaunch();
    this.onNukeLaunch?.(nuke);
  }

  // 核ミサイルの形 (先が +y): 白い胴・赤い先と羽・持ち主の色に光る帯・下の炎。大きさは NUKE.size
  nukeModel(color) {
    const g = this.geometries;
    const body = new THREE.MeshLambertMaterial({ color: 0xe6eaf0, flatShading: true });
    const red = new THREE.MeshLambertMaterial({ color: 0xd8262c, emissive: 0x3a0505, flatShading: true });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(g.nukeBody, body), new THREE.Mesh(g.nukeNose, red), new THREE.Mesh(g.nukeBand, this.glowMaterial(color)));
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(g.nukeFin, red);
      fin.rotation.y = (i * Math.PI) / 2;
      root.add(fin);
    }
    const flame = new THREE.Mesh(g.nukeFlame, this.glowMaterial(0xffc04a));
    root.add(flame);
    root.scale.setScalar(NUKE.size);
    return { root, flame, materials: [body, red] };
  }

  // お助けロボを呼ぶ。robot (アイテムを拾ったロボ) の肩の横を飛んで、その相手を撃つ。2台目は反対の肩に来る
  callHelper(robot) {
    const side = this.items.some((w) => w.kind === 'helper' && w.owner === robot && w.side > 0) ? -1 : 1;
    const { root, shell, flame } = this.helperModel(robot.bulletColor);
    const pos = this.helperSpot(robot, side, new THREE.Vector3());
    root.scale.setScalar(0.01);
    this.add({ kind: 'helper', owner: robot, spec: HELPER, pos, mesh: root, shell, flame, side, next: HELPER.first, age: 0 });
    this.effects.burst(pos, robot.bulletColor, 16, 4);
    robot.helperLeft = HELPER.life; // HUD に残り時間を出す
  }

  // お助けロボのいる場所: 持ち主の横 (side: 1 は持ち主の左、-1 は右) の少し後ろの、頭より上
  helperSpot(robot, side, out) {
    const c = Math.cos(robot.yaw);
    const s = Math.sin(robot.yaw);
    const x = side * HELPER.side;
    const z = -HELPER.back;
    return out.set(robot.pos.x + x * c + z * s, robot.pos.y + HELPER.height, robot.pos.z - x * s + z * c);
  }

  // お助けロボの形: 白い丸い体 (角ばった多面体)・持ち主の色に光る目の帯・左右の小さな羽・アンテナ・前の小さな筒・下の噴射の炎
  helperModel(color) {
    const g = this.geometries;
    const shell = new THREE.MeshLambertMaterial({ color: 0xdfe6f2, emissive: color, emissiveIntensity: 0.15, flatShading: true });
    const glow = this.glowMaterial(color);
    const root = new THREE.Group();
    const part = (geometry, material, [x, y, z], rz = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.z = rz;
      root.add(mesh);
      return mesh;
    };
    part(g.helperBody, shell, [0, 0, 0]);
    part(g.helperVisor, glow, [0, 0.05, 0.27]);
    for (const side of [-1, 1]) part(g.helperFin, shell, [side * 0.36, 0, -0.05], side * 0.4);
    part(g.helperAntenna, this.turretMetal, [0, 0.4, 0]);
    part(g.helperTip, glow, [0, 0.53, 0]);
    part(g.helperGun, this.turretMetal, [0, -0.18, 0.25]);
    const flame = part(g.helperFlame, glow, [0, -0.28, 0]);
    return { root, shell, flame };
  }

  updateHelper(h, dt) {
    if (h.dead) return;
    const owner = h.owner;
    const target = owner.target;
    // 持ち主の横へついていき、ふわふわ上下にゆれる。相手のほうを向く
    const want = this.helperSpot(owner, h.side, this.probe);
    want.y += Math.sin(h.age * 3) * 0.15;
    h.pos.lerp(want, Math.min(1, dt * 6));
    h.mesh.rotation.y = Math.atan2(target.pos.x - h.pos.x, target.pos.z - h.pos.z);
    h.mesh.scale.setScalar(HELPER.size * Math.max(0.01, Math.min(1, h.age / 0.3))); // 現れるときは大きくなる
    h.flame.scale.y = 0.8 + Math.random() * 0.4;
    if (h.age >= h.next && target.alive && owner.alive) {
      h.next += HELPER.interval;
      const muzzle = this.tmp.set(h.pos.x + Math.sin(h.mesh.rotation.y) * 0.4, h.pos.y - 0.18, h.pos.z + Math.cos(h.mesh.rotation.y) * 0.4);
      this.shoot(owner, HELPER_SHOT, muzzle);
      this.effects.burst(muzzle, owner.bulletColor, 3, 1.5);
      this.sfx.helperShot();
    }
    // 終わりぎわは点滅して、時間がきたら煙を出して帰る
    const left = HELPER.life - h.age;
    h.mesh.visible = left > 2 || Math.floor(left * 8) % 2 === 0;
    if (left <= 0) {
      h.dead = true;
      this.effects.puff(h.pos, { color: 0x9aa7c0, count: 8, speed: 1.5, rise: 0.8, size: 0.6, life: 0.6 });
    }
  }

  update(dt) {
    for (const item of this.items) {
      item.age += dt;
      if (item.kind === 'bullet') this.updateBullet(item, dt);
      else if (item.kind === 'bomb') this.updateBomb(item, dt);
      else if (item.kind === 'missile') this.updateMissile(item, dt);
      else if (item.kind === 'turret') this.updateTurret(item, dt);
      else if (item.kind === 'helper') this.updateHelper(item, dt);
      else if (item.kind === 'nuke') this.updateNuke(item, dt);
      else this.updatePod(item, dt);
      item.mesh.position.copy(item.pos);
    }
    this.items = this.items.filter((item) => {
      if (!item.dead) return true;
      this.remove(item);
      return false;
    });
  }

  updateBullet(b, dt) {
    if (b.dead) return;
    const spec = b.spec;
    const target = b.target;
    if (b.age > spec.life) {
      b.dead = true;
      return;
    }
    // 撃ったときの相手を追う (相手を通り過ぎたらもう追わない)。追う強さは、撃ったロボの助け (assist.aim) の倍
    const turn = spec.turn * b.owner.assist.aim;
    if (target?.alive && turn > 0) {
      const want = this.tmp.copy(target.center).sub(b.pos);
      if (want.dot(b.dir) > 0) {
        want.normalize();
        const angle = b.dir.angleTo(want);
        if (angle > 1e-4) b.dir.lerp(want, Math.min(1, (turn * dt) / angle)).normalize();
      }
    }
    // 速いので細かく区切って進め、すり抜けを防ぐ
    const steps = Math.ceil((spec.speed * dt) / 0.4);
    const step = (spec.speed * dt) / steps;
    for (let i = 0; i < steps; i++) {
      b.pos.addScaledVector(b.dir, step);
      if (this.bulletHits(b)) return;
    }
    b.mesh.position.copy(b.pos);
    b.mesh.lookAt(this.tmp.copy(b.pos).add(b.dir));
    // ビームは、撃った所からの光の帯をのばす (飛んでいくうちに少し薄くなる)
    if (b.streak) {
      this.stretchStreak(b);
      b.streak.material.opacity = BEAM_STREAK.opacity * (1 - (0.5 * b.age) / spec.life);
    }
    // マイクロミサイルは煙の尾を、ビームは光の粒を引く
    if (spec.missile || spec.beam) {
      b.trail -= dt;
      if (b.trail <= 0) {
        b.trail = spec.beam ? BEAM_TRAIL_GAP : SWARM_TRAIL_GAP;
        if (spec.beam) this.effects.burst(b.pos, b.owner.bulletColor, 3, 1.5);
        else this.effects.puff(b.pos, SWARM_TRAIL);
      }
    }
  }

  // ビームの光の帯を、撃った所 (b.start) から弾のいる所までのばす
  stretchStreak(b) {
    const streak = b.streak;
    streak.position.copy(b.start);
    streak.lookAt(b.pos);
    const width = BEAM_STREAK.width * b.spec.size;
    streak.scale.set(width, width, Math.max(0.01, b.start.distanceTo(b.pos)));
  }

  // 弾が何かに当たったか (相手の砲台・相手のマインやミサイル・相手のロボ・床や箱や壁)
  bulletHits(b) {
    const owner = b.owner;
    for (const other of this.items) {
      if (other.dead || !owner.isFoe(other.owner)) continue;
      if (other.kind === 'turret' && this.nearTurret(other, b.pos)) {
        // 相手の砲台に当たった (弾はそこで止まる)
        b.dead = true;
        this.damageTurret(other, b.spec.damage * b.owner.attackRate);
        this.effects.burst(b.pos, 0xffffff, 6, 3);
        this.sfx.hit();
        return true;
      }
      const reach = other.kind === 'pod' ? 0.7 * other.spec.size : other.kind === 'missile' ? other.spec.reach : 0;
      if (other.pos.distanceTo(b.pos) < reach) {
        // 相手のマインやミサイルを撃ち落とした (ダメージなし)
        other.dead = true;
        b.dead = true;
        this.effects.explosion(other.pos, 1.2, 0xffffff);
        this.sfx.hit();
        return true;
      }
    }
    // 飛んできたほう (シールドで防げるかを決める)。相手がシールドを構えていて前から来た弾は、盾のところで当たる
    const came = this.probe.copy(b.pos).addScaledVector(b.dir, -2);
    for (const foe of owner.foes) {
      if (!foe.alive || distanceToRobot(b.pos, foe) >= HIT_RADIUS + 0.15 * b.spec.size + foe.guardReach(came)) continue;
      b.dead = true;
      const result = foe.takeHit({ damage: b.spec.damage * owner.attackRate, knockdown: Boolean(b.spec.knockdown), from: owner.pos, at: came, cause: 'gun', by: owner });
      this.effects.burst(b.pos, result ? owner.bulletColor : 0xffffff, 10, 4);
      if (result === 'down') this.breakShots(foe);
      return true;
    }
    if (b.pos.y <= 0 || this.arena.blockAt(b.pos) || this.arena.outside(b.pos)) {
      b.dead = true;
      this.effects.burst(b.pos, b.owner.bulletColor, 5, 2.5);
      return true;
    }
    return false;
  }

  updateBomb(b, dt) {
    if (b.dead) return;
    b.vel.y -= b.spec.gravity * dt;
    b.pos.addScaledVector(b.vel, dt);
    b.mesh.rotation.x += dt * 8;
    b.mesh.rotation.z += dt * 5;
    b.marker.material.opacity = 0.45 + 0.3 * Math.sin(b.age * 16);
    const ground = this.arena.groundAt(b.pos.x, b.pos.z, b.pos.y);
    if (b.pos.y <= ground || this.arena.blockAt(b.pos) || this.closestFoe(b.owner, b.pos).d < HIT_RADIUS) {
      b.pos.y = Math.max(b.pos.y, ground + 0.2);
      this.explode(b, b.spec.blast, b.spec.damage, 'bomb');
    }
  }

  updatePod(p, dt) {
    if (p.dead) return;
    const spec = p.spec;
    const target = p.target?.alive ? p.target : this.closestFoe(p.owner, p.pos).foe; // 出したときの相手を追う (倒れていれば、いちばん近い相手)
    let speed = 0;
    let hover = POD_HOVER;
    if (spec.kind === 'homing') {
      if (target) {
        const want = Math.atan2(target.pos.x - p.pos.x, target.pos.z - p.pos.z);
        const diff = Math.atan2(Math.sin(want - p.heading), Math.cos(want - p.heading));
        p.heading += THREE.MathUtils.clamp(diff, -spec.turn * dt, spec.turn * dt);
      }
      speed = spec.speed * Math.min(1, 0.4 + p.age);
    } else if (spec.kind === 'bounce') {
      speed = spec.speed;
      hover = 0.35 + Math.abs(Math.sin(p.age * 7)) * 0.9; // 床の上をはねる
    } else {
      speed = p.age < TRAP_SLIDE_TIME ? spec.speed : 0;
      hover = TRAP_HOVER;
    }
    let nx = p.pos.x + Math.sin(p.heading) * speed * dt;
    let nz = p.pos.z + Math.cos(p.heading) * speed * dt;
    // 壁で跳ね返る
    const lim = this.arena.half - 0.45;
    if (Math.abs(nx) > lim) {
      p.heading = -p.heading;
      nx = p.pos.x;
    }
    if (Math.abs(nz) > lim) {
      p.heading = Math.PI - p.heading;
      nz = p.pos.z;
    }
    // 箱で跳ね返る (どちらの面から入ったかで向きを変える)
    const block = this.arena.blockAt(this.tmp.set(nx, p.pos.y, nz));
    if (block) {
      if (p.pos.x <= block.x0 || p.pos.x >= block.x1) {
        p.heading = -p.heading;
        nx = p.pos.x;
      } else {
        p.heading = Math.PI - p.heading;
        nz = p.pos.z;
      }
    }
    p.pos.x = nx;
    p.pos.z = nz;
    // 床や箱の上を浮いて進む (はねるマインは高さをすぐ合わせる)。床の穴の上は、床の高さのまま
    const want = Math.max(0, this.arena.groundAt(nx, nz, p.pos.y)) + hover;
    p.pos.y += (want - p.pos.y) * (spec.kind === 'bounce' ? 1 : Math.min(1, dt * 3));
    const near = this.closestFoe(p.owner, p.pos).d; // 相手の誰かが近づくと爆発する
    p.mesh.rotation.y += dt * 4;
    p.mesh.rotation.x += dt * 2;
    const armed = p.age > spec.arm;
    p.mesh.material.emissiveIntensity = armed ? 0.55 + 0.45 * Math.sin(p.age * (near < 5 ? 30 : 10)) : 0.3;
    if ((armed && near < spec.trigger) || p.age > spec.life) this.explode(p, spec.blast, spec.damage, 'pod');
  }

  updateTurret(t, dt) {
    if (t.dead) return;
    t.mesh.scale.y = TURRET.size * Math.max(0.05, Math.min(1, t.age / TURRET.rise)); // 床から立ち上がる
    const target = this.closestFoe(t.owner, t.pos).foe; // 持ち主の相手のうち、砲台にいちばん近いロボを狙う
    t.target = target;
    if (target) {
      // 頭を相手のほうへ向ける
      const want = Math.atan2(target.pos.x - t.pos.x, target.pos.z - t.pos.z);
      t.yaw += Math.atan2(Math.sin(want - t.yaw), Math.cos(want - t.yaw)) * Math.min(1, dt * 6);
      t.head.rotation.y = t.yaw;
      // 左右の筒から1発ずつ、少しずらして撃つ
      const due = TURRET.first + Math.floor(t.shots / 2) * TURRET.interval + (t.shots % 2) * TURRET.gap;
      if (t.age >= due && t.owner.alive) {
        this.fireMissile(t, t.shots % 2 ? 1 : -1);
        t.shots++;
      }
    }
    // 撃たれると白く光る。終わりぎわは点滅して、時間がきたら消える
    t.hit = Math.max(0, t.hit - dt);
    t.shell.emissive.setHex(t.hit > 0 ? 0xffffff : t.owner.bulletColor);
    const left = TURRET.life - t.age;
    t.mesh.visible = left > 1.2 || Math.floor(left * 10) % 2 === 0;
    if (left <= 0) this.breakTurret(t, false);
  }

  // ミサイル (砲台・ミサイルのボタン・ハイミサイル。動きは m.spec)。打ち上げ (boost) のあいだはまっすぐ飛び、そのあとは
  // 撃ったときの相手のほうへ、毎秒 spec.turn ずつ向きを変えて追う (ねらいがつくまでは、相手が近いほど速く向き直る: MISSILE_SWING)。
  // ねらいがついたあとで相手を通り過ぎたら、もう追わない (MISSILE_AIM)
  updateMissile(m, dt) {
    if (m.dead) return;
    const spec = m.spec;
    const target = m.target;
    if (m.age > spec.life) {
      this.explode(m, spec.blast, spec.damage, 'missile');
      return;
    }
    m.speed = Math.min(spec.speed[1], m.speed + spec.accel * dt);
    if (target?.alive && m.age >= (spec.boost ?? 0) && !m.passed) {
      const want = this.probe.copy(target.center).sub(m.pos);
      const dist = Math.max(want.length(), 1);
      want.normalize();
      const angle = m.dir.angleTo(want);
      if (m.aimed && angle > Math.PI / 2) {
        m.passed = true; // 相手を通り過ぎた
      } else {
        if (angle < MISSILE_AIM) m.aimed = true;
        const turn = spec.turn * m.owner.assist.aim; // 撃ったロボの助け (assist.aim) の倍
        const rate = m.aimed ? turn : Math.max(turn, m.speed / (MISSILE_SWING * dist));
        turnToward(m.dir, want, rate * dt);
      }
    }
    // 細かく区切って進め、相手・床・箱・壁に当たったら爆発する
    const steps = Math.ceil((m.speed * dt) / 0.4);
    const step = (m.speed * dt) / steps;
    for (let i = 0; i < steps; i++) {
      m.pos.addScaledVector(m.dir, step);
      const came = this.probe.copy(m.pos).addScaledVector(m.dir, -2);
      const hit = m.owner.foes.some((foe) => foe.alive && distanceToRobot(m.pos, foe) < HIT_RADIUS + 0.1 + foe.guardReach(came));
      // 打ち上げで高く上がるので、壁の高さより上でも、闘技場の真上なら飛び続ける
      const away = Math.abs(m.pos.x) > this.arena.half || Math.abs(m.pos.z) > this.arena.half || m.pos.y > MISSILE_CEILING;
      if (hit || m.pos.y <= this.arena.groundAt(m.pos.x, m.pos.z, m.pos.y) || this.arena.blockAt(m.pos) || away) {
        this.explode(m, spec.blast, spec.damage, 'missile');
        return;
      }
    }
    m.mesh.position.copy(m.pos);
    m.mesh.lookAt(this.probe.copy(m.pos).add(m.dir));
    // 煙の尾
    m.trail -= dt;
    if (m.trail <= 0) {
      m.trail = 0.05;
      this.effects.puff(m.pos, MISSILE_TRAIL);
    }
  }

  // 核ミサイル: 背中から真上へ打ち上げ (rise) → 警告の輪が相手の足元についていく (track) → 輪が止まり、空から光の柱が立つ (lock) →
  // 最後の fall 秒で、輪の真上から先を下にして落ちてきて大爆発 (explodeNuke)
  updateNuke(n, dt) {
    if (n.dead) return;
    const t = n.age;
    const lockAt = NUKE.rise + NUKE.track;
    const hitAt = lockAt + NUKE.lock;
    const target = n.target;
    if (t < lockAt && target?.alive && target.state !== 'fall') {
      const k = Math.min(1, dt * NUKE.follow);
      n.land.x += (target.pos.x - n.land.x) * k;
      n.land.z += (target.pos.z - n.land.z) * k;
      n.land.y = Math.max(0, this.arena.groundAt(n.land.x, n.land.z, Math.max(target.pos.y, 0) + 0.5));
    }
    if (!n.locked && t >= lockAt) {
      n.locked = true; // 輪が止まった (ai.js は、ここから逃げ始める)
      n.lockedAt = t;
      this.sfx.nukeWarn();
    }
    // 警告の輪: 出るときは広がり、点滅する (止まったら速く)。止まったら、輪の真ん中に空から光の柱
    const blink = Math.floor(t * (n.locked ? 10 : 4)) % 2 === 0;
    n.ring.position.set(n.land.x, n.land.y + 0.05, n.land.z);
    n.ring.scale.setScalar(NUKE.blast * (0.15 + 0.85 * Math.min(1, t / 0.3)));
    n.ringMaterials.edge.opacity = blink ? 1 : 0.5;
    n.ringMaterials.fill.opacity = n.locked ? (blink ? 0.24 : 0.14) : 0.1;
    n.beam.visible = n.locked;
    n.beam.position.copy(n.ring.position);
    n.ringMaterials.beam.opacity = blink ? 0.6 : 0.3;
    // ミサイル: 打ち上げは速くなりながら真上へ (煙を引く)。見えなくなってから、落ちるときに輪の真上へ現れる
    if (t < NUKE.rise) {
      n.speed += 70 * dt;
      n.pos.y += n.speed * dt;
      n.mesh.rotation.set(0, 0, 0);
      n.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
      n.trail -= dt;
      if (n.trail <= 0) {
        n.trail = 0.04;
        this.effects.puff(n.pos, NUKE_TRAIL);
      }
    } else if (t < hitAt - NUKE.fall) {
      n.mesh.visible = false;
    } else if (t < hitAt) {
      const k = (t - (hitAt - NUKE.fall)) / NUKE.fall;
      n.pos.set(n.land.x, n.land.y + NUKE.height * (1 - k * k), n.land.z);
      n.mesh.rotation.set(Math.PI, 0, 0);
      n.mesh.visible = true;
    } else {
      this.explodeNuke(n);
    }
  }

  // 核ミサイルの大爆発。輪の中 (半径 NUKE.blast) の相手全員に、真ん中に近いほど大きなダメージ (必ずダウン。シールドでは防げない)。
  // 中にある相手の砲台は壊れ、もろい床にはひびが入る
  explodeNuke(n) {
    n.dead = true;
    const owner = n.owner;
    const rate = owner.attackRate;
    const center = new THREE.Vector3(n.land.x, n.land.y + 1, n.land.z);
    for (const foe of owner.foes) {
      const d = distanceToRobot(center, foe);
      if (!foe.alive || d >= NUKE.blast) continue;
      const damage = Math.round(NUKE.damage * rate * (1 - (NUKE.falloff * d) / NUKE.blast));
      foe.takeHit({ damage, knockdown: true, from: center, cause: 'nuke', pierce: true, by: owner });
    }
    for (const other of this.items) {
      if (other.kind === 'turret' && !other.dead && owner.isFoe(other.owner) && other.pos.distanceTo(center) < NUKE.blast + TURRET.reach) {
        this.breakTurret(other, true);
      }
    }
    this.arena.tiles.blast(n.land, NUKE.blast);
    this.effects.nuke(n.land, NUKE.blast);
    this.sfx.nuke();
    this.onNuke?.(n.land, NUKE.blast);
  }

  // owner の相手のうち、点 p にいちばん近い生きているロボ (foe。いなければ null) と、その体までの距離 (d)
  closestFoe(owner, p) {
    let foe = null;
    let d = Infinity;
    for (const robot of owner.foes) {
      if (!robot.alive) continue;
      const rd = distanceToRobot(p, robot);
      if (rd < d) {
        foe = robot;
        d = rd;
      }
    }
    return { foe, d };
  }

  // 点 p が砲台に当たっているか
  nearTurret(t, p) {
    return Math.hypot(p.x - t.pos.x, p.z - t.pos.z) < TURRET.reach && p.y > t.pos.y - 0.2 && p.y < t.pos.y + TURRET.height;
  }

  damageTurret(t, damage) {
    if (t.dead) return;
    t.hp -= damage;
    t.hit = 0.1;
    if (t.hp <= 0) this.breakTurret(t, true);
  }

  // 砲台を片付ける。broken: 壊された (爆発する)。時間切れなら、煙を出して消える
  breakTurret(t, broken) {
    t.dead = true;
    const center = this.probe.set(t.pos.x, t.pos.y + 0.8, t.pos.z);
    if (broken) {
      this.effects.explosion(center, 1.6, 0xffffff);
      this.sfx.boom();
      this.onTurretBroken?.(t);
    } else {
      this.effects.puff(center, { color: 0x9aa7c0, count: 8, speed: 1.5, rise: 0.8, size: 0.7, life: 0.6 });
    }
  }

  // 爆発。爆風の中にいる相手全員に、中心に近いほど大きなダメージ (必ずダウン)。爆風の中にある相手の砲台にもダメージ。
  // シールドで防げるかは、ミサイルは飛んできた向き、ほかは爆発したところで決める (足元に落ちたグレネードは防げない)。
  // 爆風が届く床のもろい床には、ひびが入る (ひびが入っていれば割れて穴になる: tiles.js の blast)
  explode(item, radius, damage, cause) {
    item.dead = true;
    const owner = item.owner;
    const rate = owner.attackRate;
    const at = item.kind === 'missile' ? this.probe.copy(item.pos).addScaledVector(item.dir, -2) : item.pos;
    for (const foe of owner.foes) {
      const d = distanceToRobot(item.pos, foe);
      if (!foe.alive || d >= radius) continue;
      foe.takeHit({ damage: Math.round(damage * rate * (1 - (0.4 * d) / radius)), knockdown: true, from: item.pos, at, cause, by: owner });
    }
    for (const other of this.items) {
      if (other.kind === 'turret' && owner.isFoe(other.owner) && other.pos.distanceTo(item.pos) < radius + TURRET.reach) {
        this.damageTurret(other, damage * rate);
      }
    }
    this.arena.tiles.blast(item.pos, radius);
    this.effects.explosion(item.pos, radius, item.owner.bulletColor);
    this.sfx.boom();
    this.onExplode?.(item.pos, radius);
  }

  // ブレイク。robot が出していた飛び道具を、害なく消す (砲台とお助けロボと核ミサイルは残す)
  breakShots(robot) {
    for (const item of this.items) {
      if (item.owner !== robot || item.dead || item.kind === 'turret' || item.kind === 'helper' || item.kind === 'nuke') continue;
      item.dead = true;
      this.effects.burst(item.pos, 0xffffff, 6, 2);
    }
    this.onBreak?.(robot);
  }

  // 決着がついたとき、飛んでいるものを害なく消す
  fizzle() {
    for (const item of this.items) {
      this.effects.burst(item.pos, 0xffffff, 6, 2);
      this.remove(item);
    }
    this.items = [];
  }

  remove(item) {
    this.scene.remove(item.mesh);
    if (item.marker) {
      this.scene.remove(item.marker);
      item.marker.material.dispose();
    }
    if (item.kind === 'pod') item.mesh.material.dispose();
    if (item.kind === 'turret' || item.kind === 'helper') item.shell.dispose();
    if (item.streak) {
      // ビームの光の帯は、最後の場所までのばしてから、少しずつ薄くして消す (effects.js が片付ける)
      this.stretchStreak(item);
      this.effects.fadeOut(item.streak, BEAM_STREAK.fade);
    }
    if (item.kind === 'nuke') {
      this.scene.remove(item.ring, item.beam);
      for (const material of [...item.materials, ...Object.values(item.ringMaterials)]) material.dispose();
    }
  }

  clear() {
    for (const item of this.items) this.remove(item);
    this.items = [];
  }
}
