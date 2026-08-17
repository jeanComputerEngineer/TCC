import { CommonModule, NgStyle } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subject, Subscription, firstValueFrom, merge } from 'rxjs';
import { debounceTime, finalize, takeUntil } from 'rxjs/operators';
import {
  BackgroundMode,
  CropResponse,
  PreviewResponse,
  RootAnalysisResponse,
  RootAnalysisService,
} from '../../services/root-analysis.service';
import { BackgroundOption, BatchEntry, BatchPreviewData, ProcessedSettingsSnapshot } from './root-analyzer.models';
import { PreviewStepComponent } from './steps/preview-step/preview-step.component';
import { ResultsStepComponent } from './steps/results-step/results-step.component';
import { SelectionStepComponent } from './steps/selection-step/selection-step.component';

// As opcoes avancadas (suavizacao, filtro de componentes e poda) iniciam
// desmarcadas: o usuario ativa cada ajuste de forma deliberada.
const DEFAULT_ADVANCED_OPTION = false;

type ImageZoomTarget = 'preview' | 'grayscale' | 'segmented' | 'skeleton';
type ImageDownloadKind = 'cinza' | 'seg' | 'esq';

interface CropSelection {
  x: number;
  y: number;
  size: number;
}

interface CropPointerState {
  mode: 'move' | 'resize';
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startSize: number;
}

@Component({
  selector: 'app-root-analyzer',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    NgStyle,
    SelectionStepComponent,
    PreviewStepComponent,
    ResultsStepComponent,
  ],
  templateUrl: './root-analyzer.component.html',
  styleUrls: ['./root-analyzer.component.css']
})
export class RootAnalyzerComponent implements OnInit, OnDestroy {
  private static readonly MIN_PLAUSIBLE_DPI = 50;
  private static readonly MAX_PLAUSIBLE_DPI = 2400;
  private static readonly MIN_SELECTION_FILES = 1;
  private static readonly MAX_BATCH_FILES = 20;
  private static readonly MIN_BATCH_FILES = 2;
  private static readonly MIN_THRESHOLD = 0;
  private static readonly MAX_THRESHOLD = 255;
  private static readonly MIN_ZOOM = 0.1;
  private static readonly MAX_ZOOM = 4;
  private static readonly ZOOM_STEP = 0.25;
  private static readonly MIN_CROP_SIZE = 48;
  private static readonly MAX_PREVIEW_EDGE = 1200;

  private readonly formBuilder = inject(FormBuilder);
  private readonly service = inject(RootAnalysisService);
  private readonly destroy$ = new Subject<void>();

  @ViewChild('cropImageElement') private cropImageElement?: ElementRef<HTMLImageElement>;
  @ViewChild(PreviewStepComponent) private previewStepComponent?: PreviewStepComponent;

  private activeRequest?: Subscription;
  private dpiRequest?: Subscription;
  private previewRequest?: Subscription;
  private previewTasks = 0;
  private previewWidth = 0;
  private previewHeight = 0;
  private previewGrayBase?: Uint8Array;
  private previewGraySmoothed?: Uint8Array;
  private previewHistogram: number[] = new Array<number>(256).fill(0);
  private cropPointerState?: CropPointerState;
  private previewFitZoom = 1;
  private singleProcessedSignature?: string;
  private singleProcessedSettings?: ProcessedSettingsSnapshot;
  private readonly supportedImageExtensions = new Set(['.tif', '.tiff', '.png', '.jpg', '.jpeg', '.bmp']);

  readonly form = this.formBuilder.group({
    manualDpi: this.formBuilder.control<number | null>(null, [
      Validators.min(RootAnalyzerComponent.MIN_PLAUSIBLE_DPI),
      Validators.max(RootAnalyzerComponent.MAX_PLAUSIBLE_DPI),
    ]),
    threshold: this.formBuilder.control<number | null>(null, [
      Validators.min(RootAnalyzerComponent.MIN_THRESHOLD),
      Validators.max(RootAnalyzerComponent.MAX_THRESHOLD),
    ]),
    backgroundMode: this.formBuilder.control<BackgroundMode>('auto', { nonNullable: true }),
    smoothSegmentation: this.formBuilder.control<boolean>(DEFAULT_ADVANCED_OPTION, { nonNullable: true }),
    filterComponents: this.formBuilder.control<boolean>(DEFAULT_ADVANCED_OPTION, { nonNullable: true }),
    pruneSkeleton: this.formBuilder.control<boolean>(DEFAULT_ADVANCED_OPTION, { nonNullable: true }),
  });

  readonly backgroundOptions: BackgroundOption[] = [
    { value: 'auto', label: 'Auto', description: 'Escolhe automaticamente o lado do limiar com base na imagem.' },
    { value: 'light', label: 'Fundo claro', description: 'Marca como raiz os pixels mais escuros do que o limiar.' },
    { value: 'dark', label: 'Fundo escuro', description: 'Marca como raiz os pixels mais claros do que o limiar.' },
  ];

  readonly imageZooms: Record<ImageZoomTarget, number> = {
    preview: 1,
    grayscale: 1,
    segmented: 1,
    skeleton: 1,
  };

  selectedFile?: File;
  previewStep = false;
  selectionFiles: File[] = [];
  batchEntries: BatchEntry[] = [];
  activeBatchIndex = -1;
  batchProcessing = false;
  batchProgress = 0;
  batchCompletedCount = 0;
  batchNoticeMessage = '';
  processing = false;
  previewProcessing = false;
  cropModalOpen = false;
  cropBusy = false;
  cropNaturalWidth = 0;
  cropNaturalHeight = 0;
  cropSelection?: CropSelection;
  errorMessage?: string;
  analysis?: RootAnalysisResponse;
  previewSegmentedImage?: string;
  previewHistogramImage?: string;
  previewPixelSizeMm?: number;
  previewForegroundPercent?: number;
  previewThresholdPercentile?: number;
  previewDynamicRange?: number;
  suggestedThreshold?: number;
  cropModalImageUrl?: string;
  dpiHintMessage = 'Informe o DPI da digitalizacao para ter medidas precisas.';

  get isBatchMode(): boolean {
    return this.previewStep && this.batchEntries.length > 1;
  }

  get isBatchProcessed(): boolean {
    return this.isBatchMode
      && this.batchEntries.length >= RootAnalyzerComponent.MIN_BATCH_FILES
      && this.batchEntries.every((entry) => entry.lastProcessedSignature !== undefined);
  }

  get hasBatchPendingChanges(): boolean {
    if (!this.isBatchProcessed) {
      return false;
    }

    return this.batchEntries.some((entry, index) => entry.lastProcessedSignature !== this.buildBatchEntrySignature(
      entry,
      index === this.activeBatchIndex,
    ));
  }

  get canShowBatchOutputs(): boolean {
    return this.isBatchProcessed && !this.hasBatchPendingChanges && !this.batchProcessing;
  }

  get canDownloadCsv(): boolean {
    return this.isBatchMode ? this.canShowBatchOutputs : this.analysis !== undefined;
  }

  get workflowLocked(): boolean {
    return this.processing || this.batchProcessing;
  }

  get processingProgressPercent(): number {
    if (this.batchProcessing && this.batchEntries.length > 0) {
      return Math.round((this.batchCompletedCount / this.batchEntries.length) * 100);
    }

    return this.processing ? 100 : 0;
  }

  get processingProgressLabel(): string {
    return '';
  }

  get processingStatusMessage(): string {
    if (this.batchProcessing && this.batchEntries.length > 0) {
      const total = this.batchEntries.length;
      const current = Math.min(total, this.batchCompletedCount + 1);
      return `Processando ${current}/${total}`;
    }

    if (this.processing) {
      return this.isBatchMode ? 'Reprocessando imagem atual' : 'Processando imagem';
    }

    return '';
  }

  get showProcessingProgressBar(): boolean {
    return this.batchProcessing && this.batchEntries.length > 1;
  }

  get processingButtonLabel(): string {
    if (this.isBatchMode) {
      if (this.batchProcessing) {
        return `Processando ${this.batchProgress}/${this.batchEntries.length}...`;
      }
      return this.isBatchProcessed ? 'Reprocessar imagens' : 'Processar imagens';
    }

    return this.processing ? 'Processando...' : 'Processar';
  }

  get showResultsSection(): boolean {
    return this.isBatchMode ? this.canShowBatchOutputs : this.analysis !== undefined;
  }

  get showPendingProcessingWarning(): boolean {
    if (this.isBatchMode) {
      return this.isBatchProcessed && this.hasBatchPendingChanges;
    }

    return this.analysis !== undefined
      && this.singleProcessedSignature !== undefined
      && this.singleProcessedSignature !== this.buildSingleProcessingSignature();
  }

