
/* Rugido Salvaje — punto de entrada del minijuego.
 * Gestiona la partida, las zonas, las mejoras y los desafíos educativos.
 */

import { Input } from "./input.js";
import { World, ZONES } from "./world.js";
import { CHALLENGES } from "./challenges.js";
import { audio } from "./audio.js";
import {
    loadSave,
    writeSave,
    permanentBonuses,
    upgradeCost,
    PERMANENT_UPGRADES
} from "./save.js";
import * as ui from "./ui.js";

const ZONE_DESCRIPTIONS = [
    "El sol se filtra entre las copas. Panteras y ranas venenosas acechan entre la maleza.",
    "La espesura oculta a cazadores veloces. Cada sombra entre las lianas puede moverse.",
    "Piedras olvidadas por el tiempo guardan secretos... y guardianes que no descansan.",
    "El viento seco silba entre paredes rojizas. El territorio se vuelve cada vez más hostil.",
    "Aquí el miedo gobierna. Todo lo que se mueve entre la penumbra quiere tu piel.",
    "Al fondo de esta guarida espera el rival que usurpó tu manada. Es hora de reclamarla."
];

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const stage = document.getElementById("gameStage");
const input = new Input(canvas);

let save = loadSave();

let state = "start";
let world = null;
let zoneIndex = 0;
let pendingZoneIndex = 0;
let session = null;
let dpr = 1;

// Control de los desafíos educativos.
let activeChallenge = null;
let challengeElapsed = 0;
let challengeIndex = 0;

let eventElapsed = 0;
let activeQuickChallenge = null;
let quickChallengeRemaining = 0;
let quickChallengeTypeIndex = 0;
let quickChallengeFinished = false;

// Tiempo entre preguntas automáticas: 30 segundos de juego activo.
const CHALLENGE_INTERVAL = 30;
const QUICK_EVENT_INTERVAL = 30 * 60;
const QUICK_CHALLENGE_TIME = 10;
const QUICK_CHALLENGE_TYPES = ["word", "place", "order", "find"];

function resetTimedChallengeState() {
    activeChallenge = null;
    challengeElapsed = 0;
}

function resetQuickChallengeState() {
    activeQuickChallenge = null;
    quickChallengeRemaining = 0;
    quickChallengeFinished = false;
}

function nextQuickChallengeType() {
    const type = QUICK_CHALLENGE_TYPES[quickChallengeTypeIndex % QUICK_CHALLENGE_TYPES.length];
    quickChallengeTypeIndex += 1;
    return type;
}

function buildQuickChallenge(type) {
    const bank = {
        word: {
            type: "word",
            title: "Completa la palabra",
            instruction: "Completa la palabra escondida antes de que acabe el tiempo.",
            timeLimit: QUICK_CHALLENGE_TIME,
            answer: "COLEGIO",
            masked: "C_L_G_O",
            prompt: "Escribe la palabra correcta en mayúsculas."
        },
        place: {
            type: "place",
            title: "Coloca la información",
            instruction: "Asigna cada texto al lugar correcto del mapa del colegio.",
            timeLimit: QUICK_CHALLENGE_TIME,
            slots: [
                { id: "entrada", label: "Entrada principal" },
                { id: "patio", label: "Patio y descanso" },
                { id: "bloque", label: "Bloque C" },
                { id: "portal", label: "Portal dorado" }
            ],
            items: [
                { id: "a", label: "Bloque C" },
                { id: "b", label: "Portal dorado" },
                { id: "c", label: "Entrada principal" },
                { id: "d", label: "Patio y descanso" }
            ],
            correct: {
                entrada: "c",
                patio: "d",
                bloque: "a",
                portal: "b"
            }
        },
        order: {
            type: "order",
            title: "Ordena correctamente",
            instruction: "Selecciona los pasos en el orden correcto.",
            timeLimit: QUICK_CHALLENGE_TIME,
            sequence: ["Observa", "Analiza", "Responde", "Avanza"],
            scrambled: ["Responde", "Observa", "Avanza", "Analiza"]
        },
        find: {
            type: "find",
            title: "Encuentra y selecciona",
            instruction: "Elige el elemento correcto según la pista: es el símbolo que representa la ruta del colegio.",
            timeLimit: QUICK_CHALLENGE_TIME,
            items: [
                { id: "mapa", label: "Mapa del colegio" },
                { id: "arbusto", label: "Arbusto" },
                { id: "portal", label: "Portal dorado" },
                { id: "roca", label: "Roca" },
                { id: "liana", label: "Liana" }
            ],
            correct: "mapa"
        }
    };

    return bank[type] || bank.word;
}

