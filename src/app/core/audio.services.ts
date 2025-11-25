import { Injectable } from '@angular/core';

export type SoundKey = 'attack' | 'reload' | 'block' | 'win' | 'lose' | 'draw' | 'ui';

@Injectable({
  providedIn: 'root'
})
export class AudioService {

  private sounds = new Map<SoundKey, HTMLAudioElement>();
  private hasUserInteracted = false;

  constructor() {
    // IMPORTANTE: rutas con .mp3
    this.load('attack', 'assets/audio/attack-8bit.mp3');
    this.load('reload', 'assets/audio/reload-8bit.mp3');
    this.load('block',  'assets/audio/block-8bit.mp3');
    this.load('win',    'assets/audio/win-8bit.mp3');
    this.load('lose',   'assets/audio/lose-8bit.mp3');
    this.load('draw',   'assets/audio/draw-8bit.mp3');
    this.load('ui',     'assets/audio/ui-select.mp3');
  }

  private load(key: SoundKey, src: string) {
    const audio = new Audio();
    audio.src = src;
    audio.volume = 0.6;

    audio.addEventListener('canplaythrough', () => {
      console.log('[AudioService] Cargado:', key, '→', src);
    });

    audio.addEventListener('error', (e) => {
      console.error('[AudioService] ERROR al cargar', key, '→', src, e);
    });

    this.sounds.set(key, audio);
  }

  /** Marcar que el usuario ya hizo click, para evitar bloqueos de autoplay */
  public markUserInteraction() {
    this.hasUserInteracted = true;
  }

  play(key: SoundKey) {
    const audio = this.sounds.get(key);
    if (!audio) {
      console.warn('[AudioService] No se encontró el sonido para key:', key);
      return;
    }

    // algunos navegadores bloquean play sin interacción previa
    if (!this.hasUserInteracted) {
      console.warn('[AudioService] Intento de play antes de interacción del usuario. key:', key);
    }

    audio.currentTime = 0;
    audio.play().catch(err => {
      console.error('[AudioService] Error en audio.play() para', key, err);
    });
  }
}
