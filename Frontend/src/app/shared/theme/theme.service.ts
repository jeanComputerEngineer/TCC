import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { BehaviorSubject } from 'rxjs';

export type ThemeMode = 'light' | 'dark';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly storageKey = 'rootAnalyzerTheme';
  private readonly themeSubject = new BehaviorSubject<ThemeMode>('light');
  readonly theme$ = this.themeSubject.asObservable();

  constructor(
    @Inject(DOCUMENT) private readonly documentRef: Document,
    @Inject(PLATFORM_ID) private readonly platformId: object
  ) {}

  initialize(): void {
    const preferred = this.getStoredTheme() ?? this.detectPreference();
    this.applyTheme(preferred);
  }

  toggle(): void {
    const nextTheme: ThemeMode = this.themeSubject.value === 'light' ? 'dark' : 'light';
    this.applyTheme(nextTheme);
  }

  setTheme(theme: ThemeMode): void {
    this.applyTheme(theme);
  }

  private applyTheme(theme: ThemeMode): void {
    this.themeSubject.next(theme);
    const body = this.documentRef.body;
    body.setAttribute('data-theme', theme);
    if (this.isBrowser()) {
      localStorage.setItem(this.storageKey, theme);
    }
  }

  private getStoredTheme(): ThemeMode | null {
    if (!this.isBrowser()) {
      return null;
    }
    const stored = localStorage.getItem(this.storageKey);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
    return null;
  }

  private detectPreference(): ThemeMode {
    if (this.isBrowser() && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  private isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }
}

