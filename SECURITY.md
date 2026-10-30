# Revisão de segurança do widget

Escopo: `widget-script.js`. As mudanças desta pasta não alteram o código do
fornecedor hospedado em `https://public-assets.tiflux.com/widget/tiflux-widget.iife.js`.

## Proteções

- O carregador exige SHA-384 fixo via Subresource Integrity, CORS anônimo e não
  envia referer. Scripts existentes sem a integridade esperada são rejeitados.
- O hash fixa uma distribuição do fornecedor; não representa uma auditoria
  completa do código hospedado.
- A página hospedeira deve controlar as próprias dependências e sua política CSP.
  Scripts executados na página têm acesso ao DOM e ao armazenamento da mesma origem.

## Manutenção do script externo

Se o fornecedor modificar a distribuição no mesmo endereço, o navegador deve
bloquear seu carregamento por divergência de integridade. Revise a nova
distribuição antes de atualizar `TIFLUX_SCRIPT_INTEGRITY`; prefira uma URL
imutável ou versionada se o fornecedor disponibilizar uma. Nunca recalcule o
hash automaticamente em produção.

## Verificação

Com Node.js instalado, execute:

```sh
npm ci
npm test
node --check widget-script.js
git diff --check
```
