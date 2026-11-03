# Instruções para `js/`

- Nunca altere `../widget.js`. Ele é a base do widget e deve permanecer intacto para servir de referência a futuras mudanças.
- Implemente ajustes específicos desta integração em `widget-script.js`, como injeções no bundle obtido pela URL oficial.
- Para ocultar conteúdo, prefira filtrar na camada de renderização do bundle injetado quando isso preservar estado, paginação e eventos recebidos.
- Preserve a verificação de integridade do bundle remoto. Faça a injeção falhar de forma explícita se os trechos esperados não forem encontrados exatamente uma vez; revise a nova distribuição antes de atualizar os anchors ou o hash.
- `teste-local.html` deve carregar `./widget-script.js` para testar o caminho de injeção. Não carregue `../widget.js` diretamente nessa página.
- Para testar no localhost com `js/` como diretório atual, execute `python -m http.server 8000` dentro de `js/` e abra `/teste-local.html`.
