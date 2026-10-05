import { SLOTS, SLOT_NAMES, PARTS, robotStats } from './parts.js';
import { rivalFor } from './rivals.js';

// 組み立て画面。上のタブで付け替える場所を選び、一覧のパーツを押すとすぐ付け替わる。
// 付け替えたら onChange(組み合わせ) を呼ぶ (main.js がロボを作り直して保存する)。
// まだ手に入れていないパーツは「？？？」で、大会のどのライバルに勝つと手に入るかだけ見せる
const STAT_BARS = [
  { label: '走る速さ', value: (s) => s.run, min: 6, max: 13.5 },
  { label: 'ジャンプ', value: (s) => (s.jump * s.jump) / (2 * s.gravity), min: 1.5, max: 7 }, // 跳べる高さ
  { label: '倒れにくさ', value: (s) => s.endurance, min: 100, max: 250 },
  { label: '打たれ強さ', value: (s) => 1 / s.armor, min: 0.8, max: 1.2 },
];
const HOMING_WORDS = [[0.1, 'なし'], [1, '弱い'], [2, 'ふつう'], [Infinity, '強い']]; // [turn がこれ未満, 言葉]
const POD_MOVES = { homing: '追いかける', bounce: 'はねて進む', trap: 'その場で待つ' };

// パーツの性能を短い言葉で並べる
function partChips(slot, part) {
  if (slot === 'frame') {
    const s = part.stats;
    return [
      `倒れにくさ ${s.endurance}`,
      `受けるダメージ ×${s.armor}`,
      `ブレード ${s.blade}`,
      s.dashes ? `空中ダッシュ ${s.dashes > 0 ? '+' : ''}${s.dashes}回` : '',
      s.gravity < 1 ? 'ゆっくり落ちる' : s.gravity > 1 ? '速く落ちる' : '',
    ].filter(Boolean);
  }
  if (slot === 'legs') {
    const s = part.stats;
    return [`走る速さ ${s.run}`, `ジャンプ ${s.jump}`, `空中ダッシュ ${s.dashes}回`];
  }
  const s = part.spec;
  const times = slot === 'gun' ? s.shots * s.count : s.count;
  const chips = [`ダメージ ${s.damage}${times > 1 ? `×${times}` : ''}`];
  if (slot === 'gun') chips.push(`追いかける力 ${HOMING_WORDS.find(([limit]) => s.turn < limit)[1]}`);
  else chips.push(`爆風 ${s.blast}m`);
  if (s.knockdown) chips.push('当たるとダウン');
  if (slot === 'pod') chips.push(POD_MOVES[s.kind]);
  chips.push(`次まで ${s.cooldown}秒`);
  return chips;
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

export class Garage {
  constructor(onChange) {
    this.onChange = onChange;
    this.slot = 'frame';
    this.focus = null; // 説明を出しているパーツの id (null なら付けているパーツ)
    this.loadout = null;
    this.unlocked = new Set();
    const $ = (id) => document.getElementById(id);
    this.el = {
      tabs: $('slot-tabs'),
      list: $('part-list'),
      name: $('part-name'),
      text: $('part-text'),
      chips: $('part-chips'),
      stats: $('robot-stats'),
    };
    this.el.tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-slot]');
      if (!tab) return;
      this.slot = tab.dataset.slot;
      this.focus = null;
      this.render();
    });
    this.el.list.addEventListener('click', (e) => {
      const item = e.target.closest('[data-part]');
      if (!item) return;
      const id = item.dataset.part;
      this.focus = id;
      if (this.unlocked.has(id) && this.loadout[this.slot] !== id) {
        this.loadout[this.slot] = id;
        this.onChange({ ...this.loadout });
      }
      this.render();
    });
  }

  // unlocked: 使えるパーツの id の Set
  open(loadout, unlocked) {
    this.loadout = { ...loadout };
    this.unlocked = unlocked;
    this.focus = null;
    this.render();
  }

  render() {
    // 作り直すとキーボードの選択が外れるので、押していたボタンを覚えておいて戻す
    const active = document.activeElement?.dataset ?? {};
    const equipped = this.loadout[this.slot];
    const focusId = this.focus ?? equipped;

    this.el.tabs.replaceChildren(...SLOTS.map((slot) => {
      const tab = element('button', 'slot-tab');
      tab.type = 'button';
      tab.dataset.slot = slot;
      tab.setAttribute('aria-pressed', String(slot === this.slot));
      tab.append(element('span', 'slot-name', SLOT_NAMES[slot]), element('span', 'slot-part', PARTS[slot].find((p) => p.id === this.loadout[slot]).name));
      return tab;
    }));

    this.el.list.replaceChildren(...PARTS[this.slot].map((part) => {
      const open = this.unlocked.has(part.id);
      const item = element('button', 'part');
      item.type = 'button';
      item.dataset.part = part.id;
      item.classList.toggle('equipped', part.id === equipped);
      item.classList.toggle('locked', !open);
      item.classList.toggle('focused', part.id === focusId);
      const note = part.id === equipped ? '装備中' : open ? '' : `${rivalFor(part.id)?.name ?? ''}に勝つ`;
      item.append(element('span', 'part-title', open ? part.name : '？？？'), element('span', 'part-note', note));
      return item;
    }));

    const part = PARTS[this.slot].find((p) => p.id === focusId);
    const open = this.unlocked.has(focusId);
    this.el.name.textContent = open ? part.name : '？？？';
    const giver = rivalFor(focusId);
    this.el.text.textContent = open ? part.text : `大会で${giver?.name}（${giver?.title}）に勝つと手に入ります`;
    this.el.chips.replaceChildren(...(open ? partChips(this.slot, part) : []).map((chip) => element('li', '', chip)));

    const stats = robotStats(this.loadout);
    this.el.stats.replaceChildren(
      ...STAT_BARS.map((bar) => {
        const ratio = Math.min(1, Math.max(0.04, (bar.value(stats) - bar.min) / (bar.max - bar.min)));
        const row = element('div', 'stat');
        const meter = element('span', 'meter');
        meter.style.setProperty('--v', ratio.toFixed(3));
        row.append(element('span', 'stat-label', bar.label), meter);
        return row;
      }),
      (() => {
        const row = element('div', 'stat');
        row.append(element('span', 'stat-label', '空中ダッシュ'), element('span', 'stat-count', `${stats.dashes}回`));
        return row;
      })(),
    );

    const again = active.part
      ? this.el.list.querySelector(`[data-part="${active.part}"]`)
      : active.slot
        ? this.el.tabs.querySelector(`[data-slot="${active.slot}"]`)
        : null;
    again?.focus({ preventScroll: true });
  }
}
