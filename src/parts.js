// パーツ (部品) のデータ。フレーム・ショット・グレネード・マイン・脚の5か所を組み合わせてロボを作る。
// 名前と性能はこのゲームのオリジナル。最初は DEFAULT_LOADOUT と STARTER_PARTS だけ使え、ほかのパーツは大会でライバルに勝つと手に入る (rivals.js)
export const SLOTS = ['frame', 'gun', 'bomb', 'pod', 'legs'];
export const SLOT_NAMES = { frame: 'フレーム', gun: 'ショット', bomb: 'グレネード', pod: 'マイン', legs: '脚' };
const BASE_GRAVITY = 32;

export const PARTS = {
  // stats: speed (走る速さの倍率) / endurance (倒れにくさ: 短い間にこれだけ弾を受けるとダウン) /
  // armor (受けるダメージの倍率) / gravity (落ちる速さの倍率) / dashes (空中ダッシュの回数の増減) /
  // blade (ブレードの強さ。斬りのダメージは、この値に robot.js の SLASHES の damage (技ごとの割合) をかけたもの)
  frame: [
    {
      id: 'aogane', name: 'アオガネ', text: '走り・守り・ブレードのバランスがいい。はじめの1台',
      stats: { speed: 1, endurance: 150, armor: 1, gravity: 1, dashes: 0, blade: 130 },
    },
    {
      id: 'iwao', name: 'イワオ', text: '重くて遅いが、倒れにくく打たれ強い。ブレードが強い。空中ダッシュは1回少ない',
      stats: { speed: 0.86, endurance: 240, armor: 0.85, gravity: 1.15, dashes: -1, blade: 190 },
    },
    {
      id: 'hayate', name: 'ハヤテ', text: '軽くて速く、空中ダッシュが1回多い。そのかわり打たれ弱く、倒れやすい',
      stats: { speed: 1.15, endurance: 110, armor: 1.15, gravity: 1, dashes: 1, blade: 100 },
    },
    {
      id: 'tsubame', name: 'ツバメ', text: 'ふわりとゆっくり落ちる。高く跳べて、空中から撃ち続けるのが得意',
      stats: { speed: 0.95, endurance: 140, armor: 1.05, gravity: 0.6, dashes: 0, blade: 120 },
    },
  ],
  // spec: shots (1回で撃つ回数) / interval (その間隔 秒) / count (1回に扇形に出す弾の数) / fan (扇の広さ rad) /
  // speed / turn (相手を追う強さ rad/秒) / lead (先読み) / damage / spread (ぶれ) / life (秒) / size / stretch (弾の長さ) / cooldown /
  // missile: ミサイルの形で煙を引く (当たり方はふつうの弾と同じ) / rise: 撃つ向きを上へ向ける量 /
  // beam: 白い芯の入った太い光で、光の粒を引く / knockdown: 当たると相手がダウンする。
  // パーツの playerOnly: プレイヤーだけが使う (CPU の組み合わせには入れない)
  gun: [
    {
      id: 'triple', name: 'トリプル', text: '3連射。弾は少しだけ相手を追う',
      spec: { shots: 3, interval: 0.09, count: 1, fan: 0, speed: 32, turn: 1.2, lead: 0.5, damage: 30, spread: 0.06, life: 1.4, size: 1, stretch: 2.6, cooldown: 0.75 },
    },
    {
      id: 'gatling', name: 'ガトリング', text: '小さな弾を6連射。1発は弱いが、ばらまける',
      spec: { shots: 6, interval: 0.06, count: 1, fan: 0, speed: 36, turn: 0.9, lead: 0.5, damage: 17, spread: 0.07, life: 1.2, size: 0.7, stretch: 2.6, cooldown: 0.8 },
    },
    {
      id: 'spread', name: 'スプレッド', text: '5方向に広がる弾。遠くまでは届かないが、近いほど当たる',
      spec: { shots: 1, interval: 0, count: 5, fan: 0.2, speed: 32, turn: 0, lead: 0.8, damage: 34, spread: 0.02, life: 0.9, size: 0.9, stretch: 2, cooldown: 0.9 },
    },
    {
      id: 'rail', name: 'レール', text: 'とても速い1発。追いかけないが、ダメージが大きい',
      spec: { shots: 1, interval: 0, count: 1, fan: 0, speed: 55, turn: 0, lead: 0.8, damage: 95, spread: 0, life: 0.9, size: 1.3, stretch: 8, cooldown: 1.8 },
    },
    {
      id: 'homing', name: 'ホーミング', text: '遅い弾を2発。しつこく相手を追いかける',
      spec: { shots: 2, interval: 0.22, count: 1, fan: 0, speed: 17, turn: 2.4, lead: 0, damage: 34, spread: 0.35, life: 2.6, size: 1.3, stretch: 1.4, cooldown: 1.4 },
    },
    {
      id: 'micro', name: 'マイクロミサイル', text: '小さなミサイルを4発。広がって上へ飛び出し、曲がりながら相手を追う',
      spec: { shots: 1, interval: 0, count: 4, fan: 1.1, speed: 21, turn: 3.2, lead: 0, damage: 18, spread: 0.08, life: 2.4, size: 0.9, stretch: 1, cooldown: 1.6, missile: true, rise: 0.3 },
    },
    {
      id: 'beam', name: 'ビームキャノン', text: '太いビームを1発。太くて速いので当たりやすく、当たると相手がダウンする。プレイヤーだけの武器',
      playerOnly: true,
      spec: { shots: 1, interval: 0, count: 1, fan: 0, speed: 46, turn: 0.8, lead: 0.9, damage: 110, spread: 0, life: 1.2, size: 2.2, stretch: 6, cooldown: 1.6, beam: true, knockdown: true },
    },
  ],
  // spec: count (1回に撃つ数) / scatter (散らばる半径 m) / blast (爆風の半径 m) / damage / speed (水平の速さの目安) /
  // flight (飛ぶ時間の範囲 秒) / gravity / lead / size / cooldown。
  // kind が 'rocket' のものは、背中から打ち上げて相手を追うミサイル (weapons.js の missile)。speed は [出たとき, いちばん速いとき] (m/秒) で、
  // accel (加速) / turn (追う強さ rad/秒) / boost (追い始めるまで 秒) / life (秒) / reach (相手の弾で撃ち落とされる半径 m) を使う
  bomb: [
    {
      id: 'frag', name: 'フラグ', text: '山なりに1発。床に出る輪が落ちる場所',
      spec: { count: 1, scatter: 0, blast: 2.8, damage: 120, speed: 17, flight: [0.6, 1.3], gravity: 26, lead: 0.6, size: 1, cooldown: 1.6 },
    },
    {
      id: 'cluster', name: 'クラスター', text: '小さな3発が、相手のまわりに散らばって落ちる',
      spec: { count: 3, scatter: 1.5, blast: 2, damage: 70, speed: 16, flight: [0.7, 1.4], gravity: 26, lead: 0.4, size: 0.7, cooldown: 2 },
    },
    {
      id: 'megaton', name: 'メガトン', text: 'ゆっくり高く飛ぶ大きな1発。爆風がとても広い',
      spec: { count: 1, scatter: 0, blast: 4.6, damage: 150, speed: 11, flight: [1.2, 2], gravity: 20, lead: 0.3, size: 1.7, cooldown: 3 },
    },
    {
      id: 'snap', name: 'スナップ', text: '低く速く飛ぶ。爆風は小さいが、すぐに次を撃てる',
      spec: { count: 1, scatter: 0, blast: 2, damage: 85, speed: 26, flight: [0.35, 0.8], gravity: 34, lead: 0.8, size: 0.8, cooldown: 1 },
    },
    {
      id: 'rocket', name: 'ハイミサイル', text: '背中から2発を真上へ打ち上げる。上から相手を追って落ち、当たると爆発する',
      spec: { kind: 'rocket', count: 2, blast: 2.2, damage: 70, speed: [9, 24], accel: 30, turn: 4, boost: 0.25, life: 3.4, reach: 0.6, size: 1, cooldown: 2.6 },
    },
  ],
  // spec: kind ('homing' 追いかける / 'bounce' はねてまっすぐ進む / 'trap' 後ろに置いて待つ) / count / speed / turn /
  // life (秒) / trigger (相手がこれより近いと爆発 m) / blast / damage / arm (出てから爆発できるまで 秒) / size / cooldown
  pod: [
    {
      id: 'float', name: 'フロート', text: '浮かんでゆっくり相手を追いかけ、近づくと爆発する',
      spec: { kind: 'homing', count: 1, speed: 6.5, turn: 1.3, life: 7, trigger: 1.8, blast: 2.4, damage: 100, arm: 0.5, size: 1, cooldown: 3.2 },
    },
    {
      id: 'bound', name: 'バウンド', text: '床をはねながら速くまっすぐ進み、壁で跳ね返る',
      spec: { kind: 'bounce', count: 1, speed: 11, turn: 0, life: 5, trigger: 1.5, blast: 2.2, damage: 90, arm: 0.3, size: 0.9, cooldown: 2.6 },
    },
    {
      id: 'twin', name: 'ツイン', text: '左右から2つ出る。1つの爆発は小さめ',
      spec: { kind: 'homing', count: 2, speed: 5.5, turn: 1.1, life: 7, trigger: 1.6, blast: 2, damage: 70, arm: 0.5, size: 0.8, cooldown: 3.8 },
    },
    {
      id: 'trap', name: 'トラップ', text: '後ろに置いて待ち伏せする。長く残る',
      spec: { kind: 'trap', count: 1, speed: 3, turn: 0, life: 12, trigger: 2.6, blast: 3, damage: 110, arm: 1, size: 1.1, cooldown: 3.5 },
    },
  ],
  // stats: run (走る速さ m/秒) / jump (ジャンプの勢い) / dashes (空中ダッシュの回数) / dashSpeed / dashTime (秒)
  legs: [
    {
      id: 'walker', name: 'ウォーカー', text: '走りもジャンプもふつう',
      stats: { run: 9, jump: 13, dashes: 2, dashSpeed: 20, dashTime: 0.25 },
    },
    {
      id: 'dasher', name: 'ダッシャー', text: '地面を速く走る。ジャンプは低め',
      stats: { run: 11.5, jump: 11, dashes: 2, dashSpeed: 23, dashTime: 0.22 },
    },
    {
      id: 'hopper', name: 'ホッパー', text: '高く跳べて、空中ダッシュが長い。地面は遅め。柱の上にも乗れる',
      stats: { run: 7.8, jump: 16, dashes: 2, dashSpeed: 21, dashTime: 0.32 },
    },
  ],
};

