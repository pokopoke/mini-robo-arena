import { DEFAULT_LOADOUT, UNLOCK_ORDER, unlockedIds, validLoadout } from './parts.js';
import { RIVALS, rewardsOf } from './rivals.js';

// 進み具合の保存。この端末 (localStorage) にすぐ保存し、claude.ai で開いたときはアーティファクトの保存機能 (db) の
// 自分だけの場所 (data/users/<自分の id>/progress) にも保存する。db があれば iPhone と PC で同じ進み具合になる。
// 形: { wins (勝った回数), beaten (倒したライバルの id), parts (手に入れたパーツの id), loadout: { frame, gun, bomb, pod, legs },
//      updatedAt (保存した時刻 ms) }
const STORAGE_KEY = 'mini-robo-arena:progress';

export function normalizeProgress(raw) {
  const wins = Number.isFinite(raw?.wins) ? Math.max(0, Math.floor(raw.wins)) : 0;
  // 前の版の保存データ (parts が無く、勝った数でパーツが増えていた) は、そのとき使えたパーツを引き継ぎ、
  // そのパーツが全部そろうライバルは倒したことにする
  const legacy = !Array.isArray(raw?.parts);
  const parts = new Set(legacy ? UNLOCK_ORDER.slice(0, wins) : raw.parts);
  const beaten = new Set(Array.isArray(raw?.beaten) ? raw.beaten : []);
  for (const rival of RIVALS) {
    if (legacy && rewardsOf(rival).every((id) => parts.has(id))) beaten.add(rival.id);
    if (beaten.has(rival.id)) for (const id of rewardsOf(rival)) parts.add(id);
  }
  const owned = UNLOCK_ORDER.filter((id) => parts.has(id));
  return {
    wins,
    beaten: RIVALS.filter((rival) => beaten.has(rival.id)).map((rival) => rival.id), // 大会の順に並べ、知らない id は捨てる
    parts: owned,
    loadout: validLoadout(raw?.loadout ?? DEFAULT_LOADOUT, unlockedIds(owned)),
    updatedAt: Number.isFinite(raw?.updatedAt) ? raw.updatedAt : 0,
  };
}

// 2つの進み具合を合わせる。勝った回数は多いほう、ライバルとパーツは両方の分、組み合わせは新しく保存したほう
export function mergeProgress(a, b) {
  const x = normalizeProgress(a);
  const y = normalizeProgress(b);
  const newer = y.updatedAt > x.updatedAt ? y : x;
  return normalizeProgress({
    wins: Math.max(x.wins, y.wins),
    beaten: [...x.beaten, ...y.beaten],
    parts: [...x.parts, ...y.parts],
    loadout: newer.loadout,
    updatedAt: newer.updatedAt,
  });
}

export class Save {
  constructor() {
    this.ref = null; // db の文書 (使えないときは null)
    this.writing = false;
    this.pending = null;
  }

  loadLocal() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    } catch {
      return null; // 保存できない設定 (プライベートブラウズなど) では毎回はじめから
    }
  }

  save(progress) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // この端末に保存できなくても、db には保存を試みる
    }
    if (this.ref) this.writeRemote(progress);
  }

  // db の進み具合を読み、sync(読んだ内容、無ければ null) が返した進み具合を保存し直す。
  // db が使えないとき (claude.ai の外で開いた、サインインしていない など) は何もしない
  async connect(sync) {
    if (typeof window.claude?.use !== 'function') return;
    try {
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      const id = db && user ? await user.id() : null;
      if (!id) return;
      const ref = db.doc(`data/users/${id}/progress`);
      const snap = await ref.get();
      const remote = snap.exists ? snap.data() : null;
      this.ref = ref;
      const merged = sync(remote);
      if (!remote || JSON.stringify(normalizeProgress(remote)) !== JSON.stringify(merged)) this.save(merged);
    } catch {
      this.ref = null; // 読めなかったときは、この端末だけに保存する
    }
  }

  // 同じ文書への書き込みは1つずつ。書いている間に来た分は、終わってから最新のものだけを書く
  async writeRemote(progress) {
    this.pending = progress;
    if (this.writing) return;
    this.writing = true;
    let retried = false;
    while (this.pending && this.ref) {
      const data = this.pending;
      this.pending = null;
      try {
        await this.ref.set(data);
        retried = false;
      } catch (e) {
        if (e?.code === 'unavailable' && !retried) {
          // 一時的な不調は、少し待って1回だけやり直す
          retried = true;
          await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));
          this.pending ??= data;
        } else if (e?.code !== 'unavailable') {
          this.ref = null; // 書けない (権限が無い など)。この端末だけに保存する
        }
      }
    }
    this.writing = false;
  }
}