function applyQuickReward(result) {
    if (!session || !world) return;

    if (result && result.success) {
        const rewardCoins = 5;
        const rewardGems = 1;

        world.runCoins += rewardCoins;
        session.coins += rewardCoins;
        save.gems += rewardGems;
        writeSave(save);
        audio.sfxCoin();
        audio.sfxGem();
    }
}

function armAudioOnce() {
    const arm = () => {
        audio.ensure();
        window.removeEventListener("pointerdown", arm);
        window.removeEventListener("keydown", arm);
    };

    window.addEventListener("pointerdown", arm);
    window.addEventListener("keydown", arm);
}

function resize() {
    const rect = stage.getBoundingClientRect();

    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (world) {
        world.camera.viewW = rect.width;
        world.camera.viewH = rect.height;
    }
}

window.addEventListener("resize", resize);

function computeWorldBonuses() {
    const perm = permanentBonuses(save);

    return {
        maxHealthBonus: perm.maxHealthBonus,
        damageMult: perm.damageMult * session.buffs.damageMult,
        speedMult: perm.speedMult * session.buffs.speedMult,
        cooldownMult: perm.cooldownMult * session.buffs.cooldownMult,
        rangeMult: perm.rangeMult,
        roarMult: perm.roarMult
    };
}

function startNewRun() {
    resetTimedChallengeState();
    resetQuickChallengeState();
    challengeIndex = 0;
    eventElapsed = 0;

    session = {
        coins: 0,
        kills: 0,
        gemsThisRun: 0,
        startTime: performance.now(),
        purchasedFlags: {},
        buffs: {
            damageMult: 1,
            speedMult: 1,
            cooldownMult: 1
        },
        pendingFullHeal: false
    };

    goToZoneIntro(0);
}

function goToZoneIntro(idx) {
    if (idx < 0 || idx >= ZONES.length) return;

    pendingZoneIndex = idx;

    ui.setIntroText(
        ZONES[idx].name,
        ZONE_DESCRIPTIONS[idx] || ""
    );

    state = "intro";
    ui.hideAllScreens();
    ui.showScreen("screenIntro");
    ui.setHudVisible(false);
}

function beginZone(idx) {
    if (!session || idx < 0 || idx >= ZONES.length) return;

    activeChallenge = null;
    challengeElapsed = 0;
    resetQuickChallengeState();
    eventElapsed = 0;
    zoneIndex = idx;

    const rect = stage.getBoundingClientRect();

    world = new World(
        idx,
        idx,
        computeWorldBonuses(),
        rect.width,
        rect.height
    );

    if (session.pendingFullHeal) {
        world.player.health = world.player.maxHealth;
        session.pendingFullHeal = false;
    }

    world.onPlayerDied = handlePlayerDied;
    world.onPortalEnter = handlePortalEnter;

    world.onGemBanked = () => {
        save.gems += 1;
        session.gemsThisRun += 1;
        writeSave(save);
    };

    state = "playing";
    ui.hideAllScreens();
    ui.setHudVisible(true);
}

/*
 * Desafío periódico.
 * No utiliza el portal ni cambia de zona.
 */
function showTimedChallenge() {
    if (
        state !== "playing" ||
        !session ||
        !world ||
        !CHALLENGES.length ||
        activeChallenge
    ) {
        return;
    }

    activeChallenge = CHALLENGES[
        challengeIndex % CHALLENGES.length
    ];

    challengeIndex += 1;
    challengeElapsed = 0;
    state = "challenge";

    ui.setHudVisible(true);

    ui.showChallenge(activeChallenge, () => {
        audio.sfxClick();
        window.setTimeout(() => {
            if (state !== "challenge") return;
            completeTimedChallenge();
        }, 1200);
    }, "timed");
}

