import { DEFAULT_LOADOUT, SLOTS } from './parts.js';

// 大会のライバル。上から順に戦い、勝つとその組み合わせのうち、まだ持っていないパーツが手に入る
// (8人ですべてのパーツがそろう)。名前とセリフはこのゲームのオリジナル。
// round: 予選・本戦・決勝 / level: CPU の強さ (0〜10) / arena: 戦う闘技場 (arenas.js) /
// style: 戦い方のくせ (ai.js)。range 保ちたい距離 (m) / strafe 回り込む向きを変える多さ / jumpy ジャンプの多さ /
//   bombs グレネードの多さ / pods マインの多さ / blade ブレードの多さ / dodge よける確率に足す値。どれも書かなければふつう
// lines: intro 試合の前 / lose ライバルが負けたとき / win ライバルが勝ったとき
export const RIVALS = [
  {
    id: 'haruki',
    name: 'ハルキ',
    title: '見習い',
    round: '予選',
    level: 0,
    arena: 'plaza',
    loadout: { frame: 'aogane', gun: 'gatling', bomb: 'cluster', pod: 'float', legs: 'walker' },
    style: {},
    lines: {
      intro: 'はじめての大会なんだ。よろしくね！',
      lose: 'うわー、負けた！ でも楽しかった！',
      win: 'やった、勝てた！ もう一回やる？',
    },
  },
  {
    id: 'minato',
    name: 'ミナト',
    title: '快足',
    round: '予選',
    level: 0,
    arena: 'plaza',
    loadout: { frame: 'aogane', gun: 'triple', bomb: 'frag', pod: 'bound', legs: 'dasher' },
    style: { strafe: 1.8, range: [8, 14] },
    lines: {
      intro: '足の速さなら負けないよ。ついてこられる？',
      lose: '追いつかれるなんて…。きみ、やるね',
      win: 'ほらね、つかまえられなかったでしょ',
    },
  },
  {
    id: 'kaede',
    name: 'カエデ',
    title: '突撃',
    round: '予選',
    level: 2,
    arena: 'corridor',
    loadout: { frame: 'hayate', gun: 'spread', bomb: 'frag', pod: 'float', legs: 'dasher' },
    style: { range: [4, 8], blade: 2.5 },
    lines: {
      intro: '遠くからちまちま撃つのは性に合わないの。いくよ！',
      lose: 'くっ…近づくだけじゃ勝てないか',
      win: '近づいたもん勝ち、ってね',
    },
  },
  {
    id: 'gou',
    name: 'ゴウ',
    title: '爆撃',
    round: '本戦',
    level: 1,
    arena: 'lift',
    loadout: { frame: 'aogane', gun: 'gatling', bomb: 'megaton', pod: 'twin', legs: 'walker' },
    style: { range: [13, 20], bombs: 1.3, pods: 1.2 },
    lines: {
      intro: 'でかいのを降らせてやる。足元に気をつけな',
      lose: '全部よけやがった…。見事だ',
      win: '空から来るものには気をつけろって言ったろ',
    },
  },
  {
    id: 'rin',
    name: 'リン',
    title: '跳躍',
    round: '本戦',
    level: 3,
    arena: 'tower',
    loadout: { frame: 'iwao', gun: 'gatling', bomb: 'cluster', pod: 'bound', legs: 'hopper' },
    style: { jumpy: 2.5, blade: 1.3 },
    lines: {
      intro: '重くたって、高く跳べるんだから',
      lose: '上からでも届かなかった…。強いね',
      win: '上を取ったほうが勝つの。覚えておいて',
    },
  },
  {
    id: 'shinobu',
    name: 'シノブ',
    title: '狙撃',
    round: '本戦',
    level: 5,
    arena: 'lift',
    loadout: { frame: 'hayate', gun: 'rail', bomb: 'snap', pod: 'float', legs: 'dasher' },
    style: { range: [15, 24], dodge: 0.1 },
    lines: {
      intro: '……動かないほうがいい。狙いがずれるから',
      lose: '……読まれていた、か',
      win: '……一発で十分だった',
    },
  },
  {
    id: 'tsumugi',
    name: 'ツムギ',
    title: '仕掛け',
    round: '決勝',
    level: 7,
    arena: 'corridor',
    loadout: { frame: 'tsubame', gun: 'spread', bomb: 'cluster', pod: 'trap', legs: 'hopper' },
    style: { pods: 2, range: [7, 13] },
    lines: {
      intro: '通り道には、もう仕掛けてあるよ',
      lose: 'わたしの仕掛けを全部見ぬくなんて',
      win: 'ほら、足元。気づかなかった？',
    },
  },
  {
    id: 'rei',
    name: 'レイ',
    title: '王者',
    round: '決勝',
    level: 6,
    arena: 'tower',
    loadout: { frame: 'tsubame', gun: 'homing', bomb: 'megaton', pod: 'twin', legs: 'hopper' },
    style: { dodge: 0.1, jumpy: 1.5 },
    lines: {
      intro: 'ここまで来たんだね。全力でいくよ',
      lose: '……負けた。今日からきみが王者だ',
      win: 'まだ王座はゆずれない。また来て',
    },
  },
];

const DEFAULT_PARTS = new Set(Object.values(DEFAULT_LOADOUT));

export function rivalById(id) {
  return RIVALS.find((rival) => rival.id === id) ?? null;
}

// ライバルに勝つと手に入るパーツの id (最初から持っているパーツは除く)
export function rewardsOf(rival) {
  return SLOTS.map((slot) => rival.loadout[slot]).filter((id) => !DEFAULT_PARTS.has(id));
}

// そのパーツをくれるライバル (無ければ null)
export function rivalFor(partId) {
  return RIVALS.find((rival) => rewardsOf(rival).includes(partId)) ?? null;
}
