import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ロボの見た目。細身で脚が長く、胸を張ったヒーロー体型 (下がしまった逆三角形の胸・小さな頭・長い脚)。かどを落とした装甲を重ね、
// とがった角や羽・光るライン・排気口などの細かい部品をつける (足元が原点、前が +z、ロボの右手が -x)。
// 配色はヒーローらしく、白い装甲にチームの色と黄色と小さな部品の色を重ねる (プレイヤーは白・青・赤・黄のトリコロール)。
// 材質は、つやのある塗装のプラモデルのよう (平らな面は平らに光り、上にクリアのつやが乗る)。大きな装甲には細いみぞ (パネルの線) が入り、
// 装甲のふちは、ロボの光の色でふちどる。
// 目・コア・光るライン・炎・ブレードの刃は明るく光り、目・コア・炎・刃のまわりには、やわらかい光の輪 (halo) を重ねる (光がにじんで見える)。
// 上半身 (腹・胸・頭・腕・背中) は腰の上の torso にまとめ、腰から上だけをひねったりかがめたりできる (robot.js が構えや斬る動きに使う)。
// 背中の噴射口からは炎が出る。右の前腕にはブレードの光の刃 (ふだんは隠す)。発射口の位置 (muzzles) も一緒に返し、weapons.js はそこから弾を出す。
// 組み立てたあと、いっしょに動く部品は材質ごとに1つの形にまとめる (描く回数を減らして、スマホでも軽くする)

// 色。side (プレイヤー you・CPU cpu・4人対戦で増える CPU green / pink) ごとに、チームの色 team と、小さな部品 (あご・腰の前・つま先) の色 sub。
// プレイヤーは白・青・赤・黄、CPU は白・オレンジ・黒、緑は白・緑・紺、ピンクは白・ピンク・紫
const TEAM_LOOKS = {
  you: { team: 0x1f5bd6, sub: 0xd9262e },
  cpu: { team: 0xee5a1a, sub: 0x2b2f3a },
  green: { team: 0x2aa04a, sub: 0x1d3a80 },
  pink: { team: 0xdb3c9c, sub: 0x5b2ca6 },
};
// フレームごとの色の置き方。main (装甲) と trim (胸板・ひざ・羽などの飾り) に、白 ('white') とチームの色 ('team') のどちらを使うか / white: その白
const FRAME_SCHEMES = {
  aogane: { main: 'white', trim: 'team', white: 0xe6eaf0 },
  iwao: { main: 'team', trim: 'white', white: 0xdde1e8 },
  hayate: { main: 'white', trim: 'team', white: 0xeceff4 },
  tsubame: { main: 'white', trim: 'team', white: 0xe3e7ee },
};
const ACCENT = 0xf4bd1a; // 差し色 (V字の角・排気口などの黄色)
const GLOW_COLORS = { you: 0x6ff0ff, cpu: 0xffa43d, green: 0x9dff70, pink: 0xff74d8 }; // 目・コア・炎・ふちどりの色
const GLOW_BOOST = 1.5; // 光る部品の明るさの倍率 (色を少し白っぽく、明るく見せる)
const HALO_OPACITY = 0.55; // 光の輪の濃さ
const RIM = { strength: 0.3, power: 3.5 }; // 装甲のふちどりの光。strength: 明るさ / power: 大きいほど、ふちの近くだけが光る
const HIP_Y = 1.1; // 脚の付け根の高さ (どの脚も同じ)
const WAIST_Y = 1.25; // 上半身をひねる・かがめる中心の高さ
const THIGH = 0.5; // 付け根からひざまで (m)
const UPPER_ARM = 0.4; // 肩からひじまで (m)
export const LEG = { thigh: THIGH, shin: HIP_Y - THIGH }; // もも・すね (ひざから足の裏まで) の長さ。robot.js が足を置く場所から脚の曲げ方を決める

// 装甲の形。RIDGE: 前と後ろの面を真ん中の稜線で折る深さ (奥行に対する割合。形ごとに ridge で変えられる) / RIDGE_CAP: 折る深さの上限 (幅に対する割合) /
// BEVEL: 上下のふちを落とす大きさ (高さに対する割合) / BEVEL_CAP: その上限 (いちばん細い寸法に対する割合)。小さくして、面を広く平らに見せる
const RIDGE = 0.25;
const RIDGE_CAP = 0.35;
const BEVEL = 0.14;
const BEVEL_CAP = 0.16;
// パネルの線 (装甲の細いみぞ)。half: 線の太さの半分 (m) / depth: みぞの暗さ (0〜1)。遠くて線が1画素より細くなると、そのぶん薄くする
const SEAM = { half: 0.0035, depth: 0.6 };
const NO_SEAM = 10; // 線のない形に入れておく、線までの距離 (m)

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// 装甲の上下のふちを落とす大きさ
function bevelOf({ w, h, d, tw = w, td = d }) {
  return Math.max(0.004, Math.min(h * BEVEL, Math.min(w, d, tw, td) * BEVEL_CAP));
}

// かどを落とした装甲 (原点は真ん中)。w, d: 下の面の幅と奥行 / tw, td: 上の面 (変えると先細りになる) / h: 高さ /
// shift: 上の面を前 (+z) へずらす量 / ridge: 前後の面を折る深さ。上から見ると六角形で、前と後ろの面は真ん中の稜線で浅く折れ、上下のふちを小さく落とす
function armorGeometry(shape) {
  const { w, h, d, tw = w, td = d, shift = 0, ridge = RIDGE } = shape;
  const bevel = bevelOf(shape);
  const points = [];
  // 高さ y に六角形 (前と後ろがとがる) を置く。inset: まわりを内側へ寄せる幅
  const ring = (y, inset) => {
    const t = (y + h / 2) / h;
    const x = (w + (tw - w) * t) / 2 - inset;
    const z = (d + (td - d) * t) / 2 - inset;
    const z0 = shift * (t - 0.5);
    const r = Math.min(z * 2 * ridge, x * RIDGE_CAP); // 稜線からふちまでで、どれだけ後ろへ下がるか
    points.push(V(-x, y, z0 - z + r), V(0, y, z0 - z), V(x, y, z0 - z + r), V(x, y, z0 + z - r), V(0, y, z0 + z), V(-x, y, z0 + z - r));
  };
  ring(-h / 2, bevel);
  ring(-h / 2 + bevel, 0);
  ring(h / 2 - bevel, 0);
  ring(h / 2, bevel);
  return new ConvexGeometry(points);
}

// 点を包む凸の形 (とがった飾りや翼など)
function hullGeometry(points) {
  return new ConvexGeometry(points.map(([x, y, z]) => V(x, y, z)));
}

// 噴射の炎 (先が下を向いた四角すい。付け根が原点)。r: 付け根の太さ
function flameGeometry(r = 0.08) {
  return new THREE.ConeGeometry(r, r * 5.2, 4, 1, true).rotateX(Math.PI).translate(0, -r * 2.6, 0);
}

// 光の輪の模様 (真ん中が明るく、ふちへ向かって消える丸)。はじめて使うときに作り、どのロボでも使い回す
let haloMap = null;
function haloTexture() {
  if (!haloMap) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = canvas.getContext('2d');
    const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.25, 'rgba(255, 255, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 64, 64);
    haloMap = new THREE.CanvasTexture(canvas);
    haloMap.colorSpace = THREE.SRGBColorSpace;
  }
  return haloMap;
}

// 胸の装甲 (armorGeometry の形 shape を高さ cy に置いたもの) の、前の面の上の点を返す関数を作る。
// 返す関数 (u, v, side): u は真ん中の稜線 0 → 横のかど 1、v は上 0 → 下 1、side は -1 が右 (-x)・1 が左
function chestSurface(shape, cy) {
  const { w, h, d, tw = w, td = d, shift = 0, ridge = RIDGE } = shape;
  const bevel = bevelOf(shape);
  const ring = (y) => {
    const t = (y + h / 2) / h;
    const x = (w + (tw - w) * t) / 2;
    const z = (d + (td - d) * t) / 2;
    const z0 = shift * (t - 0.5);
    return { x, center: z0 + z, edge: z0 + z - Math.min(z * 2 * ridge, x * RIDGE_CAP) };
  };
  const top = ring(h / 2 - bevel);
  const bottom = ring(-h / 2 + bevel);
  return (u, v, side = 1) => {
    const tz = top.center + (top.edge - top.center) * u;
    const bz = bottom.center + (bottom.edge - bottom.center) * u;
    return V(side * u * (top.x + (bottom.x - top.x) * v), cy + h / 2 - bevel - (h - 2 * bevel) * v, tz + (bz - tz) * v);
  };
}

