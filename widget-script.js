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
  // CONFIGURAÇÃO: troque para false para desativar TODAS as personalizações (injeções no bundle,
  // botão/balão estilizados, animações, layout expandido) e carregar o widget oficial sem alterações.
  // Também dá para desativar por página com data-extensions="false" na tag do script.
  const ENABLE_EXTENSIONS = options.extensions !== undefined ? options.extensions !== "false" : true;
  const state = { initialized: false };
  // A fila acompanha mensagens renderizadas, inclusive as recebidas por eventos.
  // Só o clique arma a fila; mensagens já presentes nesse momento são histórico.
  const agentQueues = new Map();
  const AGENT_REPLY_DELAY_MS = 2000;
  const messageKey = (message) => String(message.id || message._id || `${message.created_at}|${message.body}`);
  const queueKey = (message) => `${message.chat_id || "current"}|${messageKey(message)}`;
  const sentStorageKey = (message) => `@SecullumWidget:Sent:${options.token || window.TifluxWidgetConfig?.token || DEFAULT_WIDGET_CONFIG.token}:${queueKey(message)}`;
  const wasSent = (message) => {
    if (agentQueues.get(queueKey(message))?.status === "sent") return true;
    try { return window.localStorage.getItem(sentStorageKey(message)) === "sent"; } catch { return false; }
  };
  window.__SecullumAgentStatus = (message) => wasSent(message) ? "sent" : agentQueues.get(queueKey(message))?.status || "idle";
  window.__SecullumQueueAgentMessage = (message) => {
    const queue = agentQueues.get(queueKey(message));
    if (!queue || queue.status !== "idle" || wasSent(message)) return;
    queue.seen = new Set(queue.messages.map(messageKey));
    queue.since = Math.max(Date.parse(message.created_at) || 0, ...queue.messages.map((item) => Date.parse(item.created_at) || 0));
    queue.status = "waiting";
    queue.refresh?.();
  };
  window.__SecullumObserveAgentMessages = (messages, send, refresh) => {
    for (const copy of messages.filter((message) => message.type === "secullum-agent-copy")) {
      const key = queueKey(copy);
      let queue = agentQueues.get(key);
      if (!queue) {
        queue = { status: wasSent(copy) ? "sent" : "idle", seen: new Set(messages.map(messageKey)) };
        agentQueues.set(key, queue);
      }
      queue.messages = messages;
      queue.refresh = refresh;
      const arrived = messages.filter((message) => !queue.seen.has(messageKey(message)));
      messages.forEach((message) => queue.seen.add(messageKey(message)));
      const agentArrived = arrived.some((message) => {
        const name = typeof message.name === "string" ? message.name.trim() : "";
        return !message.out && message.type !== "comment" && message.type !== "secullum-agent-copy"
          && message.ia_ai !== true && name && name.toLocaleLowerCase("pt-BR") !== "assistente virtual"
          && (!copy.chat_id || !message.chat_id || copy.chat_id === message.chat_id)
          && Date.parse(message.created_at) >= queue.since;
      });
      if (queue.status !== "waiting" || wasSent(copy) || !agentArrived || typeof send !== "function") continue;
      queue.status = "scheduled";
      refresh();
      setTimeout(() => {
        if (queue.status !== "scheduled" || wasSent(copy)) {
          if (wasSent(copy)) queue.status = "sent";
          queue.refresh?.();
          return;
        }
        queue.status = "sending";
        queue.refresh?.();
        Promise.resolve().then(() => send({ message: copy.body })).then(() => {
          queue.status = "sent";
          try { window.localStorage.setItem(sentStorageKey(copy), "sent"); } catch (error) {
            console.error("[SecullumWidget] Não foi possível persistir a trava de reenvio", error);
          }
        }, (error) => {
          queue.status = "error";
          console.error("[SecullumWidget] Falha ao enviar mensagem para atendente", error);
        }).finally(() => queue.refresh?.());
      }, AGENT_REPLY_DELAY_MS);
    }
  };
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
      if (ENABLE_EXTENSIONS) console.warn("[SecullumWidget] As personalizações locais falharam; carregando o widget vanilla do Tiflux.", reason);
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
    if (!ENABLE_EXTENSIONS) return loadVanillaWidget("extensões desativadas por configuração");
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
        'Le=({messages:e,loading:t=!1,loadingMore:n=!1,hasMoreMessages:r=!1,isTyping:i=!1,primaryColor:o,onLoadMore:a,onSelectOption:s,onRetryMessage:l,footer:c,optionsLocked:u=!1,onSendMessage:z})=>{e=e.filter(e=>{if("comment"!==e.type)return!0;"string"==typeof e.body&&window.__SecullumCommentBodies.add(e.body);return!1});e=e.flatMap(e=>{if(!e.out&&"string"==typeof e.body){const t=e.body.indexOf("Olá, a assistente virtual me orientou a enviar esta mensagem para detalhar " + "o caso.");if(t>=0){const n=e.body.slice(0,t),r={...e,type:"secullum-agent-copy",body:e.body.slice(t),id:(e.id||e._id||"secullum-agent-copy")+"-copy"};return n.trim()?[{...e,body:n},r]:[r]}}return[e]});const[__secullumRevision,__secullumRefresh]=(0,x.useState)(0);(0,x.useEffect)(()=>{window.__SecullumObserveAgentMessages(e,z,()=>__secullumRefresh(e=>e+1))},[e,z]);const',
      );
      source = injectOnce(
        source,
        'e.map((e,t)=>(0,w.jsx)(Se,{message:e,primaryColor:o,onSelectOption:s,onRetry:l,optionsEnabled:t===v}',
        'e.map((e,t)=>(0,w.jsx)(Se,{message:e,primaryColor:o,onSelectOption:s,onRetry:l,onSendToAgent:z,optionsEnabled:t===v}',
      );
      source = injectOnce(
        source,
        'var Se=({message:e,primaryColor:t,onSelectOption:n,onRetry:r,optionsEnabled:i=!0})=>{const{t:o}=S(),',
        'const __secullumMarkdown=(value,color="#2563eb",background="#f1f1f1",embedLinks=!1)=>{const escapeHtml=(text)=>String(text).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\\x27/g,"&#39;"),renderInline=(text)=>{let rendered=escapeHtml(text).replace(/\\*\\*(.+?)\\*\\*/g,"<strong>$1</strong>").replace(/__(.+?)__/g,"<strong>$1</strong>").replace(/\\*(.+?)\\*/g,"<em>$1</em>").replace(/_(.+?)_/g,"<em>$1</em>");if(embedLinks){rendered=rendered.replace(/https?:\\/\\/[^\\s<]+/g,(url)=>`<span style="display:block;margin:5px 0;overflow:hidden"><style>@media (prefers-reduced-motion:no-preference){.secullum-link-card summary,.secullum-link-card a,.secullum-link-card span[data-link-toggle]{transition:color .42s ease,background-color .42s ease,border-color .42s ease}.secullum-link-card .secullum-link-preview{display:grid;grid-template-rows:0fr;width:0;opacity:0;transform:translateY(-6px);transition:grid-template-rows .8s cubic-bezier(.22,.61,.36,1),width .8s cubic-bezier(.22,.61,.36,1),opacity .55s ease,transform .8s cubic-bezier(.22,.61,.36,1)}.secullum-link-card .secullum-link-preview-inner{overflow:hidden}.secullum-link-card[open] .secullum-link-preview{grid-template-rows:1fr;width:min(560px,60vw);opacity:1;transform:translateY(0)}.secullum-link-card summary:focus-visible{outline:2px solid #2563eb;outline-offset:3px;border-radius:4px}}@media (prefers-reduced-motion:reduce){.secullum-link-card .secullum-link-preview{display:block;width:min(560px,60vw);opacity:1;transform:none}.secullum-link-card .secullum-link-preview-inner{overflow:visible}}</style><details class="secullum-link-card" style="display:inline-block;width:fit-content;max-width:100%;margin:0;border:1px solid #e5e7eb;border-radius:6px;padding:6px 8px" ontoggle="const b=this.querySelector(\\x27[data-link-toggle]\\x27);if(b)b.textContent=this.open?\\x27Ocultar\\x27:\\x27Visualizar\\x27;const p=this.querySelector(\\x27.secullum-link-preview\\x27);if(p)p.setAttribute(\\x27aria-hidden\\x27,String(!this.open))"><summary aria-label="Opções para visualizar o link" style="display:flex;align-items:center;gap:8px;list-style:none;cursor:pointer;flex-wrap:nowrap"><a href="${url}" target="_blank" rel="noopener noreferrer" aria-label="Abrir link ${url}" onclick="event.stopPropagation()" onmouseover="this.style.color=\\x27#1d4ed8\\x27" onmouseout="this.style.color=\\x27${color}\\x27" style="min-width:0;flex:1 1 auto;max-width:none;overflow-wrap:normal;word-break:normal;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${color};font-size:13px;font-weight:500;text-decoration:underline">${url}</a><span data-link-actions style="display:inline-flex;flex:0 0 auto;align-items:center;gap:6px;white-space:nowrap"><span data-link-toggle role="button" aria-label="Visualizar link incorporado" style="display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border:1px dotted #93c5fd;border-radius:5px;background:#f8fafc;color:${color};font-size:11px;font-weight:600;line-height:16px">Visualizar</span><a href="${url}" target="_blank" rel="noopener noreferrer" aria-label="Abrir link em nova aba" onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;padding:3px 7px;border:1px dotted #cbd5e1;border-radius:5px;background:#fff;color:${color};font-size:11px;font-weight:600;line-height:16px;text-decoration:none">Abrir</a></span></summary><div class="secullum-link-preview" aria-hidden="true"><div class="secullum-link-preview-inner"><iframe src="${url}" title="Visualização incorporada de ${url}" loading="lazy" allow="fullscreen" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation" style="display:block;width:100%;height:320px;margin-top:8px;border:1px solid #e5e7eb;border-radius:6px;background:white"></iframe></div></div></details></span>`)}return rendered};return String(value??"").split(/\\r?\\n/).map((line)=>{const heading=line.match(/^(#{1,6})\\s+(.+)$/);if(heading){const level=heading[1].length;const sizes={1:"20px",2:"18px",3:"16px",4:"15px",5:"14px",6:"14px"};return `<h${level} style="margin:6px 0 2px;font-size:${sizes[level]};font-weight:700;line-height:1.15;color:${color}">${renderInline(heading[2])}</h${level}>`}const checklist=line.match(/^\\s*[-*]\\s+\\[([ xX])\\]\\s+(.+)$/);if(checklist){const isChecked="x"===checklist[1].toLowerCase(),checked=isChecked?"true":"false",textStyle=isChecked?"opacity:.65":"";return `<label style="display:flex;align-items:flex-start;gap:7px;margin:2px 0;cursor:pointer;line-height:18px"><div role="checkbox" tabindex="0" aria-checked="${checked}" onclick="this.classList.toggle(\\x27checked\\x27);this.setAttribute(\\x27aria-checked\\x27,this.classList.contains(\\x27checked\\x27));this.textContent=this.classList.contains(\\x27checked\\x27)?\\x27✓\\x27:\\x27\\x27;this.style.backgroundColor=this.classList.contains(\\x27checked\\x27)?\\x27${color}\\x27:\\x27${background}\\x27;this.nextElementSibling.style.opacity=this.classList.contains(\\x27checked\\x27)?\\x27.65\\x27:\\x271\\x27" onkeydown="if(event.key===\\x27Enter\\x27||event.key===\\x27 \\x27){event.preventDefault();this.click()}" style="display:flex;align-items:center;justify-content:center;width:16px;height:16px;flex:0 0 auto;margin:1px 0 0;border:1px solid ${color};border-radius:4px;background:${isChecked?color:background};color:white;font-size:11px;font-weight:700;line-height:1;cursor:pointer;user-select:none">${isChecked?"✓":""}</div><span style="${textStyle}">${renderInline(checklist[2])}</span></label>`}return renderInline(line)}).join("<br>")};var Se=({message:e,primaryColor:t,onSelectOption:n,onRetry:r,optionsEnabled:i=!0})=>{const{t:o}=S(),',
      );
      source = injectOnce(
        source,
        'Se=({message:e,primaryColor:t,onSelectOption:n,onRetry:r,optionsEnabled:i=!0})=>{const{t:o}=S(),',
        'Se=({message:e,primaryColor:t,onSelectOption:n,onRetry:r,onSendToAgent:__secullumSend,optionsEnabled:i=!0})=>{if("secullum-agent-copy"===e.type){const __secullumText=e.body,__secullumButtonStyle={padding:"7px 10px",border:"1px solid #d1d5db",borderRadius:"6px",background:"white",color:"#293239",fontSize:"13px",fontWeight:500,fontFamily:"Be Vietnam Pro, sans-serif",lineHeight:"18px",cursor:"pointer"},__secullumSendButtonStyle={...__secullumButtonStyle,background:t,color:"white",borderColor:t};return(0,w.jsxs)("div",{style:{display:"flex",justifyContent:"flex-start",marginBottom:"12px"},children:[(0,w.jsx)("div",{style:{maxWidth:"75%",border:"1px dashed #cbd5e1",borderRadius:8,borderTopLeftRadius:2,padding:"12px",backgroundColor:"#f8fafc",color:"#293239",fontSize:"14px",lineHeight:"20px",whiteSpace:"pre-wrap",wordBreak:"break-word"},children:[(0,w.jsx)("div",{style:{fontSize:"12px",fontWeight:600,color:"#475569",marginBottom:"6px"},children:"Mensagem para enviar"}),(0,w.jsx)("div",{children:__secullumText}),(0,w.jsxs)("div",{style:{display:"flex",gap:"8px",marginTop:"10px",flexWrap:"wrap"},children:[(0,w.jsx)("button",{type:"button",style:__secullumButtonStyle,onClick:async e=>{const button=e.currentTarget;try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(__secullumText);else{const area=document.createElement("textarea");area.value=__secullumText;area.style.position="fixed";area.style.opacity="0";document.body.appendChild(area);area.select();try{if(!document.execCommand("copy"))throw Error("Clipboard indisponível")}finally{area.remove()}}button.textContent="Copiado";setTimeout(()=>{button.textContent="Copiar texto"},1500)}catch(error){console.error("[SecullumWidget] Falha ao copiar mensagem",error)}},children:"Copiar texto"}),"idle"===window.__SecullumAgentStatus(e)?(0,w.jsx)("button",{type:"button",style:__secullumSendButtonStyle,onClick:()=>window.__SecullumQueueAgentMessage(e),children:"Enviar para atendente"}):"waiting"===window.__SecullumAgentStatus(e)?(0,w.jsxs)("div",{role:"status","aria-live":"polite",style:{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",gap:"8px",flexBasis:"100%",boxSizing:"border-box",padding:"12px",border:"1px solid #bfdbfe",borderRadius:"8px",background:"#eff6ff",color:"#1e40af",whiteSpace:"normal"},children:[(0,w.jsx)("svg",{width:20,height:20,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:1.7,strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":true,style:{flexShrink:0,marginTop:"1px"},children:[(0,w.jsx)("circle",{cx:12,cy:12,r:9}),(0,w.jsx)("path",{d:"M12 7v5l3 2"})]}),(0,w.jsxs)("div",{style:{minWidth:0},children:[(0,w.jsx)("div",{style:{fontSize:"13px",fontWeight:600,lineHeight:"20px"},children:"Aguardando atendente"}),(0,w.jsx)("div",{style:{fontSize:"12px",fontWeight:400,lineHeight:"18px",marginTop:"2px",color:"#475569"},children:"Sua mensagem será enviada automaticamente assim que um atendente responder."})]})]}):(0,w.jsx)("span",{role:"status",style:{fontSize:"12px",color:"#475569"},children:({scheduled:"Atendente respondeu. Enviando em instantes...",waiting:"Será enviada quando o chat for assumido",sending:"Enviando...",sent:"Enviado",error:"Falha ao enviar. Copie o texto para enviar manualmente."})[window.__SecullumAgentStatus(e)]})]})]})]})}const{t:o}=S(),',
      );
      source = injectOnce(
        source,
        'dangerouslySetInnerHTML:{__html:we("string"==typeof e.body?e.body:JSON.stringify(e.body),a?l:"#2563eb")}',
        'dangerouslySetInnerHTML:{__html:__secullumMarkdown("string"==typeof e.body?e.body:JSON.stringify(e.body),t,a?t:"#f1f1f1",!a&&"comment"!==e.type&&"secullum-agent-copy"!==e.type)}',
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
          widgetPage.style.setProperty("border-radius", mobile ? "0" : "12px", "important");
          widgetPage.style.setProperty("border", "none", "important");
          widgetPage.style.setProperty("box-sizing", "border-box", "important");
          widgetPage.style.setProperty("box-shadow", mobile ? "none" : "0 8px 32px 8px rgba(52, 110, 188, 0.08)", "important");

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

  // Destaca o launcher quando o widget está fechado, mantendo o clique no botão original.
  const initializeFloatingLauncher = () => {
    const startedAt = Date.now();
    const waitForWidget = setInterval(() => {
      const root = document.querySelector("#tiflux-widget-root");
      const shadow = root?.shadowRoot;
      const button = shadow?.querySelector("#tiflux-widget-app > button");

      if (!button) {
        if (Date.now() - startedAt >= 30000) clearInterval(waitForWidget);
        return;
      }

      clearInterval(waitForWidget);
      if (!shadow.querySelector("[data-secullum-launcher-style]")) {
        const style = document.createElement("style");
        style.dataset.secullumLauncherStyle = "true";
        style.textContent = `
          @keyframes secullum-launcher-pop {
            0% { opacity: 0; scale: .3; rotate: -25deg; }
            60% { opacity: 1; scale: 1.12; rotate: 4deg; }
            100% { opacity: 1; scale: 1; rotate: 0deg; }
          }
          @keyframes secullum-launcher-ring {
            0% { transform: scale(1); opacity: .4; }
            35%, 100% { transform: scale(1.6); opacity: 0; }
          }
          @keyframes secullum-icon-in {
            from { opacity: 0; transform: scale(.4) rotate(-90deg); }
            to { opacity: 1; transform: scale(1) rotate(0); }
          }
          @keyframes secullum-label-in {
            from { opacity: 0; translate: 14px 0; scale: .92; }
            to { opacity: 1; translate: 0 0; scale: 1; }
          }
          @keyframes secullum-panel-in {
            from { opacity: 0; translate: 0 18px; scale: .94; }
            to { opacity: 1; translate: 0 0; scale: 1; }
          }

          #tiflux-widget-app > button[data-secullum-launcher] {
            background: linear-gradient(145deg, #60a5fa 0%, #2563eb 55%, #1e40af 100%) !important;
            border: 1px solid rgba(255,255,255,.85) !important;
            box-shadow:
              0 10px 28px rgba(37,99,235,.38),
              0 3px 8px rgba(30,64,175,.25),
              inset 0 1px 1px rgba(255,255,255,.45) !important;
            transform: none !important;
            transition: transform .7s cubic-bezier(.34,1.4,.64,1), box-shadow .5s ease, filter .5s ease !important;
            animation: secullum-launcher-pop 1.1s cubic-bezier(.34,1.56,.64,1) backwards !important;
            -webkit-tap-highlight-color: transparent;
            isolation: isolate;
          }
          #tiflux-widget-app > button[data-secullum-launcher]::before {
            content: "";
            position: absolute;
            inset: 0;
            border-radius: 50%;
            background: rgba(59,130,246,.55);
            z-index: -1;
            pointer-events: none;
            animation: secullum-launcher-ring 9s ease-out 3s infinite;
          }
          #tiflux-widget-app > button[data-secullum-launcher]:hover {
            transform: scale(1.1) !important;
            filter: brightness(1.06) saturate(1.1);
            box-shadow:
              0 14px 34px rgba(37,99,235,.5),
              0 0 0 6px rgba(96,165,250,.22),
              inset 0 1px 1px rgba(255,255,255,.5) !important;
          }
          #tiflux-widget-app > button[data-secullum-launcher]:active {
            transform: scale(.93) !important;
            transition-duration: .25s !important;
          }
          #tiflux-widget-app > button[data-secullum-launcher]:focus-visible {
            outline: 3px solid rgba(147,197,253,.9) !important;
            outline-offset: 3px;
          }
          #tiflux-widget-app > button[data-secullum-launcher] > svg {
            animation: secullum-icon-in .7s cubic-bezier(.34,1.56,.64,1) backwards;
            filter: drop-shadow(0 1px 2px rgba(15,23,42,.25));
            transition: transform .6s cubic-bezier(.34,1.4,.64,1);
          }
          #tiflux-widget-app > button[data-secullum-launcher]:hover > svg {
            transform: scale(1.08) rotate(-6deg);
          }
          #tiflux-widget-app > button[data-secullum-launcher][data-secullum-open="true"] {
            animation: none !important;
          }
          #tiflux-widget-app > button[data-secullum-launcher][data-secullum-open="true"]::before {
            animation: none !important;
            opacity: 0;
          }

          #tiflux-widget-app > div {
            animation: secullum-panel-in .7s cubic-bezier(.22,1,.36,1) backwards;
            transform-origin: bottom right;
            border-radius: 16px;
            box-shadow: 0 18px 48px rgba(37,99,235,.18), 0 4px 14px rgba(15,23,42,.1);
          }

          [data-secullum-launcher-label] {
            animation: secullum-label-in .9s cubic-bezier(.22,1,.36,1) 1.4s backwards;
          }
          [data-secullum-launcher-label]::after {
            content: "";
            position: absolute;
            right: -5px;
            top: 50%;
            width: 10px;
            height: 10px;
            margin-top: -5px;
            background: #f8fbff;
            border-top: 1px solid rgba(37,99,235,.12);
            border-right: 1px solid rgba(37,99,235,.12);
            transform: rotate(45deg);
            border-radius: 0 3px 0 0;
          }
          [data-secullum-launcher-label]:hover {
            transform: translate(-3px,50%) scale(1.03) !important;
            box-shadow: 0 10px 24px rgba(37,99,235,.22) !important;
          }
          #tiflux-widget-app:has(+ [data-secullum-launcher-label]:hover) > button {
            transform: scale(1.05) !important;
          }
          [data-secullum-launcher-label] [data-secullum-launcher-close] {
            opacity: 0 !important;
            pointer-events: none !important;
            transform: scale(.8);
            transition: opacity .3s ease, transform .35s ease, background-color .3s ease;
          }
          [data-secullum-launcher-label]:hover [data-secullum-launcher-close],
          [data-secullum-launcher-close]:focus-visible {
            opacity: 1 !important;
            pointer-events: auto !important;
            transform: scale(1);
          }
          [data-secullum-launcher-close]:hover {
            background: #1d4ed8 !important;
            color: #ffffff !important;
          }

          #tiflux-widget-app > div button:not([data-secullum-launcher-close]),
          #tiflux-widget-app > div [role="button"],
          #tiflux-widget-app > div a {
            transition: filter .35s ease, scale .4s cubic-bezier(.34,1.4,.64,1), background-color .35s ease, border-color .35s ease, box-shadow .35s ease, opacity .35s ease;
          }
          #tiflux-widget-app > div button:not(:disabled):hover,
          #tiflux-widget-app > div [role="button"]:hover {
            filter: brightness(.96);
            scale: 1.03;
          }
          #tiflux-widget-app > div button:not(:disabled):active,
          #tiflux-widget-app > div [role="button"]:active {
            scale: .96;
          }
          #tiflux-widget-app > div input,
          #tiflux-widget-app > div textarea,
          #tiflux-widget-app > div [contenteditable] {
            transition: border-color .35s ease, box-shadow .35s ease, background-color .35s ease;
          }
          #tiflux-widget-app > div input:focus,
          #tiflux-widget-app > div textarea:focus,
          #tiflux-widget-app > div [contenteditable]:focus {
            box-shadow: 0 0 0 3px rgba(59,130,246,.2);
          }

          @media (prefers-reduced-motion: reduce) {
            #tiflux-widget-app *, [data-secullum-launcher-label],
            #tiflux-widget-app > button[data-secullum-launcher]::before {
              animation: none !important;
              transition-duration: .01ms !important;
            }
          }
        `;
        shadow.appendChild(style);
      }
      let observer;
      const syncLauncher = () => {
        observer?.disconnect();
        const currentButton = shadow.querySelector("#tiflux-widget-app > button");
        if (!currentButton) return;
        const isOpen = /fechar|close/i.test(currentButton.getAttribute("aria-label") || "");

        currentButton.dataset.secullumLauncher = "true";
        currentButton.title = isOpen ? "Recolher atendimento" : "Clique para falar com a nossa equipe";
        currentButton.style.setProperty("width", "60px", "important");
        currentButton.style.setProperty("height", "60px", "important");
        currentButton.style.setProperty("border-radius", "50%", "important");
        currentButton.dataset.secullumOpen = String(isOpen);
        currentButton.style.setProperty("overflow", "visible", "important");
        currentButton.style.setProperty("z-index", "2", "important");
        currentButton.querySelectorAll("svg, svg *").forEach((icon) => {
          icon.style.setProperty("color", "#ffffff", "important");
          icon.style.setProperty("stroke", "#ffffff", "important");
        });

        let label = shadow.querySelector("[data-secullum-launcher-label]");
        if (!label) {
          label = document.createElement("span");
          label.dataset.secullumLauncherLabel = "true";
          label.setAttribute("aria-hidden", "true");
          label.addEventListener("click", (event) => event.stopPropagation());
          shadow.appendChild(label);
        }
        let message = label.querySelector("[data-secullum-launcher-message]");
        if (!message) {
          label.textContent = "";
          const content = document.createElement("span");
          content.dataset.secullumLauncherContent = "true";
          content.style.cssText = "position:relative;display:inline-flex;align-items:center;";
          message = document.createElement("span");
          message.dataset.secullumLauncherMessage = "true";
          message.textContent = "Fale com a gente!";
          content.appendChild(message);

          const close = document.createElement("button");
          close.type = "button";
          close.dataset.secullumLauncherClose = "true";
          close.setAttribute("aria-label", "Fechar mensagem");
          close.textContent = "×";
          close.style.cssText = [
            "display:inline-flex",
            "align-items:center",
            "justify-content:center",
            "width:20px",
            "height:20px",
            "position:absolute",
            "left:-22px",
            "top:-15px",
            "margin:0",
            "padding:0",
            "border:1px solid rgba(255,255,255,.9)",
            "border-radius:50%",
            "background:#2563eb",
            "color:#ffffff",
            "font:400 17px/18px Arial,sans-serif",
            "cursor:pointer",
            "user-select:none",
            "pointer-events:none",
            "opacity:0",
            "transform:scale(.8)",
            "z-index:3",
            "box-shadow:0 2px 6px rgba(15,23,42,.14)",
            "transition:opacity .3s ease, transform .35s ease, background-color .3s ease",
          ].join(";");
          close.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            label.dataset.secullumDismissed = "true";
            label.style.setProperty("opacity", "0", "important");
            label.style.setProperty("visibility", "hidden", "important");
          });
          content.appendChild(close);
          label.appendChild(content);
        }
        const dismissed = label.dataset.secullumDismissed === "true";
        label.style.cssText = [
          "position:fixed",
          "left:auto",
          "top:auto",
          "max-width:calc(100vw - 110px)",
          `transform:translate(${isOpen ? "4px" : "0"},50%)`,
          "transition:opacity .6s cubic-bezier(.22,.61,.36,1), transform .6s cubic-bezier(.22,1,.36,1), box-shadow .45s ease, visibility .6s ease",
          "padding:10px 16px",
          "border-radius:16px",
          "background:linear-gradient(180deg,#ffffff 0%,#f8fbff 100%)",
          "color:#1f2937",
          "font:500 13.5px/1 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif",
          "font-weight:500",
          "letter-spacing:.1px",
          "white-space:nowrap",
          "user-select:none",
          "display:inline-flex",
          "align-items:center",
          "border:1px solid rgba(37,99,235,.1)",
          "box-shadow:0 8px 22px rgba(37,99,235,.16), 0 2px 6px rgba(15,23,42,.08)",
          "pointer-events:auto",
          "z-index:10000",
          "will-change:opacity,transform",
          `opacity:${isOpen || dismissed ? "0" : "1"}`,
          `visibility:${isOpen || dismissed ? "hidden" : "visible"}`,
        ].join(";");
        // Usa os valores de layout (right/bottom), que não mudam com transform/animação do botão.
        const placeLabel = () => {
          const btn = shadow.querySelector("#tiflux-widget-app > button") || currentButton;
          const cs = getComputedStyle(btn);
          const right = parseFloat(cs.right) || 24;
          const bottom = parseFloat(cs.bottom) || 24;
          const size = btn.offsetWidth || 60;
          label.style.setProperty("right", `${right + size + 12}px`, "important");
          label.style.setProperty("bottom", `${bottom + (btn.offsetHeight || size) / 2}px`, "important");
        };
        placeLabel();

        label.dataset.secullumOpen = String(isOpen);

        if (!label._secullumRotationTimer) {
          const messages = [
            "Precisa de ajuda?",
            "Tem alguma dúvida?",
            "Fale com a gente!",
            "Estamos aqui para ajudar!",
          ];
          let messageIndex = 0;
          label._secullumRotationTimer = setInterval(() => {
            placeLabel();
            if (!label.isConnected) {
              clearInterval(label._secullumRotationTimer);
              return;
            }
            if (/fechar|close/i.test(currentButton.getAttribute("aria-label") || "")) return;
            const fadeOut = message.animate([{ opacity: "1" }, { opacity: "0" }], {
              duration: 400,
              easing: "ease",
              fill: "forwards",
            });
            fadeOut.onfinish = () => {
              messageIndex = (messageIndex + 1) % messages.length;
              message.textContent = messages[messageIndex];
              message.animate([{ opacity: "0" }, { opacity: "1" }], {
                duration: 400,
                easing: "ease",
                fill: "forwards",
              });
            };
          }, 10000);
        }

        observer?.observe(shadow, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["style", "class", "aria-label"],
        });
      };

      observer = new MutationObserver((mutations) => {
        const currentLabel = shadow.querySelector("[data-secullum-launcher-label]");
        if (currentLabel && mutations.every(({ target }) => currentLabel === target || currentLabel.contains(target))) return;
        syncLauncher();
      });
      observer.observe(shadow, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "aria-label"],
      });
      syncLauncher();
    }, 100);
  };

  // Anima a entrada de qualquer elemento novo dentro do painel (mensagens, listas, cartoes).
  // Usa translate/scale individuais, que nao conflitam com o transform inline do bundle.
  const initializeEnterAnimations = () => {
    const startedAt = Date.now();
    const wait = setInterval(() => {
      const shadow = document.querySelector("#tiflux-widget-root")?.shadowRoot;
      const app = shadow?.querySelector("#tiflux-widget-app");
      if (!app) {
        if (Date.now() - startedAt >= 30000) clearInterval(wait);
        return;
      }
      clearInterval(wait);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      new MutationObserver((mutations) => {
        const fresh = [];
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1 || node.matches("style, [data-secullum-launcher-label]")) continue;
            if (node.closest("[data-secullum-launcher-label], #tiflux-widget-app > button")) continue;
            if (!node.closest("#tiflux-widget-app > div") || node.parentElement === app) continue;
            fresh.push(node);
          }
        }
        // So anima o no mais externo de cada insercao, evitando animar filhos junto do pai.
        fresh.filter((node) => !fresh.some((other) => other !== node && other.contains(node))).forEach((node, index) => {
          node.animate(
            [{ opacity: 0, translate: "0 10px", scale: ".98" }, { opacity: 1, translate: "0 0", scale: "1" }],
            { duration: 600, delay: Math.min(index, 6) * 70, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" },
          );
        });
      }).observe(app, { childList: true, subtree: true });
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
      if (ENABLE_EXTENSIONS && options.layout === "expanded") {
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
      if (ENABLE_EXTENSIONS) {
        if (options.layout === "expanded") initializeExpandedLayout(layoutStyle);
        initializeFloatingLauncher();
        initializeEnterAnimations();
      }
      // Coloca um símbolo discreto no centro da borda superior do painel do widget.
      const addLocalMarker = ENABLE_EXTENSIONS && setInterval(() => {
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
