const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(path.join(__dirname, '../public')));

// ── Load word list ──────────────────────────────────────────────────────────
const WORDS_FILE = process.env.WORDS_FILE || '/app/words.txt';
let validWords = new Set();

console.log(`Looking for word list at: ${WORDS_FILE}`);
console.log(`__dirname is: ${__dirname}`);

try {
  const raw = fs.readFileSync(WORDS_FILE, 'utf8');
  for (const line of raw.split('\n')) {
    const w = line.trim().toLowerCase();
    if (w.length >= 2 && w.length <= 10 && /^[a-z]+$/.test(w)) {
      validWords.add(w);
    }
  }
  console.log(`Loaded ${validWords.size} words from ${WORDS_FILE}`);
  console.log(`Sample words: ${[...validWords].slice(0, 5).join(', ')}`);
} catch (e) {
  console.warn(`Word list not found at ${WORDS_FILE}: ${e.message}`);
  console.warn('Validation disabled — all words accepted.');
}

function isValidWord(word) {
  if (validWords.size === 0) return true;
  return validWords.has(word.toLowerCase());
}

// ── Room state ──────────────────────────────────────────────────────────────
const rooms = {};

function createRoom(roomId) {
  return {
    id: roomId,
    players: {},
    playerOrder: [],
    phase: 'lobby',
    createdAt: Date.now()
  };
}

function getPublicRoom(room) {
  const players = {};
  for (const [sid, p] of Object.entries(room.players)) {
    players[sid] = {
      name: p.name,
      ready: p.ready,
      wordLength: p.word ? p.word.length : null,
      guessCount: p.guesses.length,
      finished: p.finished,
      won: p.won,
      guesses: p.guesses
    };
  }
  return { id: room.id, phase: room.phase, players, playerOrder: room.playerOrder };
}

function scoreGuess(guess, target) {
  const len = target.length;
  const result = Array(len).fill(null).map((_, i) => ({ letter: guess[i], status: 'absent' }));
  const targetArr = target.split('');
  const used = Array(len).fill(false);
  for (let i = 0; i < len; i++) {
    if (guess[i] === targetArr[i]) {
      result[i].status = 'correct';
      used[i] = true;
    }
  }
  for (let i = 0; i < len; i++) {
    if (result[i].status === 'correct') continue;
    for (let j = 0; j < len; j++) {
      if (!used[j] && guess[i] === targetArr[j]) {
        result[i].status = 'present';
        used[j] = true;
        break;
      }
    }
  }
  return result;
}

