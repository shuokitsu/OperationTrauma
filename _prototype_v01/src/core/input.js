// タッチとマウスを Pointer Events で共通に扱う。
// 試作では同時に扱うポインタは1本だけ（マルチタッチは無視）。
export class Input {
  constructor(canvas, screen, getScene, onFirstGesture) {
    this.activeId = null;
    this.last = null;
    const pos = (e) => screen.toLogical(e.clientX, e.clientY);

    canvas.addEventListener('pointerdown', (e) => {
      onFirstGesture();
      if (this.activeId !== null) return;
      this.activeId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      this.last = pos(e);
      getScene()?.pointerDown?.(this.last);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      this.last = pos(e);
      if (e.pointerId !== this.activeId) return;
      getScene()?.pointerMove?.(this.last);
    });
    const up = (e) => {
      if (e.pointerId !== this.activeId) return;
      this.activeId = null;
      this.last = pos(e);
      getScene()?.pointerUp?.(this.last);
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    addEventListener('keydown', (e) => {
      onFirstGesture();
      getScene()?.keyDown?.(e.key);
    });
  }

  get down() {
    return this.activeId !== null;
  }
}
