import { TalkBox } from './talkbox.js';

export class TalkScene {
  constructor(game, opts) {
    this.box = new TalkBox(game, opts);
  }

  enter() { this.box.start(); }
  update(dt) { this.box.update(dt); }
  draw(c) { this.box.draw(c); }
  pointerDown(p) { this.box.pointerDown(p); }
  pointerUp(p) { this.box.pointerUp(p); }
  keyDown(k) { if (k === 'Enter' || k === ' ') this.box.pointerUp({ x: -1, y: -1 }); }
}