export const DEFAULT_LOADOUT = { frame: 'aogane', gun: 'triple', bomb: 'frag', pod: 'float', legs: 'walker' };
// 最初から使える、追加のパーツ (大会のライバルは使わないので、勝って手に入れるものではない。beam は CPU も使わない: playerOnly)
export const STARTER_PARTS = ['micro', 'rocket', 'beam'];
// 最初のパーツ以外の全部。前の版では、勝つたびにこの順で1つずつ増えていた (save.js が古い保存データを引き継ぐのに使う)
export const UNLOCK_ORDER = [
  'gatling', 'cluster', 'bound', 'dasher', 'hayate', 'spread', 'megaton', 'twin',
  'hopper', 'iwao', 'rail', 'snap', 'trap', 'tsubame', 'homing',
];

const PART_INDEX = new Map(); // id → { slot, part }
for (const slot of SLOTS) {
  for (const part of PARTS[slot]) PART_INDEX.set(part.id, { slot, part });
}
export const TOTAL_PARTS = PART_INDEX.size;

// その場所のパーツ (知らない id なら、その場所の最初のパーツ)
export function partOf(slot, id) {
  return PARTS[slot].find((p) => p.id === id) ?? PARTS[slot][0];
}

export function partById(id) {
  return PART_INDEX.get(id)?.part ?? null;
}

