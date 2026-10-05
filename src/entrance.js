import * as THREE from 'three';

// 試合の始まりの演出。ロボの入った箱が空から落ちてきて、着地したあと光りながらふるえ、はじけてロボが現れる。
// 2台目は少し遅れて落ちる。update(t) には READY になってからの時間 (秒) を渡す
const CUBE_SIZE = 1.8;
const DROP_HEIGHT = 16; // 落ち始める高さ (m)
const DROP_TIME = 0.65; // 着地するまで (秒)
const OPEN_AT = 1.3; // 箱がはじける時刻 (秒)
const GROW_TIME = 0.32; // ロボが大きくなって現れるまで (秒)
const STAGGER = 0.2; // 2台目が遅れる時間 (秒)

// 0 → 1 で、少し行きすぎてから戻る (items.js でも使う)
export function easeOutBack(t) {
  const c = 1.70158;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

export class Entrance {
  constructor(scene, effects, sfx) {
    this.scene = scene;
    this.effects = effects;
    this.sfx = sfx;
    this.geometry = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
    this.edges = new THREE.EdgesGeometry(this.geometry);
    this.items = [];
    this.onLand = null; // 箱が着地したときに呼ぶ (ロボ)。main.js が画面を揺らす
  }

  start(robots) {
    this.clear();
    robots.forEach((robot, i) => {
      const material = new THREE.MeshLambertMaterial({ color: 0x1b2230, emissive: robot.bulletColor, emissiveIntensity: 0.2 });
      const cube = new THREE.Mesh(this.geometry, material);
      cube.add(new THREE.LineSegments(this.edges, new THREE.LineBasicMaterial({ color: robot.bulletColor })));
      this.scene.add(cube);
      robot.root.visible = false;
      robot.root.scale.setScalar(1);
      this.items.push({ robot, cube, delay: i * STAGGER, landed: false, opened: false });
    });
    this.update(0);
  }

  update(time) {
    for (const item of this.items) {
      const { robot, cube } = item;
      const t = time - item.delay;
      if (!item.opened) {
        const k = THREE.MathUtils.clamp(t / DROP_TIME, 0, 1);
        cube.position.set(robot.pos.x, robot.pos.y + CUBE_SIZE / 2 + DROP_HEIGHT * (1 - k * k), robot.pos.z);
        cube.rotation.y = robot.yaw + (1 - k) * 2.5;
        if (k >= 1 && !item.landed) {
          item.landed = true;
          this.effects.puff(new THREE.Vector3(robot.pos.x, robot.pos.y + 0.15, robot.pos.z), {
            color: 0x9aa7c0, count: 14, speed: 4, rise: 0.5, size: 0.9, life: 0.8,
          });
          this.sfx.land();
          this.onLand?.(robot);
        }
        if (item.landed) {
          // はじける前は光が強くなり、最後は小刻みにふるえる
          const charge = THREE.MathUtils.clamp((t - DROP_TIME) / (OPEN_AT - DROP_TIME), 0, 1);
          cube.material.emissiveIntensity = 0.2 + 0.8 * charge;
          if (charge > 0.5) {
            cube.position.x += (Math.random() - 0.5) * 0.08;
            cube.position.z += (Math.random() - 0.5) * 0.08;
          }
        }
        if (t >= OPEN_AT) this.open(item);
      }
      if (item.opened) {
        const g = THREE.MathUtils.clamp((t - OPEN_AT) / GROW_TIME, 0, 1);
        robot.root.scale.setScalar(0.2 + 0.8 * easeOutBack(g));
      }
    }
  }

  open(item) {
    item.opened = true;
    const center = item.cube.position.clone();
    this.removeCube(item);
    this.effects.shatter(center, CUBE_SIZE, item.robot.bulletColor);
    this.effects.explosion(center, 1.6, 0xffffff);
    this.sfx.open();
    item.robot.root.visible = true;
    item.robot.root.scale.setScalar(0.2);
  }

  // 演出を終わらせて、ロボをふつうの大きさで出す (試合が始まるとき)
  finish() {
    for (const item of this.items) {
      if (!item.opened) this.open(item);
      item.robot.root.scale.setScalar(1);
    }
    this.items = [];
  }

  // 演出を途中でやめる (箱を消し、ロボを元に戻す)
  clear() {
    for (const item of this.items) {
      if (!item.opened) this.removeCube(item);
      item.robot.root.scale.setScalar(1);
      item.robot.root.visible = true;
    }
    this.items = [];
  }

  removeCube(item) {
    this.scene.remove(item.cube);
    item.cube.material.dispose();
    item.cube.children[0].material.dispose();
  }
}
