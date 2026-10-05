import { RIVALS, rewardsOf } from './rivals.js';
import { ARENAS } from './arenas.js';
import { SLOTS, SLOT_NAMES, partById, partOf, slotOf } from './parts.js';

// 大会の画面。ライバルを戦う順に並べ、選んだライバルのセリフ・組み合わせ・闘技場・勝つと手に入るパーツを見せる。
// 戦えるのは、もう勝ったライバルと、まだ勝っていない最初の1人だけ。「戦う」ボタンは main.js が受け持つ
function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// パーツの名前と場所 (例: ガトリング（ショット）)
export function partLabel(id) {
  return `${partById(id).name}（${SLOT_NAMES[slotOf(id)]}）`;
}

export class Cup {
  constructor() {
    this.progress = null;
    this.index = 0;
    const $ = (id) => document.getElementById(id);
    this.el = {
      list: $('rival-list'),
      round: $('rival-round'),
      name: $('rival-name'),
      line: $('rival-line'),
      chips: $('rival-chips'),
      reward: $('rival-reward'),
      fight: $('cup-fight'),
    };
    this.el.list.addEventListener('click', (e) => {
      const item = e.target.closest('[data-rival]');
      if (!item) return;
      this.index = Number(item.dataset.rival);
      this.render();
    });
  }

  // index: はじめに選んでおくライバル (null なら、次に戦うライバル)
  open(progress, index = null) {
    this.progress = progress;
    this.index = index ?? Math.min(this.nextIndex(), RIVALS.length - 1);
    this.render();
  }

  // まだ勝っていない最初のライバル (全員に勝っていれば RIVALS.length)
  nextIndex() {
    const i = RIVALS.findIndex((rival) => !this.progress.beaten.includes(rival.id));
    return i < 0 ? RIVALS.length : i;
  }

  available(i) {
    return i <= this.nextIndex();
  }

  get rival() {
    return RIVALS[this.index];
  }

  render() {
    const active = document.activeElement?.dataset?.rival; // 作り直してもキーボードの選択を戻す
    const next = this.nextIndex();
    const beaten = new Set(this.progress.beaten);
    this.el.list.replaceChildren(...RIVALS.map((rival, i) => {
      const open = i <= next;
      const item = make('button', 'rival');
      item.type = 'button';
      item.dataset.rival = String(i);
      item.classList.toggle('beaten', beaten.has(rival.id));
      item.classList.toggle('next', i === next);
      item.classList.toggle('locked', !open);
      item.classList.toggle('focused', i === this.index);
      item.setAttribute('aria-pressed', String(i === this.index));
      const note = beaten.has(rival.id) ? '勝った' : i === next ? 'つぎの相手' : 'まだ戦えない';
      item.append(
        make('span', 'rival-no', String(i + 1)),
        make('span', 'rival-title', open ? rival.name : '？？？'),
        make('span', 'rival-note', note),
      );
      return item;
    }));

    const rival = this.rival;
    const open = this.available(this.index);
    this.el.round.textContent = `第${this.index + 1}試合・${rival.round}`;
    this.el.name.textContent = open ? `${rival.name}（${rival.title}）` : '？？？';
    this.el.line.textContent = open ? `「${rival.lines.intro}」` : '前のライバルに勝つと戦えます';
    this.el.chips.replaceChildren(...(open
      ? [`闘技場 ${ARENAS[rival.arena].name}`, ...SLOTS.map((slot) => `${SLOT_NAMES[slot]} ${partOf(slot, rival.loadout[slot]).name}`)]
      : []).map((text) => make('li', '', text)));
    const owned = new Set(this.progress.parts);
    const rewards = rewardsOf(rival);
    const fresh = rewards.filter((id) => !owned.has(id));
    if (!open) {
      this.el.reward.textContent = `勝つと ${rewards.map((id) => SLOT_NAMES[slotOf(id)]).join('・')} のパーツが手に入ります`;
    } else if (fresh.length) {
      this.el.reward.textContent = `勝つと手に入る: ${fresh.map(partLabel).join('、')}`;
    } else {
      this.el.reward.textContent = beaten.has(rival.id) ? 'もう勝ったライバル。何度でも戦えます' : '新しいパーツはもう持っています';
    }
    this.el.fight.disabled = !open;
    this.el.fight.textContent = beaten.has(rival.id) ? 'もう一度戦う' : '戦う';
    if (active !== undefined) this.el.list.querySelector(`[data-rival="${active}"]`)?.focus({ preventScroll: true });
  }
}
