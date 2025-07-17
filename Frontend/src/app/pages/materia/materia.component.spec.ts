import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MateriaComponent } from './materia.component';

describe('MateriaComponent', () => {
  let component: MateriaComponent;
  let fixture: ComponentFixture<MateriaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MateriaComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MateriaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
