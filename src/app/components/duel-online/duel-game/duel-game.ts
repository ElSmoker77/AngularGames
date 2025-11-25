import { Component, Input, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, interval } from 'rxjs';
import { SocketService } from '../../../core/socket.service';
import { DuelPlayer, DuelState } from '../../../core/models/duel-models';
import { AudioService } from '../../../core/audio.services';

@Component({
  selector: 'app-duel-game',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './duel-game.html',
  styleUrls: ['./duel-game.scss']
})
export class DuelGameComponent implements OnInit, OnDestroy {

  @Input() playerId: number | null = null;

  state: DuelState | null = null;
  private prevState: DuelState | null = null;

  maxAmmoDisplay = 3;
  private stateSub?: Subscription;
  private tickSub?: Subscription;
  now = Date.now();

  readonly TURN_SECONDS = 10;

  constructor(
    private socket: SocketService,
    private cdr: ChangeDetectorRef,
    private audio: AudioService
  ) {}

  ngOnInit() {
    this.stateSub = this.socket.state$.subscribe(st => {
      // reproducir sonidos según cambios entre prev y nuevo
      this.handleSounds(this.prevState, st);
      this.prevState = this.state;
      this.state = st;
      this.cdr.detectChanges();
    });

    this.tickSub = interval(50).subscribe(() => {
      this.now = Date.now();
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy() {
    this.stateSub?.unsubscribe();
    this.tickSub?.unsubscribe();
  }

  // ---- getters ----

  get myPlayer(): DuelPlayer | null {
    if (!this.state || this.playerId == null) return null;
    return this.state.players.find(p => p.id === this.playerId) ?? null;
  }

  get opponent(): DuelPlayer | null {
    if (!this.state || this.playerId == null) return null;
    return this.state.players.find(p => p.id !== this.playerId) ?? null;
  }

  get hasChosen(): boolean {
    if (!this.state || this.playerId == null) return false;
    const pa = this.state.pendingActions;
    if (!pa) return false;
    return !!pa[this.playerId];
  }

  get canPlay(): boolean {
    if (!this.state || this.playerId == null) return false;
    if (!this.state.gameStarted) return false;
    if (this.state.isRoundOver) return false;
    if (this.hasChosen) return false;
    return true;
  }

  get timeLeft(): number | null {
    if (!this.state || !this.state.turnEndsAt) return null;
    const diffMs = this.state.turnEndsAt - this.now;
    const secs = Math.ceil(diffMs / 1000);
    return secs > 0 ? secs : 0;
  }

  get timePercent(): number {
    if (!this.state || !this.state.turnEndsAt) return 0;
    const left = this.timeLeft;
    if (left == null) return 0;
    const pct = (left / this.TURN_SECONDS) * 100;
    if (pct < 0) return 0;
    if (pct > 100) return 100;
    return pct;
  }

  getHearts(player: DuelPlayer): boolean[] {
    return Array.from({ length: player.maxHp }, (_, i) => i < player.hp);
  }

  getAmmoSlots(player: DuelPlayer): boolean[] {
    const filled = Math.min(player.ammo, this.maxAmmoDisplay);
    return Array.from({ length: this.maxAmmoDisplay }, (_, i) => i < filled);
  }

  // ---- acciones ----

 doAction(action: 'attack' | 'reload' | 'block') {
  if (!this.canPlay) return;
  this.audio.markUserInteraction();   // 👈 NUEVO
  this.audio.play('ui');              // 👈 para escuchar click
  this.socket.chooseAction(action);
}


  nextRound() {
    this.audio.play('ui');
    this.socket.nextRound();
  }

  get statusText(): string {
    if (!this.state) return '';
    if (!this.state.gameStarted) return 'Esperando a que se conecte el segundo jugador...';
    if (this.state.isRoundOver) return 'Ronda terminada.';
    if (this.hasChosen) return 'Acción enviada. Esperando al rival...';
    return 'Elegí tu acción. Se resolverá al mismo tiempo que la del rival.';
  }

  getWinnerName(winnerId: number | null): string | null {
    if (!this.state || winnerId == null) return null;
    const player = this.state.players.find(p => p.id === winnerId);
    return player?.name ?? null;
  }

  // ---- sonidos según cambios de estado ----

  private handleSounds(prev: DuelState | null, curr: DuelState | null) {
    if (!curr || !this.playerId) return;

    const myNow = curr.players.find(p => p.id === this.playerId);
    const myPrev = prev?.players.find(p => p.id === this.playerId);

    // sonidos por acción (cuando cambia lastAction)
    if (myNow && myPrev && myNow.lastAction !== myPrev.lastAction) {
      switch (myNow.lastAction) {
        case 'attack':
          this.audio.play('attack');
          break;
        case 'reload':
          this.audio.play('reload');
          break;
        case 'block':
          this.audio.play('block');
          break;
      }
    }

    // sonidos al terminar ronda (cambio isRoundOver false->true)
    if (prev && !prev.isRoundOver && curr.isRoundOver) {
      if (curr.winnerId == null) {
        this.audio.play('draw');
      } else if (curr.winnerId === this.playerId) {
        this.audio.play('win');
      } else {
        this.audio.play('lose');
      }
    }
  }
}