// ── Socket handlers ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);

  socket.on('create_room', ({ name }) => {
    const roomId = uuidv4().slice(0, 6).toUpperCase();
    rooms[roomId] = createRoom(roomId);
    const room = rooms[roomId];
    room.players[socket.id] = { name, ready: false, word: null, guesses: [], finished: false, won: false };
    room.playerOrder.push(socket.id);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.emit('room_joined', { roomId, yourId: socket.id });
    io.to(roomId).emit('room_update', getPublicRoom(room));
    console.log(`Room ${roomId} created by ${name}`);
  });

  socket.on('join_room', ({ roomId, name }) => {
    const rid = roomId.toUpperCase().trim();
    const room = rooms[rid];
    if (!room) { socket.emit('error', { msg: 'Room not found. Check the code and try again.' }); return; }
    if (room.playerOrder.length >= 2) { socket.emit('error', { msg: 'Room is full.' }); return; }
    if (room.phase !== 'lobby') { socket.emit('error', { msg: 'Game already in progress.' }); return; }
    room.players[socket.id] = { name, ready: false, word: null, guesses: [], finished: false, won: false };
    room.playerOrder.push(socket.id);
    socket.join(rid);
    socket.data.roomId = rid;
    socket.emit('room_joined', { roomId: rid, yourId: socket.id });
    io.to(rid).emit('room_update', getPublicRoom(room));
    console.log(`${name} joined room ${rid}`);
    if (room.playerOrder.length === 2) {
      room.phase = 'setup';
      io.to(rid).emit('phase_change', { phase: 'setup' });
      io.to(rid).emit('room_update', getPublicRoom(room));
    }
  });

  socket.on('submit_word', ({ word }) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || room.phase !== 'setup') return;
    const w = word.toUpperCase().trim();
    if (w.length < 2 || w.length > 10) { socket.emit('error', { msg: 'Word must be 2–10 letters.' }); return; }
    if (!/^[A-Z]+$/.test(w)) { socket.emit('error', { msg: 'Letters only please.' }); return; }
    if (!isValidWord(w)) { socket.emit('error', { msg: `"${w.toLowerCase()}" isn't in the word list.` }); return; }
    const player = room.players[socket.id];
    player.word = w;
    player.ready = true;
    socket.emit('word_accepted', { wordLength: w.length });
    io.to(roomId).emit('room_update', getPublicRoom(room));
    const allReady = room.playerOrder.every(sid => room.players[sid].ready);
    if (allReady) {
      // Tell each player their own word length (to guess) and opponent's word length (for mini board)
      for (const sid of room.playerOrder) {
        const oppId = room.playerOrder.find(id => id !== sid);
        io.to(sid).emit('game_start', {
          wordLength: room.players[oppId].word.length,      // length I need to guess
          oppWordLength: room.players[sid].word.length      // length opponent needs to guess (for mini board)
        });
      }
      room.phase = 'playing';
      io.to(roomId).emit('phase_change', { phase: 'playing' });
      io.to(roomId).emit('room_update', getPublicRoom(room));
      console.log(`Room ${roomId} game started`);
    }
  });

  socket.on('submit_guess', ({ guess }) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || room.phase !== 'playing') return;
    const player = room.players[socket.id];
    if (player.finished) return;
    if (player.guesses.length >= 6) return;
    const g = guess.toUpperCase().trim();
    if (!/^[A-Z]+$/.test(g)) { socket.emit('error', { msg: 'Letters only.' }); return; }
    if (!isValidWord(g)) { socket.emit('error', { msg: `"${g.toLowerCase()}" isn't in the word list.` }); return; }
    const opponentId = room.playerOrder.find(sid => sid !== socket.id);
    const opponentWord = room.players[opponentId]?.word;
    if (!opponentWord) { socket.emit('error', { msg: 'Waiting for opponent word.' }); return; }
    if (g.length !== opponentWord.length) {
      socket.emit('error', { msg: `Guess must be ${opponentWord.length} letters.` }); return;
    }
    const result = scoreGuess(g, opponentWord);
    player.guesses.push({ word: g, result });
    const won = result.every(r => r.status === 'correct');
    if (won || player.guesses.length >= 6) {
      player.finished = true;
      player.won = won;
    }
    io.to(roomId).emit('room_update', getPublicRoom(room));
    socket.emit('guess_result', { guess: g, result, guessNumber: player.guesses.length });
    const allDone = room.playerOrder.every(sid => room.players[sid].finished);
    if (allDone) {
      room.phase = 'done';
      const winners = room.playerOrder.filter(sid => room.players[sid].won);
      let outcome;
      if (winners.length === 2) outcome = 'draw';
      else if (winners.length === 1) outcome = room.players[winners[0]].name + ' wins!';
      else outcome = 'Nobody wins — both ran out of guesses!';
      const reveal = {};
      const stats = {};
      for (const sid of room.playerOrder) {
        reveal[sid] = room.players[sid].word;
        stats[sid] = {
          name: room.players[sid].name,
          guesses: room.players[sid].guesses.length,
          won: room.players[sid].won
        };
      }
      io.to(roomId).emit('game_over', { outcome, reveal, stats, players: getPublicRoom(room).players });
      console.log(`Room ${roomId} done: ${outcome}`);
    }
  });

  socket.on('chat_msg', ({ msg }) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;
    const name = room.players[socket.id]?.name || 'Unknown';
    io.to(roomId).emit('chat_msg', { name, msg: String(msg).slice(0, 200), ts: Date.now() });
  });

  socket.on('request_rematch', () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;
    room.players[socket.id].rematch = true;
    const votes = room.playerOrder.filter(sid => room.players[sid].rematch).length;
    io.to(roomId).emit('rematch_vote', { votes });
    const allWant = room.playerOrder.every(sid => room.players[sid].rematch);
    if (allWant) {
      for (const sid of room.playerOrder) {
        const p = room.players[sid];
        p.ready = false; p.word = null; p.guesses = []; p.finished = false; p.won = false; p.rematch = false;
      }
      room.phase = 'setup';
      io.to(roomId).emit('rematch_start'); // signal clients to fully reset
      io.to(roomId).emit('phase_change', { phase: 'setup' });
      io.to(roomId).emit('room_update', getPublicRoom(room));
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    const name = room.players[socket.id]?.name || 'Someone';
    delete room.players[socket.id];
    room.playerOrder = room.playerOrder.filter(sid => sid !== socket.id);
    io.to(roomId).emit('player_left', { name });
    if (room.playerOrder.length === 0) {
      delete rooms[roomId];
      console.log(`Room ${roomId} cleaned up`);
    } else {
      io.to(roomId).emit('room_update', getPublicRoom(room));
    }
    console.log(`[-] ${name} disconnected from ${roomId}`);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of Object.entries(rooms)) {
    if (now - room.createdAt > 7200000) delete rooms[id];
  }
}, 3600000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Wordle Duel running on port ${PORT}`));
