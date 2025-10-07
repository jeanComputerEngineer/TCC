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
  private suggestionReady = false;

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
  recommendedDpi?: number;
  recommendedThreshold?: number;
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
        if (this.suggestionReady) {
          this.triggerPreview();
        }
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
      this.recommendedDpi = undefined;
      this.recommendedThreshold = undefined;
      this.suggestionReady = false;
      return;
    }
    this.selectedFile = input.files[0];
    this.analysis = undefined;
    this.errorMessage = undefined;
    this.previewAnalysis = undefined;
    this.viewMode = 'original';
    this.recommendedDpi = undefined;
    this.recommendedThreshold = undefined;
    this.suggestionReady = false;
    const reader = new FileReader();
    reader.onload = () => {
      this.previewUrl = typeof reader.result === 'string' ? reader.result : undefined;
      this.triggerPreview(true);
    };
    reader.readAsDataURL(this.selectedFile);
  }

  preprocess(): void {
    this.triggerPreview();
  }

  submit(): void {
    this.runAnalysis({ preview: false });
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

  private triggerPreview(initial = false): void {
    this.runAnalysis({ preview: true, initial });
  }

  private runAnalysis(options: { preview: boolean; initial?: boolean }): void {
    if (!this.selectedFile) {
      if (!options.preview) {
        this.errorMessage = 'Selecione uma imagem antes de processar.';
      }
      return;
    }
    if (options.preview && this.processing) {
      return;
    }
    if (this.form.invalid) {
      if (!options.preview) {
        this.form.markAllAsTouched();
      }
      return;
    }
    const manualDpiValue = this.form.value.manualDpi;
    const thresholdValue = this.form.value.threshold;
    const manualDpi = manualDpiValue !== null && manualDpiValue !== undefined ? Number(manualDpiValue) : undefined;
    const threshold = thresholdValue !== null && thresholdValue !== undefined ? Number(thresholdValue) : undefined;
    const safeManualDpi = manualDpi !== undefined && Number.isFinite(manualDpi) ? manualDpi : undefined;
    const safeThreshold = threshold !== undefined && Number.isFinite(threshold) ? threshold : undefined;
    if (!options.preview) {
      this.processing = true;
    } else {
      this.previewProcessing = true;
    }
    this.errorMessage = undefined;
    this.activeRequest?.unsubscribe();
    this.activeRequest = this.service
      .analyze({ file: this.selectedFile, manualDpi: safeManualDpi, threshold: safeThreshold })
      .subscribe({
        next: (response) => {
          if (options.preview) {
            this.previewAnalysis = response;
            this.previewProcessing = false;
            if (options.initial && !this.suggestionReady) {
              this.suggestionReady = true;
              this.recommendedDpi = response.dpi;
              this.recommendedThreshold = response.threshold;
              this.form.patchValue(
                {
                  manualDpi: response.dpi,
                  threshold: Math.round(response.threshold),
                },
                { emitEvent: false }
              );
            }
          } else {
            this.analysis = response;
            this.previewAnalysis = response;
            this.processing = false;
            this.previewProcessing = false;
          }
          this.activeRequest = undefined;
        },
        error: (error) => {
          if (options.preview) {
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
}
