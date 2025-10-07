import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RootAnalysisResponse, RootAnalysisService } from '../../services/root-analysis.service';
import { Subscription, debounceTime } from 'rxjs';

type ViewMode = 'original' | 'grayscale' | 'segmented' | 'skeleton';

@Component({
  selector: 'app-root-analyzer',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './root-analyzer.component.html',
  styleUrls: ['./root-analyzer.component.css']
})
export class RootAnalyzerComponent implements OnInit, OnDestroy {
  private readonly formBuilder = inject(FormBuilder);
  private readonly service = inject(RootAnalysisService);
  private activeRequest?: Subscription;
  private formChangesSubscription?: Subscription;

  readonly form = this.formBuilder.group({
    manualDpi: [null, [Validators.min(1)]],
    threshold: [null, [Validators.min(0), Validators.max(255)]],
  });
  selectedFile?: File;
  previewUrl?: string;
  processing = false;
  previewProcessing = false;
  errorMessage?: string;
  analysis?: RootAnalysisResponse;
  previewAnalysis?: RootAnalysisResponse;
  viewMode: ViewMode = 'original';
  readonly viewModes: { id: ViewMode; label: string }[] = [
    { id: 'original', label: 'Original' },
    { id: 'grayscale', label: 'Tons de cinza' },
    { id: 'segmented', label: 'Segmentado' },
    { id: 'skeleton', label: 'Esqueleto' },
  ];

  ngOnInit(): void {
    this.formChangesSubscription = this.form.valueChanges
      .pipe(debounceTime(400))
      .subscribe(() => {
        this.triggerPreview();
      });
  }

  ngOnDestroy(): void {
    this.formChangesSubscription?.unsubscribe();
    this.activeRequest?.unsubscribe();
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      this.selectedFile = undefined;
      this.previewUrl = undefined;
      this.analysis = undefined;
      this.previewAnalysis = undefined;
      return;
    }
    this.selectedFile = input.files[0];
    this.analysis = undefined;
    this.errorMessage = undefined;
    this.previewAnalysis = undefined;
    this.viewMode = 'original';
    const reader = new FileReader();
    reader.onload = () => {
      this.previewUrl = typeof reader.result === 'string' ? reader.result : undefined;
      this.triggerPreview();
    };
    reader.readAsDataURL(this.selectedFile);
  }

  submit(): void {
    this.runAnalysis(false);
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

  private triggerPreview(): void {
    this.runAnalysis(true);
  }

  private runAnalysis(auto: boolean): void {
    if (!this.selectedFile) {
      if (!auto) {
        this.errorMessage = 'Selecione uma imagem antes de processar.';
      }
      return;
    }
    if (auto && this.processing) {
      return;
    }
    if (this.form.invalid) {
      if (!auto) {
        this.form.markAllAsTouched();
      }
      return;
    }
    const manualDpi = this.form.value.manualDpi ?? undefined;
    const threshold = this.form.value.threshold ?? undefined;
    if (!auto) {
      this.processing = true;
    } else {
      this.previewProcessing = true;
    }
    this.errorMessage = undefined;
    this.activeRequest?.unsubscribe();
    this.activeRequest = this.service
      .analyze({ file: this.selectedFile, manualDpi, threshold })
      .subscribe({
        next: (response) => {
          this.analysis = response;
          this.previewAnalysis = response;
          if (auto) {
            this.previewProcessing = false;
          } else {
            this.processing = false;
            this.previewProcessing = false;
          }
          this.activeRequest = undefined;
        },
        error: (error) => {
          if (auto) {
            this.previewProcessing = false;
          } else {
            this.processing = false;
            this.analysis = undefined;
            this.previewAnalysis = undefined;
          }
          const detail = error.error?.detail;
          if (detail) {
            this.errorMessage = detail;
          } else {
            this.errorMessage = 'Falha no processamento. Tente novamente com uma configuração diferente.';
          }
          this.activeRequest = undefined;
        },
      });
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
  }

  isActiveMode(mode: ViewMode): boolean {
    return this.viewMode === mode;
  }

  getPreviewSource(): string | undefined {
    if (this.viewMode === 'original') {
      return this.previewUrl;
    }
    if (!this.previewAnalysis) {
      return undefined;
    }
    if (this.viewMode === 'grayscale') {
      return this.getImageSource(this.previewAnalysis.grayscaleImage);
    }
    if (this.viewMode === 'segmented') {
      return this.getImageSource(this.previewAnalysis.segmentedImage);
    }
    if (this.viewMode === 'skeleton') {
      return this.getImageSource(this.previewAnalysis.skeletonImage);
    }
    return undefined;
  }
}