/*
 * Al acertar una pregunta periódica, se reanuda
 * la partida sin activar la tienda ni el portal.
 */
function completeTimedChallenge() {
    if (state !== "challenge" || !activeChallenge) return;

    activeChallenge = null;
    challengeElapsed = 0;

    ui.hideAllScreens();
    ui.setHudVisible(true);

    state = "playing";
}

/*
 * El portal conserva su comportamiento original:
 * avanzar a la siguiente zona o terminar la partida.
 */
function handlePortalEnter() {
    if (!session || !world || state !== "playing") return;

    if (!CHALLENGES.length) {
        completePortalEnter();
        return;
    }

    activeChallenge = CHALLENGES[
        zoneIndex % CHALLENGES.length
    ];

    state = "challenge";
    ui.setHudVisible(true);

    ui.showChallenge(activeChallenge, () => {
        audio.sfxClick();
        window.setTimeout(() => {
            if (state !== "challenge") return;
            completePortalEnter();
        }, 1200);
    }, "portal");
}

function completePortalEnter() {
    if (!session || !world) return;

    session.coins += world.runCoins;
    session.kills += world.kills;

    activeChallenge = null;
    challengeElapsed = 0;

    if (zoneIndex >= ZONES.length - 1) {
        handleVictory();
    } else {
        audio.sfxLevelUp();
        openShop();
    }
}

function openShop() {
    state = "shop";

    ui.hideAllScreens();
    ui.setHudVisible(false);
    ui.showScreen("screenShop");

    ui.renderShop(
        session.coins,
        session.purchasedFlags,
        onShopBuy,
        ZONES[zoneIndex + 1].name
    );
}

function onShopBuy(opt) {
    if (!session || session.coins < opt.cost) return;

    if (!opt.repeatable && session.purchasedFlags[opt.key]) {
        return;
    }

    session.coins -= opt.cost;
    audio.sfxPurchase();

    if (opt.key === "heal") {
        session.pendingFullHeal = true;
    } else if (opt.key === "damage") {
        session.buffs.damageMult *= 1.15;
        session.purchasedFlags.damage = true;
    } else if (opt.key === "speed") {
        session.buffs.speedMult *= 1.10;
        session.purchasedFlags.speed = true;
    } else if (opt.key === "cooldown") {
        session.buffs.cooldownMult *= 0.85;
        session.purchasedFlags.cooldown = true;
    }

    ui.renderShop(
        session.coins,
        session.purchasedFlags,
        onShopBuy,
        ZONES[zoneIndex + 1].name
    );
}

function handlePlayerDied() {
    if (!session || state === "gameover") return;

    session.kills += world.kills;

    save.bestLevel = Math.max(save.bestLevel, zoneIndex);
    save.stats.runs += 1;
    save.stats.kills += session.kills;
    save.stats.bestRunKills = Math.max(
        save.stats.bestRunKills,
        session.kills
    );

    writeSave(save);
    audio.sfxDefeat();

    ui.setGameOverStats({
        zoneName: ZONES[zoneIndex].name,
        kills: session.kills,
        coins: session.coins,
        gems: session.gemsThisRun
    });

    activeChallenge = null;
    challengeElapsed = 0;
    state = "gameover";

    ui.hideAllScreens();
    ui.setHudVisible(false);
    ui.showScreen("screenGameOver");
}

function handleVictory() {
    save.bestLevel = Math.max(save.bestLevel, ZONES.length - 1);
    save.stats.runs += 1;
    save.stats.kills += session.kills;
    save.stats.bestRunKills = Math.max(
        save.stats.bestRunKills,
        session.kills
    );

    writeSave(save);
    audio.sfxVictory();

    const seconds = Math.round(
        (performance.now() - session.startTime) / 1000
    );

    const time =
        `${Math.floor(seconds / 60)}:` +
        String(seconds % 60).padStart(2, "0");

    ui.setVictoryStats({
        kills: session.kills,
        coins: session.coins,
        gems: session.gemsThisRun,
        time
    });

    state = "victory";

    ui.hideAllScreens();
    ui.setHudVisible(false);
    ui.showScreen("screenVictory");
}

