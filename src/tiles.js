import * as THREE from 'three';

// マス目と、床の仕掛け。闘技場の床は、arenas.js の tiles (文字の地図。1文字が1マス) で決まるマス目に分かれている
// (広さ 40m の闘技場は 10×10 の 4m、回廊は 8×8 の 3.75m。床の光る格子の線がマスのさかい目)。決まったマスには仕掛けがある:
// - もろい床 (地図の B): 爆発 (グレネード・マイン・ミサイル) でひびが入り、もう一度爆発すると割れて穴になる (blast)。
//   穴に乗ったロボは落ちて (robot.js の startFall)、少しあとにダメージを受けて、穴のそばの床へ飛び出してくる (climbOut)。
//   落ちかけたところで空中ダッシュすれば逃げられる。穴は HOLE_TIME 秒でもとにもどる
// - 加速マス (S): 乗ると、降りてからも HASTE_TIME 秒、走るのが速くなる (robot.js の hasteUp)
// - しびれマス (Z): SHOCK.cycle 秒ごとに、点滅して知らせてから電気が流れる。流れている間に乗っているロボ (空中は平気) は
//   ダメージを受けて、しびれて少し動けない。となりのマスとは、流れる時間を半分ずらしてある
// 床の見た目 (ふつうのマスの光る格子と、仕掛けのマスの模様・穴) もここで作る。仕掛けの音と文字は main.js が出す (on〜 で知らせる)
export const PIT_DEPTH = 3; // 穴の深さ (m)
const HOLE_EDGE = 0.35; // 体の中心が、穴のふちからこれだけ内側に入ると落ちる (m)
const HOLE_TIME = 8; // 穴がもとにもどるまで (秒)
const HOLE_BLINK = 1.5; // もどる前に、床が点滅しながら現れる時間 (秒)
const PIT_FALL = -0.9; // 床からこれだけ下へ落ちたら、穴に落ちた (m)
const FALL_TIME = 0.55; // 穴に落ちてから、底から飛び出すまで (秒)
const FALL_DAMAGE = 90; // 穴に落ちたときのダメージ
const CRACK_REACH = 0.8; // 爆風の半径のこの割合まで届くもろい床に、ひびが入る
const HASTE_TIME = 3; // 加速マスから降りても、速いままの時間 (秒)
// しびれマス。cycle: 1回りの長さ / warn: 電気が流れる前に、点滅して知らせる時間 / on: 流れている時間 (秒) /
// damage / stun: しびれて動けない時間 (秒)
const SHOCK = { cycle: 5, warn: 0.9, on: 1.1, damage: 45, stun: 0.8 };
const TILE_CHARS = { B: 'crack', S: 'speed', Z: 'shock' }; // 地図の文字 → 仕掛け
// 仕掛けの光る色 (style.css の --crack / --haste / --shock も同じ)
export const TILE_COLORS = { crack: 0xff9a3d, speed: 0x9dff4a, shock: 0xffe14d };
const OVERLAY_HEIGHT = 0.02; // 仕掛けの模様を、床から浮かせる高さ (m)
const ARCS = 3; // しびれマスの上を走る電気の線の数
const ARC_STEPS = 6; // 電気の線1本の折れ目の数
const FENCE_HEIGHT = 1.1; // しびれマスのまわりに立つ、光の壁の高さ (m)
const CRACK_DUST = { color: 0x9aa7c0, count: 8, speed: 2, rise: 0.5, size: 0.7, life: 0.6 };
const BREAK_DUST = { color: 0x9aa7c0, count: 16, speed: 3.5, rise: 1.2, size: 1, life: 0.9 };

