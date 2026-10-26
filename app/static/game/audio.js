/* Sonido 100% sintetizado con Web Audio API — sin archivos de audio ni librerías
 * externas. Cada efecto es una fórmula propia (tono/ruido con envolvente),
 * inspirado en la idea de "sonido por código" pero sin reutilizar ninguna
 * síntesis del proyecto de referencia.
 *
 * El juego ya no tiene su propio botón de silencio: obedece la preferencia
 * única del navbar del portal (menú 🔊, ver initAmbientSound en app.js),
 * guardada en localStorage bajo PORTAL_AUDIO_KEY. Esto funciona igual si el
 * juego corre en su propia página (juego.html, con navbar) o embebido en el
 * <iframe> de la pestaña "Aventura" (juego_embed.html, sin navbar): en ambos
 * casos se sincroniza por evento "storage" (entre documentos distintos) y por
 * el CustomEvent que dispara app.js dentro de un mismo documento. */

const PORTAL_AUDIO_KEY = "portalAudioModo";
const PORTAL_AUDIO_EVENT = "portal:audio-modo";

function leerModoAudio() {
    try {
        const guardado = localStorage.getItem(PORTAL_AUDIO_KEY);
        if (guardado === "todo" || guardado === "sin-fondo" || guardado === "silencio") return guardado;
    } catch (e) {}
    return "todo";
}

class AudioSystem {
    constructor() {
        this.ctx = null;
        this.muted = leerModoAudio() === "silencio";
        this.master = null;

        window.addEventListener("storage", (event) => {
            if (event.key === PORTAL_AUDIO_KEY) this.setMuted(leerModoAudio() === "silencio");
        });
        window.addEventListener(PORTAL_AUDIO_EVENT, (event) => {
            this.setMuted((event.detail && event.detail.modo) === "silencio");
        });
    }

    /** Debe llamarse tras un gesto del usuario (click/tecla) por las políticas de autoplay. */
    ensure() {
        if (this.ctx) return;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
    }

    setMuted(v) {
        this.muted = v;
        if (this.master) this.master.gain.value = v ? 0 : 0.35;
    }

    _env(gainNode, t0, attack, hold, release, peak) {
        const g = gainNode.gain;
        g.cancelScheduledValues(t0);
        g.setValueAtTime(0.0001, t0);
        g.linearRampToValueAtTime(peak, t0 + attack);
        g.setValueAtTime(peak, t0 + attack + hold);
        g.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
    }

    tone({ freq = 440, endFreq = null, type = "sine", dur = 0.15, attack = 0.005, peak = 0.6, detune = 0 }) {
        if (!this.ctx || this.muted) return;
        const t0 = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + dur);
        osc.detune.value = detune;
        this._env(gain, t0, attack, Math.max(0, dur - attack - dur * 0.3), dur * 0.3, peak);
        osc.connect(gain).connect(this.master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.05);
    }

    noise({ dur = 0.2, peak = 0.5, filterFreq = 1200, filterType = "lowpass", attack = 0.005 }) {
        if (!this.ctx || this.muted) return;
        const t0 = this.ctx.currentTime;
        const bufferSize = Math.floor(this.ctx.sampleRate * dur);
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = filterType;
        filter.frequency.value = filterFreq;
        const gain = this.ctx.createGain();
        this._env(gain, t0, attack, dur * 0.2, dur * 0.8, peak);
        src.connect(filter).connect(gain).connect(this.master);
        src.start(t0);
        src.stop(t0 + dur + 0.05);
    }

    /* --- Efectos concretos del juego --- */
    sfxAttack() { this.tone({ freq: 900, endFreq: 300, type: "sawtooth", dur: 0.12, peak: 0.25 }); }
    sfxHit() { this.noise({ dur: 0.08, peak: 0.4, filterFreq: 2200 }); }
    sfxEnemyDeath() { this.noise({ dur: 0.3, peak: 0.4, filterFreq: 800 }); this.tone({ freq: 180, endFreq: 60, type: "square", dur: 0.25, peak: 0.2 }); }
    sfxPlayerHurt() { this.tone({ freq: 220, endFreq: 110, type: "sawtooth", dur: 0.25, peak: 0.35 }); }
    sfxDash() { this.tone({ freq: 500, endFreq: 900, type: "sine", dur: 0.18, peak: 0.25 }); }
    sfxRoar() {
        this.noise({ dur: 0.6, peak: 0.45, filterFreq: 500, filterType: "lowpass" });
        this.tone({ freq: 110, endFreq: 70, type: "sawtooth", dur: 0.6, peak: 0.3 });
    }
    sfxCoin() { this.tone({ freq: 1200, endFreq: 1800, type: "square", dur: 0.1, peak: 0.2 }); }
    sfxGem() { this.tone({ freq: 1400, type: "sine", dur: 0.18, peak: 0.25 }); this.tone({ freq: 2100, type: "sine", dur: 0.22, attack: 0.05, peak: 0.18 }); }
    sfxHeart() { this.tone({ freq: 700, endFreq: 1000, type: "sine", dur: 0.2, peak: 0.25 }); }
    sfxPoison() { this.tone({ freq: 320, endFreq: 140, type: "triangle", dur: 0.35, peak: 0.28 }); this.noise({ dur: 0.2, peak: 0.18, filterFreq: 600 }); }
    sfxPortal() { this.tone({ freq: 300, endFreq: 900, type: "triangle", dur: 0.8, peak: 0.25 }); }
    sfxPurchase() { this.tone({ freq: 500, type: "square", dur: 0.08, peak: 0.2 }); this.tone({ freq: 750, type: "square", dur: 0.12, attack: 0.06, peak: 0.2 }); }
    sfxClick() { this.tone({ freq: 600, type: "sine", dur: 0.06, peak: 0.15 }); }
    sfxLevelUp() {
        [523, 659, 784, 1046].forEach((f, i) => {
            this.tone({ freq: f, type: "square", dur: 0.18, attack: 0.02 + i * 0.09, peak: 0.2 });
        });
    }
    sfxDefeat() { this.tone({ freq: 300, endFreq: 80, type: "sawtooth", dur: 1.0, peak: 0.3 }); }
    sfxVictory() {
        [523, 659, 784, 1046, 1318].forEach((f, i) => {
            this.tone({ freq: f, type: "triangle", dur: 0.3, attack: i * 0.12, peak: 0.25 });
        });
    }
    sfxBossRoar() {
        this.noise({ dur: 1.0, peak: 0.5, filterFreq: 350 });
        this.tone({ freq: 80, endFreq: 40, type: "sawtooth", dur: 1.0, peak: 0.35 });
    }
}

export const audio = new AudioSystem();
