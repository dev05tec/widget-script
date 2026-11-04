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
  window.__SecullumCommentBodies ||= new Set();
  window.__SecullumIsCommentPreview = (conversation) => {
    if (conversation?.last_message_type === "comment" || conversation?.last_message?.type === "comment") return true;
    const lastMessage = conversation?.last_message;
    if (window.__SecullumCommentBodies.has(lastMessage)) return true;
    if (typeof lastMessage === "string") {
      try {
        const parsed = JSON.parse(lastMessage);
        return parsed?.type === "comment" || window.__SecullumCommentBodies.has(parsed?.body);
      } catch {}
    }
    return false;
  };
  window.__SecullumWidget = state;
  const TIFLUX_SCRIPT_URL = "https://public-assets.tiflux.com/widget/tiflux-widget.iife.js";
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

  // Baixa a distribuição oficial, aplica os filtros e ações locais e executa.
  // Retorna uma Promise resolvida somente quando a API pública está disponível.
  const loadTifluxWidget = () => {
    const installed = document.querySelector(`script[src="${TIFLUX_SCRIPT_URL}"]`);
    if (window.TifluxWidget?.init || installed) {
      return Promise.reject(new Error("O widget oficial já foi carregado. Remova a tag duplicada e recarregue a página."));
    }
    const loadVanillaWidget = (reason) => {
      console.warn("[SecullumWidget] As personalizações locais falharam; carregando o widget vanilla do Tiflux.", reason);
      return new Promise((resolve, reject) => {
        const loader = document.createElement("script");
        loader.src = TIFLUX_SCRIPT_URL;
        loader.async = true;
        loader.dataset.secullumVanilla = "true";
        const finish = (error) => {
          clearTimeout(timeout);
          loader.removeEventListener("load", onLoad);
          loader.removeEventListener("error", onError);
          if (error) {
            loader.remove();
            reject(error);
          } else if (window.TifluxWidget?.init) {
            resolve();
          } else {
            loader.remove();
            reject(new Error("O script vanilla do Tiflux não inicializou o widget."));
          }
        };
        const onLoad = () => finish();
        const onError = () => finish(new Error("Não foi possível carregar o script vanilla do Tiflux."));
        const timeout = setTimeout(() => finish(new Error("O carregamento vanilla do widget excedeu 30 segundos.")), 30000);
        loader.addEventListener("load", onLoad, { once: true });
        loader.addEventListener("error", onError, { once: true });
        document.head.appendChild(loader);
      });
    };
    return (async () => {
      let response;
      try {
        response = await fetch(TIFLUX_SCRIPT_URL, {
          mode: "cors",
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
        if (!response.ok) throw new Error(`Falha ao baixar o widget do Tiflux (${response.status}).`);
      } catch (error) {
        return loadVanillaWidget(error);
      }

      let source;
      try {
        source = await response.text();
      } catch (error) {
        return loadVanillaWidget(error);
      }
      // Confere os anchors; se a distribuição mudar, o loader usa o script vanilla.
      const injectOnce = (input, anchor, injected) => {
        const index = input.indexOf(anchor);
        if (index < 0 || input.indexOf(anchor, index + anchor.length) >= 0) {
          throw new Error("A distribuição do widget mudou; as personalizações locais precisam ser revisadas.");
        }
        return input.slice(0, index) + injected + input.slice(index + anchor.length);
      };
      try {
      source = injectOnce(
        source,
        'Le=({messages:e,loading:t=!1,loadingMore:n=!1,hasMoreMessages:r=!1,isTyping:i=!1,primaryColor:o,onLoadMore:a,onSelectOption:s,onRetryMessage:l,footer:c,optionsLocked:u=!1})=>{const',
        'Le=({messages:e,loading:t=!1,loadingMore:n=!1,hasMoreMessages:r=!1,isTyping:i=!1,primaryColor:o,onLoadMore:a,onSelectOption:s,onRetryMessage:l,footer:c,optionsLocked:u=!1,onSendMessage:z})=>{e=e.filter(e=>{if("comment"!==e.type)return!0;"string"==typeof e.body&&window.__SecullumCommentBodies.add(e.body);return!1});e=e.flatMap(e=>{if(!e.out&&"string"==typeof e.body){const t=e.body.indexOf("Olá, a assistente virtual me orientou a enviar esta mensagem para detalhar " + "o caso.");if(t>=0){const n=e.body.slice(0,t),r={...e,type:"secullum-agent-copy",body:e.body.slice(t),id:(e.id||e._id||"secullum-agent-copy")+"-copy"};return n.trim()?[{...e,body:n},r]:[r]}}return[e]});const',
      );
      source = injectOnce(
        source,
        'e.map((e,t)=>(0,w.jsx)(Se,{message:e,primaryColor:o,onSelectOption:s,onRetry:l,optionsEnabled:t===v}',
        'e.map((e,t)=>(0,w.jsx)(Se,{message:e,primaryColor:o,onSelectOption:s,onRetry:l,onSendToAgent:z,optionsEnabled:t===v}',
      );
      source = injectOnce(
        source,
        'Se=({message:e,primaryColor:t,onSelectOption:n,onRetry:r,optionsEnabled:i=!0})=>{const{t:o}=S(),',
        'Se=({message:e,primaryColor:t,onSelectOption:n,onRetry:r,onSendToAgent:__secullumSend,optionsEnabled:i=!0})=>{if("secullum-agent-copy"===e.type){const __secullumText=e.body,__secullumButtonStyle={padding:"7px 10px",border:"1px solid #d1d5db",borderRadius:"6px",background:"white",color:"#293239",fontSize:"13px",fontWeight:500,fontFamily:"Be Vietnam Pro, sans-serif",lineHeight:"18px",cursor:"pointer"},__secullumSendButtonStyle={...__secullumButtonStyle,background:t,color:"white",borderColor:t};return(0,w.jsxs)("div",{style:{display:"flex",justifyContent:"flex-start",marginBottom:"12px"},children:[(0,w.jsx)("div",{style:{maxWidth:"75%",border:"1px dashed #cbd5e1",borderRadius:8,borderTopLeftRadius:2,padding:"12px",backgroundColor:"#f8fafc",color:"#293239",fontSize:"14px",lineHeight:"20px",whiteSpace:"pre-wrap",wordBreak:"break-word"},children:[(0,w.jsx)("div",{style:{fontSize:"12px",fontWeight:600,color:"#475569",marginBottom:"6px"},children:"Mensagem para enviar"}),(0,w.jsx)("div",{children:__secullumText}),(0,w.jsxs)("div",{style:{display:"flex",gap:"8px",marginTop:"10px",flexWrap:"wrap"},children:[(0,w.jsx)("button",{type:"button",style:__secullumButtonStyle,onClick:async e=>{const button=e.currentTarget;try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(__secullumText);else{const area=document.createElement("textarea");area.value=__secullumText;area.style.position="fixed";area.style.opacity="0";document.body.appendChild(area);area.select();try{if(!document.execCommand("copy"))throw Error("Clipboard indisponível")}finally{area.remove()}}button.textContent="Copiado";setTimeout(()=>{button.textContent="Copiar texto"},1500)}catch(error){console.error("[SecullumWidget] Falha ao copiar mensagem",error)}},children:"Copiar texto"}),(0,w.jsx)("button",{type:"button",style:__secullumSendButtonStyle,onClick:async e=>{const button=e.currentTarget;button.disabled=!0;button.textContent="Enviando...";try{if(typeof __secullumSend!=="function")throw Error("Envio indisponível");await __secullumSend({message:__secullumText});button.textContent="Enviado"}catch(error){console.error("[SecullumWidget] Falha ao enviar mensagem",error);button.disabled=!1;button.textContent="Enviar para atendente"}},children:"Enviar para atendente"})]})]})]})}const{t:o}=S(),',
      );
      source = injectOnce(
        source,
        'Le,{messages:Ze,loading:a,loadingMore:s,hasMoreMessages:l,onLoadMore:c,isTyping:d,primaryColor:n.primary_color,onRetryMessage:v,onSelectOption:',
        'Le,{messages:Ze,loading:a,loadingMore:s,hasMoreMessages:l,onLoadMore:c,isTyping:d,primaryColor:n.primary_color,onRetryMessage:v,onSendMessage:b,onSelectOption:',
      );
      source = injectOnce(
        source,
        '}(e.last_message||""));return',
        '}((window.__SecullumIsCommentPreview(e)?"":e.last_message)||""));return',
      );
      } catch (error) {
        return loadVanillaWidget(error);
      }

      return new Promise((resolve, reject) => {
        const loader = document.createElement("script");
        const objectUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        loader.src = objectUrl;
        loader.async = true;
        loader.dataset.secullumInjected = "true";
        const timeout = setTimeout(() => finish(new Error("O carregamento do widget excedeu 30 segundos.")), 30000);
        const finish = (error) => {
          clearTimeout(timeout);
          loader.removeEventListener("load", onLoad);
          loader.removeEventListener("error", onError);
          URL.revokeObjectURL(objectUrl);
          if (error) {
            loader.remove();
            reject(error);
          } else if (window.TifluxWidget?.init) {
            resolve();
          } else {
            loader.remove();
            reject(new Error("O script do Tiflux não inicializou o widget."));
          }
        };
        const onLoad = () => finish();
        const onError = () => finish(new Error("Não foi possível executar o widget injetado."));
        loader.addEventListener("load", onLoad, { once: true });
        loader.addEventListener("error", onError, { once: true });
        document.head.appendChild(loader);
      }).catch((error) => loadVanillaWidget(error));
    })();
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