function pauseGame() {
    if (state !== "playing") return;

    state = "paused";
    ui.showScreen("screenPause");
}

function resumeGame() {
    if (state !== "paused") return;

    challengeElapsed = 0;
    state = "playing";
    ui.hideAllScreens();
    ui.setHudVisible(true);
}

function showRapidAlert() {
    if (
        state !== "playing" ||
        rapidAlertVisible ||
        rapidChallenge ||
        activeChallenge
    ) {
        return;
    }

    rapidAlertVisible = true;
    rapidReturnState = "playing";
    state = "eventAlert";
    ui.showRapidAlert({
        title: "Nuevo reto disponible",
        text: "¡Hay un nuevo reto disponible! ¿Quieres aceptarlo ahora?",
        acceptText: "Aceptar reto",
        rejectText: "Rechazar"
    });
}

function rejectRapidAlert() {
    if (state !== "eventAlert") return;

    rapidAlertVisible = false;
    rapidEventElapsed = 0;
    ui.hideRapidAlert();
    state = rapidReturnState;
    ui.hideAllScreens();
    ui.setHudVisible(true);
}

function acceptRapidAlert() {
    if (state !== "eventAlert") return;

    rapidAlertVisible = false;
    ui.hideRapidAlert();

    const type = getNextRapidChallengeType();
    const spec = getRapidChallengeSpec(type);

    rapidChallenge = {
        type,
        spec,
        remaining: RAPID_CHALLENGE_TIME_LIMIT
    };

    state = "rapidChallenge";
    ui.showRapidChallenge(spec, {
        onSubmit: (value) => resolveRapidChallenge(value),
        onCancel: () => rejectRapidChallenge("cancel")
    }, RAPID_CHALLENGE_TIME_LIMIT);
}

function resolveRapidChallenge(value) {
    if (!rapidChallenge || state !== "rapidChallenge") return;

    const spec = rapidChallenge.spec;
    const answer = String(value || "").trim();
    let isCorrect = false;

    if (spec.key === "word") {
        isCorrect = answer.toUpperCase() === String(spec.answer).toUpperCase();
    } else if (spec.key === "placement") {
        isCorrect = Array.isArray(value) && value.length === spec.answer.length &&
            value.every((entry, index) => entry.key === spec.answer[index].key && entry.slot === spec.answer[index].slot);
    } else if (spec.key === "order") {
        isCorrect = Array.isArray(value) && value.length === spec.answer.length &&
            value.every((item, index) => item === spec.answer[index]);
    } else {
        isCorrect = answer.toUpperCase() === String(spec.answer).toUpperCase();
    }

    if (isCorrect) {
        const rewardCoins = 5;
        const rewardGems = 1;

        if (world) {
            world.runCoins += rewardCoins;
        }
        if (session) {
            session.coins += rewardCoins;
            session.gemsThisRun += rewardGems;
        }
        save.gems += rewardGems;
        writeSave(save);

        ui.showRapidResult({
            success: true,
            title: "¡Reto completado!",
            message: "¡Excelente! Has ganado la recompensa del reto.",
            emoji: "😀😄😊",
            delay: 900
        });

        window.setTimeout(() => {
            rapidChallenge = null;
            rapidEventElapsed = 0;
            state = rapidReturnState;
            ui.hideRapidChallenge();
            ui.hideAllScreens();
            ui.setHudVisible(true);
        }, 900);
    } else {
        ui.showRapidResult({
            success: false,
            title: "No es correcto",
            message: "La respuesta no fue la correcta. Inténtalo de nuevo en el siguiente reto.",
            emoji: "😟🙁😢",
            delay: 900
        });

        window.setTimeout(() => {
            rapidChallenge = null;
            rapidEventElapsed = 0;
            state = rapidReturnState;
            ui.hideRapidChallenge();
            ui.hideAllScreens();
            ui.setHudVisible(true);
        }, 900);
    }
}

