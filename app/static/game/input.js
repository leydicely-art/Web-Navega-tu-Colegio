/* Entrada de teclado y mouse para Rugido Salvaje. */

const KEY_MAP = {
    up: ["KeyW", "ArrowUp"],
    down: ["KeyS", "ArrowDown"],
    left: ["KeyA", "ArrowLeft"],
    right: ["KeyD", "ArrowRight"],
    dash: ["Space", "ShiftLeft", "ShiftRight"],
    roar: ["KeyE", "KeyF"],
    pause: ["Escape", "KeyP"],
};

export class Input {
    constructor(canvas) {
        this.canvas = canvas;
        this.held = new Set();
        this.justPressed = new Set();
        this.mouse = { x: 0, y: 0, down: false, justDown: false };
        this.enabled = true;

        window.addEventListener("keydown", (e) => {
            if (!this.enabled) return;
            if (!this.held.has(e.code)) this.justPressed.add(e.code);
            this.held.add(e.code);
            if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
        });
        window.addEventListener("keyup", (e) => {
            this.held.delete(e.code);
        });
        window.addEventListener("blur", () => {
            this.held.clear();
        });

        canvas.addEventListener("mousemove", (e) => {
            const rect = canvas.getBoundingClientRect();
            this.mouse.x = e.clientX - rect.left;
            this.mouse.y = e.clientY - rect.top;
        });
        canvas.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            if (!this.enabled) return;
            this.mouse.down = true;
            this.mouse.justDown = true;
        });
        window.addEventListener("mouseup", () => {
            this.mouse.down = false;
        });
        canvas.addEventListener("touchstart", (e) => {
            const t = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            this.mouse.x = t.clientX - rect.left;
            this.mouse.y = t.clientY - rect.top;
            this.mouse.down = true;
            this.mouse.justDown = true;
        }, { passive: true });
        canvas.addEventListener("touchmove", (e) => {
            const t = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            this.mouse.x = t.clientX - rect.left;
            this.mouse.y = t.clientY - rect.top;
        }, { passive: true });
        canvas.addEventListener("touchend", () => {
            this.mouse.down = false;
        });
        canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    }

    _codesFor(action) {
        return KEY_MAP[action] || [];
    }

    isDown(action) {
        return this._codesFor(action).some((c) => this.held.has(c));
    }

    wasPressed(action) {
        return this._codesFor(action).some((c) => this.justPressed.has(c));
    }

    /** Vector normalizado de movimiento (-1..1 por eje) según WASD/flechas. */
    moveVector() {
        let x = 0, y = 0;
        if (this.isDown("left")) x -= 1;
        if (this.isDown("right")) x += 1;
        if (this.isDown("up")) y -= 1;
        if (this.isDown("down")) y += 1;
        if (x !== 0 && y !== 0) {
            const inv = 1 / Math.sqrt(2);
            x *= inv;
            y *= inv;
        }
        return { x, y };
    }

    /** Debe llamarse una vez por frame, al final, para limpiar los flancos "justPressed". */
    endFrame() {
        this.justPressed.clear();
        this.mouse.justDown = false;
    }
}
