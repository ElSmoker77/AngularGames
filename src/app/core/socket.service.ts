import { Injectable, NgZone } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { BehaviorSubject } from 'rxjs';
import { DuelState } from './models/duel-models';

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private socket?: Socket;

  state$ = new BehaviorSubject<DuelState | null>(null);
  roomId$ = new BehaviorSubject<string | null>(null);
  playerId$ = new BehaviorSubject<number | null>(null);
  roomCreated$ = new BehaviorSubject<string | null>(null);
  joined$ = new BehaviorSubject<boolean>(false);
  error$ = new BehaviorSubject<string | null>(null);

  private connected = false;

  constructor(private ngZone: NgZone) {}

  private ensureConnection() {
    if (this.connected) return;

    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
      this.socket = io('http://localhost:3000');
    } else {
      this.socket = io();
    }

    this.connected = true;

    this.socket.on('stateUpdate', (state: DuelState) => {
      this.ngZone.run(() => {
        this.state$.next(state);
      });
    });

    this.socket.on('roomCreated', ({ roomId, playerId, state }) => {
      this.ngZone.run(() => {
        this.roomId$.next(roomId);
        this.playerId$.next(playerId);
        this.roomCreated$.next(roomId);
        this.joined$.next(true);
        this.state$.next(state);
      });
    });

    this.socket.on('roomJoined', ({ roomId, playerId, state }) => {
      this.ngZone.run(() => {
        this.roomId$.next(roomId);
        this.playerId$.next(playerId);
        this.joined$.next(true);
        this.state$.next(state);
      });
    });

    this.socket.on('errorMessage', (msg: string) => {
      this.ngZone.run(() => {
        this.error$.next(msg);
        this.joined$.next(false);
      });
    });
  }

  createRoom(
    playerName: string,
    mode: 'normal' | 'tactico' | 'custom' = 'tactico',
    customConfig?: any
  ) {
    this.ensureConnection();
    this.error$.next(null);
    this.roomCreated$.next(null);
    this.joined$.next(false);

    this.socket!.emit('createRoom', { playerName, mode, customConfig });
  }

  joinRoom(roomId: string, playerName: string) {
    this.ensureConnection();
    this.error$.next(null);
    this.joined$.next(false);
    this.socket!.emit('joinRoom', { roomId, playerName });
  }

  chooseAction(action: 'attack' | 'reload' | 'block') {
    const roomId = this.roomId$.value;
    if (!roomId || !this.socket) return;
    this.socket.emit('chooseAction', { roomId, action });
  }

  nextRound() {
    const roomId = this.roomId$.value;
    if (!roomId || !this.socket) return;
    this.socket.emit('nextRound', { roomId });
  }

  // 🔹 cerrar sala / desconectar y resetear estado
  leaveRoom() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = undefined;
      this.connected = false;
    }

    this.state$.next(null);
    this.roomId$.next(null);
    this.playerId$.next(null);
    this.roomCreated$.next(null);
    this.joined$.next(false);
    this.error$.next(null);
  }
}