// 128 ピクセル四方のキャンバスに絵をかいて、模様にする
function canvasTexture(draw) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  draw(canvas.getContext('2d'));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// ふつうのマスの模様: 白い地に、ふちの光る線 (床の色をかけて使う)
function floorTexture(color) {
  const texture = canvasTexture((g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = color;
    g.globalAlpha = 0.55;
    g.lineWidth = 3;
    g.strokeRect(0, 0, 128, 128);
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// 仕掛けのマスの模様。黒い地に白でかき、材質の色で光らせる (加算で重ねるので、黒いところは透ける)。
// 四すみのかぎと、真ん中の絵: crack はひび (heavy は割れかけの大きなひび)、speed は上向きの2つの山形、shock はいなずま
function overlayTexture(kind, heavy = false) {
  return canvasTexture((g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = g.fillStyle = '#fff';
    g.lineCap = g.lineJoin = 'round';
    const line = (points, width) => {
      g.lineWidth = width;
      g.beginPath();
      points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    };
    for (const [x, y, sx, sy] of [[10, 10, 1, 1], [118, 10, -1, 1], [10, 118, 1, -1], [118, 118, -1, -1]]) {
      line([[x, y + sy * 30], [x, y], [x + sx * 30, y]], 5);
    }
    if (kind === 'crack') {
      const cracks = [
        [[64, 64], [52, 50], [47, 36], [34, 27]],
        [[64, 64], [79, 58], [91, 63], [104, 51]],
        [[64, 64], [60, 80], [69, 92], [64, 106]],
      ];
      const more = [
        [[64, 64], [45, 72], [31, 69], [19, 83]],
        [[79, 58], [85, 43], [98, 33]],
        [[60, 80], [47, 95]],
        [[52, 50], [39, 53]],
      ];
      for (const points of heavy ? [...cracks, ...more] : cracks) line(points, heavy ? 6 : 3);
    } else if (kind === 'speed') {
      for (const y of [46, 80]) line([[36, y + 16], [64, y - 8], [92, y + 16]], 11);
    } else {
      g.beginPath();
      [[74, 16], [42, 68], [62, 68], [50, 112], [88, 56], [68, 56], [82, 16]].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
    }
  });
}

export class Tiles {
  constructor(arena, effects) {
    this.arena = arena;
    this.effects = effects;
    this.list = []; // 仕掛けのマス
    this.cells = []; // マスごとの仕掛け (ふつうのマスは null)。cells[行 * n + 列]
    this.n = 1; // 1行・1列のマスの数
    this.size = 1; // 1マスの大きさ (m)
    this.half = 1;
    this.time = 0;
    this.textures = {};
    this.tmp = new THREE.Vector3();
    // 知らせ (main.js が音と文字を出す)。onCrack / onBreak / onRestore (tile): もろい床にひびが入った・割れて穴になった・もとにもどった。
    // onWarn / onZap (tile): しびれマスが点滅し始めた・電気が流れ始めた。onShock (robot, 結果): ロボがしびれた。onHaste (robot): ロボが加速した
    this.onCrack = null;
    this.onBreak = null;
    this.onRestore = null;
    this.onWarn = null;
    this.onZap = null;
    this.onShock = null;
    this.onHaste = null;
  }

  // 闘技場 def の床を作って group に入れる (arena.js の load から)。仕掛けはどれも、はじめの状態
  build(def, colors, group) {
    const rows = def.tiles ?? [];
    const n = rows.length || Math.round(def.half / 2);
    const size = (def.half * 2) / n;
    this.n = n;
    this.size = size;
    this.half = def.half;
    this.list = [];
    this.cells = new Array(n * n).fill(null);
    this.time = 0;
    for (const texture of Object.values(this.textures)) texture.dispose();
    const textures = {
      crack: overlayTexture('crack'),
      cracked: overlayTexture('crack', true),
      speed: overlayTexture('speed'),
      shock: overlayTexture('shock'),
    };
    this.textures = textures;
    const floorMaterial = new THREE.MeshLambertMaterial({ color: colors.floor, map: floorTexture(colors.grid) });
    const quad = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    // 穴: 内側だけを見せる箱 (上はあいて見える。壁は、割れたふちのあたりがオレンジに明るく、底は暗くして深さを見せる) と、光るふち
    const pitGeometry = new THREE.BoxGeometry(size, PIT_DEPTH, size);
    const rim = new THREE.Color(colors.floor).multiplyScalar(1.6).lerp(new THREE.Color(TILE_COLORS.crack), 0.45);
    const deep = new THREE.Color(colors.background).multiplyScalar(0.3);
    const shade = new THREE.Color();
    const pitPosition = pitGeometry.attributes.position;
    const pitColors = [];
    for (let i = 0; i < pitPosition.count; i++) {
      const k = pitPosition.getY(i) / PIT_DEPTH + 0.5; // 底 0 → 上 1
      shade.copy(deep).lerp(rim, k * k);
      pitColors.push(shade.r, shade.g, shade.b);
    }
    pitGeometry.setAttribute('color', new THREE.Float32BufferAttribute(pitColors, 3));
    const pitMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
    const pitEdges = new THREE.EdgesGeometry(pitGeometry);
    const pitLine = new THREE.LineBasicMaterial({ color: TILE_COLORS.crack });
    const arcMaterial = new THREE.LineBasicMaterial({ color: 0xfffbe0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    // しびれマスのまわりの光の壁 (四角い筒。下ほど明るい)。電気が流れている間と、知らせている間に見せる
    const fenceGeometry = new THREE.CylinderGeometry(size / Math.SQRT2, size / Math.SQRT2, FENCE_HEIGHT, 4, 1, true)
      .rotateY(Math.PI / 4)
      .translate(0, FENCE_HEIGHT / 2, 0);
    const fencePosition = fenceGeometry.attributes.position;
    const fenceColors = [];
    for (let i = 0; i < fencePosition.count; i++) fenceColors.push(1, 1, 1, 1 - fencePosition.getY(i) / FENCE_HEIGHT);
    fenceGeometry.setAttribute('color', new THREE.Float32BufferAttribute(fenceColors, 4));
    // 割れない床 (ふつうのマス・加速マス・しびれマス) は、マスごとの四角を1つの形にまとめる
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const kind = TILE_CHARS[rows[row]?.[col]] ?? null;
        const x0 = -this.half + col * size;
        const z1 = this.half - row * size;
        const x1 = x0 + size;
        const z0 = z1 - size;
        if (kind !== 'crack') {
          const a = positions.length / 3;
          positions.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1);
          uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
          indices.push(a, a + 2, a + 1, a, a + 3, a + 2); // 上を向く面
        }
        if (!kind) continue;
        const cx = x0 + size / 2;
        const cz = z0 + size / 2;
        const tile = {
          kind, row, col, x0, x1, z0, z1, cx, cz,
          center: new THREE.Vector3(cx, 0, cz),
          bottom: -PIT_DEPTH, // 穴の底の高さ (robot.js が使う)
          phase: (row + col) % 2 ? 0.5 : 0, // しびれマスの、電気が流れる時間のずれ (1回りに対する割合)
          cracked: false, // もろい床: ひびが入っている
          open: false, // もろい床: 割れて穴になっている
          openTime: 0, // 穴になってからの時間 (秒)
          state: 'idle', // しびれマス: 'idle' (止まっている) / 'warn' (点滅して知らせている) / 'on' (電気が流れている)
          round: 0, // しびれマスが知らせ始めた回数 (ai.js が、気づいたかを回ごとに決めるのに使う)
          zapped: new Set(), // いまの電気でしびれたロボ (1回に1度だけ)
          overlay: null,
          base: null,
          pit: null,
          arcs: null,
          fence: null,
        };
        const material = new THREE.MeshBasicMaterial({
          map: textures[kind], color: TILE_COLORS[kind], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        });
        tile.overlay = new THREE.Mesh(quad, material);
        tile.overlay.position.set(cx, OVERLAY_HEIGHT, cz);
        group.add(tile.overlay);
        if (kind === 'crack') {
          tile.base = new THREE.Mesh(quad, floorMaterial);
          tile.base.position.set(cx, 0, cz);
          tile.pit = new THREE.Mesh(pitGeometry, pitMaterial);
          tile.pit.add(new THREE.LineSegments(pitEdges, pitLine));
          tile.pit.position.set(cx, -PIT_DEPTH / 2, cz);
          tile.pit.visible = false;
          group.add(tile.base, tile.pit);
        } else if (kind === 'shock') {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARCS * ARC_STEPS * 2 * 3), 3));
          tile.arcs = new THREE.LineSegments(geometry, arcMaterial);
          tile.arcs.position.set(cx, 0, cz);
          tile.arcs.frustumCulled = false;
          tile.arcs.visible = false;
          tile.fence = new THREE.Mesh(fenceGeometry, new THREE.MeshBasicMaterial({
            color: TILE_COLORS.shock, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
          }));
          tile.fence.position.set(cx, 0, cz);
          tile.fence.visible = false;
          group.add(tile.arcs, tile.fence);
        }
        this.list.push(tile);
        this.cells[row * n + col] = tile;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    group.add(new THREE.Mesh(geometry, floorMaterial));
  }

  // (x, z) のマスの仕掛け (ふつうのマスや、闘技場の外なら null)
  tileAt(x, z) {
    const col = Math.floor((x + this.half) / this.size);
    const row = Math.floor((this.half - z) / this.size);
    if (col < 0 || row < 0 || col >= this.n || row >= this.n) return null;
    return this.cells[row * this.n + col];
  }

  // (x, z) が、あいている穴の上か (穴のふちから edge より内側)。その穴のマスを返す (無ければ null)
  holeAt(x, z, edge = HOLE_EDGE) {
    const tile = this.tileAt(x, z);
    if (!tile?.open) return null;
    return x > tile.x0 + edge && x < tile.x1 - edge && z > tile.z0 + edge && z < tile.z1 - edge ? tile : null;
  }

  // 仕掛けの動き (いつも。arena.js の update から): もろい床の光と、穴がもどるまでの時間、しびれマスの電気、加速マスの明るさ
  animate(dt) {
    this.time += dt;
    for (const tile of this.list) {
      if (tile.kind === 'crack') this.animateCrack(tile, dt);
      else if (tile.kind === 'shock') this.animateShock(tile, dt);
      else tile.overlay.material.opacity = 0.55 + 0.25 * Math.sin(this.time * 4 + tile.phase * Math.PI);
    }
  }

  animateCrack(tile, dt) {
    const material = tile.overlay.material;
    if (!tile.open) {
      material.opacity = tile.cracked ? 0.75 + 0.25 * Math.sin(this.time * 8) : 0.5;
      return;
    }
    tile.openTime += dt;
    const left = HOLE_TIME - tile.openTime;
    if (left <= 0) {
      this.close(tile);
      return;
    }
    // もどる前は、床が点滅しながら現れる (まだ穴のまま)
    const shown = left < HOLE_BLINK && Math.floor(left * 10) % 2 === 0;
    tile.base.visible = shown;
    tile.overlay.visible = shown;
    material.opacity = 0.35;
  }

  animateShock(tile, dt) {
    const t = ((this.time / SHOCK.cycle + tile.phase) % 1) * SHOCK.cycle; // いまの1回りの何秒目か
    const onAt = SHOCK.cycle - SHOCK.on;
    const state = t >= onAt ? 'on' : t >= onAt - SHOCK.warn ? 'warn' : 'idle';
    if (state !== tile.state) {
      tile.state = state;
      if (state === 'warn') {
        tile.round++;
        this.onWarn?.(tile);
      } else if (state === 'on') {
        tile.zapped.clear();
        this.onZap?.(tile);
      }
    }
    const material = tile.overlay.material;
    const fence = tile.fence.material;
    tile.arcs.visible = state === 'on';
    tile.fence.visible = state !== 'idle';
    if (state === 'idle') {
      material.opacity = 0.3;
    } else if (state === 'warn') {
      // 速く点滅して知らせる (光の壁もうっすら点滅)
      const blink = Math.floor(t * 12) % 2;
      material.opacity = blink ? 1 : 0.2;
      fence.opacity = blink ? 0.25 : 0.05;
      if (Math.random() < dt * 4) this.spark(tile, 4);
    } else {
      material.opacity = 0.8 + Math.random() * 0.2;
      fence.opacity = 0.55 + Math.random() * 0.25;
      this.zigzag(tile);
      if (Math.random() < dt * 8) this.spark(tile, 6);
    }
  }

  // しびれマスの上に、ぎざぎざの電気の線をかき直す (流れている間は毎コマ)。線は、マスの中のどこかからどこかへ
  zigzag(tile) {
    const position = tile.arcs.geometry.attributes.position;
    const reach = this.size / 2 - 0.2;
    const point = () => [(Math.random() * 2 - 1) * reach, (Math.random() * 2 - 1) * reach];
    let i = 0;
    for (let a = 0; a < ARCS; a++) {
      const [sx, sz] = point();
      const [ex, ez] = point();
      let x = sx;
      let y = 0.05;
      let z = sz;
      for (let s = 1; s <= ARC_STEPS; s++) {
        const k = s / ARC_STEPS;
        const wobble = s < ARC_STEPS ? 0.6 : 0;
        const nx = sx + (ex - sx) * k + (Math.random() - 0.5) * wobble;
        const nz = sz + (ez - sz) * k + (Math.random() - 0.5) * wobble;
        const ny = s < ARC_STEPS ? 0.1 + Math.random() * 0.6 : 0.05;
        position.setXYZ(i++, x, y, z);
        position.setXYZ(i++, nx, ny, nz);
        x = nx;
        y = ny;
        z = nz;
      }
    }
    position.needsUpdate = true;
  }

  // しびれマスの上の、どこかに火花
  spark(tile, count) {
    const reach = this.size / 2;
    const at = this.tmp.set(tile.cx + (Math.random() * 2 - 1) * reach, 0.15, tile.cz + (Math.random() * 2 - 1) * reach);
    this.effects.burst(at, TILE_COLORS.shock, count, 3);
  }

  // ロボへの効き目 (main.js から、ロボと飛び道具を動かしたあと毎コマ)。active: 戦っている (このときだけ、加速としびれが効き、
  // 穴に落ちるとダメージを受ける)。穴に落ちたロボは、FALL_TIME 秒たつと底から飛び出す
  update(robots, active) {
    for (const robot of robots) {
      if (!robot.pit && robot.pos.y < PIT_FALL) {
        const hole = this.holeAt(robot.pos.x, robot.pos.z, 0);
        if (hole) robot.startFall(hole);
      }
      if (robot.state === 'fall' && robot.stateTime >= FALL_TIME) {
        robot.climbOut(this.arena.holeExit(robot.pit, robot.pos), active ? FALL_DAMAGE : 0);
      }
      if (!active || !robot.alive || !robot.onGround) continue;
      const tile = this.tileAt(robot.pos.x, robot.pos.z);
      if (tile?.kind === 'speed' && !robot.down) {
        const fresh = robot.haste <= 0;
        robot.hasteUp(HASTE_TIME);
        if (fresh) this.onHaste?.(robot);
      } else if (tile?.kind === 'shock' && tile.state === 'on' && !tile.zapped.has(robot)) {
        const result = robot.takeHit({ damage: SHOCK.damage, knockdown: false, flinch: SHOCK.stun, from: tile.center, cause: 'shock', pierce: true });
        if (!result) continue; // ダウン中と、起き上がったあとの無敵のあいだ (無敵が切れたら、まだ流れていればしびれる)
        tile.zapped.add(robot);
        if (result !== 'blocked') robot.zapped = SHOCK.stun;
        this.onShock?.(robot, result);
      }
    }
  }

  // 爆発 (weapons.js の explode から)。爆風が届くもろい床にひびを入れ、もうひびが入っていれば割って穴にする
  blast(at, radius) {
    if (at.y > radius || at.y < -0.5) return; // 高いところ (箱の上など) や、穴の中の爆発は、床まで届かない
    const reach = radius * CRACK_REACH;
    for (const tile of this.list) {
      if (tile.kind !== 'crack' || tile.open) continue;
      const dx = at.x - THREE.MathUtils.clamp(at.x, tile.x0, tile.x1);
      const dz = at.z - THREE.MathUtils.clamp(at.z, tile.z0, tile.z1);
      if (Math.hypot(dx, dz) > reach) continue;
      if (tile.cracked) this.open(tile);
      else this.crack(tile);
    }
  }

  // もろい床にひびが入る
  crack(tile) {
    tile.cracked = true;
    tile.overlay.material.map = this.textures.cracked;
    this.effects.puff(this.tmp.set(tile.cx, 0.1, tile.cz), CRACK_DUST);
    this.onCrack?.(tile);
  }

  // もろい床が割れて穴になる (床の板が飛び散る)
  open(tile) {
    tile.open = true;
    tile.openTime = 0;
    tile.base.visible = false;
    tile.overlay.visible = false;
    tile.pit.visible = true;
    const at = this.tmp.set(tile.cx, 0.2, tile.cz);
    this.effects.shatter(at, this.size * 0.4, TILE_COLORS.crack);
    this.effects.burst(at, 0xc9d3e6, 24, 6);
    this.effects.puff(at, BREAK_DUST);
    this.onBreak?.(tile);
  }

  // 穴がもとの床にもどる (ひびも消える)。quiet: 光らせず、知らせない (試合の外の画面へ行くとき)
  close(tile, quiet = false) {
    tile.open = false;
    tile.cracked = false;
    tile.openTime = 0;
    tile.base.visible = true;
    tile.overlay.visible = true;
    tile.pit.visible = false;
    tile.overlay.material.map = this.textures.crack;
    if (quiet) return;
    this.effects.burst(this.tmp.set(tile.cx, 0.2, tile.cz), TILE_COLORS.crack, 16, 3);
    this.onRestore?.(tile);
  }

  // 仕掛けを全部はじめの状態にもどす (試合の外の画面へ行くとき)
  clear() {
    for (const tile of this.list) {
      if (tile.kind === 'crack' && (tile.open || tile.cracked)) this.close(tile, true);
      tile.zapped.clear();
    }
  }
}
