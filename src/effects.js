import * as THREE from 'three';

// 演出: 光の粒 (当たったとき・倒れたとき)、爆発 (広がって消える光の球)、煙やほこり (光らない粒)、
// 飛び散る板 (登場のときに箱がはじける)、ブレードで斬った跡 (光る弧) と突いた跡 (前へのびる光)、核の大爆発 (火の玉・衝撃波・キノコ雲)、
// 薄くなって消える光 (ビームの光の帯)
const BURST_LIFE = 0.6; // (秒)
const EXPLOSION_LIFE = 0.45; // (秒)
const SHARD_LIFE = 0.9; // (秒)
const SLASH_LIFE = 0.2; // (秒)
const NUKE_LIFE = 3.4; // 核の大爆発の演出が消えるまで (秒)

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.sphere = new THREE.IcosahedronGeometry(1, 1); // 爆発の球も角ばった多面体
  }

  burst(at, color, count = 14, speed = 5) {
    this.items.push(new Burst(this.scene, at, color, count, speed));
  }

  explosion(at, radius, color) {
    this.items.push(new Explosion(this.scene, this.sphere, at, radius, color));
    this.burst(at, color, 30, radius * 3);
  }

  // 煙やほこり。speed: 横に広がる速さ / rise: 上へのぼる速さ / size: 粒の大きさ / life: 消えるまで (秒)
  puff(at, { color = 0x3a4250, count = 6, speed = 1.2, rise = 1.5, size = 0.7, life = 0.9 } = {}) {
    this.items.push(new Puff(this.scene, at, color, count, speed, rise, size, life));
  }

  // 箱 (一辺 size) がはじけて、6枚の板が飛び散る
  shatter(at, size, color) {
    this.items.push(new Shards(this.scene, at, size, color));
  }

  // ブレードで斬った跡。at: 弧の中心 (肩の高さ) / yaw: ロボの向き / downward: 斜めに振り下ろした (3回目と急降下斬り)
  slash(at, yaw, downward, color) {
    this.items.push(new SlashArc(this.scene, at, yaw, downward, color));
  }

  // 突きの跡。at: ロボの肩の高さの位置 / yaw: ロボの向き。前へのびる細い光
  stab(at, yaw, color) {
    this.items.push(new StabTrail(this.scene, at, yaw, color));
  }

  // もう場面に置いてある光 (mesh。材質はその光だけのもの) を、life 秒で薄くして片付ける (ビームの光の帯)
  fadeOut(mesh, life) {
    this.items.push(new FadeOut(this.scene, mesh, life));
  }

  // 核の大爆発 (weapons.js の核ミサイル)。at: 床の上の爆心 / radius: 爆風の半径
  nuke(at, radius) {
    this.items.push(new NukeBlast(this.scene, this.sphere, at, radius));
    this.burst(new THREE.Vector3(at.x, at.y + 1.5, at.z), 0xffd27a, 60, radius * 3);
  }

  update(dt) {
    this.items = this.items.filter((item) => item.update(dt));
  }

  clear() {
    for (const item of this.items) item.dispose();
    this.items = [];
  }
}

// 薄くなって消える光。形はほかでも使うので片付けず、材質だけ片付ける
class FadeOut {
  constructor(scene, mesh, life) {
    this.scene = scene;
    this.mesh = mesh;
    this.life = life;
    this.left = life;
    this.opacity = mesh.material.opacity;
  }

  update(dt) {
    this.left -= dt;
    this.mesh.material.opacity = this.opacity * Math.max(this.left / this.life, 0);
    if (this.left > 0) return true;
    this.dispose();
    return false;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.material.dispose();
  }
}

