import * as THREE from 'three';
import { ARENAS } from './arenas.js';
import { Tiles, PIT_DEPTH } from './tiles.js';

// 闘技場 (アリーナ): マス目の床 (仕掛けのマスつき: tiles.js) と、まわりの見えない壁、身を隠す箱。
// 形と色は arenas.js のデータで決まり、load(id) で入れ替える。
// 上下に動くリフトも箱の1つとして扱う (update で高さが変わる)。箱の当たり判定は、軸にそろった直方体
const WALL_HEIGHT = 10;
const STEP_UP = 0.4; // これくらいの段差なら歩いて上がれる (m)
const EXIT_GAP = 1.4; // 穴から飛び出したロボが降りる場所の、穴のふちからの距離 (m)
const EXIT_ROOM = 0.9; // 降りる場所に空けておく半径 (m)
const SIGHT_POINT = new THREE.Vector3(); // lineOfSight で調べる点

export class Arena {
  // effects: 仕掛けのマスの演出に使う (effects.js)
  constructor(scene, effects) {
    this.scene = scene;
    this.view = null; // 今の闘技場の見た目をまとめたグループ
    this.tiles = new Tiles(this, effects);
    scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x1a1030, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(-8, 20, 12);
    scene.add(sun);
    this.load('plaza');
  }

  // 闘技場を入れ替える (知らない id なら中央広場)
  load(id) {
    this.id = ARENAS[id] ? id : 'plaza';
    const def = ARENAS[this.id];
    this.def = def;
    this.half = def.half;
    this.time = 0;
    const box = ([x, z, w, d, h]) => ({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, top: h });
    this.lifts = (def.lifts ?? []).map(([x, z, w, d, low, high, phase]) => ({ ...box([x, z, w, d, low]), low, high, phase, mesh: null }));
    this.blocks = [...def.blocks.map(box), ...this.lifts];
    if (this.view) {
      this.scene.remove(this.view);
      disposeTree(this.view);
    }
    const colors = def.colors;
    this.scene.background = new THREE.Color(colors.background);
    this.scene.fog = new THREE.Fog(colors.background, 45, 140);
    this.view = new THREE.Group();
    this.tiles.build(def, colors, this.view);
    this.buildGround(colors);
    this.buildWalls(colors);
    this.buildBlocks(colors);
    this.scene.add(this.view);
    this.update(0);
  }

