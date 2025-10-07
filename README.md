# Estúdio de Fenotipagem Radicular

Aplicação interativa inspirada no fluxo computacional de Teruo Matos para medir comprimento e diâmetro de raízes de milho. A solução combina uma interface moderna em Angular com um motor de processamento em FastAPI para que pesquisadores realizem toda a análise em hardware local.

## Funcionalidades

- Experiência guiada que segue o pipeline original: carregamento da imagem, configuração de DPI, conversão para tons de cinza, segmentação, esqueletização, análise morfométrica e validação.
- Processamento exclusivamente local entregue por um serviço FastAPI utilizando Pillow, NumPy, SciPy e scikit-image para medições reprodutíveis.
- Visualização instantânea das camadas em tons de cinza, segmentada e do esqueleto com downloads rápidos para documentação.
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
2. Arraste a imagem para a interface ou clique em **Selecionar imagem** para procurar. Informe o DPI manualmente se a imagem não contiver essa informação.
3. Opcionalmente ajuste o limiar de segmentação (0–255). Ao deixar o campo vazio, aplica-se o limiar automático de Otsu.
4. Pressione **Processar imagem**. O backend realiza a conversão para tons de cinza, segmentação por limiar, esqueletização, detecção de ramificações e estimação de diâmetro via transformada de distância.
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

A implementação reproduz as etapas computacionais descritas por Teruo Matos para análise de raízes de milho: normalização por DPI, conversão para tons de cinza, limiarização baseada em histograma, esqueletização morfológica, análise de ramificações, acumulação de comprimento com pesos euclidianos e estimativa de diâmetro por transformada de distância. O procedimento de validação segue a estratégia original de fios de náilon antes de aplicar o fluxo às imagens reais de raízes.