class Burst {
  constructor(scene, at, color, count, speed) {
    const positions = new Float32Array(count * 3);
    this.velocities = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = at.x;
      positions[i * 3 + 1] = at.y;
      positions[i * 3 + 2] = at.z;
      const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 1.6 - 0.3, Math.random() * 2 - 1).normalize();
      this.velocities.push(v.multiplyScalar(speed * (0.4 + Math.random() * 0.6)));
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.material = new THREE.PointsMaterial({
      color,
      size: 0.3,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.scene = scene;
    scene.add(this.points);
    this.life = BURST_LIFE;
  }

  update(dt) {
    this.life -= dt;
    const pos = this.geometry.attributes.position;
    this.velocities.forEach((v, i) => {
      v.y -= 9 * dt;
      pos.setXYZ(i, pos.getX(i) + v.x * dt, pos.getY(i) + v.y * dt, pos.getZ(i) + v.z * dt);
    });
    pos.needsUpdate = true;
    this.material.opacity = Math.max(this.life / BURST_LIFE, 0);
    if (this.life > 0) return true;
    this.dispose();
    return false;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}

// 煙やほこりの粒の形 (ふちがぼやけた丸)。はじめて使うときに作って使い回す
let softDot = null;
function softDotTexture() {
  if (!softDot) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = canvas.getContext('2d');
    const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.6)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 64, 64);
    softDot = new THREE.CanvasTexture(canvas);
  }
  return softDot;
}

// 煙やほこり。光らない丸い粒が広がりながら薄くなる
class Puff {
  constructor(scene, at, color, count, speed, rise, size, life) {
    const positions = new Float32Array(count * 3);
    this.velocities = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = at.x + (Math.random() - 0.5) * 0.3;
      positions[i * 3 + 1] = at.y;
      positions[i * 3 + 2] = at.z + (Math.random() - 0.5) * 0.3;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.5 + Math.random() * 0.5);
      this.velocities.push(new THREE.Vector3(Math.cos(a) * s, rise * (0.6 + Math.random() * 0.4), Math.sin(a) * s));
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.material = new THREE.PointsMaterial({ color, size, map: softDotTexture(), transparent: true, opacity: 0.6, depthWrite: false });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.scene = scene;
    scene.add(this.points);
    this.size = size;
    this.life = life;
    this.left = life;
  }

  update(dt) {
    this.left -= dt;
    const pos = this.geometry.attributes.position;
    this.velocities.forEach((v, i) => {
      v.multiplyScalar(Math.max(0, 1 - dt * 1.5)); // だんだん遅くなる
      pos.setXYZ(i, pos.getX(i) + v.x * dt, pos.getY(i) + v.y * dt, pos.getZ(i) + v.z * dt);
    });
    pos.needsUpdate = true;
    const t = 1 - Math.max(this.left, 0) / this.life;
    this.material.size = this.size * (1 + t); // 広がりながら
    this.material.opacity = 0.6 * (1 - t); // 薄くなる
    if (this.left > 0) return true;
    this.dispose();
    return false;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}

