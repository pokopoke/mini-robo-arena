import * as THREE from 'three';
import { easeOutBack } from './entrance.js';
import { BARRIER_COLOR } from './robot.js';
import { distanceToRobot } from './weapons.js';

// アイテム。戦っている間、闘技場の決まった場所 (arenas.js の items) のどこかにときどき現れ、ロボが触れると効く。
// しばらく取られないと点滅して消える。種類は heal (体力をもどす) / power (しばらく与えるダメージが増える: robot.js の powerUp) /
// missile (拾った場所にミサイル砲台が立つ: weapons.js の placeTurret) / helper (お助けロボが来て、しばらく相手を撃つ:
// weapons.js の callHelper) / barrier (バリアを張る: robot.js の shieldUp)。CPU も取りに行く (ai.js)
export const ITEM_KINDS = {
  heal: { name: '回復', color: 0x52ff8f },
  power: { name: 'パワーアップ', color: 0xffd23f },
  missile: { name: 'ミサイル砲台', color: 0xff5a7a },
  helper: { name: 'お助けロボ', color: 0xb98cff },
  barrier: { name: 'バリア', color: BARRIER_COLOR },
};
const HEAL_AMOUNT = 200; // 回復する体力
const POWER_TIME = 10; // パワーアップが続く時間 (秒)
const BARRIER_AMOUNT = 150; // バリアが防げるダメージの合計
const BARRIER_TIME = 10; // バリアが消えるまで (秒)
const ITEM_FIRST = 4; // 戦い始めてから、最初のアイテムが出るまで (秒)
const ITEM_EVERY = [8, 12]; // そのあと、次のアイテムが出るまで (秒)
const ITEM_MAX = 2; // 同時に出ている数の上限
const ITEM_LIFE = 15; // 取られないと消えるまで (秒)
const ITEM_BLINK = 3; // 消える前に点滅する時間 (秒)
const ITEM_REACH = 1.3; // ロボの体からこの距離 (m) まで近づくと取れる
const ITEM_KEEP = 5; // ロボからこれより近い場所には出さない (m)
const ITEM_HOVER = 1.2; // 形が浮かぶ高さ (m)
const ITEM_SIZE = 1.3; // 形の大きさの倍率 (スマホの小さな画面でも見分けられるように)
const ITEM_GROW = 0.35; // 現れるときに大きくなる時間 (秒)

// 種類ごとの形 (ロボと同じ角ばった形)。回復は十字 (どの向きから見ても十字に見えるよう3方向にのばす)、
// パワーアップは上向きの矢印、ミサイルは先のとがった筒と羽、お助けロボはアンテナと耳のついた丸い頭、バリアは六角の盾。[形, 位置, 回転]
function iconShapes() {
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  return {
    helper: [
      [new THREE.IcosahedronGeometry(0.3, 0), [0, -0.05, 0]],
      [new THREE.CylinderGeometry(0.02, 0.02, 0.2, 4), [0, 0.33, 0]],
      [new THREE.OctahedronGeometry(0.07), [0, 0.46, 0]],
      [box(0.12, 0.2, 0.2), [-0.34, -0.05, 0]],
      [box(0.12, 0.2, 0.2), [0.34, -0.05, 0]],
    ],
    barrier: [
      [new THREE.CylinderGeometry(0.42, 0.42, 0.08, 6), [0, 0, 0], [Math.PI / 2, 0, 0]],
      [new THREE.CylinderGeometry(0.16, 0.16, 0.18, 6), [0, 0, 0], [Math.PI / 2, 0, 0]],
    ],
    heal: [[box(0.7, 0.24, 0.24)], [box(0.24, 0.7, 0.24)], [box(0.24, 0.24, 0.7)]],
    power: [
      [new THREE.ConeGeometry(0.36, 0.4, 4), [0, 0.18, 0], [0, Math.PI / 4, 0]],
      [box(0.2, 0.42, 0.2), [0, -0.2, 0]],
    ],
    missile: [
      [new THREE.CylinderGeometry(0.13, 0.13, 0.5, 6), [0, -0.05, 0]],
      [new THREE.ConeGeometry(0.13, 0.26, 6), [0, 0.33, 0]],
      [box(0.44, 0.18, 0.04), [0, -0.24, 0]],
      [box(0.04, 0.18, 0.44), [0, -0.24, 0]],
    ],
  };
}

// 光の柱 (下ほど明るい)。遠くからでもアイテムのある場所がわかるように
function beamGeometry(height) {
  const geometry = new THREE.CylinderGeometry(0.5, 0.5, height, 6, 1, true).translate(0, height / 2, 0);
  const position = geometry.attributes.position;
  const colors = [];
  for (let i = 0; i < position.count; i++) colors.push(1, 1, 1, 0.4 * (1 - position.getY(i) / height));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  return geometry;
}

