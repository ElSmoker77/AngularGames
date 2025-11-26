// =========================
// Server unificado para Render
// Sirve Angular (build) + Socket.IO
// =========================

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');

// --- CONFIG ---
const TURN_DURATION_MS = 15_000; // por defecto

const DEFAULT_MODE = 'normal';

const MODES = {
  normal: {
    startingAmmo: 1,                 // 1 bala inicial
    maxAmmo: 3,                      // tamaño del cargador
    maxConsecutiveBlocks: 2,         // máx. 2 bloqueos seguidos
    afkLimit: 3,                     // 3 turnos sin elegir acción → AFK expuesto
    preciseShotChance: 0.1,          // 10% crítico base
    maxTurtleTurnsWithoutAttack: 3,  // turnos sin atacar antes de perder una bala
    hpPerPlayer: 3,                  // vidas por jugador
    turnDurationMs: TURN_DURATION_MS // duración del turno en ms
  }
};

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// --- SERVIR ANGULAR COMPILADO ---
const distPath = path.join(__dirname, 'dist', 'angular-roguelike', 'browser');
app.use(express.static(distPath));

// SPA fallback (todas las rutas -> index.html)
app.use((req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// =========================
//   SISTEMA DE SALAS
// =========================

const rooms = {};   // roomId -> { state, playersSockets, turnTimer }
const clients = {}; // socketId -> { roomId, playerId }

function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function createInitialPlayer(id, name, config) {
  const cfg = config || MODES[DEFAULT_MODE];
  return {
    id,
    name,
    hp: cfg.hpPerPlayer,
    maxHp: cfg.hpPerPlayer,
    ammo: cfg.startingAmmo,
    isBlocking: false,
    lastAction: null,
    score: 0,
    consecutiveBlocks: 0,
    consecutiveHits: 0,
    turnsWithoutAttack: 0,
    afkTurns: 0
  };
}

function pushLog(state, msg) {
  state.log.unshift(msg);
  if (state.log.length > 50) state.log.pop();
}

function ensurePlayerTrackingFields(player) {
  if (typeof player.consecutiveBlocks !== 'number') player.consecutiveBlocks = 0;
  if (typeof player.consecutiveHits !== 'number') player.consecutiveHits = 0;
  if (typeof player.turnsWithoutAttack !== 'number') player.turnsWithoutAttack = 0;
  if (typeof player.afkTurns !== 'number') player.afkTurns = 0;
}

function getCritChance(attacker, cfg) {
  const base = cfg.preciseShotChance || 0;
  let chance = base;

  // Racha de aciertos → sube probabilidad
  if (attacker.consecutiveHits >= 2) {
    chance += 0.1; // +10% si viene en racha
  }

  if (chance > 0.5) chance = 0.5;
  return chance;
}

function startTurn(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const state = room.state;
  if (!state.config) {
    state.config = MODES[DEFAULT_MODE];
  }
  const duration = state.config.turnDurationMs || TURN_DURATION_MS;

  state.pendingActions = { 1: null, 2: null };
  state.turnEndsAt = Date.now() + duration;

  if (room.turnTimer) clearTimeout(room.turnTimer);

  room.turnTimer = setTimeout(() => autoResolveTurn(roomId), duration);

  pushLog(state, `Nueva elección de acciones. Tienes ${duration / 1000} segundos.`);
}

function randomAction(player) {
  if (player.ammo <= 0) return Math.random() < 0.5 ? 'reload' : 'block';
  const r = Math.random();
  if (r < 0.34) return 'attack';
  if (r < 0.67) return 'reload';
  return 'block';
}

function autoResolveTurn(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const state = room.state;
  room.turnTimer = null;

  if (!state.gameStarted || state.isRoundOver) return;

  const cfg = state.config || MODES[DEFAULT_MODE];

  const p1 = state.players[0];
  const p2 = state.players[1];

  ensurePlayerTrackingFields(p1);
  ensurePlayerTrackingFields(p2);

  if (!state.pendingActions[1]) {
    p1.afkTurns = (p1.afkTurns || 0) + 1;

    if (p1.afkTurns >= cfg.afkLimit) {
      state.pendingActions[1] = 'afk';
      pushLog(state, `${p1.name} se distrae mirando el horizonte y queda totalmente expuesto.`);
      p1.afkTurns = 0;
    } else {
      state.pendingActions[1] = randomAction(p1);
      pushLog(state, `${p1.name} no elige acción a tiempo. Se selecciona una acción automática.`);
    }
  } else {
    p1.afkTurns = 0;
  }

  if (!state.pendingActions[2]) {
    p2.afkTurns = (p2.afkTurns || 0) + 1;

    if (p2.afkTurns >= cfg.afkLimit) {
      state.pendingActions[2] = 'afk';
      pushLog(state, `${p2.name} se distrae mirando el horizonte y queda totalmente expuesto.`);
      p2.afkTurns = 0;
    } else {
      state.pendingActions[2] = randomAction(p2);
      pushLog(state, `${p2.name} no elige acción a tiempo. Se selecciona una acción automática.`);
    }
  } else {
    p2.afkTurns = 0;
  }

  pushLog(state, `Tiempo agotado. Se resuelven las acciones elegidas.`);

  resolveTurn(roomId);
}

function resolveTurn(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const state = room.state;
  const a1 = state.pendingActions[1];
  const a2 = state.pendingActions[2];

  if (!a1 || !a2) return;

  const p1 = state.players[0];
  const p2 = state.players[1];

  const cfg = state.config || MODES[DEFAULT_MODE];

  ensurePlayerTrackingFields(p1);
  ensurePlayerTrackingFields(p2);

  // Por si usamos el contador de turnos después
  state.totalTurns = (state.totalTurns || 0) + 1;

  const isAfk1 = (a1 === 'afk');
  const isAfk2 = (a2 === 'afk');

  // Reset de bloqueo antes de aplicar acciones
  p1.isBlocking = false;
  p2.isBlocking = false;

  const preAmmo1 = p1.ammo;
  const preAmmo2 = p2.ammo;

  // --------------------
  // BLOQUEO (con límite)
  // --------------------
  if (!isAfk1 && a1 === 'block') {
    p1.consecutiveBlocks += 1;

    if (p1.consecutiveBlocks > cfg.maxConsecutiveBlocks) {
      p1.isBlocking = false;
      p1.consecutiveBlocks = cfg.maxConsecutiveBlocks;
      pushLog(state, `${p1.name} se cansó de sostener el escudo y deja una abertura.`);
    } else {
      p1.isBlocking = true;
      if (p1.consecutiveBlocks === cfg.maxConsecutiveBlocks) {
        pushLog(state, `${p1.name} fuerza al máximo su escudo.`);
      } else {
        pushLog(state, `${p1.name} levanta el escudo.`);
      }
    }
  } else if (!isAfk1) {
    p1.consecutiveBlocks = 0;
  }

  if (!isAfk2 && a2 === 'block') {
    p2.consecutiveBlocks += 1;

    if (p2.consecutiveBlocks > cfg.maxConsecutiveBlocks) {
      p2.isBlocking = false;
      p2.consecutiveBlocks = cfg.maxConsecutiveBlocks;
      pushLog(state, `${p2.name} se cansó de sostener el escudo y deja una abertura.`);
    } else {
      p2.isBlocking = true;
      if (p2.consecutiveBlocks === cfg.maxConsecutiveBlocks) {
        pushLog(state, `${p2.name} fuerza al máximo su escudo.`);
      } else {
        pushLog(state, `${p2.name} levanta el escudo.`);
      }
    }
  } else if (!isAfk2) {
    p2.consecutiveBlocks = 0;
  }

  // --------------------
  // RECARGA (con tope)
  // --------------------
  if (!isAfk1 && a1 === 'reload') {
    if (p1.ammo >= cfg.maxAmmo) {
      pushLog(state, `${p1.name} intenta recargar, pero el cargador ya está lleno.`);
    } else {
      p1.ammo++;
      pushLog(state, `${p1.name} recarga. Munición: ${p1.ammo}/${cfg.maxAmmo}.`);
    }
  }

  if (!isAfk2 && a2 === 'reload') {
    if (p2.ammo >= cfg.maxAmmo) {
      pushLog(state, `${p2.name} intenta recargar, pero el cargador ya está lleno.`);
    } else {
      p2.ammo++;
      pushLog(state, `${p2.name} recarga. Munición: ${p2.ammo}/${cfg.maxAmmo}.`);
    }
  }

  // --------------------
  // ATAQUES + CRÍTICOS
  // --------------------

  // Jugador 1 ataca
  if (!isAfk1 && a1 === 'attack') {
    p1.turnsWithoutAttack = 0;

    if (preAmmo1 <= 0) {
      pushLog(state, `${p1.name} intenta atacar pero no tiene munición.`);
      p1.consecutiveHits = 0;
    } else {
      p1.ammo--;

      const critChance1 = getCritChance(p1, cfg);
      const isCrit1 = Math.random() < critChance1;

      if (isCrit1 && p2.isBlocking) {
        // crítico ignora escudo
        p2.hp--;
        p1.consecutiveHits++;
        pushLog(
          state,
          `${p1.name} realiza un disparo preciso que atraviesa el escudo de ${p2.name}. Pierde 1 vida.`
        );
      } else if (p2.isBlocking) {
        pushLog(state, `${p2.name} bloquea el disparo de ${p1.name}.`);
        p1.consecutiveHits = 0;
      } else {
        p2.hp--;
        p1.consecutiveHits++;
        pushLog(state, `${p1.name} acierta un disparo a ${p2.name}. Pierde 1 vida.`);
      }
    }
  } else {
    // No atacó este turno (incluye AFK, recarga o bloquea)
    p1.turnsWithoutAttack++;
  }

  // Jugador 2 ataca
  if (!isAfk2 && a2 === 'attack') {
    p2.turnsWithoutAttack = 0;

    if (preAmmo2 <= 0) {
      pushLog(state, `${p2.name} intenta atacar pero no tiene munición.`);
      p2.consecutiveHits = 0;
    } else {
      p2.ammo--;

      const critChance2 = getCritChance(p2, cfg);
      const isCrit2 = Math.random() < critChance2;

      if (isCrit2 && p1.isBlocking) {
        p1.hp--;
        p2.consecutiveHits++;
        pushLog(
          state,
          `${p2.name} realiza un disparo preciso que atraviesa el escudo de ${p1.name}. Pierde 1 vida.`
        );
      } else if (p1.isBlocking) {
        pushLog(state, `${p1.name} bloquea el disparo de ${p2.name}.`);
        p2.consecutiveHits = 0;
      } else {
        p1.hp--;
        p2.consecutiveHits++;
        pushLog(state, `${p2.name} acierta un disparo a ${p1.name}. Pierde 1 vida.`);
      }
    }
  } else {
    p2.turnsWithoutAttack++;
  }

  // --------------------
  // Penalizar modo tortuga
  // --------------------
  const players = [p1, p2];
  for (const p of players) {
    const maxNoAtk = cfg.maxTurtleTurnsWithoutAttack || 0;
    if (maxNoAtk > 0 && p.turnsWithoutAttack >= maxNoAtk && p.ammo > 0) {
      p.ammo--;
      pushLog(state, `${p.name} duda demasiado y deja caer una bala del cargador.`);
      p.turnsWithoutAttack = 0;
    }
  }

  // lastAction (no mostramos AFK como acción)
  p1.lastAction = (!isAfk1 && (a1 === 'attack' || a1 === 'reload' || a1 === 'block')) ? a1 : null;
  p2.lastAction = (!isAfk2 && (a2 === 'attack' || a2 === 'reload' || a2 === 'block')) ? a2 : null;

  const p1Dead = p1.hp <= 0;
  const p2Dead = p2.hp <= 0;

  if (p1Dead && p2Dead) {
    p1.hp = 0;
    p2.hp = 0;
    state.isRoundOver = true;
    state.winnerId = null;
    pushLog(state, `Ambos jugadores caen. Empate.`);
    io.to(roomId).emit('stateUpdate', state);
    return;
  }

  if (p1Dead) {
    p1.hp = 0;
    state.isRoundOver = true;
    state.winnerId = p2.id;
    p2.score++;
    pushLog(state, `${p2.name} gana la ronda.`);
    io.to(roomId).emit('stateUpdate', state);
    return;
  }

  if (p2Dead) {
    p2.hp = 0;
    state.isRoundOver = true;
    state.winnerId = p1.id;
    p1.score++;
    pushLog(state, `${p1.name} gana la ronda.`);
    io.to(roomId).emit('stateUpdate', state);
    return;
  }

  // Ambos vivos y sin balas → turno de tensión
  if (p1.ammo === 0 && p2.ammo === 0) {
    pushLog(state, `Ambos se quedan sin balas. El silencio inunda el campo de batalla.`);
  }

  // 👉 NADIE MUERE → mostramos resultado, animaciones,
  // sin timer, y luego de 2s comenzamos la nueva elección
  state.turnEndsAt = null;         // oculta barra de tiempo
  io.to(roomId).emit('stateUpdate', state); // muestra animaciones con lastAction

  setTimeout(() => {
    const r = rooms[roomId];
    if (!r) return;                // sala ya no existe
    const st = r.state;
    if (st.isRoundOver) return;    // por si algo raro pasó

    startTurn(roomId);
    io.to(roomId).emit('stateUpdate', st);
  }, 2000); // pausa de 2 segundos
}

// =========================
//  Socket.IO handlers
// =========================

io.on('connection', (socket) => {
  console.log('Nuevo cliente', socket.id);

  socket.on('createRoom', ({ playerName }) => {
    let roomId;
    do roomId = generateRoomId();
    while (rooms[roomId]);

    const config = MODES[DEFAULT_MODE];

    const p1 = createInitialPlayer(1, playerName || 'Jugador 1', config);
    const p2 = createInitialPlayer(2, 'Esperando...', config);

    rooms[roomId] = {
      state: {
        players: [p1, p2],
        currentTurn: 0,
        isRoundOver: false,
        winnerId: null,
        round: 1,
        log: [
          `Sala creada por ${p1.name}.`,
          `Esperando a que se conecte el segundo jugador...`
        ],
        gameStarted: false,
        pendingActions: { 1: null, 2: null },
        turnEndsAt: null,
        config,
        totalTurns: 0
      },
      playersSockets: { 1: socket.id, 2: null },
      turnTimer: null
    };

    clients[socket.id] = { roomId, playerId: 1 };
    socket.join(roomId);

    socket.emit('roomCreated', {
      roomId,
      playerId: 1,
      state: rooms[roomId].state
    });

    console.log(`Sala ${roomId} creada.`);
  });

  socket.on('joinRoom', ({ roomId, playerName }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('errorMessage', 'Sala no encontrada.');
    if (room.playersSockets[2]) return socket.emit('errorMessage', 'La sala está llena.');

    const state = room.state;
    state.players[1].name = playerName || 'Jugador 2';
    room.playersSockets[2] = socket.id;
    clients[socket.id] = { roomId, playerId: 2 };
    socket.join(roomId);

    state.gameStarted = true;
    pushLog(state, `${state.players[1].name} se une a la sala. ¡Comienza el duelo!`);

    startTurn(roomId);

    socket.emit('roomJoined', { roomId, playerId: 2, state });
    io.to(roomId).emit('stateUpdate', state);

    console.log(`Jugador 2 se unió a la sala ${roomId}`);
  });

  socket.on('chooseAction', ({ roomId, action }) => {
    const info = clients[socket.id];
    if (!info || info.roomId !== roomId) return;

    const room = rooms[roomId];
    if (!room) return;

    const state = room.state;
    if (state.isRoundOver) return;

    const playerId = info.playerId;
    const player = state.players.find(p => p.id === playerId);
    if (!player) return;

    if (!state.pendingActions) state.pendingActions = { 1: null, 2: null };

    state.pendingActions[playerId] = action;
    pushLog(state, `${player.name} ha elegido su acción.`);

    if (state.pendingActions[1] && state.pendingActions[2]) {
      if (room.turnTimer) clearTimeout(room.turnTimer);
      resolveTurn(roomId);
    } else {
      io.to(roomId).emit('stateUpdate', state);
    }
  });

  socket.on('nextRound', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    const state = room.state;
    if (!state.isRoundOver) return;

    const cfg = state.config || MODES[DEFAULT_MODE];

    state.round++;
    state.isRoundOver = false;
    state.winnerId = null;

    for (const p of state.players) {
      ensurePlayerTrackingFields(p);
      p.hp = cfg.hpPerPlayer;
      p.maxHp = cfg.hpPerPlayer;
      p.ammo = cfg.startingAmmo;
      p.isBlocking = false;
      p.lastAction = null;
      p.consecutiveBlocks = 0;
      p.consecutiveHits = 0;
      p.turnsWithoutAttack = 0;
      p.afkTurns = 0;
    }

    pushLog(state, `--- Nueva ronda ${state.round}. Comienza la elección de acciones. ---`);

    startTurn(roomId);
    io.to(roomId).emit('stateUpdate', state);
  });

  socket.on('disconnect', () => {
    const info = clients[socket.id];
    if (!info) return;

    const { roomId, playerId } = info;
    const room = rooms[roomId];
    if (room) {
      const state = room.state;
      const player = state.players.find(p => p.id === playerId);
      const other = state.players.find(p => p.id !== playerId);

      room.playersSockets[playerId] = null;

      if (player) pushLog(state, `${player.name} se ha desconectado.`);

      if (other && room.playersSockets[other.id]) {
        state.isRoundOver = true;
        state.winnerId = other.id;
        other.score++;
        pushLog(state, `${other.name} gana la ronda porque el oponente se desconectó.`);
      }

      io.to(roomId).emit('stateUpdate', state);

      if (!room.playersSockets[1] && !room.playersSockets[2]) {
        if (room.turnTimer) clearTimeout(room.turnTimer);
        delete rooms[roomId];
        console.log(`Sala ${roomId} eliminada (sin jugadores).`);
      }
    }

    delete clients[socket.id];
  });
});

// =========================
//  ARRANCAR SERVIDOR
// =========================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
