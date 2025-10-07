import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RootAnalysisResponse, RootAnalysisService } from '../../services/root-analysis.service';

@Component({
  selector: 'app-root-analyzer',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './root-analyzer.component.html',
  styleUrls: ['./root-analyzer.component.css']
})
export class RootAnalyzerComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly service = inject(RootAnalysisService);

  readonly form = this.formBuilder.group({
    manualDpi: [null, [Validators.min(1)]],
    threshold: [null, [Validators.min(0), Validators.max(255)]],
  });
  selectedFile?: File;
  previewUrl?: string;
  processing = false;
  errorMessage?: string;
  analysis?: RootAnalysisResponse;

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      this.selectedFile = undefined;
      this.previewUrl = undefined;
      return;
    }
    this.selectedFile = input.files[0];
    this.analysis = undefined;
    this.errorMessage = undefined;
    const reader = new FileReader();
    reader.onload = () => {
      this.previewUrl = typeof reader.result === 'string' ? reader.result : undefined;
    };
    reader.readAsDataURL(this.selectedFile);
  }

  submit(): void {
    if (!this.selectedFile) {
      this.errorMessage = 'Selecione uma imagem antes de processar.';
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const manualDpi = this.form.value.manualDpi ?? undefined;
    const threshold = this.form.value.threshold ?? undefined;
    this.processing = true;
    this.errorMessage = undefined;
    this.service
      .analyze({ file: this.selectedFile, manualDpi, threshold })
      .subscribe({
        next: (response) => {
          this.analysis = response;
          this.processing = false;
        },
        error: (error) => {
          this.processing = false;
          this.analysis = undefined;
          if (error.error?.detail) {
            this.errorMessage = error.error.detail;
          } else {
            this.errorMessage = 'Falha no processamento. Tente novamente com uma configuração diferente.';
          }
        },
      });
  }

  getImageSource(base64?: string): string | undefined {
    if (!base64) {
      return undefined;
    }
    return `data:image/png;base64,${base64}`;
  }

  downloadImage(base64: string, filename: string): void {
    const source = this.getImageSource(base64);
    if (!source) {
      return;
    }
    const link = document.createElement('a');
    link.href = source;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
