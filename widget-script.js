(() => {
  // IIFE (função executada imediatamente): cria um escopo privado para as variáveis
  // deste arquivo, evitando colisões com nomes usados pelo site que o incorpora.
  // Executa em um escopo isolado e impede instalar o mesmo widget duas vezes na página.
  if (window.__SecullumWidget) return;
  // Copia os atributos data-* enquanto currentScript ainda aponta para este script.
  // Opções: data-token, data-open e data-layout.
  // `?.` (optional chaining) só lê dataset se currentScript existir. `|| {}` fornece
  // um objeto vazio como alternativa e `...` copia os atributos para um objeto próprio.
  const options = { ...(document.currentScript?.dataset || {}) };
  const state = { initialized: false };
  window.__SecullumWidget = state;
  const TIFLUX_SCRIPT_URL = "https://public-assets.tiflux.com/widget/tiflux-widget.iife.js";
  // Snapshot verificado em 23/10/2026. Atualize somente após revisar a nova distribuição.
  const TIFLUX_SCRIPT_INTEGRITY = "sha384-EAvsVChq1qYU17TR1lRMIoVxNcb7EgIrROF0KUfFkmQpgs0bcnFvGOmICpc9Nium";
  const DEFAULT_WIDGET_CONFIG = {
    // Valores de posicionamento e autenticação usados quando a página não os sobrescreve.
    token: "4dbbca22-ea44-4171-a4c7-23b3031a77d4",
    xOffset: 24,
    yOffset: 24,
    // identify: {
    //   name: "Nome do usuário",
    //   email: "email@empresa.com",
    //   phone: "11999990000",
    //   externalId: "id-do-usuario",
    // },
  };

  // Carrega a distribuição oficial e exige o hash de integridade (SRI) esperado.
  // Também valida scripts existentes e limita a espera a 30 segundos.
  // Retorna uma Promise: quem chama pode usar `await` e só inicializar o chat depois que
  // o script terminar. A Promise termina resolvida (sucesso) ou rejeitada (erro/timeout).
  const loadTifluxWidget = () => {
    // Procura primeiro a URL exata; assim o script desta integração e a API global
    // podem ser reaproveitados sem baixar nem executar o mesmo widget de novo.
    const installed = document.querySelector(`script[src="${TIFLUX_SCRIPT_URL}"]`);
    if (window.TifluxWidget?.init) {
      // Uma API global preexistente só é confiável quando veio da tag esperada,
      // com SRI e CORS anônimo. Sem essa correspondência, abortamos a inicialização.
      if (!installed || installed.integrity !== TIFLUX_SCRIPT_INTEGRITY || installed.crossOrigin !== "anonymous") {
        return Promise.reject(new Error("O widget já carregado não possui a integridade esperada."));
      }
      return Promise.resolve();
    }
      return new Promise((resolve, reject) => {
      let loader = document.querySelector(`script[src="${TIFLUX_SCRIPT_URL}"]`);
      const existing = Boolean(loader);
      // Uma tag encontrada sem os atributos de segurança não será corrigida às cegas:
      // ela pode já estar em carregamento ou representar uma distribuição diferente.
      if (existing && (loader.integrity !== TIFLUX_SCRIPT_INTEGRITY || loader.crossOrigin !== "anonymous")) {
        reject(new Error("O script existente do Tiflux não possui a integridade esperada."));
        return;
      }
      if (!loader) {
        loader = document.createElement("script");
        // SRI faz o navegador comparar o arquivo recebido com o hash aprovado.
        loader.integrity = TIFLUX_SCRIPT_INTEGRITY;
        loader.crossOrigin = "anonymous";
        loader.referrerPolicy = "no-referrer";
        loader.src = TIFLUX_SCRIPT_URL;
        loader.async = true;
      }
      // `resolve` e `reject` são funções fornecidas pelo construtor Promise para concluir
      // a operação assíncrona. Os ouvintes `{ once: true }` também se removem após o evento.
      const cleanUp = () => {
        // Remove temporizador e ouvintes após qualquer resultado para evitar
        // que um evento atrasado tente resolver/rejeitar a mesma operação novamente.
        clearTimeout(timeout);
        loader.removeEventListener("load", onLoad);
        loader.removeEventListener("error", onError);
      };
      const onLoad = () => {
        cleanUp();
        // O evento load sozinho não garante que a biblioteca expôs sua API pública.
        if (window.TifluxWidget?.init) resolve();
        else reject(new Error("O script do Tiflux não inicializou o widget."));
      };
      const onError = () => {
        cleanUp();
        // Só remove uma tag criada por esta função; preserva tags pertencentes à página.
        if (!existing) loader.remove();
        reject(new Error("Não foi possível carregar o script do Tiflux."));
      };
      const timeout = setTimeout(() => {
        cleanUp();
        if (!existing) loader.remove();
        reject(new Error("O carregamento do widget excedeu 30 segundos."));
      }, 30000);
      loader.addEventListener("load", onLoad, { once: true });
      loader.addEventListener("error", onError, { once: true });
      if (!existing) document.head.appendChild(loader);
    });
  };

  // Aguarda o DOM interno do widget (ShadowRoot) para aplicar o layout expandido:
  // painel centralizado no desktop e tela inteira em larguras de até 600 px.
  // `setInterval` agenda novas tentativas sem bloquear a página; o callback para assim
  // que a ShadowRoot existe ou depois do prazo. Shadow DOM isola o HTML do widget.
  const initializeExpandedLayout = (loadingStyle) => {
    // O widget cria sua raiz de forma assíncrona; a consulta periódica cobre esse atraso.
    const startedAt = Date.now();
    const waitForWidget = setInterval(() => {
      const root = document.querySelector("#tiflux-widget-root");

      if (!root?.shadowRoot) {
        // Evita ocultar a página indefinidamente se o widget não criar a raiz.
        if (Date.now() - startedAt >= 30000) {
          clearInterval(waitForWidget);
          loadingStyle?.remove();
        }
        return;
      }

      clearInterval(waitForWidget);
      loadingStyle?.remove();

      // Esta função pequena evita repetir o seletor quando o layout for recalculado.
      const getInternalButton = () =>
        // É o botão de abrir/fechar do componente original, localizado dentro do Shadow DOM.
        root.shadowRoot.querySelector("#tiflux-widget-app > button");

      let observer;
      // Funções declaradas aqui formam uma closure: conseguem ler `root`, `observer` e
      // `mobile` da inicialização sem armazenar esses valores em variáveis globais.
      const syncWidget = () => {
        // Pausa a observação para que as mudanças de estilo abaixo não gerem um ciclo.
        observer?.disconnect();
        const button = getInternalButton();
        const app = root.shadowRoot.querySelector("#tiflux-widget-app");
        const widgetPage = app?.querySelector(":scope > div");
        // Lê a largura atual para recalcular o painel após rotação ou redimensionamento.
        // matchMedia avalia uma regra CSS e `matches` informa se ela vale neste viewport.
        const mobile = window.matchMedia("(max-width: 600px)").matches;

        if (button) {
          // No modo expandido, esconde o botão flutuante e mostra a raiz que o contém.
          if (button.style.visibility !== "hidden") {
            button.style.setProperty("visibility", "hidden", "important");
          }

          if (root.style.visibility !== "visible") {
            root.style.setProperty("visibility", "visible", "important");
          }
        }

        if (widgetPage) {
          widgetPage.querySelectorAll("img, svg").forEach((icon) => {
            const box = icon.getBoundingClientRect();
            const nearTitle = icon.parentElement?.textContent?.trim().length > 0;
            if (nearTitle && box.width > 0 && box.height > 0 && Math.abs(box.width - box.height) > 1) {
              const side = `${Math.max(box.width, box.height)}px`;
              icon.style.setProperty("width", side, "important");
              icon.style.setProperty("height", side, "important");
              icon.style.setProperty("object-fit", "cover", "important");
            }
          });
          // Desktop: painel central limitado a 1400 px; celular: painel de ponta a ponta.
          const viewportHeight = mobile ? "100dvh" : "80vh";
          root.style.setProperty("position", "fixed", "important");
          root.style.setProperty("inset", "0", "important");
          root.style.setProperty("width", "100vw", "important");
          root.style.setProperty("height", mobile ? "100dvh" : "100vh", "important");

          widgetPage.style.setProperty("position", "fixed", "important");
          widgetPage.style.setProperty("top", mobile ? "0" : "50%", "important");
          widgetPage.style.setProperty("left", mobile ? "0" : "50%", "important");
          widgetPage.style.setProperty("transform", mobile ? "none" : "translate(-50%, -50%)", "important");
          widgetPage.style.setProperty("width", mobile ? "100vw" : "min(80vw, 1400px)", "important");
          widgetPage.style.setProperty("height", viewportHeight, "important");
          widgetPage.style.setProperty("max-width", mobile ? "100vw" : "1400px", "important");
          widgetPage.style.setProperty("max-height", mobile ? "100dvh" : "none", "important");
          widgetPage.style.setProperty("border-radius", mobile ? "0" : "16px", "important");

          widgetPage
            .querySelectorAll('[aria-label="Recolher"], [aria-label="Fechar"]')
            .forEach((button) => {
              button.style.setProperty("display", "none", "important");
            });
        }
        observer?.observe(root.shadowRoot, {
          childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"],
        });
      };

      // O viewport visual também muda quando o teclado virtual abre no celular.
      window.addEventListener("resize", syncWidget);
      window.visualViewport?.addEventListener("resize", syncWidget);

      // MutationObserver chama syncWidget quando o próprio Tiflux altera o DOM observado.
      observer = new MutationObserver(syncWidget);

      observer.observe(root.shadowRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class"],
      });

      syncWidget();
    }, 100);
  };

  // Configura o chat.
  const initialize = async () => {
    let layoutStyle;
    try {
      const previous = window.TifluxWidgetConfig || {};
      // Token: atributo data-token > configuração global existente > valor padrão.
      // As demais configurações globais também prevalecem sobre os padrões.
      const token = options.token || previous.token || DEFAULT_WIDGET_CONFIG.token;
      // Spread (`...`) combina padrões e configurações do site; as propriedades à direita
      // substituem as anteriores, por isso `token` calculado é aplicado no final.
      window.TifluxWidgetConfig = {
        ...DEFAULT_WIDGET_CONFIG,
        ...previous,
        token,
        identify: previous.identify === undefined ? DEFAULT_WIDGET_CONFIG.identify : previous.identify,
      };
      if (options.open === "true") {
        // O widget usa esta chave no armazenamento local para abrir já expandido.
        try { localStorage.setItem(`@TifluxWidget:IsOpen:${token}`, "true"); } catch {}
      }
      if (options.layout === "expanded") {
        // Evita um breve flash do widget flutuante antes de aplicar o layout expandido.
        layoutStyle = document.createElement("style");
        layoutStyle.textContent = "#tiflux-widget-root { visibility: hidden !important; }";
        document.head.appendChild(layoutStyle);
      }
      // `await` garante que a API global exista antes de chamar identify() ou init().
      await loadTifluxWidget();
      if (!document.querySelector("#tiflux-widget-root")) {
        // Inicializa somente quando o Tiflux ainda não inseriu sua raiz na página.
        if (window.TifluxWidgetConfig.identify) window.TifluxWidget.identify(window.TifluxWidgetConfig.identify);
        window.TifluxWidget.init(window.TifluxWidgetConfig);
      }
      if (options.layout === "expanded") initializeExpandedLayout(layoutStyle);
      // Coloca um símbolo discreto no centro da borda superior do painel do widget.
      const addLocalMarker = setInterval(() => {
        const root = document.querySelector("#tiflux-widget-root");
        const panel = root?.shadowRoot?.querySelector("#tiflux-widget-app > div");
        if (!panel) return;
        clearInterval(addLocalMarker);
        if (panel.querySelector("[data-secullum-local-marker]")) return;
        const marker = document.createElement("span");
        marker.dataset.secullumLocalMarker = "true";
        marker.textContent = "✦";
        marker.title = "Widget pela integração local";
        marker.setAttribute("aria-label", "Widget pela integração local");
        marker.style.cssText = "position:absolute;top:2px;left:50%;transform:translateX(-50%);z-index:10;color:#64748b;font:12px/14px Arial,sans-serif;opacity:.65;pointer-events:none;";
        panel.appendChild(marker);
      }, 100);
      state.initialized = true;
    } catch (error) {
      // O catch impede rejeição não tratada e deixa o próximo carregamento livre para tentar de novo.
      layoutStyle?.remove();
      delete window.__SecullumWidget;
      console.error("[SecullumWidget]", error.message);
    }
  };

  // Só inicia quando o DOM está disponível, inclusive se o script carregar após esse evento.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initialize(), { once: true });
  } else {
    initialize();
  }
})();
