// src/app/services/api.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

// ----- Interfaces das Entidades -----
export interface Periodo {
  id?: number;
  horarioInicio: string;
  horarioFim: string;
  duracaoAula: number;
  intervaloInicio: string;
  intervaloFim: string;
}

export interface Materia {
  id?: number;
  nomeMateria: string;
}

export interface Professor {
  id?: number;
  nomeProfessor: string;
  cpfProfessor: string;
  // Adiciona a propriedade opcional 'materias'
  materias?: string;
}


export interface Turma {
  id?: number;
  nomeTurma: string;
}

export interface Horario {
  id?: number;
  horarioInicio: string;
  horarioFim: string;
  diaSemana: string;
  idTurma: number;
  idMateria: number;
  idProfessor: number;
}

// ----- Serviço de API -----
@Injectable({
  providedIn: 'root'
})


export class ApiService {
  // URL base da API (ajuste conforme necessário)
  private API_URL = 'http://localhost:3000/api';

  constructor(private http: HttpClient) { }

  // ========= PERÍODO =========
  getPeriodos(): Observable<Periodo[]> {
    return this.http.get<Periodo[]>(`${this.API_URL}/periodos`);
  }
  addPeriodo(periodo: Periodo): Observable<Periodo> {
    return this.http.post<Periodo>(`${this.API_URL}/periodos`, periodo);
  }
  updatePeriodo(periodo: Periodo): Observable<Periodo> {
    return this.http.put<Periodo>(`${this.API_URL}/periodos/${periodo.id}`, periodo);
  }
  deletePeriodo(id: number): Observable<any> {
    return this.http.delete(`${this.API_URL}/periodos/${id}`);
  }

  // ========= MATÉRIA =========
  getMaterias(): Observable<Materia[]> {
    return this.http.get<Materia[]>(`${this.API_URL}/materias`);
  }
  addMateria(materia: Materia): Observable<Materia> {
    return this.http.post<Materia>(`${this.API_URL}/materias`, materia);
  }
  updateMateria(materia: Materia): Observable<Materia> {
    return this.http.put<Materia>(`${this.API_URL}/materias/${materia.id}`, materia);
  }
  deleteMateria(id: number): Observable<any> {
    return this.http.delete(`${this.API_URL}/materias/${id}`);
  }

  // ========= PROFESSOR =========
  getProfessores(): Observable<Professor[]> {
    return this.http.get<Professor[]>(`${this.API_URL}/professores`);
  }
  addProfessor(professor: Professor): Observable<Professor> {
    return this.http.post<Professor>(`${this.API_URL}/professores`, professor);
  }
  updateProfessor(professor: Professor): Observable<Professor> {
    return this.http.put<Professor>(`${this.API_URL}/professores/${professor.id}`, professor);
  }
  deleteProfessor(id: number): Observable<any> {
    return this.http.delete(`${this.API_URL}/professores/${id}`);
  }
  assignMateriaToProfessor(professorId: number, materiaId: number): Observable<any> {
    return this.http.post(`${this.API_URL}/professores/${professorId}/materias`, { idMateria: materiaId });
  }

  // ========= TURMA =========
  getTurmas(): Observable<Turma[]> {
    return this.http.get<Turma[]>(`${this.API_URL}/turmas`);
  }
  addTurma(turma: Turma): Observable<Turma> {
    return this.http.post<Turma>(`${this.API_URL}/turmas`, turma);
  }
  updateTurma(turma: Turma): Observable<Turma> {
    return this.http.put<Turma>(`${this.API_URL}/turmas/${turma.id}`, turma);
  }
  deleteTurma(id: number): Observable<any> {
    return this.http.delete(`${this.API_URL}/turmas/${id}`);
  }
  assignMateriaToTurma(turmaId: number, materiaId: number, quantidadeAulas: number): Observable<any> {
    return this.http.post(`${this.API_URL}/turmas/${turmaId}/materias`, { idMateria: materiaId, quantidadeAulas });
  }

  // ========= HORÁRIO =========
  getHorarios(): Observable<Horario[]> {
    return this.http.get<Horario[]>(`${this.API_URL}/horarios`);
  }
  generateHorarios(): Observable<any> {
    return this.http.post(`${this.API_URL}/horarios/gerar`, {});
  }
  getHorariosByTurma(turmaId: number): Observable<Horario[]> {
    return this.http.get<Horario[]>(`${this.API_URL}/horarios/turma/${turmaId}`);
  }
  getHorariosByProfessor(professorId: number): Observable<Horario[]> {
    return this.http.get<Horario[]>(`${this.API_URL}/horarios/professor/${professorId}`);
  }

  // ========= SLOTS =========
  getSlots(): Observable<{ inicio: string; fim: string }[]> {
    return this.http.get<{ inicio: string; fim: string }[]>(`${this.API_URL}/slots`);
  }
}