  get pendingProcessingWarningMessage(): string {
    if (!this.isBatchMode) {
      return 'Há alterações não processadas nesta imagem. Processe novamente para atualizar os resultados.';
    }

    return this.isActiveBatchEntryPending()
      ? 'Há alterações não processadas nesta imagem. Reprocesse ou descarte para ver os resultados.'
      : 'Há imagens com alterações não processadas no lote. Reprocesse ou descarte para ver os resultados.';
  }

  get hasSelectionFiles(): boolean {
    return this.selectionFiles.length > 0;
  }

  ngOnInit(): void {
    merge(
      this.form.controls.threshold.valueChanges,
      this.form.controls.manualDpi.valueChanges,
      this.form.controls.backgroundMode.valueChanges,
    )
      .pipe(debounceTime(80), takeUntil(this.destroy$))
      .subscribe(() => {
        this.updatePreviewArtifacts();
      });

    this.form.controls.smoothSegmentation.valueChanges
      .pipe(debounceTime(80), takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.selectedFile) {
          this.requestPreviewData(this.selectedFile);
        }
      });
  }

  ngOnDestroy(): void {
    this.activeRequest?.unsubscribe();
    this.dpiRequest?.unsubscribe();
    this.previewRequest?.unsubscribe();
    this.destroy$.next();
    this.destroy$.complete();
    this.resetPreviewState();
    this.closeCropModal(true);
    this.clearBatchState();
  }

  onSelectionFilesChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';

    if (files.length === 0) {
      return;
    }

    this.errorMessage = undefined;
    this.selectionFiles = [...this.selectionFiles, ...files];
  }

  removeSelectionFile(index: number): void {
    if (index < 0 || index >= this.selectionFiles.length) {
      return;
    }
    this.selectionFiles = this.selectionFiles.filter((_, currentIndex) => currentIndex !== index);
  }

  openPreviewStep(): void {
    if (this.processing || this.previewProcessing || this.batchProcessing) {
      return;
    }

    const validation = this.validateSelectionFiles(this.selectionFiles);
    if (!validation.ok) {
      this.errorMessage = validation.message;
      return;
    }

    this.clearSelectedFile();
    this.clearBatchState();
    this.errorMessage = undefined;
    this.previewStep = true;
    this.singleProcessedSignature = undefined;
    this.batchEntries = this.selectionFiles.map((file) => ({
      file,
      label: this.formatFileName(file),
      manualDpi: null,
      threshold: null,
      backgroundMode: 'auto',
      smoothSegmentation: DEFAULT_ADVANCED_OPTION,
      filterComponents: DEFAULT_ADVANCED_OPTION,
      pruneSkeleton: DEFAULT_ADVANCED_OPTION,
    }));
    this.activeBatchIndex = 0;
    this.batchNoticeMessage = this.isBatchMode
      ? 'Modo em lote ativo. Revise a prévia de cada imagem ou processe todas de uma vez.'
      : 'Imagem pronta para validação na prévia.';
    this.selectBatchEntry(0);
  }

  backToSelectionStep(): void {
    if (this.processing || this.previewProcessing || this.batchProcessing) {
      return;
    }
    this.previewStep = false;
    this.batchNoticeMessage = '';
    this.clearSelectedFile();
    this.clearBatchState();
    this.errorMessage = undefined;
  }

  clearSelectionFiles(): void {
    if (this.processing || this.previewProcessing || this.batchProcessing) {
      return;
    }
    this.selectionFiles = [];
    this.errorMessage = undefined;
  }

  discardPendingChanges(): void {
    if (this.processing || this.previewProcessing || this.batchProcessing) {
      return;
    }

    if (this.isBatchMode) {
      const entry = this.batchEntries[this.activeBatchIndex];
      if (!entry?.processedSettings) {
        return;
      }

      this.applyProcessedSettings(entry.processedSettings);
      entry.manualDpi = entry.processedSettings.manualDpi;
      entry.threshold = entry.processedSettings.threshold;
      entry.backgroundMode = entry.processedSettings.backgroundMode;
      entry.smoothSegmentation = entry.processedSettings.smoothSegmentation;
      entry.filterComponents = entry.processedSettings.filterComponents;
      entry.pruneSkeleton = entry.processedSettings.pruneSkeleton;
      this.updatePreviewArtifacts();
      return;
    }

    if (!this.singleProcessedSettings) {
      return;
    }

    this.applyProcessedSettings(this.singleProcessedSettings);
    this.updatePreviewArtifacts();
  }

  selectBatchEntry(index: number): void {
    if (this.batchEntries.length === 0 || index < 0 || index >= this.batchEntries.length) {
      return;
    }
    this.saveActiveBatchFormState();
    this.activeBatchIndex = index;
    const entry = this.batchEntries[index];
    const hasStoredManualDpi = entry.manualDpi !== null && entry.manualDpi !== undefined;
    this.loadSelectedFile(entry.file, {
      preserveManualDpi: hasStoredManualDpi,
      skipProbe: hasStoredManualDpi,
      dpiHintMessage: entry.previewData?.dpiHintMessage ?? (
        hasStoredManualDpi
          ? `DPI definido para esta imagem (${Math.round(entry.manualDpi ?? 0)}). Ajuste se necessario.`
          : undefined
      ),
    });
    this.form.controls.backgroundMode.setValue(entry.backgroundMode ?? 'auto', { emitEvent: false });
    this.form.controls.smoothSegmentation.setValue(entry.smoothSegmentation ?? DEFAULT_ADVANCED_OPTION, { emitEvent: false });
    this.form.controls.filterComponents.setValue(entry.filterComponents ?? DEFAULT_ADVANCED_OPTION, { emitEvent: false });
    this.form.controls.pruneSkeleton.setValue(entry.pruneSkeleton ?? DEFAULT_ADVANCED_OPTION, { emitEvent: false });
    this.requestPreviewData(entry.file);
    if (entry.threshold !== null && entry.threshold !== undefined) {
      this.form.controls.threshold.setValue(entry.threshold, { emitEvent: false });
    }
    if (hasStoredManualDpi) {
      this.form.controls.manualDpi.setValue(entry.manualDpi ?? null, { emitEvent: false });
    }
    if (entry.analysis) {
      this.analysis = entry.analysis;
      this.errorMessage = entry.errorMessage;
    } else if (entry.errorMessage) {
      this.analysis = undefined;
      this.errorMessage = entry.errorMessage;
    } else {
      this.analysis = undefined;
      this.errorMessage = undefined;
    }
  }

  submit(): void {
    if (!this.previewStep) {
      this.openPreviewStep();
      return;
    }
    if (this.isBatchMode) {
      void this.processBatchImages();
      return;
    }
    this.runAnalysis();
  }

  async reprocessCurrentBatchImage(): Promise<void> {
    if (!this.isBatchMode || !this.isBatchProcessed || this.batchProcessing || this.processing || this.previewProcessing) {
      return;
    }

    this.saveActiveBatchFormState();
    const entry = this.batchEntries[this.activeBatchIndex];
    if (!entry) {
      return;
    }

    this.processing = true;
    this.errorMessage = undefined;
    this.batchNoticeMessage = 'Reprocessando apenas a imagem selecionada.';

    try {
      await this.prepareBatchEntryForProcessing(entry, true);
      const response = await firstValueFrom(this.service.analyze({
        file: entry.file,
        manualDpi: entry.manualDpi ?? undefined,
        threshold: entry.threshold ?? undefined,
        backgroundMode: entry.backgroundMode ?? 'auto',
        smoothSegmentation: entry.smoothSegmentation ?? DEFAULT_ADVANCED_OPTION,
        filterComponents: entry.filterComponents ?? DEFAULT_ADVANCED_OPTION,
        pruneSkeleton: entry.pruneSkeleton ?? DEFAULT_ADVANCED_OPTION,
      }));

      entry.analysis = response;
      entry.errorMessage = undefined;
      entry.processedSettings = this.captureProcessedSettings();
      entry.lastProcessedSignature = this.buildBatchEntrySignature(entry);
      this.analysis = response;
      this.resetZoom('grayscale');
      this.resetZoom('segmented');
      this.resetZoom('skeleton');
      this.batchNoticeMessage = 'Imagem reprocessada. Os resultados do lote foram atualizados.';
    } catch (error: any) {
      entry.analysis = undefined;
      entry.errorMessage = error?.error?.detail || 'Falha no reprocessamento desta imagem.';
      entry.processedSettings = this.captureProcessedSettings();
      entry.lastProcessedSignature = this.buildBatchEntrySignature(entry);
      this.analysis = undefined;
      this.errorMessage = entry.errorMessage;
      this.batchNoticeMessage = 'A reanálise da imagem selecionada falhou.';
    } finally {
      this.processing = false;
    }
  }

  async processBatchImages(): Promise<void> {
    if (!this.isBatchMode || this.batchEntries.length < RootAnalyzerComponent.MIN_BATCH_FILES || this.batchProcessing || this.previewProcessing) {
      return;
    }

    this.saveActiveBatchFormState();
    this.batchProcessing = true;
    this.batchProgress = 0;
    this.batchCompletedCount = 0;
    this.batchNoticeMessage = 'Processando imagens em lote. Isso pode demorar alguns minutos.';
    this.errorMessage = undefined;

    try {
      for (let index = 0; index < this.batchEntries.length; index += 1) {
        const entry = this.batchEntries[index];
        this.batchProgress = index + 1;

        try {
          await this.prepareBatchEntryForProcessing(entry, index === this.activeBatchIndex);
          const response = await firstValueFrom(this.service.analyze({
            file: entry.file,
            manualDpi: entry.manualDpi ?? undefined,
            threshold: entry.threshold ?? undefined,
            backgroundMode: entry.backgroundMode ?? 'auto',
            smoothSegmentation: entry.smoothSegmentation ?? DEFAULT_ADVANCED_OPTION,
            filterComponents: entry.filterComponents ?? DEFAULT_ADVANCED_OPTION,
            pruneSkeleton: entry.pruneSkeleton ?? DEFAULT_ADVANCED_OPTION,
          }));
          entry.analysis = response;
          entry.errorMessage = undefined;
          entry.processedSettings = {
            manualDpi: entry.manualDpi ?? null,
            threshold: entry.threshold ?? null,
            backgroundMode: entry.backgroundMode ?? 'auto',
            smoothSegmentation: entry.smoothSegmentation ?? DEFAULT_ADVANCED_OPTION,
            filterComponents: entry.filterComponents ?? DEFAULT_ADVANCED_OPTION,
            pruneSkeleton: entry.pruneSkeleton ?? DEFAULT_ADVANCED_OPTION,
          };
          entry.lastProcessedSignature = this.buildBatchEntrySignature(entry);
        } catch (error: any) {
          entry.analysis = undefined;
          entry.errorMessage = error?.error?.detail || 'Falha no processamento desta imagem.';
          entry.processedSettings = {
            manualDpi: entry.manualDpi ?? null,
            threshold: entry.threshold ?? null,
            backgroundMode: entry.backgroundMode ?? 'auto',
            smoothSegmentation: entry.smoothSegmentation ?? DEFAULT_ADVANCED_OPTION,
            filterComponents: entry.filterComponents ?? DEFAULT_ADVANCED_OPTION,
            pruneSkeleton: entry.pruneSkeleton ?? DEFAULT_ADVANCED_OPTION,
          };
          entry.lastProcessedSignature = this.buildBatchEntrySignature(entry);
        }

        this.batchCompletedCount = index + 1;
      }

      const firstAnalyzedIndex = this.batchEntries.findIndex((entry) => entry.analysis !== undefined);
      const firstIndex = firstAnalyzedIndex >= 0 ? firstAnalyzedIndex : 0;
      this.selectBatchEntry(firstIndex);
      this.batchNoticeMessage = 'Lote finalizado. Clique nas bolinhas para navegar entre os resultados.';
    } finally {
      this.batchProcessing = false;
      this.batchCompletedCount = 0;
    }
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

  downloadGrayscaleImage(): void {
    if (!this.analysis?.grayscaleImage) {
      return;
    }
    this.downloadImage(this.analysis.grayscaleImage, this.buildImageDownloadName('cinza'));
  }

  downloadSegmentedImage(): void {
    if (!this.analysis?.segmentedImage) {
      return;
    }
    this.downloadImage(this.analysis.segmentedImage, this.buildImageDownloadName('seg'));
  }

  downloadSkeletonImage(): void {
    if (!this.analysis?.skeletonImage) {
      return;
    }
    this.downloadImage(this.analysis.skeletonImage, this.buildImageDownloadName('esq'));
  }

  downloadCsv(): void {
    const timestamp = new Date();
    const rows = this.buildCsvRows(timestamp);
    if (rows.length === 0) {
      return;
    }

    const columns = Array.from(
      rows.reduce((set, row) => {
        for (const key of Object.keys(row)) {
          set.add(key);
        }
        return set;
      }, new Set<string>())
    );

    const csvLines = [columns.map((column) => this.escapeCsv(column)).join(',')];
    for (const row of rows) {
      const line = columns.map((column) => this.escapeCsv(row[column] ?? ''));
      csvLines.push(line.join(','));
    }

    const blob = new Blob([csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    const isMultipleSelection = this.batchEntries.length > 1;
    const baseNameRaw = isMultipleSelection
      ? 'analise-raizes-lote'
      : (this.selectedFile?.name ?? 'analise-raizes').replace(/\.[^.]+$/, '');
    const safeBaseName = baseNameRaw.trim() || 'analise-raizes';
    const stamp = this.formatDateStamp(timestamp);

    link.href = objectUrl;
    link.download = `${safeBaseName}_${stamp}_dados.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  }

  onThresholdSliderInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = Number(target.value);
    if (!Number.isFinite(value)) {
      return;
    }
    this.applyThreshold(value);
  }

  onThresholdNumberInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = Number(target.value);
    if (!Number.isFinite(value)) {
      return;
    }
    this.applyThreshold(value);
  }

  decrementThreshold(): void {
    this.applyThreshold(this.resolveThresholdValue() - 1);
  }

  incrementThreshold(): void {
    this.applyThreshold(this.resolveThresholdValue() + 1);
  }

  onHistogramClick(event: MouseEvent): void {
    const target = event.target as HTMLImageElement;
    const rect = target.getBoundingClientRect();
    const relative = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    const clamped = Math.max(0, Math.min(1, relative));
    const threshold = Math.round(clamped * 255);
    this.applyThreshold(threshold);
  }

  restoreSuggestedThreshold(): void {
    if (this.suggestedThreshold === undefined) {
      return;
    }
    this.applyThreshold(this.suggestedThreshold);
  }

  getThresholdSliderValue(): number {
    return this.resolveThresholdValue();
  }

  shouldShowSuggestedThresholdIcon(): boolean {
    // O botao permanece visivel enquanto houver sugestao disponivel. Antes ele
    // era removido ao coincidir com o valor sugerido, o que fazia o controle
    // sumir e reaparecer durante os ajustes de 1 em 1.
    return this.suggestedThreshold !== undefined;
  }

  isThresholdAtSuggestion(): boolean {
    if (this.suggestedThreshold === undefined) {
      return false;
    }
    return this.resolveThresholdValue() === this.suggestedThreshold;
  }

  zoomIn(target: ImageZoomTarget): void {
    this.setZoom(target, this.imageZooms[target] + RootAnalyzerComponent.ZOOM_STEP);
  }

  zoomOut(target: ImageZoomTarget): void {
    this.setZoom(target, this.imageZooms[target] - RootAnalyzerComponent.ZOOM_STEP);
  }

  resetZoom(target: ImageZoomTarget): void {
    this.imageZooms[target] = target === 'preview' ? this.previewFitZoom : 1;
  }

  getZoomValue(target: ImageZoomTarget): string {
    return String(this.imageZooms[target]);
  }

  getZoomPercent(target: ImageZoomTarget): number {
    return Math.round(this.imageZooms[target] * 100);
  }

  onZoomPercentInput(target: ImageZoomTarget, event: Event): void {
    const input = event.target as HTMLInputElement;
    const percent = input.valueAsNumber;
    if (!Number.isFinite(percent)) {
      return;
    }
    this.setZoom(target, percent / 100);
  }

  isPreviewScrollEnabled(): boolean {
    return this.imageZooms.preview > this.previewFitZoom + 0.01;
  }

  openCropModal(): void {
    if (!this.selectedFile || !this.cropModalImageUrl) {
      return;
    }
    this.cropModalOpen = true;
    this.cropBusy = false;
    this.cropNaturalWidth = 0;
    this.cropNaturalHeight = 0;
    this.cropSelection = undefined;
    this.cropPointerState = undefined;
  }

  closeCropModal(force = false): void {
    if (this.cropBusy && !force) {
      return;
    }
    this.cropModalOpen = false;
    this.cropBusy = false;
    this.cropNaturalWidth = 0;
    this.cropNaturalHeight = 0;
    this.cropSelection = undefined;
    this.cropPointerState = undefined;
  }

  onCropImageLoad(event: Event): void {
    const image = event.target as HTMLImageElement;
    this.cropNaturalWidth = Math.max(1, image.naturalWidth || image.width || 1);
    this.cropNaturalHeight = Math.max(1, image.naturalHeight || image.height || 1);

    const size = Math.max(
      RootAnalyzerComponent.MIN_CROP_SIZE,
      Math.round(Math.min(this.cropNaturalWidth, this.cropNaturalHeight) * 0.6),
    );

    this.cropSelection = {
      x: Math.round((this.cropNaturalWidth - size) / 2),
      y: Math.round((this.cropNaturalHeight - size) / 2),
      size,
    };
  }

  onPreviewImageLoad(event: Event): void {
    const image = event.target as HTMLImageElement;
    const naturalWidth = Math.max(1, image.naturalWidth || image.width || 1);
    const naturalHeight = Math.max(1, image.naturalHeight || image.height || 1);
    this.updatePreviewFitZoom(naturalWidth, naturalHeight);
  }

  getCropSelectionStyles(): Record<string, string> {
    if (!this.cropSelection || this.cropNaturalWidth <= 0 || this.cropNaturalHeight <= 0) {
      return { display: 'none' };
    }

    return {
      left: `${(this.cropSelection.x / this.cropNaturalWidth) * 100}%`,
      top: `${(this.cropSelection.y / this.cropNaturalHeight) * 100}%`,
      width: `${(this.cropSelection.size / this.cropNaturalWidth) * 100}%`,
      height: `${(this.cropSelection.size / this.cropNaturalHeight) * 100}%`,
    };
  }

  startCropMove(event: PointerEvent): void {
    if (!this.cropSelection) {
      return;
    }
    event.preventDefault();
    this.cropPointerState = {
      mode: 'move',
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: this.cropSelection.x,
      startY: this.cropSelection.y,
      startSize: this.cropSelection.size,
    };
  }

  startCropResize(event: PointerEvent): void {
    if (!this.cropSelection) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.cropPointerState = {
      mode: 'resize',
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: this.cropSelection.x,
      startY: this.cropSelection.y,
      startSize: this.cropSelection.size,
    };
  }

  confirmCrop(): void {
    if (
      !this.selectedFile ||
      !this.cropSelection ||
      this.cropNaturalWidth <= 0 ||
      this.cropNaturalHeight <= 0
    ) {
      return;
    }

    this.cropBusy = true;
    const sourceFile = this.selectedFile;
    const selection = { ...this.cropSelection };

    const xRatio = this.clampNumber(selection.x / this.cropNaturalWidth, 0, 1);
    const yRatio = this.clampNumber(selection.y / this.cropNaturalHeight, 0, 1);
    const widthRatio = this.clampNumber(selection.size / this.cropNaturalWidth, 0, 1);
    const heightRatio = this.clampNumber(selection.size / this.cropNaturalHeight, 0, 1);
    const preservedDpi = Math.round(this.resolveDpiValue());
    this.form.controls.manualDpi.setValue(preservedDpi, { emitEvent: false });

    this.service
      .crop(sourceFile, { xRatio, yRatio, widthRatio, heightRatio, dpi: preservedDpi })
      .pipe(
        finalize(() => {
          this.cropBusy = false;
        })
      )
      .subscribe({
        next: (response: CropResponse) => {
          const baseName = sourceFile.name.replace(/\.[^.]+$/, '') || 'imagem';
          const croppedFile = this.decodePngBase64ToFile(response.croppedImage, `${baseName}-corte.png`);
          this.replaceActiveSelectionFile(croppedFile);

          this.closeCropModal(true);
          this.loadSelectedFile(croppedFile, {
            preserveManualDpi: true,
            skipProbe: true,
            dpiHintMessage: `DPI mantido apos o corte (${preservedDpi}). Ajuste se necessario.`,
          });
        },
        error: (error) => {
          const detail = error?.error?.detail;
          this.errorMessage = detail || 'Não foi possível concluir o corte da imagem.';
        },
      });
  }

  @HostListener('window:pointermove', ['$event'])
  onWindowPointerMove(event: PointerEvent): void {
    if (!this.cropModalOpen || !this.cropSelection || !this.cropPointerState) {
      return;
    }

    const image = this.cropImageElement?.nativeElement;
    if (!image) {
      return;
    }

    const bounds = image.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return;
    }

    const deltaX = ((event.clientX - this.cropPointerState.startClientX) / bounds.width) * this.cropNaturalWidth;
    const deltaY = ((event.clientY - this.cropPointerState.startClientY) / bounds.height) * this.cropNaturalHeight;

    if (this.cropPointerState.mode === 'move') {
      const maxX = Math.max(0, this.cropNaturalWidth - this.cropPointerState.startSize);
      const maxY = Math.max(0, this.cropNaturalHeight - this.cropPointerState.startSize);
      this.cropSelection = {
        x: this.clampNumber(this.cropPointerState.startX + deltaX, 0, maxX),
        y: this.clampNumber(this.cropPointerState.startY + deltaY, 0, maxY),
        size: this.cropPointerState.startSize,
      };
      return;
    }

    const dominantDelta = Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY;
    const maxSize = Math.min(
      this.cropNaturalWidth - this.cropPointerState.startX,
      this.cropNaturalHeight - this.cropPointerState.startY,
    );

    this.cropSelection = {
      x: this.cropPointerState.startX,
      y: this.cropPointerState.startY,
      size: this.clampNumber(
        this.cropPointerState.startSize + dominantDelta,
        RootAnalyzerComponent.MIN_CROP_SIZE,
        Math.max(RootAnalyzerComponent.MIN_CROP_SIZE, maxSize),
      ),
    };
  }

  @HostListener('window:pointerup')
  @HostListener('window:pointercancel')
  onWindowPointerUp(): void {
    this.cropPointerState = undefined;
  }

  @HostListener('window:keydown.escape')
  onEscapeKey(): void {
    if (this.cropModalOpen) {
      this.closeCropModal();
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (this.previewWidth > 0 && this.previewHeight > 0) {
      this.updatePreviewFitZoom(this.previewWidth, this.previewHeight);
    }
  }

  private runAnalysis(): void {
    if (!this.selectedFile) {
      this.errorMessage = 'Selecione uma imagem antes de processar.';
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const manualDpiValue = this.form.value.manualDpi;
    const thresholdValue = this.form.value.threshold;
    const manualDpi = manualDpiValue !== null && manualDpiValue !== undefined ? Number(manualDpiValue) : undefined;
    const threshold = thresholdValue !== null && thresholdValue !== undefined ? Number(thresholdValue) : undefined;
    const safeManualDpi = manualDpi !== undefined && Number.isFinite(manualDpi) ? manualDpi : undefined;
    const safeThreshold = threshold !== undefined && Number.isFinite(threshold) ? threshold : undefined;

    this.processing = true;
    this.errorMessage = undefined;
    this.activeRequest?.unsubscribe();
    this.activeRequest = this.service
      .analyze({
        file: this.selectedFile,
        manualDpi: safeManualDpi,
        threshold: safeThreshold,
        backgroundMode: this.resolveBackgroundMode(),
        smoothSegmentation: this.form.controls.smoothSegmentation.value,
        filterComponents: this.form.controls.filterComponents.value,
        pruneSkeleton: this.form.controls.pruneSkeleton.value,
      })
      .pipe(
        finalize(() => {
          this.processing = false;
          this.activeRequest = undefined;
        })
      )
      .subscribe({
        next: (response) => {
          this.analysis = response;
          this.singleProcessedSettings = this.captureProcessedSettings();
          this.singleProcessedSignature = this.buildSingleProcessingSignature();
          this.resetZoom('grayscale');
          this.resetZoom('segmented');
          this.resetZoom('skeleton');
        },
        error: (error) => {
          this.analysis = undefined;
          this.singleProcessedSettings = this.captureProcessedSettings();
          this.singleProcessedSignature = undefined;
          const detail = error.error?.detail;
          this.errorMessage = detail || 'Falha no processamento. Tente novamente com outra configuração.';
        },
      });
  }

  private loadSelectedFile(
    file: File,
    options?: { preserveManualDpi?: boolean; skipProbe?: boolean; dpiHintMessage?: string },
  ): void {
    this.closeCropModal(true);
    this.selectedFile = file;
    this.analysis = undefined;
    this.errorMessage = undefined;
    this.resetImageZooms();
    this.form.controls.threshold.setValue(null, { emitEvent: false });
    if (!options?.preserveManualDpi) {
      this.form.controls.manualDpi.setValue(null, { emitEvent: false });
    }

    this.dpiHintMessage = options?.dpiHintMessage ?? 'Lendo imagem e detectando DPI...';
    this.resetPreviewState();
    this.requestPreviewData(file);

    this.dpiRequest?.unsubscribe();
    if (options?.skipProbe) {
      return;
    }

    this.startPreviewTask();
    this.dpiRequest = this.service.probeDpi(file).pipe(
      finalize(() => this.endPreviewTask())
    ).subscribe({
      next: (res) => {
        if (!res) {
          return;
        }
        const { dpi, dpiSource } = res;
        if (typeof dpi === 'number' && Number.isFinite(dpi) && dpiSource !== 'fallback') {
          this.form.patchValue({ manualDpi: Math.round(dpi) }, { emitEvent: false });
          this.dpiHintMessage = `DPI detectado automaticamente (${Math.round(dpi)}). Voce pode ajustar se necessario.`;
        } else {
          this.dpiHintMessage = 'DPI não encontrado nos metadados. Informe manualmente para evitar erro de escala.';
        }
        this.updatePreviewArtifacts();
      },
      error: () => {
        this.dpiHintMessage = 'Não foi possível detectar DPI automático. Informe manualmente.';
      },
    });
  }

  private clearSelectedFile(): void {
    this.selectedFile = undefined;
    this.analysis = undefined;
    this.singleProcessedSignature = undefined;
    this.singleProcessedSettings = undefined;
    this.errorMessage = undefined;
    this.form.controls.manualDpi.setValue(null, { emitEvent: false });
    this.form.controls.threshold.setValue(null, { emitEvent: false });
    this.form.controls.smoothSegmentation.setValue(DEFAULT_ADVANCED_OPTION, { emitEvent: false });
    this.form.controls.filterComponents.setValue(DEFAULT_ADVANCED_OPTION, { emitEvent: false });
    this.form.controls.pruneSkeleton.setValue(DEFAULT_ADVANCED_OPTION, { emitEvent: false });
    this.resetPreviewState();
    this.resetImageZooms();
    this.closeCropModal(true);
  }

  private clearBatchState(): void {
    this.batchEntries = [];
    this.activeBatchIndex = -1;
    this.batchProcessing = false;
    this.batchProgress = 0;
    this.batchCompletedCount = 0;
  }

  private saveActiveBatchFormState(): void {
    if (this.batchEntries.length === 0 || this.activeBatchIndex < 0 || this.activeBatchIndex >= this.batchEntries.length) {
      return;
    }
    const entry = this.batchEntries[this.activeBatchIndex];
    entry.manualDpi = this.form.controls.manualDpi.value;
    entry.threshold = this.form.controls.threshold.value;
    entry.backgroundMode = this.form.controls.backgroundMode.value ?? 'auto';
    entry.smoothSegmentation = this.form.controls.smoothSegmentation.value;
    entry.filterComponents = this.form.controls.filterComponents.value;
    entry.pruneSkeleton = this.form.controls.pruneSkeleton.value;
  }

  private captureProcessedSettings(): ProcessedSettingsSnapshot {
    return {
      manualDpi: this.normalizeOptionalNumber(this.form.controls.manualDpi.value),
      threshold: this.normalizeOptionalNumber(this.form.controls.threshold.value),
      backgroundMode: this.form.controls.backgroundMode.value ?? 'auto',
      smoothSegmentation: this.form.controls.smoothSegmentation.value,
      filterComponents: this.form.controls.filterComponents.value,
      pruneSkeleton: this.form.controls.pruneSkeleton.value,
    };
  }

  private applyProcessedSettings(settings: ProcessedSettingsSnapshot): void {
    this.form.controls.manualDpi.setValue(settings.manualDpi, { emitEvent: false });
    this.form.controls.threshold.setValue(settings.threshold, { emitEvent: false });
    this.form.controls.backgroundMode.setValue(settings.backgroundMode, { emitEvent: false });
    this.form.controls.smoothSegmentation.setValue(settings.smoothSegmentation, { emitEvent: false });
    this.form.controls.filterComponents.setValue(settings.filterComponents, { emitEvent: false });
    this.form.controls.pruneSkeleton.setValue(settings.pruneSkeleton, { emitEvent: false });
  }

  private requestPreviewData(file: File): void {
    this.previewRequest?.unsubscribe();
    this.startPreviewTask();
    this.previewRequest = this.service.preview(file, this.form.controls.smoothSegmentation.value).pipe(
      finalize(() => {
        this.previewRequest = undefined;
        this.endPreviewTask();
      })
    ).subscribe({
      next: (response) => {
        try {
          const width = Math.max(1, Math.round(Number(response.width)));
          const height = Math.max(1, Math.round(Number(response.height)));
          const expectedLength = width * height;
          const grayPixels = this.decodeBase64ToBytes(response.grayPixels, expectedLength);
          const smoothedPixels = this.decodeBase64ToBytes(response.smoothedPixels, expectedLength);

          this.previewWidth = width;
          this.previewHeight = height;
          this.previewGrayBase = grayPixels;
          this.previewGraySmoothed = smoothedPixels;
          this.previewHistogram = this.computeHistogram(grayPixels);
          this.suggestedThreshold = this.clampByte(response.suggestedThreshold);
          this.cropModalImageUrl = this.buildGrayImageDataUrl(grayPixels, width, height);

          const thresholdControl = this.form.controls.threshold;
          const current = thresholdControl.value;
          if (current === null || current === undefined || !Number.isFinite(Number(current))) {
            thresholdControl.setValue(this.suggestedThreshold, { emitEvent: false });
          }

          this.updatePreviewArtifacts();
        } catch {
          this.resetPreviewState();
          this.errorMessage = 'Falha ao montar prévia/histograma da imagem. Tente outro arquivo ou reduza a resolução.';
        }
      },
      error: (error) => {
        this.resetPreviewState();
        const detail = error?.error?.detail;
        this.errorMessage = detail || 'Não foi possível gerar a prévia da imagem. Verifique o arquivo e tente novamente.';
      },
    });
  }

  private decodeBase64ToBytes(base64: string, expectedLength: number): Uint8Array {
    const binary = atob(base64);
    if (binary.length !== expectedLength) {
      throw new Error('Tamanho de preview invalido.');
    }
    const output = new Uint8Array(expectedLength);
    for (let i = 0; i < expectedLength; i += 1) {
      output[i] = binary.charCodeAt(i);
    }
    return output;
  }

  private decodePngBase64ToFile(base64: string, filename: string): File {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], filename, { type: 'image/png' });
  }

  private buildGrayImageDataUrl(grayPixels: Uint8Array, width: number, height: number): string {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return '';
    }

    const frame = context.createImageData(width, height);
    const data = frame.data;
    for (let i = 0, offset = 0; i < grayPixels.length; i += 1, offset += 4) {
      const value = grayPixels[i];
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
    context.putImageData(frame, 0, 0);
    return canvas.toDataURL('image/png');
  }

  private updatePreviewFitZoom(imageWidth: number, imageHeight: number): void {
    if (imageWidth <= 0 || imageHeight <= 0) {
      return;
    }

    const normalizedFit = 1;
    const wasAtPreviousFit = Math.abs(this.imageZooms.preview - this.previewFitZoom) < 0.01;
    this.previewFitZoom = normalizedFit;
    if (wasAtPreviousFit) {
      this.imageZooms.preview = normalizedFit;
    }
  }

  private updatePreviewArtifacts(): void {
    if (!this.previewGrayBase || !this.previewGraySmoothed || this.previewWidth <= 0 || this.previewHeight <= 0) {
      this.previewSegmentedImage = undefined;
      this.previewHistogramImage = undefined;
      return;
    }

    const threshold = this.resolveThresholdValue();
    const dpi = this.resolveDpiValue();
    const effectiveBackground = this.resolveEffectiveBackgroundMode(this.previewGraySmoothed, threshold);

    this.previewPixelSizeMm = 25.4 / dpi;
    this.previewHistogram = this.computeHistogram(this.previewGrayBase);
    this.previewThresholdPercentile = this.computeThresholdPercentile(this.previewHistogram, threshold);
    this.previewDynamicRange = this.computeDynamicRange(this.previewHistogram);

    const segmented = this.buildSegmentedPreview(this.previewGrayBase, this.previewGraySmoothed, threshold, effectiveBackground);
    this.previewSegmentedImage = segmented.dataUrl;
    this.previewForegroundPercent = segmented.foregroundPercent;
    this.previewHistogramImage = this.buildHistogramPreview(this.previewHistogram, threshold, dpi, effectiveBackground);
    this.syncActiveBatchPreviewData();
  }

  private computeHistogram(gray: Uint8Array): number[] {
    const histogram = new Array<number>(256).fill(0);
    for (let i = 0; i < gray.length; i += 1) {
      histogram[gray[i]] += 1;
    }
    return histogram;
  }

  private resolveThresholdValue(): number {
    const value = this.form.controls.threshold.value;
    if (value !== null && value !== undefined && Number.isFinite(Number(value))) {
      return this.clampByte(Number(value));
    }
    if (this.suggestedThreshold !== undefined) {
      return this.suggestedThreshold;
    }
    return 127;
  }

  private buildCsvRows(timestamp: Date): Array<Record<string, string>> {
    if (this.isBatchMode) {
      return this.batchEntries.map((entry) => this.buildCsvRow({
        timestamp,
        file: entry.file,
        analysis: entry.analysis,
        errorMessage: entry.errorMessage,
        previewData: entry.previewData,
        manualDpi: entry.manualDpi,
        threshold: entry.threshold,
        backgroundMode: entry.backgroundMode,
        smoothSegmentation: entry.smoothSegmentation,
        filterComponents: entry.filterComponents,
        pruneSkeleton: entry.pruneSkeleton,
      }));
    }

    if (!this.analysis || !this.selectedFile) {
      return [];
    }

    return [this.buildCsvRow({
      timestamp,
      file: this.selectedFile,
      analysis: this.analysis,
      errorMessage: this.errorMessage,
      previewData: this.captureCurrentPreviewData(),
      manualDpi: this.form.controls.manualDpi.value,
      threshold: this.form.controls.threshold.value,
      backgroundMode: this.form.controls.backgroundMode.value,
      smoothSegmentation: this.form.controls.smoothSegmentation.value,
      filterComponents: this.form.controls.filterComponents.value,
      pruneSkeleton: this.form.controls.pruneSkeleton.value,
    })];
  }

  private buildCsvRow(params: {
    timestamp: Date;
    file: File;
    analysis?: RootAnalysisResponse;
    errorMessage?: string;
    previewData?: BatchPreviewData;
    manualDpi?: number | null;
    threshold?: number | null;
    backgroundMode?: BackgroundMode;
    smoothSegmentation?: boolean;
    filterComponents?: boolean;
    pruneSkeleton?: boolean;
  }): Record<string, string> {
    const {
      timestamp,
      file,
      analysis,
      errorMessage,
      previewData,
      manualDpi,
      threshold,
      backgroundMode,
      smoothSegmentation,
      filterComponents,
      pruneSkeleton,
    } = params;
    return {
      data_exportacao_iso: timestamp.toISOString(),
      arquivo_nome: file.name,
      arquivo_tipo_mime: file.type || '',
      arquivo_tamanho_bytes: String(file.size ?? ''),
      status_processamento: analysis ? 'ok' : 'erro',
      erro_processamento: analysis ? '' : (errorMessage ?? ''),
      mensagem_dpi: previewData?.dpiHintMessage ?? '',
      dpi_informado_usuario: this.formatNumber(manualDpi),
      limiar_informado_usuario: this.formatNumber(threshold),
      modo_fundo_preview: backgroundMode ?? '',
      suavizacao_segmentacao: this.formatBoolean(smoothSegmentation),
      filtragem_componentes: this.formatBoolean(filterComponents),
      poda_esqueleto: this.formatBoolean(pruneSkeleton),
      limiar_sugerido_automatico: this.formatNumber(previewData?.suggestedThreshold),
      preview_largura_px: this.formatNumber(previewData?.width, 0),
      preview_altura_px: this.formatNumber(previewData?.height, 0),
      preview_foreground_percentual: this.formatNumber(previewData?.foregroundPercent, 12),
      preview_limiar_percentil: this.formatNumber(previewData?.thresholdPercentile, 12),
      preview_faixa_dinamica: this.formatNumber(previewData?.dynamicRange, 12),
      preview_tamanho_pixel_mm: this.formatNumber(previewData?.pixelSizeMm, 12),
      resultado_dpi: this.formatNumber(analysis?.dpi, 12),
      resultado_dpi_confiavel: this.formatBoolean(analysis?.dpiReliable),
      resultado_fonte_dpi: analysis?.dpiSource ?? '',
      resultado_modo_fundo: analysis?.backgroundMode ?? '',
      resultado_tamanho_pixel_mm: this.formatNumber(analysis?.pixelSizeMm, 12),
      resultado_limiar_aplicado: this.formatNumber(analysis?.threshold, 12),
      resultado_metodo_limiar: analysis?.thresholdMethod ?? '',
      resultado_preprocessamento: analysis?.preprocessingMode ?? '',
      resultado_suavizacao_segmentacao: this.formatBoolean(analysis?.smoothSegmentation),
      resultado_filtragem_componentes: this.formatBoolean(analysis?.filterComponents),
      resultado_poda_esqueleto: this.formatBoolean(analysis?.pruneSkeleton),
      resultado_comprimento_bruto_mm: this.formatNumber(analysis?.rawLengthMm, 12),
      resultado_correcao_comprimento: analysis?.lengthCorrectionMode ?? '',
      resultado_comprimento_mm: this.formatNumber(analysis?.lengthMm, 12),
      resultado_ramificacoes: this.formatNumber(analysis?.branchPoints, 0),
      resultado_diametro_medio_mm: this.formatNumber(analysis?.averageDiameterMm, 12),
      resultado_area_mm2: this.formatNumber(analysis?.areaMm2, 12),
      imagem_cinza_base64_tamanho: this.formatNumber(analysis?.grayscaleImage?.length ?? 0, 0),
      imagem_segmentada_base64_tamanho: this.formatNumber(analysis?.segmentedImage?.length ?? 0, 0),
      imagem_esqueleto_base64_tamanho: this.formatNumber(analysis?.skeletonImage?.length ?? 0, 0),
    };
  }

  private buildImageDownloadName(kind: ImageDownloadKind): string {
    const baseNameRaw = (this.selectedFile?.name ?? 'imagem').replace(/\.[^.]+$/, '');
    const baseName = baseNameRaw.trim() || 'imagem';
    const stamp = this.formatDateStamp(new Date());
    return `${baseName}_${stamp}_${kind}.png`;
  }

  private formatDateStamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}_${hour}${minute}${second}`;
  }

  private escapeCsv(value: unknown): string {
    const text = value === null || value === undefined ? '' : String(value);
    const escaped = text.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  private formatNumber(value: unknown, maxDecimals = 12): string {
    if (value === null || value === undefined || value === '') {
      return '';
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return '';
    }
    if (maxDecimals <= 0) {
      return String(Math.round(numeric));
    }
    return numeric.toFixed(maxDecimals).replace(/\.?0+$/, '');
  }

  private formatBoolean(value: unknown): string {
    if (value === true) {
      return 'sim';
    }
    if (value === false) {
      return 'não';
    }
    return '';
  }

  private isDarkTheme(): boolean {
    if (typeof document === 'undefined') {
      return false;
    }
    return document.body?.dataset?.['theme'] === 'dark';
  }

  private resolveDpiValue(): number {
    const value = this.form.controls.manualDpi.value;
    if (value !== null && value !== undefined && Number.isFinite(Number(value))) {
      const dpi = Number(value);
      if (dpi >= RootAnalyzerComponent.MIN_PLAUSIBLE_DPI && dpi <= RootAnalyzerComponent.MAX_PLAUSIBLE_DPI) {
        return dpi;
      }
    }
    return 600;
  }

  private resolveBackgroundMode(): BackgroundMode {
    return this.form.controls.backgroundMode.value ?? 'auto';
  }

  private resolveEffectiveBackgroundMode(
    gray: Uint8Array,
    threshold: number,
    selectedMode: BackgroundMode = this.resolveBackgroundMode(),
  ): Exclude<BackgroundMode, 'auto'> {
    if (selectedMode === 'light' || selectedMode === 'dark') {
      return selectedMode;
    }

    let darkForegroundCount = 0;
    for (let i = 0; i < gray.length; i += 1) {
      if (gray[i] <= threshold) {
        darkForegroundCount += 1;
      }
    }
    return darkForegroundCount / gray.length > 0.6 ? 'dark' : 'light';
  }

  private buildSegmentedPreview(
    grayBase: Uint8Array,
    grayForSegmentation: Uint8Array,
    threshold: number,
    effectiveBackground: 'light' | 'dark',
  ): { dataUrl: string; foregroundPercent: number } {
    const width = this.previewWidth;
    const height = this.previewHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return { dataUrl: '', foregroundPercent: 0 };
    }

    const frame = context.createImageData(width, height);
    const data = frame.data;
    let foregroundCount = 0;

    for (let i = 0, offset = 0; i < grayBase.length; i += 1, offset += 4) {
      const baseValue = grayBase[i];
      const segmentationValue = grayForSegmentation[i];
      const isForeground = effectiveBackground === 'dark'
        ? segmentationValue >= threshold
        : segmentationValue <= threshold;

      if (isForeground) {
        foregroundCount += 1;
        data[offset] = Math.min(255, Math.round(baseValue * 0.55 + 115));
        data[offset + 1] = Math.round(baseValue * 0.2);
        data[offset + 2] = Math.round(baseValue * 0.2);
      } else {
        data[offset] = baseValue;
        data[offset + 1] = baseValue;
        data[offset + 2] = baseValue;
      }
      data[offset + 3] = 255;
    }

    context.putImageData(frame, 0, 0);
    const previewCanvas = this.compressPreviewCanvas(canvas, width, height);
    return {
      dataUrl: previewCanvas.toDataURL('image/png'),
      foregroundPercent: this.computeForegroundPercent(foregroundCount, grayBase.length),
    };
  }

  private compressPreviewCanvas(
    sourceCanvas: HTMLCanvasElement,
    width: number,
    height: number,
  ): HTMLCanvasElement {
    const maxEdge = RootAnalyzerComponent.MAX_PREVIEW_EDGE;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    if (scale >= 0.999) {
      return sourceCanvas;
    }

    const targetCanvas = document.createElement('canvas');
    targetCanvas.width = Math.max(1, Math.round(width * scale));
    targetCanvas.height = Math.max(1, Math.round(height * scale));
    const targetContext = targetCanvas.getContext('2d');
    if (!targetContext) {
      return sourceCanvas;
    }

    targetContext.imageSmoothingEnabled = true;
    targetContext.imageSmoothingQuality = 'high';
    targetContext.drawImage(sourceCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
    return targetCanvas;
  }

  private buildHistogramPreview(
    histogram: number[],
    threshold: number,
    dpi: number,
    effectiveBackground: 'light' | 'dark',
  ): string {
    const canvas = document.createElement('canvas');
    canvas.width = 760;
    canvas.height = 250;
    const context = canvas.getContext('2d');
    if (!context) {
      return '';
    }

    const paddingLeft = 42;
    const paddingRight = 20;
    const paddingTop = 18;
    const paddingBottom = 34;
    const plotWidth = canvas.width - paddingLeft - paddingRight;
    const plotHeight = canvas.height - paddingTop - paddingBottom;
    const maxCount = Math.max(1, ...histogram);
    const darkTheme = this.isDarkTheme();
    const canvasBackground = darkTheme ? '#0f172a' : '#f8fafc';
    const activeBarColor = darkTheme ? '#ef4444' : '#ef4444';
    const inactiveBarColor = darkTheme ? '#334155' : '#c9defa';
    const thresholdMarkerColor = darkTheme ? '#f87171' : '#991b1b';
    const suggestedMarkerColor = darkTheme ? '#38bdf8' : '#0284c7';
    const plotBorderColor = darkTheme ? '#64748b' : '#94a3b8';
    const textColor = darkTheme ? '#e2e8f0' : '#0f172a';

    context.fillStyle = canvasBackground;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = Math.max(1, Math.floor(plotWidth / 256));
    for (let intensity = 0; intensity < 256; intensity += 1) {
      const value = histogram[intensity];
      const normalized = Math.sqrt(value / maxCount);
      const barHeight = Math.max(1, Math.round(normalized * plotHeight));
      const x = paddingLeft + Math.floor((intensity / 255) * (plotWidth - 1));
      const y = paddingTop + plotHeight - barHeight;
      const isForegroundSide = effectiveBackground === 'dark' ? intensity >= threshold : intensity <= threshold;
      context.fillStyle = isForegroundSide ? activeBarColor : inactiveBarColor;
      context.fillRect(x, y, barWidth, barHeight);
    }

    const markerX = paddingLeft + Math.floor((threshold / 255) * (plotWidth - 1));
    context.strokeStyle = thresholdMarkerColor;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(markerX, paddingTop);
    context.lineTo(markerX, paddingTop + plotHeight);
    context.stroke();

    if (this.suggestedThreshold !== undefined) {
      const suggestX = paddingLeft + Math.floor((this.suggestedThreshold / 255) * (plotWidth - 1));
      context.strokeStyle = suggestedMarkerColor;
      context.lineWidth = 1.5;
      context.setLineDash([5, 4]);
      context.beginPath();
      context.moveTo(suggestX, paddingTop);
      context.lineTo(suggestX, paddingTop + plotHeight);
      context.stroke();
      context.setLineDash([]);
    }

    context.strokeStyle = plotBorderColor;
    context.lineWidth = 1;
    context.strokeRect(paddingLeft, paddingTop, plotWidth, plotHeight);
    context.fillStyle = textColor;
    context.font = '600 12px Segoe UI, sans-serif';
    context.fillText(`Limiar: ${threshold}`, paddingLeft, canvas.height - 12);
    context.fillText(`DPI: ${Math.round(dpi)}`, canvas.width - 180, canvas.height - 12);
    context.fillText(
      effectiveBackground === 'dark' ? 'Fundo: escuro' : 'Fundo: claro',
      canvas.width - 100,
      canvas.height - 12,
    );

    return canvas.toDataURL('image/png');
  }

  private computeThresholdPercentile(histogram: number[], threshold: number): number {
    const total = histogram.reduce((acc, value) => acc + value, 0);
    if (total <= 0) {
      return 0;
    }
    let cumulative = 0;
    for (let i = 0; i <= threshold; i += 1) {
      cumulative += histogram[i];
    }
    return (cumulative / total) * 100;
  }

  private computeDynamicRange(histogram: number[]): number {
    const p05 = this.getPercentileIntensity(histogram, 0.05);
    const p95 = this.getPercentileIntensity(histogram, 0.95);
    return Math.max(0, p95 - p05);
  }

  private getPercentileIntensity(histogram: number[], percentile: number): number {
    const total = histogram.reduce((acc, value) => acc + value, 0);
    if (total <= 0) {
      return 127;
    }
    const target = total * Math.max(0, Math.min(1, percentile));
    let cumulative = 0;
    for (let i = 0; i < 256; i += 1) {
      cumulative += histogram[i];
      if (cumulative >= target) {
        return i;
      }
    }
    return 255;
  }

  private applyThreshold(value: number): void {
    const clamped = this.clampByte(value);
    this.form.controls.threshold.setValue(clamped, { emitEvent: false });
    this.form.controls.threshold.markAsDirty();
    this.updatePreviewArtifacts();
  }

  private computeForegroundPercent(foregroundCount: number, totalPixels: number): number {
    if (totalPixels <= 0) {
      return 0;
    }
    return (foregroundCount / totalPixels) * 100;
  }

  private captureCurrentPreviewData(): BatchPreviewData | undefined {
    if (this.previewWidth <= 0 || this.previewHeight <= 0) {
      return undefined;
    }

    return {
      dpiHintMessage: this.dpiHintMessage,
      suggestedThreshold: this.suggestedThreshold,
      width: this.previewWidth,
      height: this.previewHeight,
      foregroundPercent: this.previewForegroundPercent,
      thresholdPercentile: this.previewThresholdPercentile,
      dynamicRange: this.previewDynamicRange,
      pixelSizeMm: this.previewPixelSizeMm,
    };
  }

  private syncActiveBatchPreviewData(): void {
    if (!this.isBatchMode || this.activeBatchIndex < 0 || this.activeBatchIndex >= this.batchEntries.length) {
      return;
    }

    const previewData = this.captureCurrentPreviewData();
    if (!previewData) {
      return;
    }

    this.batchEntries[this.activeBatchIndex].previewData = previewData;
  }

  private isActiveBatchEntryPending(): boolean {
    if (!this.isBatchMode || this.activeBatchIndex < 0 || this.activeBatchIndex >= this.batchEntries.length) {
      return false;
    }

    const entry = this.batchEntries[this.activeBatchIndex];
    return entry.lastProcessedSignature !== undefined
      && entry.lastProcessedSignature !== this.buildBatchEntrySignature(entry, true);
  }

  private buildSingleProcessingSignature(): string {
    if (!this.selectedFile) {
      return '';
    }

    return JSON.stringify({
      file: this.buildFileSignature(this.selectedFile),
      manualDpi: this.normalizeOptionalNumber(this.form.controls.manualDpi.value),
      threshold: this.normalizeOptionalNumber(this.form.controls.threshold.value),
      backgroundMode: this.form.controls.backgroundMode.value ?? 'auto',
      smoothSegmentation: this.form.controls.smoothSegmentation.value,
      filterComponents: this.form.controls.filterComponents.value,
      pruneSkeleton: this.form.controls.pruneSkeleton.value,
    });
  }

  private buildBatchEntrySignature(entry: BatchEntry, useActiveFormState = false): string {
    const file = useActiveFormState && this.selectedFile ? this.selectedFile : entry.file;
    const manualDpi = useActiveFormState ? this.form.controls.manualDpi.value : entry.manualDpi;
    const threshold = useActiveFormState ? this.form.controls.threshold.value : entry.threshold;
    const backgroundMode = useActiveFormState
      ? (this.form.controls.backgroundMode.value ?? 'auto')
      : (entry.backgroundMode ?? 'auto');
    const smoothSegmentation = useActiveFormState ? this.form.controls.smoothSegmentation.value : entry.smoothSegmentation;
    const filterComponents = useActiveFormState ? this.form.controls.filterComponents.value : entry.filterComponents;
    const pruneSkeleton = useActiveFormState ? this.form.controls.pruneSkeleton.value : entry.pruneSkeleton;

    return JSON.stringify({
      file: this.buildFileSignature(file),
      manualDpi: this.normalizeOptionalNumber(manualDpi),
      threshold: this.normalizeOptionalNumber(threshold),
      backgroundMode,
      smoothSegmentation: smoothSegmentation ?? DEFAULT_ADVANCED_OPTION,
      filterComponents: filterComponents ?? DEFAULT_ADVANCED_OPTION,
      pruneSkeleton: pruneSkeleton ?? DEFAULT_ADVANCED_OPTION,
    });
  }

  private buildFileSignature(file: File): string {
    return JSON.stringify({
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    });
  }

  private normalizeOptionalNumber(value: number | null | undefined): number | null {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return null;
    }
    return Number(value);
  }

  private async prepareBatchEntryForProcessing(entry: BatchEntry, reuseCurrentPreview = false): Promise<void> {
    const dpiHintMessage = await this.ensureEntryDpi(entry, reuseCurrentPreview);

    let previewData = reuseCurrentPreview ? this.captureCurrentPreviewData() : undefined;
    if (!previewData) {
      previewData = await this.fetchBatchEntryPreviewData(entry, dpiHintMessage);
    }

    if (previewData) {
      entry.previewData = {
        ...previewData,
        dpiHintMessage,
      };
      if ((entry.threshold === null || entry.threshold === undefined) && previewData.suggestedThreshold !== undefined) {
        entry.threshold = previewData.suggestedThreshold;
      }
      return;
    }

    entry.previewData = {
      ...(entry.previewData ?? {}),
      dpiHintMessage,
    };
  }

  private async ensureEntryDpi(entry: BatchEntry, reuseCurrentPreview = false): Promise<string> {
    if (reuseCurrentPreview && this.selectedFile) {
      const currentManualDpi = this.normalizeOptionalNumber(this.form.controls.manualDpi.value);
      if (currentManualDpi !== null) {
        entry.manualDpi = currentManualDpi;
      }
      return this.dpiHintMessage;
    }

    const manualDpi = this.normalizeOptionalNumber(entry.manualDpi);
    if (manualDpi !== null) {
      entry.manualDpi = manualDpi;
      return entry.previewData?.dpiHintMessage ?? `DPI definido para esta imagem (${Math.round(manualDpi)}). Ajuste se necessario.`;
    }

    try {
      const response = await firstValueFrom(this.service.probeDpi(entry.file));
      if (typeof response?.dpi === 'number' && Number.isFinite(response.dpi) && response.dpiSource !== 'fallback') {
        entry.manualDpi = Math.round(response.dpi);
        return `DPI detectado automaticamente (${Math.round(response.dpi)}). Voce pode ajustar se necessario.`;
      }
      return 'DPI não encontrado nos metadados. Informe manualmente para evitar erro de escala.';
    } catch {
      return 'Não foi possível detectar DPI automático. Informe manualmente.';
    }
  }

  private async fetchBatchEntryPreviewData(entry: BatchEntry, dpiHintMessage: string): Promise<BatchPreviewData | undefined> {
    try {
      const response = await firstValueFrom(this.service.preview(entry.file, entry.smoothSegmentation ?? DEFAULT_ADVANCED_OPTION));
      return this.buildPreviewDataFromResponse(response, {
        manualDpi: entry.manualDpi,
        threshold: entry.threshold,
        backgroundMode: entry.backgroundMode,
        dpiHintMessage,
      });
    } catch {
      return entry.previewData ? { ...entry.previewData, dpiHintMessage } : undefined;
    }
  }

  private buildPreviewDataFromResponse(
    response: PreviewResponse,
    params: {
      manualDpi?: number | null;
      threshold?: number | null;
      backgroundMode?: BackgroundMode;
      dpiHintMessage: string;
    },
  ): BatchPreviewData {
    const width = Math.max(1, Math.round(Number(response.width)));
    const height = Math.max(1, Math.round(Number(response.height)));
    const expectedLength = width * height;
    const grayPixels = this.decodeBase64ToBytes(response.grayPixels, expectedLength);
    const smoothedPixels = this.decodeBase64ToBytes(response.smoothedPixels, expectedLength);
    const suggestedThreshold = this.clampByte(response.suggestedThreshold);
    const threshold = params.threshold !== null && params.threshold !== undefined
      ? this.clampByte(params.threshold)
      : suggestedThreshold;
    const histogram = this.computeHistogram(grayPixels);
    const dpi = this.normalizeOptionalNumber(params.manualDpi) ?? 600;
    const effectiveBackground = this.resolveEffectiveBackgroundMode(
      smoothedPixels,
      threshold,
      params.backgroundMode ?? 'auto',
    );

    let foregroundCount = 0;
    for (let i = 0; i < smoothedPixels.length; i += 1) {
      const value = smoothedPixels[i];
      const isForeground = effectiveBackground === 'dark' ? value >= threshold : value <= threshold;
      if (isForeground) {
        foregroundCount += 1;
      }
    }

    return {
      dpiHintMessage: params.dpiHintMessage,
      suggestedThreshold,
      width,
      height,
      foregroundPercent: this.computeForegroundPercent(foregroundCount, smoothedPixels.length),
      thresholdPercentile: this.computeThresholdPercentile(histogram, threshold),
      dynamicRange: this.computeDynamicRange(histogram),
      pixelSizeMm: 25.4 / dpi,
    };
  }

  private clampByte(value: number): number {
    return Math.max(
      RootAnalyzerComponent.MIN_THRESHOLD,
      Math.min(RootAnalyzerComponent.MAX_THRESHOLD, Math.round(value)),
    );
  }

  private setZoom(target: ImageZoomTarget, value: number): void {
    this.imageZooms[target] = this.clampNumber(
      Math.round(value * 100) / 100,
      RootAnalyzerComponent.MIN_ZOOM,
      RootAnalyzerComponent.MAX_ZOOM,
    );
  }

  private clampNumber(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }
    if (max < min) {
      return min;
    }
    return Math.max(min, Math.min(max, value));
  }

  private startPreviewTask(): void {
    this.previewTasks += 1;
    this.previewProcessing = this.previewTasks > 0;
  }

  private endPreviewTask(): void {
    if (this.previewTasks > 0) {
      this.previewTasks -= 1;
    }
    if (this.previewTasks === 0) {
      this.previewProcessing = false;
    }
  }

  private resetPreviewState(): void {
    this.previewRequest?.unsubscribe();
    this.previewRequest = undefined;
    this.previewTasks = 0;
    this.previewProcessing = false;
    this.previewWidth = 0;
    this.previewHeight = 0;
    this.previewGrayBase = undefined;
    this.previewGraySmoothed = undefined;
    this.previewHistogram = new Array<number>(256).fill(0);
    this.previewSegmentedImage = undefined;
    this.previewHistogramImage = undefined;
    this.previewPixelSizeMm = undefined;
    this.previewForegroundPercent = undefined;
    this.previewThresholdPercentile = undefined;
    this.previewDynamicRange = undefined;
    this.suggestedThreshold = undefined;
    this.cropModalImageUrl = undefined;
    this.previewFitZoom = 1;
  }

  private resetImageZooms(): void {
    this.previewFitZoom = 1;
    this.imageZooms.preview = this.previewFitZoom;
    this.imageZooms.grayscale = 1;
    this.imageZooms.segmented = 1;
    this.imageZooms.skeleton = 1;
  }

  private replaceActiveSelectionFile(file: File): void {
    if (this.activeBatchIndex < 0) {
      return;
    }
    if (this.activeBatchIndex < this.batchEntries.length) {
      const entry = this.batchEntries[this.activeBatchIndex];
      entry.file = file;
      entry.label = this.formatFileName(file);
      entry.analysis = undefined;
      entry.errorMessage = undefined;
    }
    if (this.activeBatchIndex < this.selectionFiles.length) {
      const updatedSelectionFiles = [...this.selectionFiles];
      updatedSelectionFiles[this.activeBatchIndex] = file;
      this.selectionFiles = updatedSelectionFiles;
    }
    this.analysis = undefined;
    this.errorMessage = undefined;
  }

  private validateSelectionFiles(files: File[]): { ok: true } | { ok: false; message: string } {
    if (files.length < RootAnalyzerComponent.MIN_SELECTION_FILES || files.length > RootAnalyzerComponent.MAX_BATCH_FILES) {
      return {
        ok: false,
        message: `Selecione entre ${RootAnalyzerComponent.MIN_SELECTION_FILES} e ${RootAnalyzerComponent.MAX_BATCH_FILES} imagens para continuar.`,
      };
    }

    const invalidFiles = files.filter((file) => !this.isSupportedImageFile(file));
    if (invalidFiles.length > 0) {
      const invalidNames = invalidFiles.slice(0, 3).map((file) => file.name).join(', ');
      const suffix = invalidFiles.length > 3 ? '...' : '';
      return {
        ok: false,
        message: `Arquivos invalidos detectados (${invalidNames}${suffix}). Formatos aceitos: TIF, TIFF, PNG, JPG, JPEG ou BMP.`,
      };
    }

    return { ok: true };
  }

  private isSupportedImageFile(file: File): boolean {
    const lowerName = file.name.toLowerCase();
    for (const extension of this.supportedImageExtensions) {
      if (lowerName.endsWith(extension)) {
        return true;
      }
    }
    return false;
  }

  private formatFileName(file: File): string {
    const name = file.name.trim();
    if (name.length <= 32) {
      return name;
    }
    const extIndex = name.lastIndexOf('.');
    const extension = extIndex > -1 ? name.slice(extIndex) : '';
    const base = extIndex > -1 ? name.slice(0, extIndex) : name;
    return `${base.slice(0, 20)}...${extension}`;
  }
}
