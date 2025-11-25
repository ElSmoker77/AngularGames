import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { map, Observable } from 'rxjs';
import { SocketService } from '../../core/socket.service';
import { DuelGameComponent } from './duel-game/duel-game'; // ajusta el path si es distinto

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

  createRoom() {
    const name = this.playerName.trim();
    this.uiError = null;

    if (!name) {
      this.uiError = 'Poné un nombre para jugar.';
      return;
    }

    this.socket.createRoom(name);
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

  // 🔹 NUEVO: salir de la sala y volver al lobby
  leaveGame() {
    this.socket.leaveRoom();
    this.roomCode = '';
    this.uiError = null;
    // si querés resetear el nombre también:
    // this.playerName = '';
  }
}
