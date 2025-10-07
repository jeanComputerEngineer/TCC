import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { RootAnalyzerComponent } from './pages/root-analyzer/root-analyzer.component';

const routes: Routes = [
  { path: '', component: RootAnalyzerComponent },
  { path: '**', redirectTo: '' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}

export { routes };