// 箱の6つの面が、回りながら外へ飛び散る
class Shards {
  constructor(scene, at, size, color) {
    this.scene = scene;
    this.geometry = new THREE.BoxGeometry(size * 0.92, size * 0.92, 0.08);
    this.material = new THREE.MeshLambertMaterial({ color: 0x1b2230, emissive: color, emissiveIntensity: 0.6, transparent: true });
    // 面の向き (外向き) と、その面の板の回し方
    const faces = [
      [new THREE.Vector3(1, 0, 0), [0, Math.PI / 2, 0]],
      [new THREE.Vector3(-1, 0, 0), [0, Math.PI / 2, 0]],
      [new THREE.Vector3(0, 1, 0), [Math.PI / 2, 0, 0]],
      [new THREE.Vector3(0, -1, 0), [Math.PI / 2, 0, 0]],
      [new THREE.Vector3(0, 0, 1), [0, 0, 0]],
      [new THREE.Vector3(0, 0, -1), [0, 0, 0]],
    ];
    this.pieces = faces.map(([n, [rx, ry, rz]]) => {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.position.copy(at).addScaledVector(n, size / 2);
      mesh.rotation.set(rx, ry, rz);
      scene.add(mesh);
      const vel = n.clone().multiplyScalar(6 + Math.random() * 3);
      vel.y += 3 + Math.random() * 3;
      const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14);
      return { mesh, vel, spin };
    });
    this.left = SHARD_LIFE;
  }

  update(dt) {
    this.left -= dt;
    for (const piece of this.pieces) {
      piece.vel.y -= 20 * dt;
      piece.mesh.position.addScaledVector(piece.vel, dt);
      piece.mesh.rotation.x += piece.spin.x * dt;
      piece.mesh.rotation.y += piece.spin.y * dt;
      piece.mesh.rotation.z += piece.spin.z * dt;
    }
    this.material.opacity = Math.max(this.left / SHARD_LIFE, 0);
    if (this.left > 0) return true;
    this.dispose();
    return false;
  }

  dispose() {
    for (const piece of this.pieces) this.scene.remove(piece.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}

// 斬った跡の弧の形 [横に振った, 斜めに振り下ろした]。前が +z。はじめて使うときに作って使い回す
let slashShapes = null;
function slashGeometry(downward) {
  if (!slashShapes) {
    // 横: ロボのまわりの水平な弧 (前を中心に左右へ) /
    // 振り下ろし: 頭の上の後ろから前の足元までの縦の弧を、右上から左下へ傾ける (真後ろのカメラからも見えるように)
    const flat = new THREE.RingGeometry(1.4, 2.4, 16, 1, -Math.PI / 2 - 1.1, 2.2).rotateX(-Math.PI / 2);
    const down = new THREE.RingGeometry(1.4, 2.4, 16, 1, -0.5, 2.7).rotateY(-Math.PI / 2).rotateZ(0.7);
    slashShapes = [flat, down];
  }
  return slashShapes[downward ? 1 : 0];
}

// ブレードで斬った跡。光る弧が少し広がりながら消える
class SlashArc {
  constructor(scene, at, yaw, downward, color) {
    this.material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(slashGeometry(downward), this.material);
    this.mesh.position.copy(at);
    this.mesh.rotation.y = yaw;
    this.scene = scene;
    scene.add(this.mesh);
    this.left = SLASH_LIFE;
  }

  update(dt) {
    this.left -= dt;
    const t = 1 - Math.max(this.left, 0) / SLASH_LIFE;
    this.mesh.scale.setScalar(1 + 0.15 * t);
    this.material.opacity = 0.75 * (1 - t);
    if (this.left > 0) return true;
    this.dispose();
    return false;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.material.dispose();
  }
}

// 突きの跡の形 (前 +z へ細長くのびた八面体)。はじめて使うときに作って使い回す
let stabShape = null;

// 突きの跡。ロボの前に細い光の槍が出て、前へのびながら消える
class StabTrail {
  constructor(scene, at, yaw, color) {
    stabShape ??= new THREE.OctahedronGeometry(1, 0).scale(0.16, 0.16, 1.5).translate(0, 0, 1.9);
    this.material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(stabShape, this.material);
    this.mesh.position.copy(at);
    this.mesh.rotation.y = yaw;
    this.scene = scene;
    scene.add(this.mesh);
    this.left = SLASH_LIFE;
  }

  update(dt) {
    this.left -= dt;
    const t = 1 - Math.max(this.left, 0) / SLASH_LIFE;
    this.mesh.scale.set(1 - 0.5 * t, 1 - 0.5 * t, 1 + 0.4 * t);
    this.material.opacity = 0.85 * (1 - t);
    if (this.left > 0) return true;
    this.dispose();
    return false;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.material.dispose();
  }
}

// 爆発の光の球。一気に広がって薄くなる
class Explosion {
  constructor(scene, geometry, at, radius, color) {
    this.material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.copy(at);
    this.radius = radius;
    this.scene = scene;
    scene.add(this.mesh);
    this.life = EXPLOSION_LIFE;
  }

  update(dt) {
    this.life -= dt;
    const t = 1 - Math.max(this.life, 0) / EXPLOSION_LIFE;
    this.mesh.scale.setScalar(this.radius * (0.3 + 0.7 * Math.sqrt(t)));
    this.material.opacity = 0.8 * (1 - t);
    if (this.life > 0) return true;
    this.dispose();
    return false;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.material.dispose();
  }
}

// 核の大爆発。白い火の玉が一気に広がって橙に変わりながら消え、地面を衝撃波の輪が走る。
// キノコ雲 (くき・かさ・根元の土けむり。角ばった玉の集まり) がのぼって広がりながら、熱い橙から灰色に冷め、最後に薄くなって消える
class NukeBlast {
  constructor(scene, sphere, at, radius) {
    this.scene = scene;
    this.radius = radius;
    this.age = 0;
    this.group = new THREE.Group();
    this.group.position.copy(at);
    scene.add(this.group);
    const additive = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    this.fireMaterial = additive(0xfff4d0, 1);
    this.fire = new THREE.Mesh(sphere, this.fireMaterial);
    this.fire.position.y = 1;
    this.ringGeometry = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
    this.ringMaterial = additive(0xffe2a8, 0.9);
    this.ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
    this.ring.position.y = 0.15;
    this.cloudMaterial = new THREE.MeshLambertMaterial({
      color: 0x6e6058, emissive: 0xff7424, emissiveIntensity: 1.2, transparent: true, opacity: 0.95, flatShading: true, depthWrite: false,
    });
    this.cloud = new THREE.Group();
    this.group.add(this.fire, this.ring, this.cloud);
    // 雲の玉。kind: 'stem' (くき。上へのびる) / 'cap' (かさ。外へ少し広がる) / 'base' (根元の土けむり。外へ大きく広がる)
    this.blobs = [];
    const blob = (x, y, z, size, kind) => {
      const mesh = new THREE.Mesh(sphere, this.cloudMaterial);
      mesh.position.set(x, y, z);
      mesh.scale.setScalar(size);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      this.cloud.add(mesh);
      this.blobs.push({ mesh, base: new THREE.Vector3(x, y, z), kind });
    };
    for (let i = 0; i < 5; i++) blob((Math.random() - 0.5) * 0.4, 0.6 + i * 0.85, (Math.random() - 0.5) * 0.4, 0.8 - i * 0.06, 'stem');
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      blob(Math.cos(a) * 1.7, 4.7 + (i % 2) * 0.3, Math.sin(a) * 1.7, 1.15, 'cap');
    }
    blob(0, 5.5, 0, 1.75, 'cap');
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) / 8) * Math.PI * 2;
      blob(Math.cos(a) * 1.3, 0.35, Math.sin(a) * 1.3, 0.85, 'base');
    }
  }

  update(dt) {
    this.age += dt;
    const t = this.age;
    const r = this.radius;
    // 火の玉: 0.3 秒で広がり、白から橙へ変わりながら 1.1 秒で消える
    const f = Math.min(1, t / 0.3);
    const heat = Math.min(1, t / 0.9);
    this.fire.scale.setScalar(r * (0.25 + 0.85 * (1 - (1 - f) ** 3)));
    this.fireMaterial.color.setRGB(1, 0.96 - 0.4 * heat, 0.82 - 0.7 * heat);
    this.fireMaterial.opacity = Math.max(0, 1 - t / 1.1);
    // 衝撃波: 0.9 秒で爆風の 3 倍ほどまで走って消える
    const w = Math.min(1, t / 0.9);
    this.ring.scale.setScalar(r * (0.3 + 2.7 * w));
    this.ringMaterial.opacity = 0.9 * (1 - w);
    // キノコ雲: のぼって広がり (くきはのび、かさと土けむりは外へ)、熱い色が冷めて、最後の 1 秒で薄くなる
    const grow = 1 - (1 - Math.min(1, t / 1.8)) ** 2;
    this.cloud.scale.setScalar((r / 6.5) * (0.7 + 1.4 * grow));
    this.cloud.position.y = 2.2 * grow;
    for (const { mesh, base, kind } of this.blobs) {
      if (kind === 'stem') mesh.position.set(base.x, base.y * (0.5 + 0.8 * grow), base.z);
      else if (kind === 'cap') mesh.position.set(base.x * (1 + 0.35 * grow), base.y * (0.6 + 0.5 * grow), base.z * (1 + 0.35 * grow));
      else mesh.position.set(base.x * (1 + 2.2 * grow), base.y, base.z * (1 + 2.2 * grow));
    }
    this.cloudMaterial.emissiveIntensity = Math.max(0, 1.2 - t * 0.65);
    this.cloudMaterial.opacity = 0.95 * Math.min(1, Math.max(0, NUKE_LIFE - t));
    if (t < NUKE_LIFE) return true;
    this.dispose();
    return false;
  }

  dispose() {
    this.scene.remove(this.group);
    this.ringGeometry.dispose();
    for (const material of [this.fireMaterial, this.ringMaterial, this.cloudMaterial]) material.dispose();
  }
}