  // ロボの金属に映り込む景色 (pmrem: THREE.PMREMGenerator)。下は暗い床、まわりは闘技場の光の色、上に明るい照明の板。
  // 返すのは PMREM の描画先 (使い終わったら dispose)
  makeEnvironment(pmrem) {
    const colors = this.def.colors;
    const env = new THREE.Scene();
    const sky = new THREE.SphereGeometry(10, 32, 16);
    const position = sky.attributes.position;
    const floor = new THREE.Color(colors.background).multiplyScalar(0.5);
    const glow = new THREE.Color(colors.edge);
    const top = new THREE.Color(0xd8e4ff);
    const c = new THREE.Color();
    const list = [];
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i) / 10;
      if (y < 0) c.copy(glow).multiplyScalar(0.45).lerp(floor, Math.min(1, -y * 3));
      else c.copy(glow).multiplyScalar(0.9).lerp(top, y ** 0.6);
      list.push(c.r, c.g, c.b);
    }
    sky.setAttribute('color', new THREE.Float32BufferAttribute(list, 3));
    const skyMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
    env.add(new THREE.Mesh(sky, skyMaterial));
    // 照明の板: 斜め上の白い板 (面に白い光が映る) と、後ろの闘技場の色の板 (ふちに色の光が映る)
    const panelGeometry = new THREE.PlaneGeometry(1, 1);
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const tint = new THREE.MeshBasicMaterial({ color: new THREE.Color(colors.edge).multiplyScalar(1.6), side: THREE.DoubleSide });
    for (const [material, [x, y, z], [w, h]] of [[white, [-3, 7, 5], [6, 3]], [tint, [2, 2, -8], [9, 2.5]], [tint, [-7, 1.5, -2], [2, 6]]]) {
      const panel = new THREE.Mesh(panelGeometry, material);
      panel.position.set(x, y, z);
      panel.scale.set(w, h, 1);
      panel.lookAt(0, 0, 0);
      env.add(panel);
    }
    const target = pmrem.fromScene(env, 0.02);
    for (const item of [sky, skyMaterial, panelGeometry, white, tint]) item.dispose();
    return target;
  }

  // リフトと、床の仕掛けを動かす
  update(dt) {
    this.time += dt;
    const period = this.def.liftPeriod ?? 6;
    for (const lift of this.lifts) {
      const k = 0.5 - 0.5 * Math.cos(2 * Math.PI * (this.time / period + lift.phase));
      lift.top = lift.low + (lift.high - lift.low) * k;
      lift.mesh.scale.y = lift.top;
      lift.mesh.position.y = lift.top / 2;
    }
    this.tiles.animate(dt);
  }

  // 闘技場のまわりの暗い地面 (闘技場の下はくりぬいて、床の穴の中が見えるようにする)
  buildGround(colors) {
    const corner = (x, z) => new THREE.Vector2(x, z);
    const h = this.half;
    const shape = new THREE.Shape([corner(-200, -200), corner(200, -200), corner(200, 200), corner(-200, 200)]);
    shape.holes.push(new THREE.Path([corner(-h, -h), corner(h, -h), corner(h, h), corner(-h, h)]));
    const outside = new THREE.Mesh(
      new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(colors.background).multiplyScalar(0.6) }),
    );
    outside.position.y = -0.05;
    this.view.add(outside);
  }

  buildWalls(colors) {
    // うっすら光る壁と、光る縁
    const size = this.half * 2;
    const material = new THREE.MeshBasicMaterial({
      color: colors.wall,
      transparent: true,
      opacity: 0.06,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    for (let i = 0; i < 4; i++) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(size, WALL_HEIGHT), material);
      const angle = (i * Math.PI) / 2;
      wall.position.set(Math.sin(angle) * this.half, WALL_HEIGHT / 2, Math.cos(angle) * this.half);
      wall.rotation.y = angle;
      this.view.add(wall);
    }
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(size, WALL_HEIGHT, size)),
      new THREE.LineBasicMaterial({ color: colors.edge }),
    );
    edges.position.y = WALL_HEIGHT / 2;
    this.view.add(edges);
  }

  buildBlocks(colors) {
    const material = new THREE.MeshLambertMaterial({ color: colors.block, emissive: colors.blockGlow });
    const edgeMaterial = new THREE.LineBasicMaterial({ color: colors.edge });
    const liftEdgeMaterial = new THREE.LineBasicMaterial({ color: colors.lift ?? colors.edge });
    for (const b of this.blocks) {
      const lift = this.lifts.includes(b);
      // リフトは高さ 1 の箱を縦にのばして使う (update で高さを合わせる)
      const geometry = new THREE.BoxGeometry(b.x1 - b.x0, lift ? 1 : b.top, b.z1 - b.z0);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set((b.x0 + b.x1) / 2, lift ? 0.5 : b.top / 2, (b.z0 + b.z1) / 2);
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), lift ? liftEdgeMaterial : edgeMaterial));
      this.view.add(mesh);
      if (lift) b.mesh = mesh;
    }
  }

  // (x, z) で、足元 feetY から段差 STEP_UP 以内にある一番高い床 (床 0 か箱の上。もろい床が割れた穴の上なら、穴の底)
  groundAt(x, z, feetY) {
    let ground = this.tiles.holeAt(x, z) ? -PIT_DEPTH : 0;
    for (const b of this.blocks) {
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && b.top <= feetY + STEP_UP) ground = Math.max(ground, b.top);
    }
    return ground;
  }

  // 穴 (pit: tiles.js の、割れたもろい床のマス) から飛び出したロボが降りる床の点。穴のふちのすぐ外で、from (いまいるところ) に
  // いちばん近く、箱にも穴にもかからないところ (しびれマスは、なるべくさける)。pit が無ければ (もう穴がもどった) from の足元
  holeExit(pit, from) {
    const spot = new THREE.Vector3(from.x, 0, from.z);
    if (!pit) return spot;
    const x = THREE.MathUtils.clamp(from.x, pit.x0 + 0.5, pit.x1 - 0.5);
    const z = THREE.MathUtils.clamp(from.z, pit.z0 + 0.5, pit.z1 - 0.5);
    const places = [];
    for (const gap of [EXIT_GAP, EXIT_GAP + this.tiles.size]) {
      places.push([pit.x0 - gap, z], [pit.x1 + gap, z], [x, pit.z0 - gap], [x, pit.z1 + gap]);
    }
    places.sort((a, b) => Math.hypot(a[0] - from.x, a[1] - from.z) - Math.hypot(b[0] - from.x, b[1] - from.z));
    const pick = places.find(([px, pz]) => this.standable(px, pz, true)) ?? places.find(([px, pz]) => this.standable(px, pz, false));
    if (pick) return spot.set(pick[0], 0, pick[1]);
    // まわりがふさがっていれば、闘技場の真ん中のほうへ探す
    const d = Math.hypot(pit.cx, pit.cz) || 1;
    for (let step = this.tiles.size / 2 + EXIT_GAP; step < this.half * 2; step += 1) {
      const px = pit.cx - (pit.cx / d) * step;
      const pz = pit.cz - (pit.cz / d) * step;
      if (this.standable(px, pz, false)) return spot.set(px, 0, pz);
    }
    return spot.set(0, 0, 0);
  }

  // (x, z) の床に、半径 EXIT_ROOM のロボが立てるか (闘技場の中で、箱にも穴にもかからない。avoidShock なら、しびれマスもさける)
  standable(x, z, avoidShock) {
    const r = EXIT_ROOM;
    const lim = this.half - r;
    if (Math.abs(x) > lim || Math.abs(z) > lim) return false;
    if (this.blocks.some((b) => x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r)) return false;
    return [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dz]) => {
      const tile = this.tiles.tileAt(x + dx, z + dz);
      return !tile?.open && !(avoidShock && tile?.kind === 'shock');
    });
  }

  // 丸い体 (半径 r、足元 pos.y から高さ h) を、壁と箱にめり込まないよう押し出す
  collide(pos, r, h) {
    const lim = this.half - r;
    pos.x = THREE.MathUtils.clamp(pos.x, -lim, lim);
    pos.z = THREE.MathUtils.clamp(pos.z, -lim, lim);
    for (const b of this.blocks) {
      if (pos.y >= b.top - STEP_UP || pos.y + h <= 0) continue; // 箱の上にいる
      const cx = THREE.MathUtils.clamp(pos.x, b.x0, b.x1);
      const cz = THREE.MathUtils.clamp(pos.z, b.z0, b.z1);
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d = Math.hypot(dx, dz);
      if (d >= r) continue;
      if (d > 1e-4) {
        pos.x = cx + (dx / d) * r;
        pos.z = cz + (dz / d) * r;
      } else {
        // 中心が箱の中に入ってしまったら、一番近い面から外へ出す
        const exits = [[b.x0 - r - pos.x, 0], [b.x1 + r - pos.x, 0], [0, b.z0 - r - pos.z], [0, b.z1 + r - pos.z]];
        const [ex, ez] = exits.reduce((m, e) => (Math.abs(e[0] + e[1]) < Math.abs(m[0] + m[1]) ? e : m));
        pos.x += ex;
        pos.z += ez;
      }
    }
  }

  // 点が入っている箱 (無ければ null)
  blockAt(p) {
    return this.blocks.find((b) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1 && p.y < b.top && p.y > 0) || null;
  }

  // 2点の間に箱が無いか (CPU が撃つかどうかと、プレイヤーのオートで撃つときに使う)
  lineOfSight(from, to) {
    for (let i = 1; i < 12; i++) {
      if (this.blockAt(SIGHT_POINT.lerpVectors(from, to, i / 12))) return false;
    }
    return true;
  }

  outside(p) {
    return Math.abs(p.x) > this.half || Math.abs(p.z) > this.half || p.y > WALL_HEIGHT;
  }
}

// グループの中の形・材質・模様を片付ける
function disposeTree(root) {
  const materials = new Set();
  root.traverse((object) => {
    if (object.geometry) object.geometry.dispose();
    if (object.material) materials.add(object.material);
  });
  for (const material of materials) {
    material.map?.dispose();
    material.dispose();
  }
}
