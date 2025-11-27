import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { map, Observable } from 'rxjs';
import { SocketService } from '../../core/socket.service';
import { DuelGameComponent } from './duel-game/duel-game';

@Component({
  selector: 'app-duel-online',
  standalone: true,
  imports: [CommonModule, FormsModule, DuelGameComponent],
  templateUrl: './duel-online.html',
  styleUrls: ['./duel-online.scss']
})
export class DuelOnlineComponent {

  // inputs del lobby
  playerName = '';
  roomCode = '';

  // selección de modo (incluimos cinematic)
  selectedMode: 'normal' | 'tactico' | 'custom' | 'cinematic' = 'tactico';

  // valores para modo custom
  customLives = 3;
  customAmmo = 3;
  customPreciseShotChance = 0.1;      // 10%
  customTurtleTurns = 3;              // 0 = desactivado
  customAfkLimit = 4;                 // turnos AFK antes de castigo

  readonly maxLives = 10;
  readonly maxAmmo = 12;

  // errores de UI (validación local) y de server (observable)
  uiError: string | null = null;

  // observables expuestos al template
  roomId$!: Observable<string | null>;
  playerId$!: Observable<number | null>;
  joined$!: Observable<boolean>;
  error$!: Observable<string | null>;
  createdRoomId$!: Observable<string | null>;
  inGame$!: Observable<boolean>;

  constructor(public socket: SocketService) {
    this.roomId$        = this.socket.roomId$;
    this.playerId$      = this.socket.playerId$;
    this.joined$        = this.socket.joined$;
    this.error$         = this.socket.error$;
    this.createdRoomId$ = this.socket.roomCreated$;

    this.inGame$ = this.socket.joined$.pipe(
      map(j => !!j)
    );
  }

  private buildCustomConfig() {
    const clamp = (v: number, min: number, max: number) =>
      Math.max(min, Math.min(max, v));

    return {
      hpPerPlayer: clamp(this.customLives, 1, this.maxLives),
      maxAmmo: clamp(this.customAmmo, 1, this.maxAmmo),
      preciseShotChance: clamp(this.customPreciseShotChance || 0, 0, 0.5),
      maxTurtleTurnsWithoutAttack: clamp(this.customTurtleTurns || 0, 0, 10),
      afkLimit: clamp(this.customAfkLimit || 3, 1, 10)
    };
  }

  createRoom() {
    const name = this.playerName.trim();
    this.uiError = null;

    if (!name) {
      this.uiError = 'Poné un nombre para jugar.';
      return;
    }

    let customConfig: any = undefined;
    if (this.selectedMode === 'custom') {
      customConfig = this.buildCustomConfig();
    }

    // selectedMode puede ser normal / tactico / cinematic / custom
    this.socket.createRoom(name, this.selectedMode, customConfig);
  }

  joinRoom() {
    const name = this.playerName.trim();
    const code = this.roomCode.trim();
    this.uiError = null;

    if (!name || !code) {
      this.uiError = 'Nombre y código de sala son obligatorios.';
      return;
    }

    this.socket.joinRoom(code, name);
  }

  clearServerError() {
    this.socket.error$.next(null);
  }

  // salir de la sala y volver al lobby
  leaveGame() {
    this.socket.leaveRoom();
    this.roomCode = '';
    this.uiError = null;
    // this.playerName = ''; // si quieres resetear también el nombre
  }
}
