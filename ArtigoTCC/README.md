# Artigo do TCC

Esta pasta e o projeto final do artigo em LaTeX para o Overleaf.

## Como usar no Overleaf

Envie o conteudo desta pasta para o projeto do Overleaf. Esta pasta ja contem o `main.tex`, as referencias, o template SBC, as figuras e os dados finais usados no artigo.

## Arquivos principais

- `main.tex`: texto principal do artigo.
- `referencias.bib`: referencias bibliograficas.
- `sbc-template.sty`, `sbc.bst` e `caption2.sty`: arquivos do template SBC.
- `figuras/interface/`: capturas desktop da interface.
- `figuras/responsivo/`: capturas mobile e iPad/tablet.
- `figuras/processamento/`: exemplos de cinza, segmentacao e esqueleto.
- `dados/`: CSVs finais e resumo estatistico usados no artigo.

## Como compilar

No Overleaf, selecione `main.tex` como arquivo principal. Em uma maquina com LaTeX instalado:

```powershell
pdflatex main.tex
bibtex main
pdflatex main.tex
pdflatex main.tex
```

## Como regenerar os resultados

A partir da raiz do projeto:

```powershell
python Testes\analisar_artigo_final.py
```

O script gera os arquivos em:

`Testes\Resultados Artigo Final`
