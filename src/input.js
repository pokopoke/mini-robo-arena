// 操作の入力。PC はキーボード、スマホ (タッチ) は画面左の仮想スティックと右のボタン。
// 移動は「前 = basisYaw の向き」として受け取り、read() がワールドの向きに直す (main.js はカメラの向きを前にして渡すので、
// スティックを倒した向きと、画面の上でロボが動く向きがそろう)
const KEY_ACTIONS = {
  Space: 'jump', KeyJ: 'gun', KeyK: 'bomb', KeyL: 'pod', KeyH: 'missile', KeyI: 'attack', KeyU: 'guard', KeyO: 'target', KeyP: 'special',
  ShiftLeft: 'step', ShiftRight: 'step',
};
const MOVE_KEYS = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
const ACTIONS = ['jump', 'step', 'gun', 'bomb', 'pod', 'missile', 'attack', 'guard', 'target', 'special'];
const TAP_ONLY = new Set(['jump', 'step', 'attack', 'target', 'special']); // 押した瞬間だけ (押しっぱなしでくり返さない)
const STICK_RADIUS = 40; // 仮想スティックがいっぱいに倒れる指の移動量 (px)。これより離れると、中心が指についてくる
const STICK_DEAD = 0.1; // これより小さい傾きは無視する (いっぱいに倒したときに対する割合)
const STICK_FULL = 0.5; // これだけ倒せば全速で走る (少し動かすだけで走れるように)
const BUTTON_SLOP = 16; // ボタンの縁からこれだけ外れていても、押したことにする (px)
const DOUBLE_TAP = 350; // 戦っている間、前のタッチの終わりからこれより早い次のタッチの終わりは、ダブルタップの拡大にさせない (ミリ秒)

// 指の取り込み。本物のタッチでない (試験で作ったイベントなど) と失敗するので、失敗しても続ける
function capture(el, pointerId) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // 取り込めなくても、指が要素の上にあるあいだは動く
  }
}