// 胸の面の上の場所 (u, v, side) の、外向きと、その向きのヨー (板や排気口を面に沿わせる回し方)
function facetAt(surface, u, v, side) {
  const p = surface(u, v, side);
  const across = surface(Math.min(1, u + 0.1), v, side).sub(surface(Math.max(0, u - 0.1), v, side));
  const down = surface(u, Math.min(1, v + 0.1), side).sub(surface(u, Math.max(0, v - 0.1), side));
  const normal = across.cross(down).normalize();
  if (normal.z < 0) normal.negate();
  return { point: p, normal, yaw: Math.atan2(normal.x, normal.z) };
}

// パネルの線を、頂点ごとの「線の平面までの距離」にして形に書きこむ (装甲の材質のシェーダーが、距離が 0 に近いところを暗くする)。
// 平面までの距離は面の上でまっすぐ変わるので、頂点で計算して間をつなげば、どの点でもちょうどの距離になる。
// 線は形ごとに2本まで (userData.seams: 形の中の平面 [nx, ny, nz, c] の並び)。装甲の材質の形には、線がなくても入れておく
function bakeSeams(root) {
  const p = new THREE.Vector3();
  root.traverse((object) => {
    if (!object.isMesh || !object.material.userData.seams) return;
    const seams = (object.userData.seams ?? []).slice(0, 2);
    const position = object.geometry.attributes.position;
    const values = new Float32Array(position.count * 2).fill(NO_SEAM);
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i);
      seams.forEach(([nx, ny, nz, c], j) => {
        values[i * 2 + j] = nx * p.x + ny * p.y + nz * p.z - c;
      });
    }
    object.geometry.setAttribute('seam', new THREE.BufferAttribute(values, 2));
  });
}

// いっしょに動く部品をまとめる: グループごとに、同じ材質の直接の子の形を1つにする (描く回数が減る)。
// keep の付いた形 (炎など、あとで大きさを変えるもの) と、子を持つ形はそのまま
function mergeStatic(root) {
  const groups = [];
  root.traverse((object) => {
    if (!object.isMesh) groups.push(object);
  });
  for (const group of groups) {
    const byMaterial = new Map();
    for (const child of group.children) {
      if (!child.isMesh || child.children.length || child.userData.keep) continue;
      if (!byMaterial.has(child.material)) byMaterial.set(child.material, []);
      byMaterial.get(child.material).push(child);
    }
    for (const [material, meshes] of byMaterial) {
      if (meshes.length < 2) continue;
      const parts = meshes.map((mesh) => {
        mesh.updateMatrix();
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        geometry.deleteAttribute('uv');
        return geometry.applyMatrix4(mesh.matrix);
      });
      const merged = new THREE.Mesh(mergeGeometries(parts), material);
      for (const mesh of meshes) {
        group.remove(mesh);
        mesh.geometry.dispose();
      }
      for (const part of parts) part.dispose();
      group.add(merged);
    }
  }
}

