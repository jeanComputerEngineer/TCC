import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule, NgForm } from '@angular/forms';
import { ApiService, Professor, Materia } from '../../services/api.service';

@Component({
  selector: 'app-professor',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './professor.component.html',
  styleUrls: ['./professor.component.css']
})
export class ProfessorComponent {
  professores: Professor[] = [];
  materias: Materia[] = [];

  showForm: boolean = false;
  editing: boolean = false;
  currentProfessor: Professor = { nomeProfessor: '', cpfProfessor: '' };

  // Variável para exibir mensagens de erro no formulário
  formError: string = '';

  // Propriedades para o modal de atribuição de matéria
  showAssignMateriaModal: boolean = false;
  selectedProfessorForAssign: Professor | null = null;
  selectedMateriaId: number | null = null;

  constructor(private api: ApiService) { }

  ngOnInit(): void {
    this.loadProfessores();
    this.loadMaterias();
  }

  loadProfessores(): void {
    this.api.getProfessores().subscribe((data: Professor[]) => {
      this.professores = data;
    });
  }

  loadMaterias(): void {
    this.api.getMaterias().subscribe((data: Materia[]) => {
      this.materias = data;
    });
  }

  addProfessor(): void {
    this.editing = false;
    this.currentProfessor = { nomeProfessor: '', cpfProfessor: '' };
    this.formError = '';
    this.showForm = true;
  }

  editProfessor(prof: Professor): void {
    this.editing = true;
    this.currentProfessor = { ...prof };
    this.formError = '';
    this.showForm = true;
  }

  deleteProfessor(id: number): void {
    if (confirm('Confirma a exclusão deste professor?')) {
      this.api.deleteProfessor(id).subscribe(() => {
        this.loadProfessores();
      });
    }
  }

  // Abre o modal para atribuir matéria ao professor
  openAssignMateriaModal(prof: Professor): void {
    this.selectedProfessorForAssign = prof;
    this.selectedMateriaId = null;
    this.showAssignMateriaModal = true;
  }

  closeAssignMateriaModal(): void {
    this.showAssignMateriaModal = false;
    this.selectedProfessorForAssign = null;
    this.selectedMateriaId = null;
  }

  assignMateria(): void {
    if (!this.selectedProfessorForAssign || !this.selectedMateriaId) {
      alert('Selecione uma matéria.');
      return;
    }
    this.api.assignMateriaToProfessor(this.selectedProfessorForAssign.id!, this.selectedMateriaId).subscribe(() => {
      this.loadProfessores();
      this.closeAssignMateriaModal();
    });
  }

  // Validação simples do CPF: deve conter exatamente 11 dígitos numéricos
  isValidCPF(cpf: string): boolean {
    // Remove espaços em branco
    const cleanedCpf = cpf.replace(/\s+/g, '');
    return /^\d{11}$/.test(cleanedCpf);
  }


  saveProfessor(form: NgForm): void {
    if (!form.valid) {
      this.formError = 'Por favor, preencha todos os campos corretamente.';
      return;
    }
    if (!this.isValidCPF(this.currentProfessor.cpfProfessor)) {
      this.formError = 'CPF inválido. Deve conter 11 dígitos numéricos.';
      return;
    }
    this.formError = '';
    if (this.editing) {
      this.api.updateProfessor(this.currentProfessor).subscribe(() => {
        this.loadProfessores();
        this.showForm = false;
      });
    } else {
      this.api.addProfessor(this.currentProfessor).subscribe((res: Professor) => {
        this.loadProfessores();
        this.showForm = false;
        if (confirm('Deseja atribuir uma matéria agora?')) {
          this.openAssignMateriaModal(res);
        }
      });
    }
  }

  cancel(): void {
    this.showForm = false;
    this.formError = '';
  }
}