export class Input {
  constructor(touchMode) {
    this.keys = new Set();
    this.held = new Set();
    this.tapped = new Set();
    this.stick = { id: null, x: 0, y: 0, ox: 0, oy: 0 };
    this.fingers = new Map(); // ボタンを押している指: pointerId → ボタン (ボタンの外にずれたら null)
    this.releaseStick = null;
    this.rotated = false; // 横向きで遊ぶため、画面ごと 90° 回している (main.js が決める)
    this.state = {
      move: { x: 0, z: 0 }, jump: false, step: false, gun: false, bomb: false, pod: false, missile: false, attack: false, guard: false, target: false, special: false,
    };
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.clear());
    if (touchMode) this.setupTouch();
  }

  onKey(e, down) {
    const action = KEY_ACTIONS[e.code];
    if (!action && !MOVE_KEYS[e.code]) return;
    e.preventDefault();
    if (e.repeat) return;
    if (action) this.press(action, down);
    else if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
  }

  press(action, down) {
    if (down) {
      this.held.add(action);
      this.tapped.add(action);
    } else {
      this.held.delete(action);
    }
  }

  // 指の位置を、ゲームの画面の座標にする。回しているときは、画面の右がゲームの上になる
  // (main.js が #app を translateX(画面の幅) rotate(90deg) している)
  local(e) {
    return this.rotated ? { x: e.clientY, y: innerWidth - e.clientX } : { x: e.clientX, y: e.clientY };
  }

  // ゲームの画面の幅
  screenWidth() {
    return this.rotated ? innerHeight : innerWidth;
  }

  // 押しているものを全部はなす (試合の始まりや、ほかのアプリに切り替わったとき)
  clear() {
    this.keys.clear();
    this.held.clear();
    this.tapped.clear();
    for (const button of this.fingers.values()) button?.classList.remove('on');
    this.fingers.clear();
    this.releaseStick?.();
  }

  setupTouch() {
    this.stopZoom();
    const zone = document.getElementById('stick-zone');
    const base = document.getElementById('stick');
    const knob = document.getElementById('stick-knob');
    const stick = this.stick;
    const place = () => {
      base.style.left = `${stick.ox}px`;
      base.style.top = `${stick.oy}px`;
    };
    const move = (e) => {
      const p = this.local(e);
      let dx = p.x - stick.ox;
      let dy = p.y - stick.oy;
      let len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        // はみ出したぶん、スティックの中心を指のほうへ引っぱる。逆へ倒すとき、指を大きく戻さなくてすむ
        const k = (len - STICK_RADIUS) / len;
        stick.ox += dx * k;
        stick.oy += dy * k;
        dx -= dx * k;
        dy -= dy * k;
        len = STICK_RADIUS;
        place();
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const power = Math.min(1, Math.max(0, (len / STICK_RADIUS - STICK_DEAD) / (STICK_FULL - STICK_DEAD)));
      stick.x = power > 0 ? (dx / len) * power : 0;
      stick.y = power > 0 ? (-dy / len) * power : 0;
    };
    // 指を置いた場所にスティックが出る
    const start = (e) => {
      if (stick.id !== null) return;
      e.preventDefault();
      const p = this.local(e);
      stick.id = e.pointerId;
      stick.ox = p.x;
      stick.oy = p.y;
      capture(zone, e.pointerId);
      base.classList.add('active');
      place();
      move(e);
    };
    this.releaseStick = () => {
      stick.id = null;
      stick.x = stick.y = 0;
      base.classList.remove('active');
      base.style.removeProperty('left');
      base.style.removeProperty('top');
      knob.style.transform = '';
    };
    zone.addEventListener('pointerdown', start);

    // ボタン。指の位置にいちばん近いボタンを押す (縁から BUTTON_SLOP までは押したことにする)。
    // 押したまま指をすべらせると、下にあるボタンに押し替わる。
    // 近さは画面そのものの座標 (clientX / getBoundingClientRect) で比べるので、回していても同じ計算でよい
    const pad = document.getElementById('pad');
    const buttons = [...pad.querySelectorAll('[data-action]')];
    // いちばん近いボタンと、その縁からの距離 (px。ボタンの中なら 0 以下)。BUTTON_SLOP より遠ければ button は null。
    // 隠れているボタン (1対1のときのターゲット) は押せない
    const buttonAt = (x, y) => {
      let button = null;
      let gap = BUTTON_SLOP;
      for (const b of buttons) {
        const r = b.getBoundingClientRect();
        if (!r.width) continue;
        const g = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2)) - r.width / 2;
        if (g < gap) {
          button = b;
          gap = g;
        }
      }
      return { button, gap };
    };
    // 指が押すボタンを button にする (null ならどれも押さない。指は覚えたままなので、すべらせてボタンに乗れば押す)
    const holdWith = (pointerId, button) => {
      const before = this.fingers.get(pointerId) ?? null;
      this.fingers.set(pointerId, button);
      if (before === button) return;
      const stillHeld = [...this.fingers.values()].includes(before); // ほかの指も同じボタンを押している
      if (before && !stillHeld) {
        before.classList.remove('on');
        this.press(before.dataset.action, false);
      }
      if (button) {
        button.classList.add('on');
        this.press(button.dataset.action, true);
      }
    };
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const { button, gap } = buttonAt(e.clientX, e.clientY);
      // 画面の左半分で、ボタンの真上ではないところに置いた指は、スティックがあいていればスティックにする
      // (縦向きでは左の親指のすぐ右にボタンがあるので、少しずれてもボタンを押さないように)
      if (this.local(e).x < this.screenWidth() / 2 && stick.id === null && (!button || gap > 0)) {
        start(e);
        return;
      }
      capture(pad, e.pointerId);
      holdWith(e.pointerId, button);
    });
    pad.addEventListener('contextmenu', (e) => e.preventDefault());

    // 指の動きと、離した・取り消されたことは window で受けて、指の番号で見分ける。どの要素に届いても
    // (指の取り込みがうまくいかない端末でも)、スティックが動かなくなったり、ボタンが押されたままになったりしない
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId === stick.id) move(e);
      else if (this.fingers.has(e.pointerId)) holdWith(e.pointerId, buttonAt(e.clientX, e.clientY).button);
    });
    const end = (e) => {
      if (e.pointerId === stick.id) this.releaseStick();
      if (!this.fingers.has(e.pointerId)) return;
      holdWith(e.pointerId, null);
      this.fingers.delete(e.pointerId);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  // iPhone の Safari (LINE などの中のブラウザも) は、ページの設定 (user-scalable=no) を無視して、二本指で広げたり (ピンチ)、
  // すばやく2回押したり (ダブルタップ) すると画面を拡大してしまう。拡大の合図 (gesture〜) はいつも止め、戦っている間は、
  // 二本指以上の動き (左のスティックと右のボタン) と、すばやい2回目のタッチの終わりも止める
  // (スティックとボタンは pointer〜 で動くので、touch〜 を止めても効く)。止められないタッチ (cancelable が false。Chrome では
  // touch-action: none のところのタッチがそうなり、もともと拡大しない) は、そのままにする
  stopZoom() {
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (e) => e.preventDefault());
    const inBattle = () => document.body.classList.contains('in-battle');
    document.addEventListener('touchmove', (e) => {
      if (e.cancelable && inBattle() && e.touches.length > 1) e.preventDefault();
    }, { passive: false });
    let lastEnd = -Infinity;
    document.addEventListener('touchend', (e) => {
      if (e.cancelable && inBattle() && e.timeStamp - lastEnd < DOUBLE_TAP) e.preventDefault();
      lastEnd = e.timeStamp;
    }, { passive: false });
    document.addEventListener('dblclick', (e) => e.preventDefault());
  }

  // basisYaw: 「前」とする向き (0 = +z 方向)
  read(basisYaw) {
    const s = this.state;
    let forward = 0;
    let right = 0;
    for (const code of this.keys) {
      right += MOVE_KEYS[code][0];
      forward += MOVE_KEYS[code][1];
    }
    right += this.stick.x;
    forward += this.stick.y;
    const len = Math.hypot(right, forward);
    if (len > 1) {
      right /= len;
      forward /= len;
    }
    // 前 = (sin, 0, cos)、右 = 前 × 上 = (-cos, 0, sin)
    const fx = Math.sin(basisYaw);
    const fz = Math.cos(basisYaw);
    s.move.x = fx * forward - fz * right;
    s.move.z = fz * forward + fx * right;
    for (const action of ACTIONS) {
      s[action] = this.tapped.has(action) || (!TAP_ONLY.has(action) && this.held.has(action));
    }
    this.tapped.clear();
    return s;
  }
}
