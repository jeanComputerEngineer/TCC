import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface RootAnalysisRequest {
  file: File;
  manualDpi?: number;
  threshold?: number;
}

export interface RootAnalysisResponse {
  dpi: number;
  pixelSizeMm: number;
  threshold: number;
  lengthMm: number;
  branchPoints: number;
  averageDiameterMm: number;
  areaMm2: number;
  grayscaleImage: string;
  segmentedImage: string;
  skeletonImage: string;
}

@Injectable({
  providedIn: 'root'
})
export class RootAnalysisService {
  private readonly baseUrl = '/api';

  constructor(private readonly http: HttpClient) {}

  analyze(request: RootAnalysisRequest): Observable<RootAnalysisResponse> {
    const formData = new FormData();
    formData.append('file', request.file);
    if (request.manualDpi !== undefined && request.manualDpi !== null) {
      formData.append('manual_dpi', String(request.manualDpi));
    }
    if (request.threshold !== undefined && request.threshold !== null) {
      formData.append('threshold', String(request.threshold));
    }
    return this.http.post<RootAnalysisResponse>(`${this.baseUrl}/process`, formData);
  }
}
