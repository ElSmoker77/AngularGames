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
const TURN_DURATION_MS = 15_000; // 👈 15 segundos

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

function createInitialPlayer(id, name) {
  return {
    id,
    name,
    hp: 3,
    maxHp: 3,
    ammo: 0,
    isBlocking: false,
    lastAction: null,
    score: 0
  };
}

function pushLog(state, msg) {
  state.log.unshift(msg);
  if (state.log.length > 50) state.log.pop();
}

function startTurn(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const state = room.state;
  state.pendingActions = { 1: null, 2: null };
  state.turnEndsAt = Date.now() + TURN_DURATION_MS;

  if (room.turnTimer) clearTimeout(room.turnTimer);

  room.turnTimer = setTimeout(() => autoResolveTurn(roomId), TURN_DURATION_MS);

  pushLog(state, `Nueva elección de acciones. Tienes 15 segundos.`);
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

  const p1 = state.players[0];
  const p2 = state.players[1];

  if (!state.pendingActions[1]) state.pendingActions[1] = randomAction(p1);
  if (!state.pendingActions[2]) state.pendingActions[2] = randomAction(p2);

  pushLog(state, `Tiempo agotado. Se eligen acciones automáticas.`);
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

  p1.isBlocking = false;
  p2.isBlocking = false;

  const preAmmo1 = p1.ammo;
  const preAmmo2 = p2.ammo;

  if (a1 === 'block') p1.isBlocking = true;
  if (a2 === 'block') p2.isBlocking = true;

  if (a1 === 'reload') {
    p1.ammo++;
    pushLog(state, `${p1.name} recarga. Munición: ${p1.ammo}.`);
  }

  if (a2 === 'reload') {
    p2.ammo++;
    pushLog(state, `${p2.name} recarga. Munición: ${p2.ammo}.`);
  }

  if (a1 === 'attack') {
    if (preAmmo1 <= 0) {
      pushLog(state, `${p1.name} intenta atacar pero no tiene munición.`);
    } else {
      p1.ammo--;
      if (p2.isBlocking) {
        pushLog(state, `${p2.name} bloquea el disparo de ${p1.name}.`);
      } else {
        p2.hp--;
        pushLog(state, `${p1.name} acierta un disparo a ${p2.name}. Pierde 1 vida.`);
      }
    }
  }

  if (a2 === 'attack') {
    if (preAmmo2 <= 0) {
      pushLog(state, `${p2.name} intenta atacar pero no tiene munición.`);
    } else {
      p2.ammo--;
      if (p1.isBlocking) {
        pushLog(state, `${p1.name} bloquea el disparo de ${p2.name}.`);
      } else {
        p1.hp--;
        pushLog(state, `${p2.name} acierta un disparo a ${p1.name}. Pierde 1 vida.`);
      }
    }
  }

  p1.lastAction = a1;
  p2.lastAction = a2;

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
  }, 2000); // 👈 pausa de 2 segundos
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

    const p1 = createInitialPlayer(1, playerName || 'Jugador 1');
    const p2 = createInitialPlayer(2, 'Esperando...');

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
        turnEndsAt: null
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

    state.round++;
    state.isRoundOver = false;
    state.winnerId = null;

    for (const p of state.players) {
      p.hp = p.maxHp;
      p.ammo = 0;
      p.isBlocking = false;
      p.lastAction = null;
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
