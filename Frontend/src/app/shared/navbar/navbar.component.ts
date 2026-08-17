import { Component, inject } from '@angular/core';
import { AsyncPipe, CommonModule } from '@angular/common';
import { ThemeService } from '../theme/theme.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, AsyncPipe],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css']
})
export class NavbarComponent {
  private readonly themeService = inject(ThemeService);
  readonly theme$ = this.themeService.theme$;

  toggleTema(): void {
    this.themeService.toggle();
  }
}
