import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    document.body.classList.remove('theme-light', 'theme-dark');
    await TestBed.configureTestingModule({
      imports: [AppComponent],
    }).compileComponents();
  });

  afterEach(() => {
    document.body.classList.remove('theme-light', 'theme-dark');
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should apply a default light theme on bootstrap', () => {
    TestBed.createComponent(AppComponent);
    expect(document.body.classList.contains('theme-light')).toBeTrue();
  });
});
