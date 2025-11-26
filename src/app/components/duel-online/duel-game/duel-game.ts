import {
  Component,
  Input,
  OnDestroy,
  OnInit,
  ChangeDetectorRef,
  ViewEncapsulation
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, interval } from 'rxjs';
import { SocketService } from '../../../core/socket.service';
import { ActionType, DuelPlayer, DuelState } from '../../../core/models/duel-models';
import { AudioService } from '../../../core/audio.services';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-duel-game',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './duel-game.html',
  styleUrls: ['./duel-game.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class DuelGameComponent implements OnInit, OnDestroy {

  @Input() playerId: number | null = null;

  state: DuelState | null = null;
  private prevState: DuelState | null = null;

  maxAmmoDisplay = 3;
  private stateSub?: Subscription;
  private tickSub?: Subscription;
  now = Date.now();

  readonly TURN_SECONDS = 15; // valor por defecto visual

  constructor(
    private socket: SocketService,
    private cdr: ChangeDetectorRef,
    private audio: AudioService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit() {
    this.stateSub = this.socket.state$.subscribe(st => {
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

  // ---- getters de jugadores ----

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

  // maxAmmo real según config del server
  get maxAmmo(): number {
    return this.state?.config?.maxAmmo ?? this.maxAmmoDisplay;
  }

  get canReload(): boolean {
    if (!this.canPlay) return false;
    const me = this.myPlayer;
    if (!me) return false;
    return me.ammo < this.maxAmmo;
  }

  // ---- timer ----

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

    // si el server manda config, usamos su duración para la barra
    const totalSecs = this.state.config?.turnDurationMs
      ? this.state.config.turnDurationMs / 1000
      : this.TURN_SECONDS;

    const pct = (left / totalSecs) * 100;
    if (pct < 0) return 0;
    if (pct > 100) return 100;
    return pct;
  }

  // ---- helpers de UI ----

  getHearts(player: DuelPlayer): boolean[] {
    return Array.from({ length: player.maxHp }, (_, i) => i < player.hp);
  }

  getAmmoSlots(player: DuelPlayer): boolean[] {
    const max = this.maxAmmo;
    const filled = Math.min(player.ammo, max);
    return Array.from({ length: max }, (_, i) => i < filled);
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

  getActionIcon(action: ActionType | null): string {
    switch (action) {
      case 'attack': return '💥';
      case 'reload': return '🔄';
      case 'block': return '🛡️';
      default: return '';
    }
  }

  getActionLabel(action: ActionType | null): string {
    switch (action) {
      case 'attack': return 'Atacar';
      case 'reload': return 'Recargar';
      case 'block': return 'Bloquear';
      default: return '-';
    }
  }

  // ---- acciones ----

  doAction(action: ActionType) {
    if (!this.canPlay) return;
    if (action === 'reload' && !this.canReload) return;

    this.audio.markUserInteraction();
    this.audio.play('ui');
    this.socket.chooseAction(action as 'attack' | 'reload' | 'block');
  }

  nextRound() {
    this.audio.play('ui');
    this.socket.nextRound();
  }

  // ---- sonidos según cambios de estado ----

  private handleSounds(prev: DuelState | null, curr: DuelState | null) {
    if (!curr || !this.playerId) return;

    const myNow = curr.players.find(p => p.id === this.playerId);
    const myPrev = prev?.players.find(p => p.id === this.playerId);

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

  // ---- Log coloreado (nombres + acciones) ----

  formatLog(entry: any): SafeHtml {
    let text = String(entry ?? '');

    if (this.state && this.state.players.length >= 2) {
      const p1Name = this.state.players[0].name;
      const p2Name = this.state.players[1].name;

      const esc = (str: string) =>
        str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      if (p1Name) {
        text = text.replace(
          new RegExp(esc(p1Name), 'g'),
          `<span class="log-p1">${p1Name}</span>`
        );
      }

      if (p2Name) {
        text = text.replace(
          new RegExp(esc(p2Name), 'g'),
          `<span class="log-p2">${p2Name}</span>`
        );
      }
    }

    // colorear / icono para acción (palabras clave)
    text = text
      .replace(/recarga/gi,          '<span class="log-action log-action-reload">🔄 recarga</span>')
      .replace(/bloquea/gi,          '<span class="log-action log-action-block">🛡️ bloquea</span>')
      .replace(/bloquear/gi,         '<span class="log-action log-action-block">🛡️ bloquear</span>')
      .replace(/disparo preciso/gi,  '<span class="log-action log-action-attack">💥 disparo preciso</span>')
      .replace(/disparo/gi,          '<span class="log-action log-action-attack">💥 disparo</span>')
      .replace(/ataca/gi,            '<span class="log-action log-action-attack">💥 ataca</span>')
      .replace(/atacar/gi,           '<span class="log-action log-action-attack">💥 atacar</span>');

    return this.sanitizer.bypassSecurityTrustHtml(text);
  }


/** Marca cuáles líneas del log pertenecen al último turno */
isFromLastTurn(index: number): boolean {
  if (!this.state?.log) return false;

  const log = this.state.log;
  const marker = "Nueva elección de acciones"; // 👈 separador de turnos

  // Buscar desde abajo hacia arriba para encontrar el inicio del turno anterior
  let lastMarkerIndex = log.findIndex(entry =>
    entry.includes(marker)
  );

  // Si no hay marcador, no resaltamos nada
  if (lastMarkerIndex === -1) return false;

  // Todo arriba del marcador pertenece al último turno
  return index < lastMarkerIndex;
}
}