export class Items {
  constructor(scene, arena, weapons, effects, sfx) {
    this.scene = scene;
    this.arena = arena;
    this.weapons = weapons;
    this.effects = effects;
    this.sfx = sfx;
    this.list = [];
    this.wait = ITEM_FIRST; // 次のアイテムが出るまで (秒)
    this.onPick = null; // 取ったときに呼ぶ (ロボ, アイテム, 回復した量)。main.js が文字を出す
    this.shapes = iconShapes();
    this.ring = new THREE.RingGeometry(0.75, 0.95, 6).rotateX(-Math.PI / 2);
    this.beam = beamGeometry(3.2);
    this.materials = {};
    for (const [kind, { color }] of Object.entries(ITEM_KINDS)) {
      const glow = { color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
      this.materials[kind] = {
        icon: new THREE.MeshLambertMaterial({ color: 0x1b2230, emissive: color, emissiveIntensity: 0.9, flatShading: true }),
        ring: new THREE.MeshBasicMaterial({ ...glow, opacity: 0.8 }),
        beam: new THREE.MeshBasicMaterial({ ...glow, vertexColors: true, side: THREE.DoubleSide }),
      };
    }
    this.tmp = new THREE.Vector3();
  }

  // 空いている場所 (ロボ・ほかのアイテム・砲台から離れたところ) のどこかに出す。種類は、いま出ていないものから選ぶ
  spawn(robots) {
    const taken = [...this.list, ...this.weapons.items.filter((w) => w.kind === 'turret')];
    const spots = (this.arena.def.items ?? []).filter(([x, z]) =>
      taken.every((other) => Math.hypot(other.pos.x - x, other.pos.z - z) > 1.5)
      && robots.every((robot) => Math.hypot(robot.pos.x - x, robot.pos.z - z) > ITEM_KEEP));
    if (!spots.length) return null;
    const [x, z] = spots[Math.floor(Math.random() * spots.length)];
    const kinds = Object.keys(ITEM_KINDS).filter((kind) => this.list.every((item) => item.kind !== kind));
    return this.add(kinds[Math.floor(Math.random() * kinds.length)], x, z);
  }

  // kind のアイテムを (x, z) に出す。高さはその場所のいちばん上の面 (床か箱の上)
  add(kind, x, z) {
    const pos = new THREE.Vector3(x, this.arena.groundAt(x, z, 100), z);
    const materials = this.materials[kind];
    const group = new THREE.Group();
    group.position.copy(pos);
    group.scale.setScalar(0.01);
    const icon = new THREE.Group();
    for (const [geometry, [px, py, pz] = [0, 0, 0], [rx, ry, rz] = [0, 0, 0]] of this.shapes[kind]) {
      const mesh = new THREE.Mesh(geometry, materials.icon);
      mesh.position.set(px, py, pz);
      mesh.rotation.set(rx, ry, rz);
      icon.add(mesh);
    }
    icon.position.y = ITEM_HOVER;
    icon.scale.setScalar(ITEM_SIZE);
    const ring = new THREE.Mesh(this.ring, materials.ring);
    ring.position.y = 0.04;
    group.add(icon, ring, new THREE.Mesh(this.beam, materials.beam));
    this.scene.add(group);
    const item = { kind, pos, group, icon, age: 0, dead: false };
    this.list.push(item);
    this.effects.burst(this.tmp.set(x, pos.y + ITEM_HOVER, z), ITEM_KINDS[kind].color, 12, 3);
    this.sfx.itemAppear();
    return item;
  }

  // robots: [you, cpu] / active: 戦っている (このときだけ、アイテムが現れて取れる)
  update(dt, robots, active) {
    for (const item of this.list) {
      item.age += dt;
      item.group.scale.setScalar(Math.max(0.01, easeOutBack(Math.min(1, item.age / ITEM_GROW))));
      item.icon.rotation.y += dt * 2.2;
      item.icon.position.y = ITEM_HOVER + Math.sin(item.age * 3) * 0.12;
      const left = ITEM_LIFE - item.age;
      item.group.visible = left > ITEM_BLINK || Math.floor(left * 8) % 2 === 0;
      if (left <= 0) {
        this.remove(item, true);
      } else if (active) {
        // 倒れているロボは取れない
        const at = this.tmp.set(item.pos.x, item.pos.y + ITEM_HOVER, item.pos.z);
        const robot = robots.find((r) => r.alive && !r.down && distanceToRobot(at, r) < ITEM_REACH);
        if (robot) this.take(item, robot);
      }
    }
    this.list = this.list.filter((item) => !item.dead);
    if (!active) return;
    this.wait -= dt;
    if (this.wait <= 0) {
      this.wait = ITEM_EVERY[0] + Math.random() * (ITEM_EVERY[1] - ITEM_EVERY[0]);
      if (this.list.length < ITEM_MAX) this.spawn(robots);
    }
  }

  // robot がアイテムを取った
  take(item, robot) {
    let healed = 0;
    if (item.kind === 'heal') healed = robot.heal(HEAL_AMOUNT);
    else if (item.kind === 'power') robot.powerUp(POWER_TIME);
    else if (item.kind === 'helper') this.weapons.callHelper(robot);
    else if (item.kind === 'barrier') robot.shieldUp(BARRIER_AMOUNT, BARRIER_TIME);
    else this.weapons.placeTurret(robot, item.pos);
    this.effects.burst(this.tmp.set(item.pos.x, item.pos.y + ITEM_HOVER, item.pos.z), ITEM_KINDS[item.kind].color, 24, 5);
    this.sfx.pickup(item.kind);
    this.onPick?.(robot, item, healed);
    this.remove(item);
  }

  // 片付ける。puff: 消えるときに光の粒を出す (時間切れや決着のとき)
  remove(item, puff = false) {
    item.dead = true;
    this.scene.remove(item.group);
    if (puff) this.effects.burst(this.tmp.set(item.pos.x, item.pos.y + ITEM_HOVER, item.pos.z), 0xffffff, 8, 2);
  }

  // 決着がついたとき、残っているアイテムを消す
  fizzle() {
    for (const item of this.list) this.remove(item, true);
    this.list = [];
  }

  // 全部片付けて、最初のアイテムが出るまでの時間を戻す (試合の始まりや、ほかの画面へ行くとき)
  clear() {
    for (const item of this.list) this.remove(item);
    this.list = [];
    this.wait = ITEM_FIRST;
  }
}
