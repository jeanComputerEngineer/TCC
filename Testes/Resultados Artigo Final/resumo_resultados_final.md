# Resumo dos resultados finais

Referências extraídas exclusivamente dos nomes dos arquivos.
Todos os testes foram executados com DPI manual de 300 e limiar automático do software.

## Estatísticas por grupo

| Grupo | n | MAE (%) | RMSE (%) | Mediana abs. (%) | P95 abs. (%) | Dentro de 5% | Dentro de 10% |
|---|---:|---:|---:|---:|---:|---:|---:|
| Sintéticas | 20 | 3,52 | 4,50 | 2,69 | 9,60 | 13/20 | 19/20 |
| Imagens Jean | 8 | 14,65 | 24,14 | 8,84 | 46,39 | 2/8 | 6/8 |
| Imagens Teruo | 8 | 13,03 | 21,11 | 5,98 | 43,13 | 4/8 | 6/8 |
| Total | 36 | 8,11 | 15,49 | 4,37 | 34,52 | 19/36 | 31/36 |

## Maiores desvios absolutos

| Grupo | Arquivo | Esperado (mm) | Medido (mm) | Erro (%) | Limiar | Correção |
|---|---|---:|---:|---:|---:|---|
| Imagens Jean | 0,36Metro.bmp | 360,00 | 593,06 | 64,74 | 164,00 | - |
| Imagens Teruo | 37 - 3000.bmp | 3000,00 | 4519,80 | 50,66 | 9,00 | dense-graph |
| Imagens Teruo | 32 - 3000.bmp | 3000,00 | 2125,99 | -29,13 | 14,28 | fragmented-components-blended |
| Imagens Jean | 0,215Metro.bmp | 215,00 | 241,47 | 12,31 | 164,00 | - |
| Sintéticas | sintetica_012_escura_cruzamentos_5200mm.png | 5200,00 | 4663,86 | -10,31 | 114,00 | - |