function rejectRapidChallenge(reason = "timeout") {
    if (!rapidChallenge || state !== "rapidChallenge") return;

    const message = reason === "timeout"
        ? "Se agotó el tiempo del reto. ¡Sigue jugando!"
        : "Reto cancelado. ¡Continúa la partida!";

    ui.showRapidResult({
        success: false,
        title: "Reto fallido",
        message,
        emoji: "😟🙁😢",
        delay: 900
    });

    window.setTimeout(() => {
        rapidChallenge = null;
        rapidEventElapsed = 0;
        state = rapidReturnState;
        ui.hideRapidChallenge();
        ui.hideAllScreens();
        ui.setHudVisible(true);
    }, 900);
}

function startEventPrompt() {
    if (state !== "playing" || !session || !world || activeQuickChallenge) return;

    const type = nextQuickChallengeType();
    const challenge = buildQuickChallenge(type);
    activeQuickChallenge = challenge;
    eventElapsed = 0;
    state = "eventAlert";

    ui.showEventAlert(
        {
            title: "Nuevo reto disponible",
            text: "Hay un nuevo reto disponible. ¿Quieres aceptarlo?"
        },
        () => {
            if (state !== "eventAlert") return;
            state = "eventChallenge";
            quickChallengeRemaining = challenge.timeLimit;
            quickChallengeFinished = false;
            ui.showQuickChallenge(challenge, (result) => {
                applyQuickReward(result);
                state = "playing";
                quickChallengeFinished = true;
                resetQuickChallengeState();
                ui.hideAllScreens();
                ui.setHudVisible(true);
                if (result && result.success) {
                    ui.showTransientFeedback("Éxito", "¡Reto completado! +5 monedas y 1 gema.");
                } else {
                    ui.showTransientFeedback("Error", result && result.message ? result.message : "Se acabó el tiempo. Inténtalo otra vez.");
                }
            });
        },
        () => {
            resetQuickChallengeState();
            state = "playing";
            ui.hideAllScreens();
            ui.setHudVisible(true);
        }
    );
}

function resolveQuickChallenge(result) {
    if (!activeQuickChallenge) return;

    const challenge = activeQuickChallenge;
    const success = !!(result && result.success);

    if (success) {
        applyQuickReward({ success: true });
        ui.showQuickResult({
            success: true,
            title: "¡Reto superado!",
            message: `¡Excelente! ${challenge.title} completado.`
        });
    } else {
        ui.showQuickResult({
            success: false,
            title: "Reto fallido",
            message: result && result.message ? result.message : "Se agotó el tiempo. Sigue jugando."
        });
    }

    window.setTimeout(() => {
        state = "playing";
        resetQuickChallengeState();
        ui.hideAllScreens();
        ui.setHudVisible(true);
    }, 1200);
}

function onBuyPermanentUpgrade(key) {
    const def = PERMANENT_UPGRADES.find((u) => u.key === key);

    if (!def) return;

    const level = save.upgrades[key] || 0;

    if (level >= def.maxLevel) return;

    const cost = upgradeCost(def, level);

    if (save.gems < cost) return;

    save.gems -= cost;
    save.upgrades[key] = level + 1;

    writeSave(save);
    audio.sfxPurchase();

    ui.renderUpgrades(save, onBuyPermanentUpgrade);
}

