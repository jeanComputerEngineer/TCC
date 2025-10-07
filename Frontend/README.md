# Guia do Frontend

Este projeto foi gerado com [Angular CLI](https://github.com/angular/angular-cli) versão 19.1.6.

## Servidor de desenvolvimento

Para iniciar o servidor local, execute:

```bash
ng serve
```

Após a inicialização, acesse `http://localhost:4200/` no navegador. A aplicação recarrega automaticamente quando houver alterações nos arquivos fonte.

## Geração de código

O Angular CLI oferece ferramentas para geração de código. Para criar um novo componente, execute:

```bash
ng generate component nome-do-componente
```

Para listar todos os esquemas disponíveis (como `components`, `directives` ou `pipes`), utilize:

```bash
ng generate --help
```

## Build

Para compilar o projeto, execute:

```bash
ng build
```

Os artefatos ficarão em `dist/`. O build de produção aplica otimizações de desempenho automaticamente.

## Testes unitários

Para rodar testes unitários com o [Karma](https://karma-runner.github.io), utilize:

```bash
ng test
```

## Testes fim a fim

Para executar testes fim a fim (e2e), utilize:

```bash
ng e2e
```

O Angular CLI não inclui um framework e2e por padrão; escolha o que melhor se adequa às suas necessidades.

## Recursos adicionais

Para mais detalhes sobre o Angular CLI e sua lista completa de comandos, visite a [documentação oficial](https://angular.dev/tools/cli).
