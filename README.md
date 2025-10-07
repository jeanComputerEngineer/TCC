# Estúdio de Fenotipagem Radicular

Aplicação interativa inspirada no fluxo computacional de Teruo Matos para medir comprimento e diâmetro de raízes de milho. A solução combina uma interface moderna em Angular com um motor de processamento em FastAPI para que pesquisadores realizem toda a análise em hardware local.

## Funcionalidades

- Experiência guiada que segue o pipeline original: carregamento da imagem, leitura ou solicitação de DPI, conversão para tons de cinza, limiarização, validação geométrica por contornos, esqueletização e consolidação das métricas finais.
- Processamento exclusivamente local entregue por um serviço FastAPI utilizando Pillow, NumPy, SciPy, scikit-image e OpenCV para medições reprodutíveis.
- Visualização instantânea das camadas em tons de cinza, segmentada e do esqueleto com downloads rápidos para documentação, sempre atualizadas conforme o DPI ou limiar são ajustados.
- Métricas quantitativas incluindo comprimento do esqueleto, pontos de ramificação, diâmetro médio e área total convertidas para unidades físicas a partir do DPI embutido ou informado.
- Modos claro e escuro para ambientes de laboratório variados.

## Pré-requisitos

- Docker Engine 24+
- Docker Compose Plugin 2+

## Início rápido

```bash
git clone <repositorio>
cd TCC
docker compose up --build
```

Abra [http://localhost:8080](http://localhost:8080) no navegador. A interface Angular encaminha as requisições para `/api` ao backend FastAPI executando na porta 8000 dentro da mesma rede Docker.

## Fluxo de uso

1. Digitalize a amostra de raízes em um scanner de mesa. Prefira alto DPI (≥600) e inclua uma régua de calibração quando o arquivo não possuir metadados.
2. Arraste a imagem para a interface ou clique em **Selecionar imagem** para procurar arquivos TIFF, PNG, JPG ou BMP. Informe o DPI manualmente se a imagem não contiver essa informação.
3. Ajuste o limiar de segmentação (0–255) quando desejar. O algoritmo aplica automaticamente o valor de Otsu ao deixar o campo vazio.
4. Observe as pré-visualizações em tons de cinza, segmentadas e do esqueleto reagindo em tempo real a cada alteração de DPI ou limiar. Utilize **Processar imagem** para consolidar manualmente os resultados quando desejar.
5. Analise as métricas quantitativas e baixe as camadas em tons de cinza, segmentada e esqueleto para relatórios ou validação.

## Execução de testes

Os testes unitários do Angular podem ser executados localmente com:

```bash
cd Frontend
npm install
npm test
```

## Estrutura do projeto

- `Frontend/`: aplicação Angular 19 voltada para tarefas de fenotipagem radicular.
- `backend/`: serviço FastAPI que implementa o pipeline de análise descrito por Teruo Matos.
- `docker-compose.yml`: orquestração dos contêineres de frontend e backend.

## Fundamentação científica

A implementação reproduz as etapas computacionais descritas por Teruo Matos para análise de raízes de milho: normalização por DPI a partir de metadados ou valor informado pelo usuário, conversão para tons de cinza, limiarização guiada por histograma com inversão automática do fundo quando necessário, extração de contornos por Suzuki & Abe, filtragem de objetos por circularidade, esqueletização por afinamento em 8-vizinhança, identificação de ramificações, acumulação do comprimento do esqueleto por distâncias euclidianas e cálculo do diâmetro médio excluindo cruzamentos. O procedimento de validação segue a estratégia original de fios de náilon antes de aplicar o fluxo às imagens reais de raízes.