// 装甲の材質に2つ足す: パネルの線 (形の seam が 0 に近いところを暗いみぞにする。線が1画素より細いと、そのぶん薄くしてちらつかせない) と、
// ふちどりの光 (カメラから見て面が横を向くほど、color の光が強い)。どのロボの材質も同じ仕組みを使う
function armored(material, color) {
  const rim = { value: color.clone().multiplyScalar(RIM.strength) };
  const f = (x) => x.toFixed(4);
  material.userData.seams = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = rim;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 seam;\nvarying vec2 vSeam;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvSeam = seam;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;\nvarying vec2 vSeam;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
	vec2 seamPixel = max(fwidth(vSeam), vec2(1e-5));
	vec2 seamLine = (1.0 - smoothstep(vec2(${f(SEAM.half)}), vec2(${f(SEAM.half)}) + seamPixel, abs(vSeam))) * min(vec2(1.0), ${f(SEAM.half * 2)} / seamPixel);
	diffuseColor.rgb *= 1.0 - ${f(SEAM.depth)} * max(seamLine.x, seamLine.y);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += rimColor * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), ${RIM.power.toFixed(2)});`,
      );
  };
  material.customProgramCacheKey = () => 'robot-armor';
  return material;
}

// 部品を足していく道具。material は main (装甲) / trim (飾り) / accent (差し色) / sub (小さな部品の色) / dark (中の機械) / metal (銃身など) /
// glow (光る) / flame (炎)
class Kit {
  constructor(materials) {
    this.materials = materials;
    // パネルの線の場所を決める乱数。毎回同じ列を使うので、同じ組み合わせのロボはいつも同じ見た目になる
    let seed = 1;
    this.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  }

  group(parent, [x, y, z] = [0, 0, 0], [rx, ry, rz] = [0, 0, 0]) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.set(rx, ry, rz);
    parent.add(group);
    return group;
  }

  add(parent, geometry, material, [x, y, z] = [0, 0, 0], [rx, ry, rz] = [0, 0, 0]) {
    const mesh = new THREE.Mesh(geometry, this.materials[material]);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    parent.add(mesh);
    return mesh;
  }

  // 装甲。白とチームの色の大きな装甲には、パネルの線を入れる (shape.seams で決めることも、false で入れないこともできる)
  armor(parent, shape, material, position, rotation) {
    const mesh = this.add(parent, armorGeometry(shape), material, position, rotation);
    if (shape.seams !== false && (material === 'main' || material === 'trim')) mesh.userData.seams = shape.seams ?? this.autoSeams(shape);
    return mesh;
  }

  // 装甲の大きさから、パネルの線を決める (平面 [nx, ny, nz, c]: nx*x + ny*y + nz*z = c の所に線を引く)。
  // 長い向きを1周する線を、端から少し入った所に少し傾けて1本。長い装甲には反対の端にもう1本、平たく広い装甲には縦に1本
  autoSeams({ w, h, d, tw = w, td = d }) {
    const r = this.random;
    if (Math.max(h, d) < 0.12 || Math.min(w, d, tw, td) < 0.07) return [];
    const along = d > h * 1.4 ? 'z' : 'y'; // 前後に長い装甲 (前腕など) は、前後の向きを1周する
    const size = along === 'z' ? Math.max(d, td) : h;
    const ring = (side, tilt) => {
      const [a, b] = [Math.cos(tilt), Math.sin(tilt)];
      const at = side * (size / 2) * (0.3 + r() * 0.25);
      return along === 'z' ? [0, b, a, at] : [0, a, b, at];
    };
    const seams = [ring(1, (r() - 0.5) * 0.6)];
    if (size >= 0.3) seams.push(ring(-1, (r() - 0.5) * 0.5));
    else if (Math.max(w, tw) >= 0.3) seams.push([1, 0, 0, (r() < 0.5 ? -1 : 1) * (Math.max(w, tw) / 2) * (0.3 + r() * 0.2)]);
    return seams;
  }

  hull(parent, points, material, position, rotation) {
    return this.add(parent, hullGeometry(points), material, position, rotation);
  }

  // 板 (とがった角・羽・すそなど)。outline: 板の形 (へこみのない多角形の点 [u, v]) / t: 厚み /
  // axis: 板の向き。'z' は前後を向く板 (u が横、v が上)、'x' は横を向く板 (u が前、v が上)、'y' は上を向く板 (u が横、v が前)
  plate(parent, outline, t, material, position, rotation, axis = 'z') {
    const points = [];
    for (const [u, v] of outline) {
      for (const w of [-t / 2, t / 2]) points.push(axis === 'z' ? [u, v, w] : axis === 'x' ? [w, v, u] : [u, w, v]);
    }
    return this.hull(parent, points, material, position, rotation);
  }

  // 角柱 (sides 角形。ふだんは四角)。axis: 'y' 縦 / 'z' 前後 / 'x' 左右。r2 は下 (axis が z なら後ろ) の半径
  prism(parent, { r, r2 = r, len, sides = 4, axis = 'y' }, material, position, rotation) {
    const geometry = new THREE.CylinderGeometry(r, r2, len, sides);
    if (axis === 'z') geometry.rotateX(Math.PI / 2);
    if (axis === 'x') geometry.rotateZ(-Math.PI / 2);
    return this.add(parent, geometry, material, position, rotation);
  }

  box(parent, [w, h, d], material, position, rotation) {
    return this.add(parent, new THREE.BoxGeometry(w, h, d), material, position, rotation);
  }

  // from から to までの細い棒 (光るふちなど)
  beam(parent, from, to, size, material) {
    const a = V(...from);
    const b = V(...to);
    const mesh = this.add(parent, new THREE.BoxGeometry(size, size, a.distanceTo(b)), material);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(V(0, 0, 1), b.sub(a).normalize());
    return mesh;
  }

  // 関節 (八面体。とがった角が前後左右の間を向く)
  joint(parent, r, position) {
    return this.add(parent, new THREE.OctahedronGeometry(r * 1.1), 'dark', position, [0, Math.PI / 4, 0]);
  }

  // 細い板を縦に count 枚並べる (排気口)。size: 1枚の [幅, 高さ, 奥行] / gap: 板の中心どうしの間
  vents(parent, count, size, gap, material, position, rotation) {
    const group = this.group(parent, position, rotation);
    for (let i = 0; i < count; i++) this.box(group, size, material, [0, (i - (count - 1) / 2) * gap, 0]);
    return group;
  }

  // やわらかい光の輪 (いつもカメラのほうを向く)。size: 大きさ (m)
  halo(parent, [x, y, z], size) {
    const sprite = new THREE.Sprite(this.materials.halo);
    sprite.position.set(x, y, z);
    sprite.scale.setScalar(size);
    parent.add(sprite);
    return sprite;
  }

  // 胸の前の左右の面に沿わせた板 (胸板)。surface: chestSurface の関数 / area: 面の上の範囲 [u0, u1, v0, v1] /
  // taper: 下のふちを真ん中へ寄せる量 (u) / glow: 下のふちに光るラインをつける / t: 厚み
  chestPlates(body, surface, [u0, u1, v0, v1], material, { taper = 0, glow = true, t = 0.05 } = {}) {
    for (const side of [-1, 1]) {
      const corners = [surface(u0, v0, side), surface(u1, v0, side), surface(u1 - taper, v1, side), surface(u0, v1, side)];
      const normal = corners[1].clone().sub(corners[0]).cross(corners[3].clone().sub(corners[0])).normalize();
      if (normal.z < 0) normal.negate();
      const front = corners.map((q) => q.clone().addScaledVector(normal, 0.018));
      const back = front.map((q) => q.clone().addScaledVector(normal, -t));
      this.hull(body, [...front, ...back].map((q) => [q.x, q.y, q.z]), material);
      if (glow) {
        const a = front[3].clone().addScaledVector(normal, 0.01);
        const b = front[2].clone().addScaledVector(normal, 0.01);
        this.beam(body, [a.x, a.y - 0.022, a.z], [b.x, b.y - 0.022, b.z], 0.016, 'glow');
      }
    }
  }

  // 胸の面の上の (u, v) に、面に沿わせて排気口を左右1つずつ
  chestVents(body, surface, u, v, count, size, material) {
    for (const side of [-1, 1]) {
      const { point, normal, yaw } = facetAt(surface, u, v, side);
      point.addScaledVector(normal, 0.01);
      this.vents(body, count, size, size[1] * 2, material, [point.x, point.y, point.z], [0, yaw, 0]);
    }
  }
}

// 肩の装甲 (角を落とした厚い箱。上の面は外へ少し下がり、外の面は下ほど開く)。sign: -1 は右肩、1 は左肩 / s: 大きさの倍率 /
// lift: 肩の関節からの高さ
function pauldron(k, shoulder, sign, s, material, lift = 0.06) {
  const points = [
    [0, 0.16, 0.17], [0, 0.16, -0.19], [0.24, 0.11, 0.16], [0.24, 0.11, -0.18],
    [0, 0.1, 0.21], [0, 0.1, -0.23], [0.25, 0.05, 0.2], [0.25, 0.05, -0.22],
    [0.27, -0.08, 0.16], [0.27, -0.08, -0.18], [0.06, -0.09, 0.16], [0.06, -0.09, -0.18],
  ];
  const pad = k.hull(shoulder, points.map(([x, y, z]) => [sign * (x * s - 0.03), y * s + lift, z * s]), material);
  pad.userData.seams = [[1, 0, 0, sign * (0.13 * s - 0.03)], [0, 1, 0, 0.01 * s + lift]]; // 上の面を前後に通る線と、横を1周する線
  return pad;
}

// 腰まわり (どのフレームも同じ形で、横幅だけ変える)。hips (脚といっしょに動く) に骨盤・股と前・横・後ろのすそ、
// upper (上半身。腰の上でひねる) に2段の腹と腹の板。s: 横幅の倍率
function waist(k, hips, upper, s) {
  k.armor(hips, { w: 0.32 * s, h: 0.2, d: 0.28, tw: 0.4 * s }, 'dark', [0, 1.15, 0]);
  k.armor(hips, { w: 0.14, h: 0.14, d: 0.22, tw: 0.2 }, 'dark', [0, 1.04, 0.01]);
  k.armor(upper, { w: 0.3 * s, h: 0.12, d: 0.24, tw: 0.33 * s }, 'dark', [0, 1.3, -0.01]);
  k.armor(upper, { w: 0.33 * s, h: 0.1, d: 0.26, tw: 0.38 * s }, 'dark', [0, 1.4, -0.01]);
  k.armor(upper, { w: 0.15 * s, h: 0.07, d: 0.05, tw: 0.19 * s }, 'main', [0, 1.3, 0.125], [-0.06, 0, 0]); // 腹の板 (2段)
  k.armor(upper, { w: 0.18 * s, h: 0.07, d: 0.05, tw: 0.22 * s }, 'main', [0, 1.39, 0.135], [-0.1, 0, 0]);
  // 前のすそ: 下がとがった五角形の板 (下へ行くほど前へ開く) と、真ん中の小さな部品の色
  k.plate(hips, [[-0.17 * s, 0.11], [0.17 * s, 0.11], [0.13 * s, -0.07], [0, -0.17], [-0.13 * s, -0.07]], 0.05, 'main', [0, 1.13, 0.17], [-0.22, 0, 0]);
  k.box(hips, [0.05, 0.12, 0.02], 'sub', [0, 1.1, 0.2], [-0.22, 0, 0]);
  // 横のすそ (下が外へ開く) と、後ろのすそ
  for (const side of [-1, 1]) {
    k.plate(hips, [[-0.11, 0.1], [0.11, 0.1], [0.09, -0.1], [-0.07, -0.13]], 0.05, 'trim', [side * 0.25 * s, 1.12, 0], [0, 0, side * 0.28], 'x');
  }
  k.plate(hips, [[-0.15 * s, 0.09], [0.15 * s, 0.09], [0.11 * s, -0.1], [-0.11 * s, -0.1]], 0.05, 'main', [0, 1.13, -0.16], [0.22, 0, 0]);
}

// 首と、えり (胸の上の後ろ)。top: 胸の上の高さ / s: 大きさの倍率
function neck(k, body, top, s) {
  k.prism(body, { r: 0.07 * s, len: 0.14, sides: 6 }, 'dark', [0, top + 0.05, 0]);
  k.armor(body, { w: 0.4 * s, h: 0.1, d: 0.28 * s, tw: 0.34 * s }, 'main', [0, top + 0.02, -0.07]);
}

// 胸のコア (光る八面体と、それを囲む差し色のひし形と、光の輪)。s: 大きさの倍率
function core(k, body, [x, y, z], s = 1) {
  k.plate(body, [[0, 0.09 * s], [0.075 * s, 0], [0, -0.09 * s], [-0.075 * s, 0]], 0.04, 'accent', [x, y, z + 0.01]);
  k.add(body, new THREE.OctahedronGeometry(0.05 * s), 'glow', [x, y, z + 0.035]);
  k.halo(body, [x, y, z + 0.07], 0.34 * s);
}

// 背中の噴射口 (金属の筒と、ふちの輪と、炎と、炎の光の輪)。spots: 噴射口の位置 [x, y, z] / size: 大きさの倍率。
// 炎の形を返す (robot.js が、跳んだりダッシュしたりするときに長さを変える。光の輪も炎といっしょにのびる)
function nozzles(k, back, spots, size = 1) {
  return spots.map(([x, y, z]) => {
    const nozzle = k.group(back, [x, y, z], [0.55, 0, 0]);
    k.prism(nozzle, { r: 0.06 * size, r2: 0.09 * size, len: 0.14 * size, sides: 6 }, 'metal');
    k.prism(nozzle, { r: 0.098 * size, len: 0.03, sides: 6 }, 'dark', [0, 0.06 * size, 0]);
    const flame = k.add(nozzle, flameGeometry(0.08 * size), 'flame', [0, -0.07 * size, 0]);
    flame.userData.keep = true;
    k.halo(flame, [0, -0.12 * size, 0], 0.42 * size);
    return flame;
  });
}

// ひざの、前へ張り出したとがった板の形 (s: 大きさの倍率)
function kneeGuard(s = 1) {
  return [
    [-0.1, 0.06, 0.07], [0.1, 0.06, 0.07], [0, 0.17, 0.12], [-0.09, -0.1, 0.1], [0.09, -0.1, 0.1],
    [0, -0.14, 0.15], [0, 0.02, 0.2], [-0.07, 0.08, -0.03], [0.07, 0.08, -0.03],
  ].map(([x, y, z]) => [x * s, y * s, z * s]);
}

// フレーム: upper (上半身のグループ。部品は足元から測った位置で置く) に胴と頭を作る。腰の横幅 (waist)、頭 (head。robot.js が相手のほうへ向け直す)、
// 肩の位置、肩の装甲 (pad)、背中 (back: 噴射口の炎を返す)、脚の付け根の横の位置、腕の太さを返す
const FRAME_MODELS = {
  // バランス型のヒーロー。逆三角形の胸に左右の胸板と金の排気口、V字の角とつり目のバイザー、とがった肩に金の羽、背中に2枚の安定翼
  aogane(k, upper) {
    const chest = { w: 0.48, h: 0.46, d: 0.36, tw: 0.86, td: 0.44, shift: 0.05, ridge: 0.4 };
    k.armor(upper, chest, 'main', [0, 1.66, 0]);
    const surface = chestSurface(chest, 1.66);
    k.chestPlates(upper, surface, [0.1, 0.8, 0.04, 0.44], 'trim', { taper: 0.24 }); // 左右の胸板
    k.chestVents(upper, surface, 0.7, 0.74, 3, [0.1, 0.016, 0.03], 'accent');
    for (const side of [-1, 1]) {
      // 胸の上のふちの、金の V 字の飾り
      const from = facetAt(surface, 0.02, 0.06, side);
      const to = facetAt(surface, 0.92, 0.02, side);
      const a = from.point.addScaledVector(from.normal, 0.015);
      const b = to.point.addScaledVector(to.normal, 0.015);
      k.beam(upper, [a.x, a.y - 0.04, a.z], [b.x, b.y, b.z], 0.03, 'accent');
    }
    core(k, upper, surface(0, 0.8).toArray());
    neck(k, upper, 1.9, 1);
    const head = k.group(upper, [0, 2.07, 0.02]);
    head.scale.setScalar(1.12);
    k.armor(head, { w: 0.24, h: 0.2, d: 0.26, tw: 0.2, td: 0.22, shift: 0.02 }, 'main', [0, 0.03, -0.01]);
    k.armor(head, { w: 0.16, h: 0.1, d: 0.06, tw: 0.17 }, 'dark', [0, -0.025, 0.115]);
    k.armor(head, { w: 0.12, h: 0.055, d: 0.05, tw: 0.15 }, 'sub', [0, -0.075, 0.125]);
    k.armor(head, { w: 0.11, h: 0.06, d: 0.05 }, 'trim', [0, 0.075, 0.115]);
    k.box(head, [0.03, 0.02, 0.02], 'glow', [0, 0.08, 0.142]);
    for (const side of [-1, 1]) {
      k.box(head, [0.075, 0.022, 0.02], 'glow', [side * 0.043, 0.002, 0.148], [0, 0, side * 0.3]); // つり目のバイザー
      k.plate(head, [[0, 0], [side * 0.035, 0.012], [side * 0.15, 0.2], [side * 0.125, 0.21]], 0.025, 'accent', [0, 0.06, 0.135], [-0.3, 0, 0]); // V字の角
      k.prism(head, { r: 0.045, len: 0.05, sides: 6, axis: 'x' }, 'dark', [side * 0.125, 0, 0]); // 耳のセンサー
      k.box(head, [0.012, 0.05, 0.012], 'glow', [side * 0.152, 0, 0]);
    }
    k.plate(head, [[-0.016, 0], [0.016, 0], [0, 0.08]], 0.02, 'accent', [0, 0.1, 0.12], [-0.2, 0, 0]);
    k.halo(head, [0, 0, 0.19], 0.3);
    return {
      waist: 1, head,
      shoulderX: 0.5, shoulderY: 1.8, hipX: 0.17, backY: 1.62, backZ: -0.24, arm: 1,
      pad(k, shoulder, sign) {
        pauldron(k, shoulder, sign, 1, 'main');
        k.plate(shoulder, [[-0.16, 0.13], [0.14, 0.11], [0.12, -0.05], [-0.14, -0.05]], 0.03, 'trim', [sign * 0.255, 0.04, 0], [0, 0, -sign * 0.4], 'x'); // 外のふちの板
        k.box(shoulder, [0.02, 0.03, 0.22], 'glow', [sign * 0.278, 0.03, 0], [0, 0, -sign * 0.4]);
        k.plate(shoulder, [[-0.13, 0], [0.11, 0], [0.06, 0.07], [-0.11, 0.16]], 0.03, 'accent', [sign * 0.08, 0.2, -0.01], [0, 0, -sign * 0.32], 'x'); // 金の羽
      },
      back(k, back) {
        k.armor(back, { w: 0.42, h: 0.4, d: 0.18, tw: 0.48 }, 'dark', [0, 0, -0.04]);
        k.armor(back, { w: 0.3, h: 0.28, d: 0.06, tw: 0.34 }, 'main', [0, 0.02, -0.14]);
        k.box(back, [0.2, 0.016, 0.02], 'glow', [0, 0.1, -0.172]);
        for (const side of [-1, 1]) {
          const fin = k.group(back, [side * 0.17, 0.06, -0.1], [0, 0, side * -0.3]);
          k.plate(fin, [[0, 0], [-0.13, 0.02], [-0.36, 0.48], [-0.25, 0.5]], 0.03, 'trim', [0, 0, 0], [0, 0, 0], 'x'); // 安定翼
          k.plate(fin, [[-0.25, 0.5], [-0.36, 0.48], [-0.42, 0.6]], 0.03, 'accent', [0, 0, 0], [0, 0, 0], 'x');
          k.beam(fin, [side * 0.018, 0.04, -0.07], [side * 0.018, 0.46, -0.31], 0.016, 'glow');
        }
        return nozzles(k, back, [[-0.13, -0.24, -0.1], [0.13, -0.24, -0.1]]);
      },
    };
  },
  // 重い。分厚い胸と大きな胸板・吸気口、とげのついた大きな肩、一つ目と一本角の頭、背中に2本のタンクと大きな噴射口
  iwao(k, upper) {
    const chest = { w: 0.6, h: 0.5, d: 0.46, tw: 1.06, td: 0.54, shift: 0.06, ridge: 0.4 };
    k.armor(upper, chest, 'main', [0, 1.66, 0]);
    const surface = chestSurface(chest, 1.66);
    k.chestPlates(upper, surface, [0.04, 0.92, 0.02, 0.44], 'trim', { t: 0.08, glow: false }); // 厚い胸板
    k.chestVents(upper, surface, 0.42, 0.74, 4, [0.15, 0.02, 0.05], 'dark'); // 胸の吸気口
    const mid = surface(0, 0.72);
    k.box(upper, [0.026, 0.16, 0.02], 'glow', [0, mid.y, mid.z + 0.012]);
    k.halo(upper, [0, mid.y, mid.z + 0.06], 0.32);
    neck(k, upper, 1.92, 1.2);
    const head = k.group(upper, [0, 2.06, 0.05]);
    head.scale.setScalar(1.05);
    k.armor(head, { w: 0.3, h: 0.2, d: 0.28, tw: 0.24, td: 0.24 }, 'main');
    k.armor(head, { w: 0.34, h: 0.07, d: 0.18, tw: 0.3 }, 'trim', [0, 0.085, 0.06]);
    k.box(head, [0.22, 0.045, 0.03], 'dark', [0, -0.005, 0.135]);
    k.box(head, [0.06, 0.04, 0.035], 'glow', [0.03, -0.005, 0.14]); // 一つ目
    k.armor(head, { w: 0.16, h: 0.07, d: 0.06, tw: 0.2 }, 'sub', [0, -0.07, 0.12]);
    k.plate(head, [[-0.03, 0], [0.03, 0], [0.012, 0.16], [-0.012, 0.16]], 0.04, 'accent', [0, 0.11, 0.1], [-0.5, 0, 0]); // 一本角
    for (const side of [-1, 1]) k.prism(head, { r: 0.05, len: 0.08, sides: 6, axis: 'x' }, 'dark', [side * 0.16, -0.01, -0.02]);
    k.halo(head, [0.03, -0.005, 0.19], 0.26);
    return {
      waist: 1.2, head,
      shoulderX: 0.62, shoulderY: 1.82, hipX: 0.21, backY: 1.64, backZ: -0.3, arm: 1.2,
      pad(k, shoulder, sign) {
        pauldron(k, shoulder, sign, 1.45, 'main', 0.06);
        k.plate(shoulder, [[-0.24, 0.12], [0.22, 0.1], [0.2, -0.08], [-0.22, -0.08]], 0.04, 'trim', [sign * 0.38, -0.04, 0], [0, 0, -sign * 0.42], 'x'); // 外のふちの厚い板
        for (const z of [-0.13, 0.11]) k.hull(shoulder, [[sign * 0.06, 0.28, z - 0.05], [sign * 0.06, 0.28, z + 0.05], [sign * 0.18, 0.25, z], [sign * 0.13, 0.5, z]], 'accent'); // 肩のとげ
        k.box(shoulder, [0.022, 0.04, 0.32], 'glow', [sign * 0.405, -0.02, 0], [0, 0, -sign * 0.42]);
      },
      back(k, back) {
        k.armor(back, { w: 0.56, h: 0.46, d: 0.22, tw: 0.62 }, 'dark', [0, 0, -0.05]);
        for (const side of [-1, 1]) {
          k.prism(back, { r: 0.11, len: 0.42, sides: 8 }, 'main', [side * 0.2, 0, -0.2]); // 推進剤のタンク
          k.prism(back, { r: 0.116, len: 0.04, sides: 8 }, 'accent', [side * 0.2, 0.12, -0.2]);
          k.box(back, [0.016, 0.24, 0.02], 'glow', [side * 0.2, -0.04, -0.315]);
        }
        return nozzles(k, back, [[-0.2, -0.28, -0.2], [0.2, -0.28, -0.2]], 1.35);
      },
    };
  },
  // 軽くて速い。細い胸に V 字の胸板、とがった頭から後ろへ流れる2本の刃の角、肩と背中に後ろへ流れる刃の羽
  hayate(k, upper) {
    const chest = { w: 0.42, h: 0.44, d: 0.32, tw: 0.76, td: 0.4, shift: 0.06, ridge: 0.4 };
    k.armor(upper, chest, 'main', [0, 1.66, 0]);
    const surface = chestSurface(chest, 1.66);
    k.chestPlates(upper, surface, [0.04, 0.94, 0.02, 0.62], 'trim', { taper: 0.6 }); // V字の胸板
    core(k, upper, surface(0, 0.8).toArray(), 0.8);
    neck(k, upper, 1.88, 0.9);
    const head = k.group(upper, [0, 2.04, 0.02]);
    head.scale.setScalar(1.1);
    k.armor(head, { w: 0.21, h: 0.19, d: 0.27, tw: 0.15, td: 0.22, shift: 0.05 }, 'main', [0, 0.02, 0]);
    k.armor(head, { w: 0.15, h: 0.07, d: 0.06, tw: 0.16 }, 'dark', [0, -0.015, 0.12]);
    k.armor(head, { w: 0.1, h: 0.05, d: 0.05, tw: 0.13 }, 'sub', [0, -0.07, 0.12]);
    for (const side of [-1, 1]) {
      k.box(head, [0.07, 0.016, 0.02], 'glow', [side * 0.04, -0.005, 0.15], [0, 0, side * 0.35]);
      k.plate(head, [[0.04, 0], [0.08, 0.02], [-0.28, 0.2], [-0.3, 0.16]], 0.025, 'trim', [side * 0.09, 0.06, 0.02], [0, 0, side * -0.3], 'x'); // 後ろへ流れる刃の角
    }
    k.halo(head, [0, 0, 0.19], 0.28);
    return {
      waist: 0.9, head,
      shoulderX: 0.45, shoulderY: 1.78, hipX: 0.16, backY: 1.6, backZ: -0.22, arm: 0.9,
      pad(k, shoulder, sign) {
        pauldron(k, shoulder, sign, 0.82, 'main', 0.05);
        k.plate(shoulder, [[0.08, 0], [-0.14, 0], [-0.32, 0.13], [-0.27, 0.16]], 0.025, 'trim', [sign * 0.13, 0.1, 0], [0, 0, -sign * 0.55], 'x'); // 後ろへ流れる羽
        k.box(shoulder, [0.016, 0.03, 0.16], 'glow', [sign * 0.2, 0.02, 0], [0, 0, -sign * 0.5]);
      },
      back(k, back) {
        k.armor(back, { w: 0.36, h: 0.36, d: 0.16, tw: 0.42 }, 'dark', [0, 0, -0.03]);
        for (const side of [-1, 1]) {
          const fin = k.group(back, [side * 0.14, 0.04, -0.08], [0, side * -0.5, side * -0.6]);
          k.plate(fin, [[0, 0.05], [0, -0.05], [-0.46, 0.2], [-0.42, 0.26]], 0.025, 'trim', [0, 0, 0], [0, 0, 0], 'x'); // 横へ流れる刃の羽
          k.beam(fin, [side * 0.016, 0.04, -0.02], [side * 0.016, 0.23, -0.43], 0.016, 'glow');
        }
        return nozzles(k, back, [[-0.11, -0.2, -0.08], [0.11, -0.2, -0.08]], 0.9);
      },
    };
  },
  // 空を飛ぶ。鳥のくちばしのような顔と後ろへ反ったとさか、羽根の肩、背中に3枚ずつの大きな刃の翼 (前のふちが光る)
  tsubame(k, upper) {
    const chest = { w: 0.46, h: 0.44, d: 0.36, tw: 0.8, td: 0.42, shift: 0.05, ridge: 0.4 };
    k.armor(upper, chest, 'main', [0, 1.66, 0]);
    const surface = chestSurface(chest, 1.66);
    k.chestPlates(upper, surface, [0.04, 0.82, 0.02, 0.46], 'trim', { taper: 0.2 });
    core(k, upper, surface(0, 0.8).toArray());
    neck(k, upper, 1.9, 0.95);
    const head = k.group(upper, [0, 2.06, 0.02]);
    head.scale.setScalar(1.08);
    k.hull(head, [
      [-0.11, -0.08, -0.12], [0.11, -0.08, -0.12], [-0.11, 0.09, -0.1], [0.11, 0.09, -0.1],
      [-0.09, -0.07, 0.09], [0.09, -0.07, 0.09], [-0.075, 0.08, 0.07], [0.075, 0.08, 0.07], [0, -0.03, 0.21],
    ], 'main');
    k.box(head, [0.18, 0.026, 0.02], 'glow', [0, 0.02, 0.105]);
    k.plate(head, [[0.06, 0], [0.1, 0.01], [-0.3, 0.27], [-0.34, 0.24]], 0.03, 'accent', [0, 0.08, 0], [0, 0, 0], 'x'); // とさか
    for (const side of [-1, 1]) {
      k.plate(head, [[0.02, 0], [0.05, 0.01], [-0.2, 0.15], [-0.22, 0.12]], 0.02, 'trim', [side * 0.08, 0.05, -0.02], [0, 0, side * -0.4], 'x');
    }
    k.halo(head, [0, 0.02, 0.16], 0.28);
    return {
      waist: 0.95, head,
      shoulderX: 0.48, shoulderY: 1.8, hipX: 0.17, backY: 1.64, backZ: -0.25, arm: 0.95,
      pad(k, shoulder, sign) {
        pauldron(k, shoulder, sign, 0.95, 'main');
        for (const [z, len] of [[0.08, 0.2], [-0.04, 0.26], [-0.14, 0.2]]) {
          k.plate(shoulder, [[0.04, 0], [-0.04, 0], [-0.06, len], [0, len + 0.04]], 0.02, 'trim', [sign * 0.14, 0.12, z], [0.5, 0, -sign * 0.7], 'x'); // 羽根
        }
        k.box(shoulder, [0.018, 0.03, 0.2], 'glow', [sign * 0.24, 0.0, 0], [0, 0, -sign * 0.4]);
      },
      back(k, back) {
        k.armor(back, { w: 0.4, h: 0.38, d: 0.18, tw: 0.46 }, 'dark', [0, 0, -0.04]);
        for (const side of [-1, 1]) {
          const wing = k.group(back, [side * 0.2, 0.14, -0.1]);
          const blades = [
            { tip: [side * 0.95, 0.7, -0.5], root: 0.13 },
            { tip: [side * 0.85, 0.32, -0.66], root: 0.1 },
            { tip: [side * 0.62, -0.04, -0.62], root: 0.08 },
          ];
          for (const { tip, root } of blades) {
            const [tx, ty, tz] = tip;
            k.hull(wing, [
              [0, root, 0.02], [0, -root, -0.02], [side * 0.03, 0, 0.06], [side * 0.03, 0, -0.1],
              [tx, ty, tz], [tx * 0.8, ty * 0.68, tz - 0.12], [tx * 0.5, ty * 0.45 + 0.05, tz * 0.5 + 0.03],
            ], 'trim');
            k.beam(wing, [side * 0.02, root * 0.6, 0.03], [tx, ty, tz], 0.022, 'glow');
          }
        }
        return nozzles(k, back, [[-0.12, -0.22, -0.1], [0.12, -0.22, -0.1]]);
      },
    };
  },
};

// ショット (右の前腕の先)。ひじが原点で、前へのびる。発射口の位置を返す
const GUN_MODELS = {
  // 3連射: 角ばった機関部に、長めの銃身と照準
  triple(k, e) {
    k.armor(e, { w: 0.2, h: 0.22, d: 0.32 }, 'dark', [0, 0.02, 0.44]);
    k.armor(e, { w: 0.11, h: 0.05, d: 0.24, tw: 0.08 }, 'trim', [0, 0.15, 0.44]);
    k.prism(e, { r: 0.05, len: 0.46, sides: 6, axis: 'z' }, 'metal', [0, 0.03, 0.8]);
    k.prism(e, { r: 0.075, len: 0.1, sides: 6, axis: 'z' }, 'dark', [0, 0.03, 1.0]);
    k.box(e, [0.02, 0.04, 0.24], 'glow', [-0.105, 0.04, 0.44]);
    return [0, 0.03, 1.06];
  },
  // 6本の銃身を束ねた回る筒と、光る輪
  gatling(k, e) {
    k.prism(e, { r: 0.15, len: 0.22, sides: 6, axis: 'z' }, 'dark', [0, 0.02, 0.44]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      k.prism(e, { r: 0.028, len: 0.5, axis: 'z' }, 'metal', [Math.cos(a) * 0.085, 0.02 + Math.sin(a) * 0.085, 0.78]);
    }
    k.prism(e, { r: 0.13, len: 0.04, sides: 6, axis: 'z' }, 'dark', [0, 0.02, 0.98]);
    k.prism(e, { r: 0.155, len: 0.03, sides: 6, axis: 'z' }, 'glow', [0, 0.02, 0.32]);
    k.armor(e, { w: 0.08, h: 0.06, d: 0.2 }, 'trim', [0, 0.17, 0.44]);
    return [0, 0.02, 1.04];
  },
  // 横に広い板の先から5方向へ撃つ
  spread(k, e) {
    k.hull(e, [
      [-0.15, -0.07, 0.26], [0.15, -0.07, 0.26], [-0.15, 0.07, 0.26], [0.15, 0.07, 0.26],
      [-0.27, -0.05, 0.62], [0.27, -0.05, 0.62], [-0.27, 0.05, 0.62], [0.27, 0.05, 0.62],
    ], 'trim', [0, 0.02, 0]);
    k.box(e, [0.48, 0.03, 0.02], 'glow', [0, 0.02, 0.625]);
    k.armor(e, { w: 0.2, h: 0.12, d: 0.22 }, 'dark', [0, 0.11, 0.4]);
    for (const side of [-1, 1]) k.plate(e, [[-0.08, 0], [0.08, 0], [0.06, 0.08]], 0.02, 'accent', [side * 0.2, 0.08, 0.5], [0, 0, 0], 'x');
    return [0, 0.02, 0.64];
  },
  // 2本のレールのあいだに光る芯がとおった、長い1発の銃
  rail(k, e) {
    k.armor(e, { w: 0.24, h: 0.2, d: 0.24 }, 'dark', [0, 0.03, 0.34]);
    for (const side of [-1, 1]) {
      k.armor(e, { w: 0.05, h: 0.11, d: 0.9, tw: 0.04 }, 'metal', [side * 0.075, 0.03, 0.75]);
      k.plate(e, [[-0.1, 0], [0.12, 0], [-0.04, 0.07]], 0.02, 'accent', [side * 0.1, 0.1, 0.36], [0, 0, side * -0.4], 'x');
    }
    k.box(e, [0.025, 0.025, 0.82], 'glow', [0, 0.03, 0.77]);
    return [0, 0.03, 1.2];
  },
  // 4つの光る穴があいた箱 (追いかける弾)
  homing(k, e) {
    k.armor(e, { w: 0.32, h: 0.28, d: 0.32 }, 'trim', [0, 0.04, 0.42]);
    k.armor(e, { w: 0.34, h: 0.05, d: 0.28 }, 'accent', [0, 0.2, 0.42]);
    for (const x of [-0.075, 0.075]) for (const y of [-0.025, 0.105]) k.prism(e, { r: 0.04, len: 0.03, axis: 'z' }, 'glow', [x, y, 0.585]);
    return [0, 0.04, 0.6];
  },
  // マイクロミサイル: 少し上を向いた発射機に、2列2段の発射筒 (中に赤い弾頭が見える) と、横の照準
  micro(k, e) {
    const pod = k.group(e, [0, 0.06, 0.44], [-0.12, 0, 0]);
    k.armor(pod, { w: 0.3, h: 0.26, d: 0.36, tw: 0.28 }, 'trim', [0, 0, 0]);
    k.armor(pod, { w: 0.32, h: 0.05, d: 0.3 }, 'accent', [0, 0.155, -0.02]);
    for (const x of [-0.07, 0.07]) {
      for (const y of [-0.055, 0.06]) {
        k.prism(pod, { r: 0.048, len: 0.05, sides: 6, axis: 'z' }, 'dark', [x, y, 0.17]);
        k.add(pod, new THREE.ConeGeometry(0.032, 0.06, 6).rotateX(Math.PI / 2), 'sub', [x, y, 0.19]);
      }
    }
    k.box(e, [0.02, 0.04, 0.22], 'glow', [-0.165, 0.05, 0.44]);
    return [0, 0.1, 0.64];
  },
  // ビームキャノン: 角ばった機関部から、太い砲身が前へのびる。砲身には光る輪を3つ重ね、先の口と光の輪が光る
  beam(k, e) {
    k.armor(e, { w: 0.26, h: 0.26, d: 0.38 }, 'dark', [0, 0.03, 0.42]);
    k.armor(e, { w: 0.15, h: 0.06, d: 0.32, tw: 0.1 }, 'trim', [0, 0.19, 0.42]);
    k.prism(e, { r: 0.085, r2: 0.105, len: 0.62, sides: 8, axis: 'z' }, 'metal', [0, 0.03, 0.88]);
    for (const z of [0.72, 0.9, 1.08]) k.prism(e, { r: 0.112, len: 0.03, sides: 8, axis: 'z' }, 'glow', [0, 0.03, z]);
    k.prism(e, { r: 0.125, len: 0.08, sides: 8, axis: 'z' }, 'dark', [0, 0.03, 1.2]);
    k.prism(e, { r: 0.07, len: 0.02, sides: 8, axis: 'z' }, 'glow', [0, 0.03, 1.245]);
    k.box(e, [0.02, 0.04, 0.26], 'glow', [-0.14, 0.04, 0.42]);
    k.halo(e, [0, 0.03, 1.28], 0.42);
    return [0, 0.03, 1.27];
  },
};

// グレネード (左の前腕の先)
const BOMB_MODELS = {
  frag(k, e) {
    k.armor(e, { w: 0.25, h: 0.23, d: 0.34, tw: 0.22 }, 'trim', [0, 0.04, 0.42]);
    k.prism(e, { r: 0.08, len: 0.14, sides: 6, axis: 'z' }, 'dark', [0, 0.05, 0.64]);
    k.prism(e, { r: 0.055, len: 0.02, sides: 6, axis: 'z' }, 'glow', [0, 0.05, 0.71]);
    k.box(e, [0.02, 0.03, 0.22], 'glow', [0.135, 0.04, 0.42]);
    return [0, 0.05, 0.74];
  },
  cluster(k, e) {
    k.armor(e, { w: 0.32, h: 0.32, d: 0.08 }, 'dark', [0, 0.05, 0.26]);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      k.prism(e, { r: 0.065, len: 0.42, sides: 6, axis: 'z' }, 'trim', [Math.cos(a) * 0.1, 0.05 + Math.sin(a) * 0.1, 0.49]);
      k.prism(e, { r: 0.04, len: 0.02, sides: 6, axis: 'z' }, 'glow', [Math.cos(a) * 0.1, 0.05 + Math.sin(a) * 0.1, 0.71]);
    }
    return [0, 0.06, 0.74];
  },
  megaton(k, e) {
    k.prism(e, { r: 0.17, r2: 0.21, len: 0.5, sides: 6, axis: 'z' }, 'trim', [0, 0.07, 0.48]);
    k.prism(e, { r: 0.19, len: 0.06, sides: 6, axis: 'z' }, 'dark', [0, 0.07, 0.74]);
    k.prism(e, { r: 0.11, len: 0.02, sides: 6, axis: 'z' }, 'glow', [0, 0.07, 0.775]);
    k.prism(e, { r: 0.215, len: 0.04, sides: 6, axis: 'z' }, 'accent', [0, 0.07, 0.36]);
    return [0, 0.07, 0.8];
  },
  snap(k, e) {
    k.armor(e, { w: 0.16, h: 0.16, d: 0.5 }, 'trim', [0, 0.05, 0.48]);
    k.box(e, [0.03, 0.02, 0.36], 'glow', [0, 0.135, 0.48]);
    k.prism(e, { r: 0.05, len: 0.06, sides: 6, axis: 'z' }, 'dark', [0, 0.05, 0.75]);
    return [0, 0.05, 0.79];
  },
  // ハイミサイル: 腕には狙いをつける照準器 (光るレンズとアンテナ)。背中 (back) の左右に、上を向いた発射口の箱をつける
  // (ミサイルはそこから打ち上がる: weapons.js の ROCKET_PORT)
  rocket(k, e, back) {
    k.armor(e, { w: 0.22, h: 0.2, d: 0.32, tw: 0.18 }, 'trim', [0, 0.05, 0.42]);
    k.prism(e, { r: 0.075, len: 0.05, sides: 8, axis: 'z' }, 'dark', [0, 0.06, 0.6]);
    k.prism(e, { r: 0.05, len: 0.02, sides: 8, axis: 'z' }, 'glow', [0, 0.06, 0.63]);
    k.plate(e, [[-0.02, 0], [0.02, 0], [0.005, 0.16], [-0.005, 0.16]], 0.02, 'accent', [0.06, 0.15, 0.36], [0.3, 0, 0]);
    for (const side of [-1, 1]) {
      const box = k.group(back, [side * 0.24, 0.42, -0.14], [0, 0, side * -0.08]);
      k.armor(box, { w: 0.16, h: 0.22, d: 0.16, tw: 0.14, td: 0.14 }, 'trim', [0, 0, 0]);
      k.box(box, [0.1, 0.02, 0.1], 'dark', [0, 0.115, 0]);
      k.box(box, [0.06, 0.012, 0.06], 'glow', [0, 0.128, 0]);
    }
    return [0, 0.06, 0.64];
  },
};

// マイン (背中の上)。背中が原点で、後ろが -z。出てくる場所を返す
const POD_MODELS = {
  // 背負いものの上に、後ろへ倒した2本の筒
  float(k, back) {
    for (const side of [-1, 1]) {
      const pod = k.group(back, [side * 0.14, 0.2, -0.17], [-0.6, 0, side * -0.15]);
      k.prism(pod, { r: 0.07, len: 0.26, sides: 6 }, 'trim');
      k.prism(pod, { r: 0.075, len: 0.03, sides: 6 }, 'dark', [0, 0.06, 0]);
      k.prism(pod, { r: 0.05, len: 0.02, sides: 6 }, 'glow', [0, 0.135, 0]);
    }
    return [0, 0.4, -0.38];
  },
  // 背中の真ん中に、光る帯を巻いた玉
  bound(k, back) {
    k.prism(back, { r: 0.14, len: 0.06, sides: 6 }, 'dark', [0, 0.22, -0.18]);
    k.add(back, new THREE.IcosahedronGeometry(0.14), 'trim', [0, 0.34, -0.18]);
    k.prism(back, { r: 0.145, len: 0.025, sides: 6 }, 'glow', [0, 0.34, -0.18]);
    return [0, 0.48, -0.36];
  },
  // 左右に開いた、2つの先細りの入れ物
  twin(k, back) {
    for (const side of [-1, 1]) {
      k.armor(back, { w: 0.16, h: 0.26, d: 0.18, tw: 0.1, td: 0.13 }, 'trim', [side * 0.24, 0.2, -0.15], [0, 0, side * -0.4]);
      k.prism(back, { r: 0.032, len: 0.03 }, 'glow', [side * 0.3, 0.33, -0.15], [0, 0, side * -0.4]);
    }
    return [0, 0.45, -0.36];
  },
  trap(k, back) {
    k.armor(back, { w: 0.6, h: 0.16, d: 0.3, tw: 0.54 }, 'trim', [0, -0.1, -0.24]);
    k.box(back, [0.44, 0.03, 0.02], 'glow', [0, -0.1, -0.4]);
    return [0, -0.22, -0.48];
  },
};

// 脚 (片脚ずつ)。付け根 (hip) が原点で、ひざ (knee) の下にすねと足 (足の裏が、ひざから LEG.shin 下)。
// side: 脚のある側 (-1 は右、1 は左。光るラインを外側につける)。ひざを返す (歩くときに曲げる)
const LEG_MODELS = {
  // ふつうの脚。とがったひざ、下ほど太いすねと前の板、ふくらはぎの羽、つま先とかかとのとげ
  walker(k, hip, side) {
    k.armor(hip, { w: 0.19, h: 0.42, d: 0.23, tw: 0.22, td: 0.26 }, 'main', [0, -0.24, 0]);
    k.armor(hip, { w: 0.08, h: 0.24, d: 0.05, tw: 0.1 }, 'trim', [0, -0.22, 0.125], [0.06, 0, 0]);
    k.box(hip, [0.016, 0.2, 0.03], 'glow', [side * 0.103, -0.26, 0.03]);
    const knee = k.group(hip, [0, -THIGH, 0.02]);
    k.joint(knee, 0.085);
    k.hull(knee, kneeGuard(), 'trim');
    k.armor(knee, { w: 0.24, h: 0.44, d: 0.3, tw: 0.2, td: 0.25 }, 'main', [0, -0.29, -0.01]);
    k.armor(knee, { w: 0.15, h: 0.27, d: 0.05, tw: 0.12 }, 'trim', [0, -0.28, 0.15], [-0.07, 0, 0]);
    k.box(knee, [0.016, 0.26, 0.03], 'glow', [side * 0.123, -0.3, 0]);
    k.plate(knee, [[-0.11, 0.1], [0.02, 0.06], [0.02, -0.16], [-0.07, -0.12]], 0.03, 'trim', [side * 0.12, -0.24, -0.08], [0, 0, side * 0.12], 'x');
    k.armor(knee, { w: 0.12, h: 0.07, d: 0.14 }, 'dark', [0, -0.5, 0]);
    k.armor(knee, { w: 0.22, h: 0.08, d: 0.46, tw: 0.17, td: 0.38 }, 'dark', [0, -0.56, 0.07]);
    k.armor(knee, { w: 0.18, h: 0.06, d: 0.14, tw: 0.14 }, 'sub', [0, -0.53, 0.25]);
    k.hull(knee, [[-0.05, -0.6, -0.12], [0.05, -0.6, -0.12], [0, -0.59, -0.25], [-0.04, -0.5, -0.12], [0.04, -0.5, -0.12]], 'accent');
    return knee;
  },
  // 速く走る。細いすねに後ろへ流れるひれ、かかととつま先の車輪
  dasher(k, hip, side) {
    k.armor(hip, { w: 0.17, h: 0.42, d: 0.21, tw: 0.2, td: 0.24 }, 'main', [0, -0.24, 0]);
    k.box(hip, [0.016, 0.22, 0.03], 'glow', [side * 0.095, -0.26, 0.04]);
    const knee = k.group(hip, [0, -THIGH, 0.02]);
    k.joint(knee, 0.08);
    k.hull(knee, kneeGuard(0.9), 'trim');
    k.armor(knee, { w: 0.19, h: 0.44, d: 0.24, tw: 0.17, td: 0.22 }, 'main', [0, -0.28, 0]);
    k.plate(knee, [[0, 0.02], [0, -0.3], [-0.22, -0.06]], 0.03, 'trim', [0, -0.12, -0.12], [0, 0, 0], 'x'); // ふくらはぎのひれ
    k.box(knee, [0.016, 0.3, 0.02], 'glow', [side * 0.1, -0.3, 0.08]);
    k.armor(knee, { w: 0.2, h: 0.08, d: 0.42, tw: 0.15, td: 0.34 }, 'dark', [0, -0.55, 0.06]);
    for (const z of [-0.13, 0.22]) k.prism(knee, { r: 0.065, len: 0.09, sides: 6, axis: 'x' }, 'metal', [0, -0.535, z]);
    k.hull(knee, [[-0.06, -0.53, 0.24], [0.06, -0.53, 0.24], [0, -0.5, 0.36], [0, -0.58, 0.32]], 'sub');
    return knee;
  },
  // 高く跳ぶ。太いもも、すねのばねと軸、つめのついた大きな足
  hopper(k, hip, side) {
    k.armor(hip, { w: 0.24, h: 0.42, d: 0.28, tw: 0.28, td: 0.31 }, 'main', [0, -0.24, 0]);
    k.armor(hip, { w: 0.17, h: 0.22, d: 0.05 }, 'trim', [0, -0.2, 0.15], [0.08, 0, 0]);
    k.box(hip, [0.016, 0.2, 0.03], 'glow', [side * 0.13, -0.26, 0.02]);
    const knee = k.group(hip, [0, -THIGH, 0.02]);
    k.joint(knee, 0.1);
    k.hull(knee, kneeGuard(1.1), 'trim');
    k.armor(knee, { w: 0.24, h: 0.16, d: 0.27 }, 'main', [0, -0.11, 0]);
    for (let i = 0; i < 4; i++) k.prism(knee, { r: 0.085, len: 0.022, sides: 6 }, 'metal', [0, -0.23 - i * 0.05, 0]);
    k.prism(knee, { r: 0.035, len: 0.26 }, 'dark', [0, -0.3, 0]);
    k.armor(knee, { w: 0.16, h: 0.08, d: 0.18 }, 'dark', [0, -0.47, 0]);
    k.armor(knee, { w: 0.3, h: 0.08, d: 0.5, tw: 0.26, td: 0.42 }, 'dark', [0, -0.56, 0.07]);
    for (const x of [-0.1, 0, 0.1]) k.hull(knee, [[x - 0.035, -0.6, 0.3], [x + 0.035, -0.6, 0.3], [x, -0.52, 0.3], [x, -0.59, 0.43]], 'sub');
    k.hull(knee, [[-0.04, -0.6, -0.17], [0.04, -0.6, -0.17], [0, -0.52, -0.17], [0, -0.59, -0.3]], 'accent');
    return knee;
  },
};

// side: 'you' / 'cpu' / 'green' / 'pink' (色分け。TEAM_LOOKS)
export function buildRobotModel(loadout, side) {
  const team = TEAM_LOOKS[side] ?? TEAM_LOOKS.you;
  const scheme = FRAME_SCHEMES[loadout.frame] ?? FRAME_SCHEMES.aogane;
  const tone = (kind) => (kind === 'team' ? team.team : scheme.white);
  const glowColor = new THREE.Color(GLOW_COLORS[side]);
  // 塗装した装甲 (つやのあるクリアを上に重ねる) と、中の機械や銃身の金属
  const paint = (color, metalness = 0.08, roughness = 0.42) => armored(new THREE.MeshPhysicalMaterial({
    color, metalness, roughness, clearcoat: 1, clearcoatRoughness: 0.14, flatShading: true,
  }), glowColor);
  const steel = (color, metalness, roughness) => armored(new THREE.MeshStandardMaterial({ color, metalness, roughness, flatShading: true }), glowColor);
  const materials = {
    main: paint(tone(scheme.main)),
    trim: paint(tone(scheme.trim)),
    accent: paint(ACCENT, 0.35, 0.32),
    sub: paint(team.sub),
    dark: steel(0x3a404b, 0.55, 0.48),
    metal: steel(0xb4bdcc, 0.95, 0.2),
    glow: new THREE.MeshBasicMaterial({ color: glowColor.clone().multiplyScalar(GLOW_BOOST) }),
    flame: new THREE.MeshBasicMaterial({
      color: glowColor.clone().multiplyScalar(GLOW_BOOST * 0.8), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
    bladeCore: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    halo: new THREE.SpriteMaterial({
      map: haloTexture(), color: glowColor, transparent: true, opacity: HALO_OPACITY, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  };
  const k = new Kit(materials);
  const root = new THREE.Group();
  const body = k.group(root); // ダウンで倒れる部分 (腰から下と、上半身)
  const torso = k.group(body, [0, WAIST_Y, 0]); // 上半身 (腰の上でひねる・かがむ)
  const upper = k.group(torso, [0, -WAIST_Y, 0]); // 上半身の部品は、ここに足元から測った位置で置く
  const frame = (FRAME_MODELS[loadout.frame] ?? FRAME_MODELS.aogane)(k, upper);
  waist(k, body, upper, frame.waist);

  // 腕: 肩の装甲 (フレームごと)、細い二の腕、太い前腕 (ひじにとげ、外に光るライン)。前腕の先に武器 (右手 -x がショット、左手 +x がグレネード)
  const arm = (sign) => {
    const s = frame.arm;
    const shoulder = k.group(upper, [sign * frame.shoulderX, frame.shoulderY, 0]);
    k.joint(shoulder, 0.1);
    frame.pad(k, shoulder, sign);
    k.armor(shoulder, { w: 0.13 * s, h: 0.3, d: 0.15 * s, tw: 0.15 * s }, 'dark', [0, -0.2, 0]);
    k.armor(shoulder, { w: 0.16 * s, h: 0.13, d: 0.18 * s, tw: 0.17 * s }, 'main', [0, -0.11, 0]);
    const elbow = k.group(shoulder, [0, -UPPER_ARM, 0.02]);
    k.joint(elbow, 0.08);
    k.armor(elbow, { w: 0.19 * s, h: 0.19 * s, d: 0.42, tw: 0.21 * s, td: 0.4 }, 'main', [0, 0, 0.15]);
    k.armor(elbow, { w: 0.12 * s, h: 0.04, d: 0.3, tw: 0.1 * s }, 'trim', [0, 0.105 * s, 0.17]);
    k.box(elbow, [0.016, 0.03, 0.26], 'glow', [sign * 0.108 * s, -0.01, 0.16]);
    k.hull(elbow, [[-0.05, 0.03, -0.03], [0.05, 0.03, -0.03], [-0.05, -0.06, -0.03], [0.05, -0.06, -0.03], [0, -0.02, -0.17]], 'trim');
    return { shoulder, elbow };
  };
  const marker = (parent, [x, y, z]) => {
    const point = new THREE.Object3D();
    point.position.set(x, y, z);
    parent.add(point);
    return point;
  };
  // 背中のグループ (背負いものとマインの入れ物はあとでつける。グレネードのハイミサイルは、ここにも発射口をつける)
  const back = k.group(upper, [0, frame.backY, frame.backZ]);
  const gunArm = arm(-1);
  const gunTip = marker(gunArm.elbow, (GUN_MODELS[loadout.gun] ?? GUN_MODELS.triple)(k, gunArm.elbow));
  const bombArm = arm(1);
  const bombTip = marker(bombArm.elbow, (BOMB_MODELS[loadout.bomb] ?? BOMB_MODELS.frag)(k, bombArm.elbow, back));
  // ブレードの光の刃: 右の前腕から前へのびる (白い芯と、まわりの光。斬るときだけ見せる)
  const blade = k.group(gunArm.elbow, [0, 0.03, 0.5]);
  k.add(blade, new THREE.CylinderGeometry(0.022, 0.035, 1.5, 6).rotateX(Math.PI / 2).translate(0, 0, 0.75), 'bladeCore');
  k.add(blade, new THREE.CylinderGeometry(0.05, 0.095, 1.56, 6).rotateX(Math.PI / 2).translate(0, 0, 0.76), 'flame');
  for (const z of [0.3, 0.8, 1.3]) k.halo(blade, [0, 0, z], 0.5);
  blade.visible = false;

  // 背中: フレームごとの背負いもの (噴射口と炎はジャンプや空中ダッシュで大きくなる) と、マインの入れ物
  const thrusters = frame.back(k, back);
  const podTip = marker(back, (POD_MODELS[loadout.pod] ?? POD_MODELS.float)(k, back));

  // 脚
  const legs = [-1, 1].map((s) => {
    const hip = k.group(body, [s * frame.hipX, HIP_Y, 0]);
    k.joint(hip, 0.1);
    const knee = (LEG_MODELS[loadout.legs] ?? LEG_MODELS.walker)(k, hip, s);
    return { hip, knee };
  });

  bakeSeams(root);
  mergeStatic(root);

  // 発射口の位置 (足元から見た座標)。組み立てた形のまま計算する
  root.updateMatrixWorld(true);
  const local = (point) => point.getWorldPosition(new THREE.Vector3());
  return {
    root,
    body,
    torso, // 上半身 (ひねる・かがむ)
    head: frame.head, // 頭 (上半身をひねっても、相手のほうを向き直す)
    flash: [materials.main, materials.trim, materials.accent, materials.sub, materials.dark], // 撃たれたときに白く光らせる
    legs,
    arms: { gun: gunArm.shoulder, bomb: bombArm.shoulder }, // 肩 (ブレードを振るときと、シールドを構えるときに回す)
    elbows: { gun: gunArm.elbow, bomb: bombArm.elbow }, // ひじ (突きで腕をまっすぐのばすときに回す)
    blade,
    thrusters,
    muzzles: { gun: local(gunTip), bomb: local(bombTip), pod: local(podTip) },
  };
}

export function disposeModel(root) {
  const geometries = new Set();
  const materials = new Set();
  root.traverse((object) => {
    if (object.isSprite) materials.add(object.material); // 光の輪 (模様はどのロボも同じものを使うので、片付けない)
    if (!object.isMesh) return;
    geometries.add(object.geometry);
    materials.add(object.material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}
