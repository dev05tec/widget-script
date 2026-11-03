# Revisão de segurança do widget

Escopo: `widget-script.js`. As mudanças desta pasta não alteram o código do
fornecedor hospedado em `https://public-assets.tiflux.com/widget/tiflux-widget.iife.js`.

## Proteções

- O carregador baixa a distribuição oficial com SHA-384 via SRI, CORS e sem
  enviar referer. Depois transforma o texto validado e executa uma URL Blob local.
- A política CSP da página hospedeira precisa permitir `connect-src` para
  `public-assets.tiflux.com` e execução de scripts `blob:`.
- O hash fixa uma distribuição do fornecedor; não representa uma auditoria
  completa do código hospedado.
- A página hospedeira deve controlar as próprias dependências e sua política CSP.
  Scripts executados na página têm acesso ao DOM e ao armazenamento da mesma origem.

## Manutenção do script externo

Se o fornecedor modificar a distribuição no mesmo endereço, o fetch deve falhar
por divergência de integridade. Revise a nova distribuição e os anchors de
injeção antes de atualizar `TIFLUX_SCRIPT_INTEGRITY`; prefira uma URL imutável ou
versionada se o fornecedor disponibilizar uma. Nunca recalcule o hash
automaticamente em produção. Não carregue a tag oficial em paralelo com o
injetor: um bundle carregado diretamente não recebe as alterações.

## Verificação

Com Node.js instalado, execute:

```sh
npm ci
npm test
node --check widget-script.js
git diff --check
```
