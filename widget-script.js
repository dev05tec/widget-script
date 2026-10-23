(() => {
  if (window.__SecullumAudioWidget) return;
  const options = { ...(document.currentScript?.dataset || {}) };
  const state = { initialized: false };
  window.__SecullumAudioWidget = state;
  const TIFLUX_SCRIPT_URL = "https://public-assets.tiflux.com/widget/tiflux-widget.iife.js";
  // Padrão dos recursos de áudio e transcrição; data-audio="true"/"false" sobrescreve este valor.
  const DEFAULT_AUDIO_ENABLED = true;
  const DEFAULT_WIDGET_CONFIG = {
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

  const loadTifluxWidget = () => {
    if (window.TifluxWidget?.init) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let loader = document.querySelector(`script[src="${TIFLUX_SCRIPT_URL}"]`);
      const existing = Boolean(loader);
      if (!loader) {
        loader = document.createElement("script");
        loader.src = TIFLUX_SCRIPT_URL;
        loader.async = true;
      }
      const timeout = setTimeout(() => reject(new Error("O carregamento do widget excedeu 30 segundos.")), 30000);
      loader.addEventListener("load", () => {
        clearTimeout(timeout);
        if (window.TifluxWidget?.init) resolve();
        else reject(new Error("O script do Tiflux não inicializou o widget."));
      }, { once: true });
      loader.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("Não foi possível carregar o script do Tiflux."));
      }, { once: true });
      if (!existing) document.head.appendChild(loader);
    });
  };

  const initializeExpandedLayout = () => {
    const waitForWidget = setInterval(() => {
      const root = document.querySelector("#tiflux-widget-root");

      if (!root?.shadowRoot) return;

      clearInterval(waitForWidget);

      const getInternalButton = () =>
        root.shadowRoot.querySelector("#tiflux-widget-app > button");

      let observer;
      const syncWidget = () => {
        observer?.disconnect();
        const button = getInternalButton();
        const app = root.shadowRoot.querySelector("#tiflux-widget-app");
        const widgetPage = app?.querySelector(":scope > div");
        const mobile = window.matchMedia("(max-width: 600px)").matches;

        if (button) {
          if (button.style.visibility !== "hidden") {
            button.style.setProperty("visibility", "hidden", "important");
          }

          if (root.style.visibility !== "visible") {
            root.style.setProperty("visibility", "visible", "important");
          }
        }

        if (widgetPage) {
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

      window.addEventListener("resize", syncWidget);
      window.visualViewport?.addEventListener("resize", syncWidget);

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

  const initializeAudioFeatures = () => {
    window.SECULLUM_IA_API_BASE_URL = window.SECULLUM_IA_API_BASE_URL || "https://widgetserverless.vercel.app";
    const transcriptionApiBase = window.SECULLUM_IA_API_BASE_URL.replace(/\/$/, "");
    const transcriptionEndpoint = `${transcriptionApiBase}/api/transcribe`;
    const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
    const TRANSCRIPT_SEND_DELAY_MS = 2000;
    let recorder;
    let recordingStream;
    let recordedChunks = [];
    let recordedBytes = 0;
    let pendingAudio;
    const MIC_ICON = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"></rect><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"></path></svg>';
    const STOP_ICON = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"></rect></svg>';
    let widgetRoot;
    let widgetShadow;
    let widgetObserver;
    let sendCaptureShadow;
    let transcriptionRouteAvailable;
    let routeCheckStarted = false;
    const processedAudioTxtLinks = new WeakSet();
    const sentAudioUrls = new Map();
    const transcriptOutbox = new Map();
    const audioUploadHosts = new Set([
      "uploads-tiflux.s3.amazonaws.com",
      "uploads-tiflux.s3.sa-east-1.amazonaws.com",
    ]);
    const processedLegacyAudioMessages = new WeakSet();
    const hiddenTranscriptRows = new Map();
    const TRANSCRIPT_MESSAGE_PREFIX = "[TIFLUX-AUDIO-TRANSCRIPT V1]";

    const findEditor = () => widgetShadow?.querySelector('[contenteditable="true"]');
    const findStatus = () => widgetShadow?.querySelector("#tiflux-transcription-status");

    const disableAudioButton = () => {
      widgetShadow?.querySelector("#tiflux-record-audio")?.remove();
      setStatus("");
    };

    const setStatus = (message) => {
      const status = findStatus();
      if (status) {
        delete status.dataset.transcriptFile;
        status.textContent = message;
        status.hidden = !message;
      }
    };

    const setButtonState = (recording, busy = false) => {
      const button = widgetShadow?.querySelector("#tiflux-record-audio");
      if (!button) return;
      button.disabled = busy;
      button.innerHTML = busy ? "…" : recording ? STOP_ICON : MIC_ICON;
      button.title = busy ? "Processando áudio…" : recording ? "Parar gravação" : "Gravar áudio";
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", String(recording));
      button.style.background = "transparent";
      button.style.color = recording ? "#346ebc" : "#5d5d5d";
      const icon = button.querySelector("svg");
      if (icon && !busy) {
        icon.style.transition = "none";
        icon.style.opacity = "0";
        icon.style.transform = recording ? "scale(.45) rotate(-90deg)" : "scale(.65) rotate(90deg)";
        icon.getBoundingClientRect();
        requestAnimationFrame(() => {
          icon.style.transition = "transform 180ms ease, opacity 180ms ease";
          icon.style.opacity = "1";
          icon.style.transform = "scale(1) rotate(0)";
        });
      }
    };

    const blobToBase64 = (blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
      reader.onerror = () => reject(new Error("Não foi possível preparar o TXT do áudio."));
      reader.readAsDataURL(blob);
    });

    const showAudioPreview = (blob, text, hideEditor = true) => {
      const editor = findEditor();
      const editorContainer = editor?.parentElement;
      const composer = widgetShadow?.querySelector("#tiflux-record-audio")?.parentElement;
      if (!editor || !editorContainer || !composer) {
        throw new Error("Não encontrei a área de mensagem do widget.");
      }

      if (pendingAudio?.url) URL.revokeObjectURL(pendingAudio.url);
      widgetShadow.querySelector("#tiflux-audio-preview")?.remove();
      const url = URL.createObjectURL(blob);
      const preview = document.createElement("div");
      preview.id = "tiflux-audio-preview";
      Object.assign(preview.style, {
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 10px", width: "100%",
        boxSizing: "border-box", padding: "8px 10px", margin: "4px 0 8px",
        border: "1px solid #e1e1e1", borderRadius: "10px", background: "#fff",
      });

      const player = document.createElement("audio");
      player.controls = true;
      player.setAttribute("aria-label", "Prévia do áudio gravado");
      player.preload = "metadata";
      player.src = url;
      Object.assign(player.style, {
        display: "block", flex: "1 1 180px", width: "100%", minWidth: "0",
        maxWidth: "100%", height: "40px",
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "Excluir";
      deleteButton.setAttribute("aria-label", "Excluir áudio gravado");
      Object.assign(deleteButton.style, {
        flex: "0 0 auto", padding: "6px 8px", border: "0", borderRadius: "6px",
        background: "transparent", color: "#5d5d5d", font: "600 12px Arial, sans-serif",
        cursor: "pointer",
      });
      deleteButton.addEventListener("click", () => {
        if (pendingAudio?.file) {
          const filename = pendingAudio.file.name;
          const chip = [...widgetShadow.querySelectorAll("span")]
            .find((element) => element.textContent === filename && !preview.contains(element));
          const removeButton = chip?.parentElement?.parentElement?.querySelector("button");
          if (removeButton?.disabled) return;
          removeButton?.click();
          sentAudioUrls.delete(filename);
          transcriptOutbox.delete(filename);
        }
        if (pendingAudio?.url) URL.revokeObjectURL(pendingAudio.url);
        pendingAudio = undefined;
        preview.remove();
        editorContainer.hidden = false;
        setStatus("Áudio excluído. Você pode gravar novamente ou escrever uma mensagem.");
      });

      preview.append(player, deleteButton);
      composer.insertBefore(preview, editorContainer);
      editorContainer.hidden = hideEditor;
      pendingAudio = { blob, text, url, preview, editorContainer };
      return pendingAudio;
    };

    const attachAudioText = async (file) => {
      const input = widgetShadow?.querySelector('input[type="file"]');
      if (!input) throw new Error("Não encontrei o campo de anexos do widget.");
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const queued = [...widgetShadow.querySelectorAll("span")]
        .find((element) => element.textContent === file.name);
      if (!queued) throw new Error("O widget não incluiu o áudio nos anexos. Verifique o limite de arquivos e tente novamente.");
      // O preview de áudio já fornece reprodução e exclusão do anexo.
      queued.parentElement?.parentElement?.style.setProperty("display", "none", "important");
    };

    const transcribeAudio = async (blob, filename) => {
      if (!blob.size) throw new Error("O áudio está vazio.");
      if (blob.size > MAX_AUDIO_BYTES) {
        throw new Error("O áudio excede o limite de 4 MB. Escolha um arquivo menor ou grave um trecho mais curto.");
      }
      const localPreview = showAudioPreview(blob, "", false);
      setStatus("");
      const formData = new FormData();
      const mimeType = (blob.type || "audio/webm").split(";", 1)[0].toLowerCase();
      const extension = mimeType.includes("ogg") ? "ogg"
        : mimeType.includes("mpeg") ? "mp3"
        : mimeType.includes("mp4") ? "m4a"
        : mimeType.includes("wav") ? "wav"
        : "webm";
      const uploadFilename = filename && /\.[a-z0-9]+$/i.test(filename)
        ? filename
        : `${filename || "gravacao"}.${extension}`;
      formData.append("file", blob, uploadFilename);
      let response;
      try {
        response = await fetch(transcriptionEndpoint, {
          method: "POST",
          body: formData,
        });
      } catch {
        disableAudioButton();
        return;
      }
      let payload = {};
      try {
        payload = await response.json();
      } catch {
        // A mensagem abaixo será escolhida pelo código HTTP.
      }
      if (!response.ok) {
        disableAudioButton();
        return;
      }
      if (payload.text?.trim()) {
        try {
          const transcript = payload.text.trim();
          const mime = (blob.type || "audio/webm").split(";", 1)[0].toLowerCase();
          const base64 = await blobToBase64(blob);
          const message = [
            "TIFLUX_AUDIO_V1",
            `MIME: ${mime}`,
            `FILENAME: ${uploadFilename}`,
            `BASE64: ${base64}`,
          ].join("\n");
          if (pendingAudio === localPreview) {
            const file = new File([message], `audio_${Date.now().toString(36)}.txt`, { type: "text/plain" });
            localPreview.file = file;
            await attachAudioText(file);
            if (pendingAudio !== localPreview) return;
            localPreview.ready = true;
            localPreview.transcript = transcript;
            localPreview.editorContainer.hidden = false;
            localPreview.preview.title = "O áudio e a transcrição serão enviados ao Tiflux; no widget, a mensagem será exibida como áudio.";
            setStatus("");
          }
        } catch (error) {
          setStatus(error.message || "Não foi possível preparar o TXT do áudio.");
        }
      } else {
        disableAudioButton();
      }
    };

    const getWidgetDeliveryContext = () => {
      const token = window.TifluxWidgetConfig?.token;
      const session = token && JSON.parse(localStorage.getItem(`@TifluxWidget:Session:${token}`) || "null");
      if (!session?.session_token || !session?.visitor_id) {
        throw new Error("Não encontrei a sessão do widget para enviar a transcrição.");
      }
      return { token, session };
    };

    const sendAudioTranscript = async (audio) => {
      if (audio.transcriptSent || !audio.transcript) return;
      if (audio.transcriptRequest) return audio.transcriptRequest;
      const request = (async () => {
        // Aguarda um pouco após o áudio aparecer no histórico antes de enviar a transcrição.
        await new Promise((resolve) => setTimeout(resolve, TRANSCRIPT_SEND_DELAY_MS));
        const { token, session } = audio.deliveryContext || getWidgetDeliveryContext();
        const user = session.user_data || {};
        const response = await fetch(`https://app.tiflux.com/widget/${encodeURIComponent(token)}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(30000),
          body: JSON.stringify({
            session_token: session.session_token,
            visitor_id: session.visitor_id,
            visitor_name: user.name,
            ...(user.email ? { visitor_email: user.email } : {}),
            ...(user.phone ? { visitor_phone: user.phone } : {}),
            type: "text",
            body: `${TRANSCRIPT_MESSAGE_PREFIX}\nTranscrição do áudio enviado pelo cliente.\nArquivo: ${audio.file.name}\n\n${audio.transcript}`,
          }),
        });
        if (!response.ok) throw new Error(`Não foi possível enviar a transcrição (HTTP ${response.status}).`);
        audio.transcriptSent = true;
        transcriptOutbox.delete(audio.file.name);
        const status = findStatus();
        if (status?.dataset.transcriptFile === audio.file.name) setStatus("");
        hideTranscriptMessages();
      })();
      audio.transcriptRequest = request;
      try { await request; } finally { audio.transcriptRequest = null; }
    };

    const deliverAudioTranscript = (audio) => {
      sendAudioTranscript(audio).catch((error) => {
        setStatus("O áudio foi enviado, mas não foi possível enviar a transcrição.");
        const status = findStatus();
        if (!status) return;
        status.dataset.transcriptFile = audio.file.name;
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "Reenviar transcrição";
        retry.title = error.message;
        Object.assign(retry.style, { marginLeft: "6px", cursor: "pointer", textDecoration: "underline" });
        retry.addEventListener("click", () => {
          setStatus("Enviando transcrição…");
          status.dataset.transcriptFile = audio.file.name;
          deliverAudioTranscript(audio);
        });
        status.append(" ", retry);
      });
    };

    const isTranscriptMessage = (text) => text.trimStart().startsWith(TRANSCRIPT_MESSAGE_PREFIX);

    const hideTranscriptMessages = () => {
      if (!widgetShadow) return;
      // Restaura uma linha caso o React reutilize seu elemento para outra mensagem.
      for (const [row, saved] of hiddenTranscriptRows) {
        if (!row.isConnected) {
          hiddenTranscriptRows.delete(row);
        } else if (!saved.content.isConnected || !row.contains(saved.content) ||
                   !isTranscriptMessage(saved.content.textContent || "")) {
          if (saved.display) row.style.setProperty("display", saved.display, saved.priority);
          else row.style.removeProperty("display");
          hiddenTranscriptRows.delete(row);
        }
      }
      for (const content of widgetShadow.querySelectorAll("p, span")) {
        if (content.closest("[contenteditable], #tiflux-audio-preview, #tiflux-transcription-status")) continue;
        if (!isTranscriptMessage(content.textContent || "")) continue;
        let history = content.closest(".tiflux-chat-messages");
        // A versão atual de widget.js identifica o histórico apenas pelo estilo.
        if (!history) {
          for (let parent = content.parentElement; parent; parent = parent.parentElement) {
            if (parent.style.overflowY === "auto") { history = parent; break; }
          }
        }
        if (!history) continue;
        let row = content;
        // A linha inclui a bolha, o nome e o horário; ocultá-la evita espaços vazios.
        for (let parent = content.parentElement; parent && parent !== history; parent = parent.parentElement) {
          if (hiddenTranscriptRows.has(parent) || (parent.style.display === "flex" &&
              ["flex-start", "flex-end"].includes(parent.style.justifyContent) && parent.style.marginBottom)) {
            row = parent;
            break;
          }
        }
        if (!hiddenTranscriptRows.has(row)) {
          hiddenTranscriptRows.set(row, {
            content,
            display: row.style.getPropertyValue("display"),
            priority: row.style.getPropertyPriority("display"),
          });
        }
        if (row.style.display !== "none") row.style.setProperty("display", "none", "important");
      }
    };

    // Recupera mensagens do formato antigo que foram enviadas no corpo do chat.
    const renderLegacyAudioMessages = () => {
      if (!widgetShadow) return;
      for (const element of [...widgetShadow.querySelectorAll("p, span")].reverse()) {
        if (processedLegacyAudioMessages.has(element) ||
            element.closest("[contenteditable], #tiflux-audio-preview, [data-tiflux-audio-player]")) continue;
        const text = element.innerText || element.textContent || "";
        const match = text.trim().match(/^TIFLUX_?AUDIO_?V2\s+MIME: ([^\r\n]+)\r?\nFILENAME: [^\r\n]+\r?\nTRANSCRIPT_?BASE64: [A-Za-z0-9+/=]*\r?\nBASE64: ([A-Za-z0-9+/=\s]+)$/);
        if (!match || !/^audio\/[a-z0-9.+-]+$/i.test(match[1].trim())) continue;
        try {
          const binary = atob(match[2].replace(/\s/g, ""));
          if (!binary.length || binary.length > MAX_AUDIO_BYTES) continue;
          const audio = document.createElement("audio");
          audio.setAttribute("data-tiflux-audio-player", "");
          audio.controls = true;
          audio.preload = "metadata";
          audio.src = URL.createObjectURL(new Blob([
            Uint8Array.from(binary, (character) => character.charCodeAt(0)),
          ], { type: match[1].trim() }));
          Object.assign(audio.style, { width: "240px", maxWidth: "100%", height: "36px" });
          processedLegacyAudioMessages.add(element);
          element.style.setProperty("display", "none", "important");
          element.insertAdjacentElement("afterend", audio);
        } catch {
          // Mantém a mensagem original quando o conteúdo não é um áudio válido.
        }
      }
    };

    const processAudioTxtLinks = async () => {
      if (!widgetShadow) return;
      const links = [...widgetShadow.querySelectorAll("a[href]")];
      for (const link of links) {
        if (processedAudioTxtLinks.has(link)) continue;
        let url;
        try {
          url = new URL(link.href);
        } catch {
          continue;
        }
        if (url.protocol !== "https:" || !audioUploadHosts.has(url.hostname) || url.port) continue;
        let filename;
        try { filename = decodeURIComponent(url.pathname.split("/").pop()); } catch { continue; }
        if (!/^(?:audio_|a_).*\.txt$/i.test(filename)) continue;

        processedAudioTxtLinks.add(link);
        const playerBubble = document.createElement("div");
        playerBubble.setAttribute("role", "group");
        playerBubble.setAttribute("aria-label", "Áudio carregando");
        Object.assign(playerBubble.style, {
          display: "block", width: "260px",
          maxWidth: "100%", minWidth: "0", boxSizing: "border-box", verticalAlign: "middle",
          color: "#5d5d5d", font: "13px Arial, sans-serif",
        });
        const loading = document.createElement("span");
        loading.textContent = "Carregando áudio…";
        playerBubble.appendChild(loading);
        link.insertAdjacentElement("afterend", playerBubble);
        link.style.setProperty("display", "none", "important");

        try {
          let audioUrl = sentAudioUrls.get(filename);
          if (!audioUrl) {
            const response = await fetch(`${transcriptionApiBase}/api/audio-from-txt`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: url.href }),
            });
            if (!response.ok) throw new Error("Não foi possível carregar o áudio.");
            const blob = await response.blob();
            if (!blob.size) throw new Error("O áudio está vazio.");
            audioUrl = URL.createObjectURL(blob);
            sentAudioUrls.set(filename, audioUrl);
          }
          const audio = document.createElement("audio");
          audio.src = audioUrl;
          audio.controls = true;
          audio.preload = "metadata";
          Object.assign(audio.style, {
            display: "block", width: "100%", maxWidth: "100%",
            minWidth: "0", height: "36px", margin: "0", filter: "grayscale(1)",
          });
          playerBubble.replaceChildren(audio);
          playerBubble.setAttribute("aria-label", "Arquivo de áudio");
          if (pendingAudio?.file?.name === filename) {
            pendingAudio.preview.remove();
            pendingAudio = undefined;
          }
          const transcript = transcriptOutbox.get(filename);
          if (transcript) deliverAudioTranscript(transcript);
        } catch {
          playerBubble.remove();
          link.style.removeProperty("display");
        }
      }
    };

    const setUpControls = () => {
      const root = document.querySelector("#tiflux-widget-root");
      const shadow = root?.shadowRoot;
      if (!shadow) return false;
      widgetRoot = root;
      widgetShadow = shadow;
      hideTranscriptMessages();
      renderLegacyAudioMessages();
      processAudioTxtLinks();

      const sendButton = shadow.querySelector('button[aria-label="Enviar mensagem"]');
      const editor = findEditor();
      if (!sendButton || !editor) return false;
      const composer = sendButton.parentElement;
      if (!composer) return false;
      if (transcriptionRouteAvailable === false) {
        composer.querySelector("#tiflux-record-audio")?.remove();
        composer.querySelector("#tiflux-transcription-status")?.remove();
        return true;
      }
      if (composer.querySelector("#tiflux-record-audio")) return true;
      composer.style.position = "relative";
      composer.style.boxSizing = "border-box";
      composer.style.paddingBottom = "42px";

      const status = document.createElement("div");
      status.id = "tiflux-transcription-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      Object.assign(status.style, {
        position: "absolute", right: "8px", bottom: "48px", zIndex: "20",
        maxWidth: "min(340px, 80%)", padding: "6px 9px", borderRadius: "6px",
        background: "#fff", color: "#5d5d5d", boxShadow: "0 1px 6px #0002",
        font: "12px/1.4 Arial, sans-serif",
      });
      status.hidden = true;

      const makeButton = (id, label, right) => {
        const button = document.createElement("button");
        button.id = id;
        button.type = "button";
        button.innerHTML = label;
        button.title = "Gravar áudio";
        button.setAttribute("aria-label", button.title);
        Object.assign(button.style, {
          position: "absolute", right, bottom: "12px", zIndex: "11",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxSizing: "border-box", width: "30px", height: "30px", padding: "0",
          border: "none", borderRadius: "0", outline: "none",
          background: "transparent", color: "#5d5d5d",
          font: "16px Arial, sans-serif", lineHeight: "0", cursor: "pointer",
          boxShadow: "none", appearance: "none",
        });
        return button;
      };

      const recordButton = makeButton("tiflux-record-audio", MIC_ICON, "80px");
      recordButton.addEventListener("click", async () => {
        if (recorder?.state === "recording") {
          recorder.stop();
          setButtonState(false, true);
          return;
        }
        if (pendingAudio) {
          setStatus("Envie ou exclua o áudio atual antes de gravar outro.");
          return;
        }
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
          setStatus("Este navegador não oferece suporte à gravação de áudio.");
          return;
        }
        try {
          recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          recordedChunks = [];
          recordedBytes = 0;
          const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
            .find((type) => MediaRecorder.isTypeSupported(type));
          recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);
          recorder.addEventListener("dataavailable", (event) => {
            if (!event.data.size) return;
            recordedBytes += event.data.size;
            if (recordedBytes > MAX_AUDIO_BYTES) {
              setStatus("A gravação passou do limite de 4 MB e foi interrompida. Grave um trecho menor.");
              setButtonState(false, true);
              if (recorder.state === "recording") recorder.stop();
              return;
            }
            recordedChunks.push(event.data);
          });
          recorder.addEventListener("stop", async () => {
            recordingStream?.getTracks().forEach((track) => track.stop());
            recordingStream = undefined;
            try {
              if (recordedBytes > MAX_AUDIO_BYTES) {
                throw new Error("A gravação excedeu o limite de 4 MB e não foi enviada. Grave um trecho menor.");
              }
              const blob = new Blob(recordedChunks, { type: recorder.mimeType || "audio/webm" });
              await transcribeAudio(blob, "gravacao");
            } catch (error) {
              setStatus(error.message || "Não foi possível gravar áudio.");
            } finally {
              setButtonState(false);
            }
          }, { once: true });
          recorder.start(1000);
          setButtonState(true);
          setStatus("");
        } catch (error) {
          recordingStream?.getTracks().forEach((track) => track.stop());
          recordingStream = undefined;
          setStatus(error.name === "NotAllowedError"
            ? "Permita o acesso ao microfone para gravar."
            : "Não foi possível iniciar a gravação. Verifique a permissão do microfone e tente novamente.");
        }
      });

      composer.append(status, recordButton);
      if (transcriptionRouteAvailable === false) {
        recordButton.remove();
        status.remove();
      }
      return true;
    };

    const prepareAudioForWidgetSend = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const sending = event.type === "click"
        ? target?.closest('button[aria-label="Enviar mensagem"]')
        : event.key === "Enter" && !event.shiftKey && target?.closest('[contenteditable="true"]');
      if (!sending || !pendingAudio) return;
      if (!pendingAudio.ready) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setStatus("Aguarde o processamento do áudio antes de enviar.");
        return;
      }
      if (event.type === "click" && sending.disabled) return;
      const audio = pendingAudio;
      sentAudioUrls.set(audio.file.name, audio.url);
      transcriptOutbox.set(audio.file.name, audio);
      if (!audio.deliveryContext) {
        try { audio.deliveryContext = getWidgetDeliveryContext(); } catch {
          // O envio nativo de texto/anexos continua; a transcrição terá opção de repetição.
        }
      }
      setStatus("");
      // O widget envia o arquivo já incluído na fila nativa de anexos.
    };

    const checkTranscriptionRoute = async () => {
      try {
        const response = await fetch(transcriptionEndpoint, { cache: "no-store" });
        transcriptionRouteAvailable = response.ok;
      } catch {
        transcriptionRouteAvailable = false;
      }
      setUpControls();
    };

    const connectToWidget = () => {
      const root = document.querySelector("#tiflux-widget-root");
      const shadow = root?.shadowRoot;
      if (!shadow) return false;
      widgetRoot = root;
      widgetShadow = shadow;
      if (!routeCheckStarted) {
        routeCheckStarted = true;
        checkTranscriptionRoute();
      }
      setUpControls();
      if (sendCaptureShadow !== shadow) {
        sendCaptureShadow = shadow;
        shadow.addEventListener("click", prepareAudioForWidgetSend, true);
        shadow.addEventListener("keydown", prepareAudioForWidgetSend, true);
      }
      if (!widgetObserver) {
        widgetObserver = new MutationObserver(() => {
          hideTranscriptMessages();
          setUpControls();
        });
        widgetObserver.observe(shadow, { childList: true, characterData: true, subtree: true });
      }
      return true;
    };

    const widgetPoll = setInterval(() => {
      if (connectToWidget()) clearInterval(widgetPoll);
    }, 100);
  };

  const initialize = async (
    enableAudio = options.audio === "true" ? true
      : options.audio === "false" ? false
      : DEFAULT_AUDIO_ENABLED
  ) => {
    let layoutStyle;
    try {
      const previous = window.TifluxWidgetConfig || {};
      const token = options.token || previous.token || DEFAULT_WIDGET_CONFIG.token;
      window.TifluxWidgetConfig = {
        ...DEFAULT_WIDGET_CONFIG,
        ...previous,
        token,
        identify: previous.identify === undefined ? { ...DEFAULT_WIDGET_CONFIG.identify } : previous.identify,
      };
      window.SECULLUM_IA_API_BASE_URL = options.apiBase || window.SECULLUM_IA_API_BASE_URL || "https://widgetserverless.vercel.app";
      if (options.open === "true") {
        try { localStorage.setItem(`@TifluxWidget:IsOpen:${token}`, "true"); } catch {}
      }
      if (options.layout === "expanded") {
        layoutStyle = document.createElement("style");
        layoutStyle.textContent = "#tiflux-widget-root { visibility: hidden !important; }";
        document.head.appendChild(layoutStyle);
      }
      await loadTifluxWidget();
      if (!document.querySelector("#tiflux-widget-root")) {
        if (window.TifluxWidgetConfig.identify) window.TifluxWidget.identify(window.TifluxWidgetConfig.identify);
        window.TifluxWidget.init(window.TifluxWidgetConfig);
      }
      if (options.layout === "expanded") initializeExpandedLayout();
      if (enableAudio) initializeAudioFeatures();
      state.initialized = true;
    } catch (error) {
      layoutStyle?.remove();
      delete window.__SecullumAudioWidget;
      console.error("[SecullumWidget]", error.message);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