ui.initUI({
    onPlay: () => {
        audio.ensure();
        audio.sfxClick();
        startNewRun();
    },

    onOpenUpgrades: () => {
        audio.sfxClick();
        state = "upgrades";

        ui.hideAllScreens();
        ui.showScreen("screenUpgrades");
        ui.renderUpgrades(save, onBuyPermanentUpgrade);
    },

    onCloseUpgrades: () => {
        audio.sfxClick();
        state = "start";

        ui.hideAllScreens();
        ui.showScreen("screenStart");
    },

    onIntroContinue: () => {
        audio.sfxClick();
        beginZone(pendingZoneIndex);
    },

    onResume: () => {
        audio.sfxClick();
        resumeGame();
    },

    onRestart: () => {
        audio.sfxClick();
        startNewRun();
    },

    onExitToMenu: () => {
        resetTimedChallengeState();
        resetQuickChallengeState();
        eventElapsed = 0;
        session = null;
        world = null;
        state = "start";

        ui.hideAllScreens();
        ui.setHudVisible(false);
        ui.showScreen("screenStart");
    },

    onShopContinue: () => {
        audio.sfxClick();
        goToZoneIntro(zoneIndex + 1);
    },

    onChallengeContinue: (challengeType) => {
        if (state !== "challenge" || !activeChallenge) return;

        audio.sfxClick();

        if (challengeType === "portal") {
            completePortalEnter();
        } else {
            completeTimedChallenge();
        }
    },

    onRapidAccept: () => {
        acceptRapidAlert();
    },

    onRapidReject: () => {
        rejectRapidAlert();
    },

    onPauseKey: () => {
        if (state === "playing") {
            pauseGame();
        } else if (state === "paused") {
            resumeGame();
        }
    },

    onEventAccept: () => {
        if (state !== "eventAlert") return;
        const challenge = activeQuickChallenge || buildQuickChallenge(nextQuickChallengeType());
        state = "eventChallenge";
        quickChallengeRemaining = challenge.timeLimit;
        ui.showQuickChallenge(challenge, (result) => {
            resolveQuickChallenge(result);
        });
    },

    onEventReject: () => {
        if (state !== "eventAlert") return;
        resetQuickChallengeState();
        eventElapsed = 0;
        state = "playing";
        ui.hideAllScreens();
        ui.setHudVisible(true);
    },

    onQuickChallengeSubmit: () => {
        if (state !== "eventChallenge" || !activeQuickChallenge) return;

        const challenge = activeQuickChallenge;
        const answer = ui.getQuickChallengeAnswer();
        const isCorrect = ui.checkQuickChallengeAnswer(challenge, answer);

        if (isCorrect) {
            resolveQuickChallenge({ success: true, message: "¡Reto superado!" });
        } else {
            resolveQuickChallenge({ success: false, message: "Respuesta incorrecta o tiempo agotado." });
        }
    },

    onQuickChallengeCancel: () => {
        if (state !== "eventChallenge") return;
        resetQuickChallengeState();
        eventElapsed = 0;
        state = "playing";
        ui.hideAllScreens();
        ui.setHudVisible(true);
    }
});

armAudioOnce();
resize();

ui.showScreen("screenStart");
ui.setHudVisible(false);

function waveLabel(w) {
    if (w.isBossLevel) {
        return w.boss
            ? "Jefe final"
            : "El Usurpador se acerca...";
    }

    const total = w.waves.length;
    const current = Math.min(w.waveIndex + 1, total);

    if (w.level.portal.active) {
        return "¡Portal abierto! Ve hacia la luz dorada";
    }

    return `Oleada ${current} / ${total}`;
}

let lastTime = performance.now();

function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(
        0,
        0,
        canvas.width / dpr,
        canvas.height / dpr
    );

    if (
        world &&
        (
            state === "playing" ||
            state === "paused" ||
            state === "challenge" ||
            state === "eventChallenge" ||
            state === "eventAlert"
        )
    ) {
        if (state === "playing") {
            challengeElapsed += dt;
            eventElapsed += dt;

            if (
                challengeElapsed >= CHALLENGE_INTERVAL &&
                CHALLENGES.length > 0
            ) {
                showTimedChallenge();
            }

            if (
                eventElapsed >= QUICK_EVENT_INTERVAL &&
                !activeQuickChallenge &&
                state === "playing"
            ) {
                startEventPrompt();
            }

            if (state === "playing") {
                world.update(dt, input);
            }
        }

        if (state === "eventChallenge" && activeQuickChallenge) {
            quickChallengeRemaining = Math.max(0, quickChallengeRemaining - dt);
            ui.updateQuickChallengeTimer(quickChallengeRemaining);

            if (quickChallengeRemaining <= 0 && !quickChallengeFinished) {
                quickChallengeFinished = true;
                resolveQuickChallenge({ success: false, message: "Se agotó el tiempo del reto rápido." });
            }
        }

        world.draw(ctx);

        ui.updateHud(
            world,
            ZONES[zoneIndex].name,
            waveLabel(world)
        );

        ui.drawMinimap(world);
    }

    ctx.restore();

    input.endFrame();
    requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
