# Processador de Imagens de Raízes

> **Trabalho de Conclusão de Curso — Engenharia de Computação**
> Universidade Estadual de Ponta Grossa (UEPG) — Departamento de Informática
>
> **Autores:** Augusto Lara Amorim Santos e Jean Samuel Candido Henrique
> **Orientadora:** Prof.ª Rosane Falate · **Coorientador:** Prof. Jonathan de Matos
>
> Software desenvolvido como parte do TCC intitulado *"Desenvolvimento de um Software
> para Processamento de Imagens Aplicado à Análise de Raízes Vegetais Lavadas com
> Algoritmos Computacionais e Princípios de UI/UX"*.

Aplicativo desktop e web para estimar o **comprimento total de raízes vegetais lavadas** a partir de imagens digitalizadas em scanner. A solução combina um backend FastAPI (Python) responsável pelo processamento das imagens, um frontend Angular para interação com o pesquisador e um wrapper Electron para distribuição em Windows com experiência offline.

O diferencial do projeto não está no algoritmo em si, que emprega técnicas clássicas de processamento digital de imagens, mas na **transparência do processo**: a interface exibe a prévia da segmentação antes da medição, mostra as imagens intermediárias (tons de cinza, máscara binária e esqueleto) junto do resultado numérico, e registra em CSV todos os parâmetros que influenciaram cada medida.

## Escopo e limitações

Este é um trabalho acadêmico. Antes de usar os resultados em pesquisa, considere:

- **Apenas o comprimento foi validado** contra referência independente (MAE de 3,52% em imagens sintéticas e 8,11% no conjunto completo de 36 imagens). Área projetada, diâmetro médio e pontos de ramificação são calculados e exportados, mas **não possuem exatidão caracterizada**.
- **Não houve comparação com software comercial** (WinRHIZO), por indisponibilidade de licença.
- O pipeline aplica **duas correções heurísticas** de comprimento em casos de supersegmentação ou fragmentação. Seus limites de acionamento foram calibrados sobre o próprio conjunto de validação, havendo risco de sobreajuste. O valor sem correção é preservado na coluna `raw_length_mm` dos CSVs.
- Cruzamentos entre raízes são subestimados, limitação estrutural da representação por esqueleto topológico.

Os detalhes metodológicos, os resultados e a discussão dessas limitações estão no artigo, em [`ArtigoTCC/`](ArtigoTCC/).

## Estrutura do repositório

| Pasta | Conteúdo |
|---|---|
| `Backend/` | API FastAPI e pipeline de processamento (`app/main.py`) |
| `Frontend/` | Aplicação Angular: fluxo guiado, histograma, lote e exportação |
| `ElectronApp/` | Empacotamento desktop para Windows |
| `ArtigoTCC/` | Artigo em LaTeX, figuras e dados dos resultados |
| `Testes/` | Imagens de validação, gerador das sintéticas e scripts de análise |

## Pré-requisitos

| Cenário                              | Dependências principais                                  |
|-------------------------------------|-----------------------------------------------------------|
| Desenvolvimento rápido (Docker)     | Docker Desktop 4.0+, Docker Compose Plugin 2.0+           |
| Desenvolvimento manual              | Node.js 18+, Python 3.11+, Git, dependências científicas  |
| Build do instalador Windows (.exe)  | Tudo acima + PyInstaller, Windows SDK (signtool opcional) |

## Ambiente de desenvolvimento com Docker

> O compose já sobe backend (porta 8000), frontend (porta 4200) e shell Electron em modo de desenvolvimento. Nenhuma configuração adicional é necessária.

```powershell
# 1. Clone o repositório e entre na pasta raiz
cd TCC-UEPG

# 2. Suba todo o ambiente
docker compose up
```

- Irá abrir na porta definida, provavelmente em http://localhost:4200/  
- Para parar, pressione `Ctrl+C` no terminal. Se quiser remover containers/imagens: `docker compose down`.

## Desenvolvimento manual (sem Docker)