export function slotOf(id) {
  return PART_INDEX.get(id)?.slot ?? null;
}

// 使えるパーツの id。parts: 手に入れたパーツ (最初から使えるパーツ以外)
export function unlockedIds(parts) {
  return new Set([...Object.values(DEFAULT_LOADOUT), ...STARTER_PARTS, ...parts]);
}

// 保存データなどから来た組み合わせを、使えるパーツ (allowed: id の Set) だけに直す
export function validLoadout(loadout, allowed) {
  const out = {};
  for (const slot of SLOTS) {
    const id = loadout?.[slot];
    out[slot] = allowed.has(id) && slotOf(id) === slot ? id : DEFAULT_LOADOUT[slot];
  }
  return out;
}

export function sameLoadout(a, b) {
  return SLOTS.every((slot) => a?.[slot] === b?.[slot]);
}

// ロボ全体の性能 (フレームと脚から決まる)
export function robotStats(loadout) {
  const frame = partOf('frame', loadout.frame).stats;
  const legs = partOf('legs', loadout.legs).stats;
  return {
    run: legs.run * frame.speed,
    jump: legs.jump,
    gravity: BASE_GRAVITY * frame.gravity,
    dashes: Math.max(1, legs.dashes + frame.dashes),
    dashSpeed: legs.dashSpeed,
    dashTime: legs.dashTime,
    endurance: frame.endurance,
    armor: frame.armor,
    blade: frame.blade,
  };
}

// CPU の組み合わせ。レベルが上がるほど、最初のパーツ以外を使うことが多くなる (プレイヤーだけのパーツは使わない)
export function randomLoadout(level) {
  const chance = Math.min(1, 0.25 + level * 0.15);
  const out = {};
  for (const slot of SLOTS) {
    const list = PARTS[slot].filter((part) => !part.playerOnly);
    out[slot] = Math.random() < chance ? list[Math.floor(Math.random() * list.length)].id : DEFAULT_LOADOUT[slot];
  }
  return out;
}
