# Instruções para `js/`

## Arquivos e responsabilidade

- `../widget.js` é a distribuição-base do widget. Nunca o edite; use-o apenas como referência.
- `widget-script.js` é o único ponto para personalizações desta integração. Ele baixa o bundle oficial, injeta alterações e executa o resultado.
- `teste-local.html` deve carregar somente `./widget-script.js`, para validar o mesmo caminho usado em produção.

## Regras para injeções

- Preserve o carregamento do bundle oficial e a validação de integridade existente.
- Cada injeção deve usar um anchor exato e único. Se o trecho não existir ou aparecer mais de uma vez, a injeção deve falhar explicitamente e carregar o widget vanilla.
- Ao inserir código antes de uma declaração minificada, inclua a declaração completa no anchor. Por exemplo, não injete código procurando apenas `Se=` quando o bundle contém `var Se=`; isso pode produzir `var const ...` inválido.
- Depois de atualizar o bundle oficial, confira todos os anchors e revise a injeção antes de alterar qualquer anchor ou hash.
- Não implemente funcionalidades no bundle-base nem adicione recursos fora do escopo solicitado.

## Teste local

Com `js/` como diretório atual:

```powershell
python -m http.server 8000
```

Abra `http://localhost:8000/teste-local.html` e verifique o console do navegador. Mensagens de fallback indicam que algum anchor não correspondeu ao bundle remoto.