1. Instale as dependências científicas:
   ```powershell
   cd Backend
   py -3 -m venv .venv
   .venv\Scripts\activate
   python -m pip install --upgrade pip
   python -m pip install -r requirements.txt
   ```
2. Instale as dependências do frontend e do Electron:
   ```powershell
   cd ..\Frontend
   npm install
   cd ..\ElectronApp
   npm install
   ```
3. Execute todos os serviços simultaneamente:
   ```powershell
   npm run start:dev
   ```
   O script inicia `start_server.py` (FastAPI), `ng serve` (Angular) e `electron .` com hot reload.

## Gerando o instalador Windows

1. **Empacotar**
   ```powershell
   cd ElectronApp
   npm run dist
   ```
   O comando executa:
   - `npm run build:frontend`: compila o Angular e copia os artefatos para `ElectronApp/dist/renderer`.
   - `npm run build:backend`: prepara `Backend/.venv`, roda o PyInstaller e salva `processador-backend.exe` em `resources/python`.
   - `node scripts/build-electron.js`: chama o `electron-builder` local em uma pasta temporária ASCII e gera `release-output/Processador-de-Imagens-de-Raizes-Setup-<versão>.exe` e `release-output/win-unpacked/Processador de Imagens de Raízes.exe`.

2. **Testar localmente**
   ```powershell
   release-output\win-unpacked\"Processador de Imagens de Raízes.exe"
   ```

## Estrutura do repositório

```
Backend/        # FastAPI + PyInstaller (processador-backend.exe)
Frontend/       # Angular 19 (interface e lógica cliente)
ElectronApp/    # Shell Electron, scripts e build do instalador
Testes/         # Imagens sintéticas/reais, scripts e relatório de validação
Dockerfile*/    # Imagens usadas no docker compose (frontend e backend)
README.md       # Este guia
```

## Testes de validação

A pasta `Testes/` contém imagens sintéticas e imagens reais de scanner para validar o comprimento medido pelo software com referências conhecidas ou anotadas.

- `Sintéticas/gerar_imagens_sinteticas.py`: gera imagens com DPI 300 e comprimento conhecido pela soma das centrolinhas desenhadas.
- `Sintéticas/analisar_sinteticas.py`: executa o mesmo pipeline do backend nas imagens sintéticas.
- `Sintéticas/comprimentos_esperados.csv`: tabela de referência.
- `Sintéticas/resultados_sinteticas.csv`: resultados medidos pelo software nas sintéticas.
- `Medidas de Scanner/`: imagens reais de scanner usadas para conferência manual.
- `analisar_todas_imagens.py`: processa sintéticas e scanner, gerando `resultados_todos.csv` e `estatisticas_por_grupo.csv`.
- `gerar_relatorio_testes.py`: recria o relatório `.doc` a partir dos CSVs.
- `Relatorio_Testes_Sinteticos.doc`: descrição detalhada da metodologia, cenários e resultados.

Para regenerar a base e recalcular os resultados:

```powershell
python "Testes\Sintéticas\gerar_imagens_sinteticas.py"
python "Testes\Sintéticas\analisar_sinteticas.py"
python "Testes\analisar_todas_imagens.py"
python "Testes\gerar_relatorio_testes.py"
```

Na rodada atual foram usadas 36 imagens: 20 sintéticas e 16 reais de scanner. As sintéticas variam fundo claro/escuro, raízes contínuas e fragmentadas, orientações horizontal/vertical/diagonal, espessura, ruído, baixo contraste, arcos longos, formas circulares, espirais e cruzamentos. O relatório registra as estatísticas por grupo, incluindo erro médio, erro absoluto médio, mediana, desvio-padrão, RMSE, percentil 95 e contagens dentro de tolerâncias de 3%, 5% e 10%.

## Referências científicas

- Matos, T. et al. *Pipeline computacional para fenotipagem radicular em milho.*
- Documentação das bibliotecas: FastAPI, Pillow, NumPy, SciPy, scikit-image, OpenCV.

## Licença

Sem licença por enquanto.
