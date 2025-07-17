// src/app/app-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { MateriaComponent } from './pages/materia/materia.component';
import { PeriodoComponent } from './pages/periodo/periodo.component';
import { ProfessorComponent } from './pages/professor/professor.component';
import { TurmaComponent } from './pages/turma/turma.component';
import { ResultadosComponent } from './pages/resultados/resultados.component';

const routes: Routes = [
    { path: '', redirectTo: '/periodo', pathMatch: 'full' },
    { path: 'materia', component: MateriaComponent },
    { path: 'periodo', component: PeriodoComponent },
    { path: 'professor', component: ProfessorComponent },
    { path: 'turma', component: TurmaComponent },
    { path: 'resultados', component: ResultadosComponent },
    { path: '**', redirectTo: '' }
];

@NgModule({
    imports: [RouterModule.forRoot(routes)],
    exports: [RouterModule]
})
export class AppRoutingModule { }

export { routes };
