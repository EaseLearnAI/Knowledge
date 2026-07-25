(() => {
  "use strict";

  const PHASE_TWO_AI_SCREENS = new Set(["05-ai-chat", "12-ai-empty"]);

  const state = {
    items: [],
    conversations: [],
    preferences: { hasCompletedOnboarding: false },
    auth: { isAuthenticated: false, user: null },
    modelStatus: "local-extractive",
    currentItemID: null,
    currentConversationID: null,
    selectedCategory: "全部",
    searchQuery: "",
    searchKind: "all",
    searchNewestFirst: false,
    sortNewestFirst: true,
    editingTags: [],
    onboardingStep: 0,
  };

  const native = (action, payload = {}) =>
    window.webkit.messageHandlers.nativeBridge.postMessage({ action, payload });

  const root = (id) => document.getElementById(`s-${id}`);
  const itemByID = (id) => state.items.find((item) => item.id === id);
  const escapeHTML = (value = "") =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  const formatText = (value = "") => escapeHTML(value).replaceAll("\n", "<br>");
  const sourceHost = (value = "") => {
    try {
      return new URL(value).host;
    } catch {
      return value;
    }
  };

  const intercept = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const route = (requestedID) => {
    let id = requestedID;
    if (PHASE_TWO_AI_SCREENS.has(id)) {
      id = state.items.length ? "01-home" : "02-home-empty";
    }
    if (!state.preferences.hasCompletedOnboarding && id !== "09-onboarding") {
      id = "09-onboarding";
    } else if (
      state.preferences.hasCompletedOnboarding &&
      !state.auth.isAuthenticated &&
      !["13-auth-login", "14-auth-register"].includes(id)
    ) {
      id = "13-auth-login";
    }
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if (typeof window.go === "function") window.go(id);
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
      root(id)?.querySelector(".phone-content")?.scrollTo(0, 0);
    });
  };

  const readyItems = () => state.items.filter((item) => item.status === "ready");
  const processingItems = () =>
    state.items.filter((item) =>
      ["queued", "fetching", "extracting", "enriching"].includes(item.status),
    );

  function prepareMVPExperience() {
    document.querySelectorAll(".phase-two-ai").forEach((element) => {
      element.remove();
    });
  }

  function replaceItem(nextItem) {
    const index = state.items.findIndex((item) => item.id === nextItem.id);
    if (index >= 0) state.items[index] = nextItem;
    else state.items.unshift(nextItem);
  }

  function relativeDate(value) {
    const date = new Date(value);
    const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return "刚刚";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
    if (seconds < 172800) return "昨天";
    return `${Math.floor(seconds / 86400)} 天前`;
  }

  function sourceIcon(item) {
    const source = item.sourceName.toLowerCase();
    if (source.includes("youtube")) return "fa-brands fa-youtube";
    if (source.includes("b 站")) return "fa-brands fa-bilibili";
    if (item.kind === "podcast") return "fa-solid fa-podcast";
    if (source.includes("小红书")) return "fa-solid fa-hashtag";
    return "fa-solid fa-file-lines";
  }

  function entryHTML(item) {
    const isProcessing = item.status !== "ready" && item.status !== "failed";
    const tags = item.tags
      .map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`)
      .join("");
    const error = item.status === "failed" ? item.errorMessage || "处理失败" : "";
    return `
      <div class="entry ${isProcessing ? "processing" : ""}"
           data-real-item-id="${item.id}">
        <div class="entry-top">
          <span class="entry-source">
            <i class="${sourceIcon(item)}"></i>${escapeHTML(item.sourceName)}
          </span>
          <span class="entry-dur">${isProcessing ? `${Math.round(item.progress * 100)}%` : "已收藏"}</span>
        </div>
        <div class="entry-title">${escapeHTML(item.title)}</div>
        ${
          isProcessing
            ? `<div class="entry-meta">
                 <span class="status-text">${escapeHTML(item.statusText)}</span>
                 <span class="sep">·</span>
                 <span>${relativeDate(item.createdAt)}</span>
               </div>
               <div class="entry-progress">
                 <div style="animation:none;width:${Math.round(item.progress * 100)}%"></div>
               </div>`
            : `<div class="entry-summary">${escapeHTML(error || item.summary)}</div>
               <div class="entry-meta">
                 <span>${relativeDate(item.createdAt)}</span>
                 <span class="sep">·</span>${tags}
               </div>`
        }
      </div>`;
  }

  function filteredItems() {
    let items = [...state.items];
    if (state.selectedCategory === "待分类") {
      items = items.filter(
        (item) => item.tags.length === 0 || item.tags.includes("待分类"),
      );
    } else if (state.selectedCategory !== "全部") {
      items = items.filter((item) => item.tags.includes(state.selectedCategory));
    }
    return items.sort((a, b) => {
      const delta = new Date(b.createdAt) - new Date(a.createdAt);
      return state.sortNewestFirst ? delta : -delta;
    });
  }

  function renderHome() {
    const screen = root("01-home");
    if (!screen) return;
    const total = state.items.length;
    const count = screen.querySelector(".greeting-title .muted");
    if (count) count.textContent = String(total);
    const processing = screen.querySelector(".count-pill span");
    if (processing) processing.textContent = `${processingItems().length} 解析中`;

    const categories = new Map();
    readyItems().forEach((item) =>
      item.tags.forEach((tag) => categories.set(tag, (categories.get(tag) || 0) + 1)),
    );
    const categoryOrder = ["AI 知识", "产品", "商业", "设计"];
    const tagRow = screen.querySelector(".tag-row");
    if (tagRow) {
      const chips = [
        ["全部", total],
        ...categoryOrder.map((tag) => [tag, categories.get(tag) || 0]),
        [
          "待分类",
          readyItems().filter(
            (item) => item.tags.length === 0 || item.tags.includes("待分类"),
          ).length,
        ],
      ];
      tagRow.innerHTML = chips
        .map(
          ([name, value]) =>
            `<span class="chip ${state.selectedCategory === name ? "active" : ""} ${
              name === "待分类" ? "outline" : ""
            }" data-real-category="${escapeHTML(name)}">
              ${escapeHTML(name)} <span style="opacity:.6;margin-left:2px">${value}</span>
            </span>`,
        )
        .join("");
    }
    const sort = screen.querySelector(".list-hint .sort");
    if (sort) {
      sort.innerHTML = `${state.sortNewestFirst ? "最新" : "最早"} <i class="fa-solid fa-chevron-down" style="font-size:9px"></i>`;
    }
    const list = screen.querySelector(".entry-list");
    if (list) list.innerHTML = filteredItems().map(entryHTML).join("");
  }

  function goToLibrary() {
    renderHome();
    route(state.items.length ? "01-home" : "02-home-empty");
  }

  function showToast(message) {
    let toast = document.getElementById("memo-runtime-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "memo-runtime-toast";
      Object.assign(toast.style, {
        position: "fixed",
        left: "50%",
        bottom: "118px",
        transform: "translateX(-50%)",
        zIndex: "9999",
        maxWidth: "360px",
        padding: "10px 16px",
        borderRadius: "999px",
        background: "rgba(15,15,14,.92)",
        color: "#FAFAF7",
        fontSize: "13px",
        textAlign: "center",
        boxShadow: "0 8px 24px rgba(0,0,0,.18)",
        opacity: "0",
        transition: "opacity .18s ease",
        pointerEvents: "none",
      });
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = "1";
    clearTimeout(toast.__timer);
    toast.__timer = setTimeout(() => (toast.style.opacity = "0"), 2600);
  }

  function prepareAddSheet() {
    const screen = root("03-add");
    const input = screen?.querySelector(".sheet-input");
    if (input) {
      input.value = "";
      input.placeholder = "https://";
    }
    const button = screen?.querySelector(".primary-cta");
    if (button) {
      button.textContent = "收藏到 Memo";
      button.disabled = false;
    }
  }

  async function submitURL() {
    const screen = root("03-add");
    const input = screen?.querySelector(".sheet-input");
    const button = screen?.querySelector(".primary-cta");
    const url = input?.value?.trim() || "";
    if (!/^https?:\/\/\S+$/i.test(url)) {
      showToast("请输入完整的 http 或 https 链接");
      input?.focus();
      return;
    }
    if (button) {
      button.disabled = true;
      button.textContent = "正在加入…";
    }
    input?.blur();
    try {
      const item = await native("addURL", { url });
      replaceItem(item);
      state.currentItemID = item.id;
      renderHome();
      renderProcessing(item);
      route("07-processing");
    } catch (error) {
      showToast(error.message || String(error));
      if (button) {
        button.disabled = false;
        button.textContent = "收藏到 Memo";
      }
    }
  }

  function renderProcessing(item) {
    const screen = root("07-processing");
    if (!screen || !item) return;
    const title = screen.querySelector(".head h2");
    const meta = screen.querySelector(".head .meta");
    const fill = screen.querySelector(".progress-fill");
    const pct = screen.querySelector(".progress-stats .pct");
    const done = screen.querySelector(".progress-stats .done-n");
    const eta = screen.querySelector(".progress-stats .eta");
    const stageIndex = {
      queued: 0,
      fetching: 0,
      extracting: 1,
      enriching: 2,
      ready: 4,
      failed: 0,
    }[item.status] ?? 0;
    if (title) title.textContent = item.statusText;
    if (meta)
      meta.innerHTML = `${escapeHTML(item.sourceName)} · <b>真实处理中</b>`;
    if (fill) {
      fill.style.transition = "width .3s ease";
      fill.style.width = `${Math.round(item.progress * 100)}%`;
    }
    if (pct) pct.textContent = `${Math.round(item.progress * 100)}%`;
    if (done) done.textContent = String(Math.min(stageIndex, 4));
    if (eta) eta.textContent = "请保持网络连接";
    screen.querySelectorAll(".steps .step").forEach((step, index) => {
      step.className =
        index < stageIndex ? "step done" : index === stageIndex ? "step active" : "step pending";
      const dot = step.querySelector(".dot");
      const time = step.querySelector(".time");
      if (dot)
        dot.innerHTML =
          index < stageIndex
            ? '<i class="fa-solid fa-check"></i>'
            : index === stageIndex
              ? '<i class="fa-solid fa-circle" style="font-size:6px"></i>'
              : "";
      if (time) time.textContent = index < stageIndex ? "完成" : "—";
    });
  }

  function renderPodcastDetail(item) {
    const screen = root("04-detail-podcast");
    if (!screen || !item) return;
    const title = screen.querySelector(".detail-body > h1");
    const source = screen.querySelector(".source-row .badge");
    const meta = screen.querySelector(".source-row .meta");
    const summary = screen.querySelector(".summary-callout p");
    if (title) title.textContent = item.title;
    if (source) source.textContent = item.sourceName;
    if (meta) meta.innerHTML = `<span>${escapeHTML(sourceHost(item.sourceURL) || item.sourceName)}</span><span>·</span><span>${relativeDate(item.createdAt)}</span>`;
    if (summary) summary.textContent = item.summary;
    const points = screen.querySelectorAll(".keypoint");
    points.forEach((point, index) => {
      const text = item.keyPoints[index];
      point.style.display = text ? "flex" : "none";
      if (!text) return;
      const heading = point.querySelector(".heading");
      const desc = point.querySelector(".desc");
      if (heading) heading.textContent = text;
      if (desc) desc.textContent = index === 0 ? item.summary : "";
    });
    const sourceLink = screen.querySelector(".tags-section a");
    if (sourceLink) {
      sourceLink.dataset.realSourceUrl = item.sourceURL;
      const sourceTitle = sourceLink.querySelector("div > div:first-child");
      if (sourceTitle) sourceTitle.textContent = item.sourceURL;
      sourceLink.setAttribute("aria-label", "打开原始内容");
    }
    renderFavoriteState(item);
  }

  function renderArticleDetail(item) {
    const screen = root("06-detail-article");
    if (!screen || !item) return;
    const title = screen.querySelector(".article-title");
    const summary = screen.querySelector(".summary-card .text");
    const author = screen.querySelector(".author-info .name");
    const handle = screen.querySelector(".author-info .handle");
    if (title) title.textContent = item.title;
    if (summary) summary.textContent = item.summary;
    if (author) author.textContent = item.sourceName;
    if (handle) handle.textContent = sourceHost(item.sourceURL) || item.sourceURL;
    const points = screen.querySelectorAll(".point-row");
    points.forEach((point, index) => {
      const text = item.keyPoints[index];
      point.style.display = text ? "flex" : "none";
      if (text) point.querySelector(".text").textContent = text;
    });
    const tags = screen.querySelector(".tag-section .tags");
    if (tags) {
      tags.innerHTML = item.tags
        .map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`)
        .join("");
    }
    renderFavoriteState(item);
  }

  function renderFavoriteState(item) {
    const favoriteButton = root("04-detail-podcast")?.querySelector(
      ".action-bar .icon-btn:nth-child(2)",
    );
    if (!favoriteButton) return;
    const isFavorite = Boolean(item.isFavorite);
    favoriteButton.classList.toggle("memo-favorite-active", isFavorite);
    favoriteButton.style.color = isFavorite ? "#C0472F" : "";
    favoriteButton.setAttribute(
      "aria-label",
      isFavorite ? "取消喜欢" : "标记为喜欢",
    );
  }

  function openItem(itemID) {
    const item = itemByID(itemID);
    if (!item) return;
    state.currentItemID = itemID;
    if (item.status === "failed") {
      const unsupported = root("10-unsupported");
      const message = unsupported?.querySelector(".unsupported-card p, .modal-card p");
      if (message) message.textContent = item.errorMessage || "这个来源暂时无法解析";
      const url = unsupported?.querySelector(".alert-url");
      if (url) url.textContent = item.sourceURL;
      route("10-unsupported");
      return;
    }
    if (item.status !== "ready") {
      renderProcessing(item);
      route("07-processing");
      return;
    }
    if (item.kind === "article" || item.kind === "note") {
      renderArticleDetail(item);
      route("06-detail-article");
    } else {
      renderPodcastDetail(item);
      route("04-detail-podcast");
    }
  }

  function searchItems(query) {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const matches = readyItems().filter((item) => {
      if (
        state.searchKind !== "all" &&
        state.searchKind !== item.kind &&
        !(state.searchKind === "media" &&
          ["podcast", "video"].includes(item.kind))
      ) {
        return false;
      }
      const haystack = [
        item.title,
        item.summary,
        item.content,
        ...(item.tags || []),
      ]
        .join(" ")
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
    if (state.searchNewestFirst) {
      return matches.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      );
    }
    return matches;
  }

  function renderSearch() {
    const screen = root("08-search");
    if (!screen) return;
    const input = screen.querySelector(".search-input input");
    if (input && input.value !== state.searchQuery) input.value = state.searchQuery;
    const results = searchItems(state.searchQuery);
    const filterDefinitions = [
      ["all", "全部"],
      ["media", "播客 / 视频"],
      ["article", "文章"],
      ["note", "笔记"],
    ];
    screen.querySelectorAll(".filter-row .filter-chip").forEach(
      (element, index) => {
        const definition = filterDefinitions[index];
        if (!definition) return;
        element.dataset.realSearchKind = definition[0];
        element.classList.toggle("active", state.searchKind === definition[0]);
        element.textContent = definition[1];
        element.setAttribute("role", "button");
        element.setAttribute("aria-label", `筛选 ${definition[1]}`);
      },
    );
    const count = screen.querySelector(".results-info .count");
    if (count) count.textContent = String(results.length);
    const summary = screen.querySelector(".ai-summary .text");
    if (summary) {
      summary.innerHTML = results.length
        ? `在你的 <strong>${results.length} 条相关收藏</strong> 中，标题、摘要或正文命中了「<strong>${escapeHTML(state.searchQuery || "全部")}</strong>」。`
        : "没有找到匹配内容，换一个关键词试试。";
    }
    const list = screen.querySelector(".result-list");
    if (list) {
      list.innerHTML =
        results
          .map(
            (item) => `
            <div class="result-item" data-real-search-id="${item.id}"
                 role="button" aria-label="${escapeHTML(item.title)}">
              <div class="body">
                <div class="top">
                  <span class="src-dot ${item.kind === "article" ? "article" : "podcast"}"></span>
                  <span>${escapeHTML(item.sourceName)}</span>
                  <span class="sep">·</span>
                  <span>${relativeDate(item.createdAt)}</span>
                </div>
                <div class="title">${escapeHTML(item.title)}</div>
                <div class="excerpt">${escapeHTML(item.summary)}</div>
                <div class="bottom">
                  ${item.tags.map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`).join("")}
                  <span class="time">${new Date(item.createdAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</span>
                </div>
              </div>
            </div>`,
          )
          .join("") + '<div style="height:24px"></div>';
    }
    const sort = screen.querySelector(".results-info .sort");
    if (sort) {
      sort.textContent = state.searchNewestFirst ? "最新优先" : "相关度";
      sort.setAttribute("role", "button");
      sort.setAttribute("aria-label", "切换搜索排序");
    }
  }

  function renderAssistantHome() {
    const screen = root("12-ai-empty");
    if (!screen) return;
    const ready = readyItems();
    const sub = screen.querySelector(".ai-sub");
    if (sub)
      sub.innerHTML = `<span class="live"></span>已连接 ${ready.length} 条收藏`;
    const context = screen.querySelector(".composer-context");
    if (context)
      context.innerHTML = `<i class="fa-solid fa-book-bookmark"></i> 回答将基于你的 ${ready.length} 条收藏，并标注来源`;
    const greetingName = screen.querySelector(".msg-text b");
    if (greetingName && state.auth.user?.nickname) {
      greetingName.textContent = state.auth.user.nickname;
    }
    const tags = new Map();
    ready.forEach((item) =>
      item.tags.forEach((tag) => tags.set(tag, (tags.get(tag) || 0) + 1)),
    );
    const topTags = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const lead = screen.querySelector(".digest-lead");
    if (lead) {
      lead.innerHTML = ready.length
        ? `你目前收藏了 <b>${ready.length} 条</b>内容，关注最多的是 ${
            topTags.length
              ? topTags.map(([tag]) => `<b>${escapeHTML(tag)}</b>`).join("、")
              : "<b>待分类内容</b>"
          }。点下面的问题，Memo 只根据这些原文回答。`
        : "资料库还是空的。先收藏一条网页，再来这里基于原文提问。";
    }
    screen.querySelectorAll(".digest-themes .theme").forEach((theme, index) => {
      const entry = topTags[index];
      theme.style.display = entry ? "" : "none";
      if (!entry) return;
      const [tag, count] = entry;
      const name = theme.querySelector(".theme-name");
      const countElement = theme.querySelector(".theme-count");
      const bar = theme.querySelector(".theme-bar span");
      if (name) name.textContent = tag;
      if (countElement) countElement.textContent = `${count} 条收藏`;
      if (bar)
        bar.style.width = `${Math.max(18, Math.round((count / ready.length) * 100))}%`;
    });
    const cites = screen.querySelector(".digest-cites");
    if (cites) {
      cites.innerHTML = ready
        .slice(0, 3)
        .map(
          (item, index) =>
            `<span class="cite" data-real-citation-id="${item.id}"><b>[${index + 1}]</b> ${escapeHTML(item.sourceName)}</span>`,
        )
        .join("");
    }
    const history = screen.querySelector(".side-list");
    if (history) {
      history.innerHTML = state.conversations.length
        ? `<div class="side-group">本机对话</div>${state.conversations
            .map(
              (conversation) => `
                <div class="thread-item" data-real-conversation-id="${conversation.id}"
                     role="button" aria-label="${escapeHTML(conversation.title)}">
                  <div class="ic"><i class="fa-solid fa-message"></i></div>
                  <div class="tt">
                    <div class="t">${escapeHTML(conversation.title)}</div>
                    <div class="m">${conversation.messages.length} 条消息 · ${relativeDate(conversation.updatedAt)}</div>
                  </div>
                </div>`,
            )
            .join("")}`
        : '<div class="side-group">还没有对话</div>';
    }
  }

  function openConversation(conversationID) {
    const conversation = state.conversations.find(
      (candidate) => candidate.id === conversationID,
    );
    if (!conversation) return;
    state.currentConversationID = conversation.id;
    renderChatMessages(conversation);
    root("12-ai-empty")?.classList.remove("side-open");
    route("05-ai-chat");
  }

  async function toggleFavorite() {
    if (!state.currentItemID) return;
    const item = await native("toggleFavorite", {
      itemID: state.currentItemID,
    });
    replaceItem(item);
    renderFavoriteState(item);
    showToast(item.isFavorite ? "已标记为喜欢" : "已取消喜欢");
  }

  async function deleteCurrentItem() {
    if (!state.currentItemID) return;
    const result = await native("deleteItem", {
      itemID: state.currentItemID,
    });
    if (!result.deleted) return;
    state.items = state.items.filter(
      (item) => item.id !== state.currentItemID,
    );
    state.currentItemID = null;
    renderHome();
    goToLibrary();
    showToast("已从本机删除");
  }

  function renderTagEditor(item) {
    const screen = root("11-edit-tags");
    if (!screen || !item) return;
    state.editingTags = [...item.tags];
    const previewTitle = screen.querySelector(".preview-card .title");
    const previewSource = screen.querySelector(".preview-card .src");
    if (previewTitle) previewTitle.textContent = item.title;
    if (previewSource) previewSource.textContent = item.sourceName;
    refreshTagEditor();
  }

  function refreshTagEditor() {
    const screen = root("11-edit-tags");
    const current = screen?.querySelector(".current-tags");
    if (current) {
      current.innerHTML = state.editingTags
        .map(
          (tag) => `
          <div class="current-tag" data-real-remove-tag="${escapeHTML(tag)}">
            <span class="ai-tag"><i class="fa-solid fa-microchip" style="font-size:8px"></i></span>
            ${escapeHTML(tag)}
            <span class="remove"><i class="fa-solid fa-xmark"></i></span>
          </div>`,
        )
        .join("");
    }
    const label = screen?.querySelector(".sec-label");
    if (label) label.innerHTML = `<span class="line"></span>CURRENT TAGS · ${state.editingTags.length}`;
    const count = screen?.querySelector(".add-tag-input .count");
    if (count) count.textContent = `${state.editingTags.length} / 8`;
    screen?.querySelectorAll(".existing-item").forEach((element) => {
      const tag = element.childNodes[0]?.textContent?.trim() || "";
      element.setAttribute("role", "button");
      element.setAttribute("aria-label", `${state.editingTags.includes(tag) ? "移除" : "添加"} Tag ${tag}`);
      const added = state.editingTags.includes(tag);
      element.classList.toggle("added", added);
      const icon = element.querySelector(".add-i");
      if (icon)
        icon.innerHTML = `<i class="fa-solid ${added ? "fa-check" : "fa-plus"}"></i>`;
    });
  }

  async function saveTags() {
    if (!state.currentItemID) return;
    try {
      const item = await native("updateTags", {
        itemID: state.currentItemID,
        tags: state.editingTags,
      });
      replaceItem(item);
      renderHome();
      openItem(item.id);
      showToast("Tag 已保存");
    } catch (error) {
      showToast(error.message || String(error));
    }
  }

  function renderChatMessages(conversation, pendingQuestion = null) {
    const screen = root("05-ai-chat");
    const list = screen?.querySelector(".ai-messages");
    if (!list) return;
    const messages = conversation?.messages || [];
    const blocks = messages.map((message) => {
      if (message.role === "user") {
        return `<div class="msg user"><div class="msg-avatar">我</div><div class="msg-bubble">${formatText(message.content)}</div></div>`;
      }
      const cards = (message.citations || [])
        .map(
          (citation) => `
            <div class="ref-card" data-real-citation-id="${citation.itemID}">
              <div class="num">${citation.number}</div>
              <div class="body">
                <div class="meta"><span>${escapeHTML(citation.sourceName)}</span></div>
                <div class="title">${escapeHTML(citation.title)}</div>
                <div class="quote">${escapeHTML(citation.quote)}</div>
              </div>
            </div>`,
        )
        .join("");
      return `<div class="msg ai"><div class="msg-avatar">M</div><div class="msg-bubble">${formatText(message.content)}${cards ? `<div class="ref-cards">${cards}</div>` : ""}</div></div>`;
    });
    if (pendingQuestion) {
      blocks.push(`<div class="msg user"><div class="msg-avatar">我</div><div class="msg-bubble">${formatText(pendingQuestion)}</div></div>`);
      blocks.push('<div class="msg ai"><div class="msg-avatar">M</div><div class="msg-bubble"><div class="typing"><span></span><span></span><span></span></div></div></div>');
    }
    list.innerHTML = blocks.join("") + '<div style="height:16px"></div>';
    list.scrollTop = list.scrollHeight;
  }

  async function ask(question, itemID = null) {
    const normalized = question.trim();
    if (!normalized) return;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    route("05-ai-chat");
    const currentConversation = state.conversations.find(
      (conversation) => conversation.id === state.currentConversationID,
    );
    renderChatMessages(currentConversation, normalized);
    try {
      const response = await native("chat", {
        question: normalized,
        conversationID: state.currentConversationID,
        itemID,
      });
      state.currentConversationID = response.conversation.id;
      const index = state.conversations.findIndex(
        (conversation) => conversation.id === response.conversation.id,
      );
      if (index >= 0) state.conversations[index] = response.conversation;
      else state.conversations.unshift(response.conversation);
      renderChatMessages(response.conversation);
      renderAssistantHome();
    } catch (error) {
      showToast(error.message || String(error));
    }
  }

  function updateOnboarding() {
    const screen = root("09-onboarding");
    const title = screen?.querySelector(".stage h2");
    const description = screen?.querySelector(".stage .desc");
    const button = screen?.querySelector(".footer .btn-primary");
    const steps = [
      ["扔进来，<br>先别整理", "粘贴一个链接，AI 会自动提取正文、生成摘要和标签。"],
      ["读完之后，<br>自动归档", "所有内容保存在你的设备上，随时全文搜索和重新编辑 Tag。"],
      ["收藏越多，<br>问得越准", "回答只基于你的收藏并附上来源；支持时使用 Apple 端侧模型。"],
    ];
    if (title) title.innerHTML = steps[state.onboardingStep][0];
    if (description) description.textContent = steps[state.onboardingStep][1];
    screen?.querySelectorAll(".dots span").forEach((dot, index) => {
      dot.classList.toggle("active", index === state.onboardingStep);
    });
    if (button) {
      button.childNodes[0].textContent =
        state.onboardingStep === 2 ? "开始使用 " : "下一步 ";
    }
    const accountStatus = screen?.querySelector("[data-auth-account-status]");
    if (accountStatus) {
      const identifier = state.auth.user?.email || state.auth.user?.phone;
      accountStatus.textContent = identifier
        ? `已登录 · ${identifier}`
        : "";
    }
  }

  function routeAfterAuthentication() {
    if (!state.preferences.hasCompletedOnboarding) route("09-onboarding");
    else goToLibrary();
  }

  function hydrateSnapshot(snapshot) {
    state.items = snapshot.items || [];
    state.conversations = snapshot.conversations || [];
    state.preferences = snapshot.preferences || state.preferences;
    state.modelStatus = snapshot.modelStatus || state.modelStatus;
    state.auth = snapshot.auth || state.auth;
    renderHome();
    renderSearch();
    renderAssistantHome();
    updateOnboarding();
  }

  function setAuthFormState(form, isLoading, errorMessage = "") {
    const button = form.querySelector(".auth-submit");
    const error = form.querySelector(".auth-error");
    if (button) {
      button.disabled = isLoading;
      button.textContent = isLoading
        ? "请稍候…"
        : form.dataset.authForm === "register"
          ? "创建账号"
          : "登录";
    }
    if (error) error.textContent = errorMessage;
  }

  async function submitAuthForm(form) {
    const mode = form.dataset.authForm;
    const values = new FormData(form);
    setAuthFormState(form, true);
    try {
      const auth = await native(mode, {
        identifier: String(values.get("identifier") || ""),
        password: String(values.get("password") || ""),
        nickname: String(values.get("nickname") || ""),
      });
      state.auth = auth;
      hydrateSnapshot(await native("bootstrap"));
      form.reset();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      updateOnboarding();
      renderAssistantHome();
      routeAfterAuthentication();
    } catch (error) {
      setAuthFormState(form, false, error.message || String(error));
      return;
    }
    setAuthFormState(form, false);
  }

  async function finishOnboarding() {
    await native("completeOnboarding");
    state.preferences.hasCompletedOnboarding = true;
    if (state.auth.isAuthenticated) goToLibrary();
    else route("13-auth-login");
  }

  function installInputHandlers() {
    document.querySelectorAll("[data-auth-form]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        intercept(event);
        await submitAuthForm(form);
      });
      const fields = [...form.querySelectorAll("input")];
      fields.forEach((field, index) => {
        field.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" || index === fields.length - 1) return;
          event.preventDefault();
          fields[index + 1]?.focus();
        });
      });
    });

    const urlInput = root("03-add")?.querySelector(".sheet-input");
    urlInput?.setAttribute("inputmode", "url");
    urlInput?.setAttribute("enterkeyhint", "done");
    urlInput?.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      intercept(event);
      urlInput.blur();
      await submitURL();
    });

    const searchInput = root("08-search")?.querySelector(".search-input input");
    searchInput?.addEventListener("input", () => {
      state.searchQuery = searchInput.value;
      renderSearch();
    });
    const tagInput = root("11-edit-tags")?.querySelector(".add-tag-input input");
    tagInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const value = tagInput.value.trim();
      if (
        value &&
        state.editingTags.length < 8 &&
        !state.editingTags.includes(value)
      ) {
        state.editingTags.push(value);
        tagInput.value = "";
        refreshTagEditor();
      }
    });
    const detailAIInput = root("05-ai-chat")?.querySelector(".ai-input input");
    detailAIInput?.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      intercept(event);
      const question = detailAIInput.value;
      detailAIInput.value = "";
      await ask(question, state.currentItemID);
    });
    const libraryAIInput = root("12-ai-empty")?.querySelector(
      ".composer-row input",
    );
    libraryAIInput?.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      intercept(event);
      const question = libraryAIInput.value;
      libraryAIInput.value = "";
      await ask(question);
    });
  }

  document.addEventListener(
    "click",
    async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const authRoute = target.closest("[data-auth-route]");
      if (authRoute) {
        intercept(event);
        route(
          authRoute.dataset.authRoute === "register"
            ? "14-auth-register"
            : "13-auth-login",
        );
        return;
      }

      const addControl = target.closest(".tab-add, .empty-cta");
      if (addControl) {
        intercept(event);
        prepareAddSheet();
        route("03-add");
        return;
      }

      const tab = target.closest(".tab-item");
      if (tab) {
        intercept(event);
        if (tab.textContent.includes("AI")) {
          route("12-ai-empty");
        } else {
          goToLibrary();
        }
        return;
      }

      if (target.closest("#s-01-home .topbar-actions .icon-btn")) {
        intercept(event);
        state.searchQuery = "";
        renderSearch();
        route("08-search");
        setTimeout(() => root("08-search")?.querySelector("input")?.focus(), 200);
        return;
      }

      const category = target.closest("[data-real-category]");
      if (category) {
        intercept(event);
        state.selectedCategory = category.dataset.realCategory;
        renderHome();
        return;
      }

      if (target.closest("#s-01-home .list-hint .sort")) {
        intercept(event);
        state.sortNewestFirst = !state.sortNewestFirst;
        renderHome();
        return;
      }

      const entry = target.closest("[data-real-item-id]");
      if (entry) {
        intercept(event);
        openItem(entry.dataset.realItemId);
        return;
      }

      if (target.closest("#s-03-add .primary-cta")) {
        intercept(event);
        await submitURL();
        return;
      }

      if (target.closest("#s-03-add .cancel")) {
        intercept(event);
        goToLibrary();
        return;
      }

      if (target.closest("#s-07-processing .bg-btn")) {
        intercept(event);
        goToLibrary();
        showToast("已转到后台处理");
        return;
      }

      if (target.closest("#s-04-detail-podcast .hero-nav > .icon-btn") ||
          target.closest("#s-06-detail-article .nav-pill")) {
        intercept(event);
        goToLibrary();
        return;
      }

      const podcastActions = root("04-detail-podcast")?.querySelectorAll(
        ".hero-nav .right .icon-btn",
      );
      if (podcastActions?.[0]?.contains(target)) {
        intercept(event);
        if (state.currentItemID)
          await native("share", { itemID: state.currentItemID });
        return;
      }
      if (podcastActions?.[1]?.contains(target)) {
        intercept(event);
        const item = itemByID(state.currentItemID);
        if (item) await native("openURL", { url: item.sourceURL });
        return;
      }

      if (
        target.closest("#s-04-detail-podcast .hero-play") ||
        target.closest("[data-real-source-url]") ||
        target.closest("#s-06-detail-article .float-actions .float-btn:first-child")
      ) {
        intercept(event);
        const item = itemByID(state.currentItemID);
        if (item) await native("openURL", { url: item.sourceURL });
        return;
      }

      const articleActions = root("06-detail-article")?.querySelectorAll(
        ".nav-actions .nav-btn",
      );
      if (articleActions?.[0]?.contains(target)) {
        intercept(event);
        if (state.currentItemID)
          await native("share", { itemID: state.currentItemID });
        return;
      }

      const podcastFooterActions = root("04-detail-podcast")?.querySelectorAll(
        ".action-bar .icon-btn",
      );
      if (podcastFooterActions?.[0]?.contains(target)) {
        intercept(event);
        await deleteCurrentItem();
        return;
      }
      if (podcastFooterActions?.[1]?.contains(target)) {
        intercept(event);
        await toggleFavorite();
        return;
      }
      if (target.closest("#s-06-detail-article .float-actions .float-btn:last-child")) {
        intercept(event);
        await deleteCurrentItem();
        return;
      }

      if (
        articleActions?.[1]?.contains(target) ||
        target.closest("#s-06-detail-article .tag-section .edit")
      ) {
        intercept(event);
        const item = itemByID(state.currentItemID);
        if (item) {
          renderTagEditor(item);
          route("11-edit-tags");
        }
        return;
      }

      const removeTag = target.closest("[data-real-remove-tag]");
      if (removeTag) {
        intercept(event);
        state.editingTags = state.editingTags.filter(
          (tag) => tag !== removeTag.dataset.realRemoveTag,
        );
        refreshTagEditor();
        return;
      }

      const existingTag = target.closest("#s-11-edit-tags .existing-item");
      if (existingTag) {
        intercept(event);
        const tag = existingTag.childNodes[0]?.textContent?.trim() || "";
        state.editingTags = state.editingTags.includes(tag)
          ? state.editingTags.filter((value) => value !== tag)
          : state.editingTags.length < 8
            ? [...state.editingTags, tag]
            : state.editingTags;
        refreshTagEditor();
        return;
      }

      if (target.closest("#s-11-edit-tags .btn-save")) {
        intercept(event);
        await saveTags();
        return;
      }
      if (
        target.closest("#s-11-edit-tags .btn-cancel") ||
        target.closest("#s-11-edit-tags .edit-content > div:first-child span")
      ) {
        intercept(event);
        if (state.currentItemID) openItem(state.currentItemID);
        return;
      }

      if (target.closest("#s-08-search .search-cancel")) {
        intercept(event);
        goToLibrary();
        return;
      }
      if (target.closest("#s-08-search .clear")) {
        intercept(event);
        state.searchQuery = "";
        renderSearch();
        root("08-search")?.querySelector("input")?.focus();
        return;
      }
      const searchKind = target.closest("[data-real-search-kind]");
      if (searchKind) {
        intercept(event);
        state.searchKind = searchKind.dataset.realSearchKind;
        renderSearch();
        return;
      }
      if (target.closest("#s-08-search .results-info .sort")) {
        intercept(event);
        state.searchNewestFirst = !state.searchNewestFirst;
        renderSearch();
        return;
      }
      const result = target.closest("[data-real-search-id]");
      if (result) {
        intercept(event);
        openItem(result.dataset.realSearchId);
        return;
      }

      if (target.closest("#s-09-onboarding .skip")) {
        intercept(event);
        await finishOnboarding();
        return;
      }
      if (target.closest("#s-09-onboarding .btn-primary")) {
        intercept(event);
        if (state.onboardingStep < 2) {
          state.onboardingStep += 1;
          updateOnboarding();
        } else {
          await finishOnboarding();
        }
        return;
      }

      if (
        target.closest("#s-02-home-empty .top-thin .icon-btn") ||
        target.closest("#s-12-ai-empty .ai-head-r .icon-btn:nth-child(2)")
      ) {
        intercept(event);
        await native("showSettings");
        return;
      }

      if (target.closest("#s-12-ai-empty .ai-head-r .icon-btn:first-child")) {
        intercept(event);
        renderAssistantHome();
        root("12-ai-empty")?.classList.add("side-open");
        return;
      }
      if (target.closest("#s-12-ai-empty [data-side-close]")) {
        intercept(event);
        root("12-ai-empty")?.classList.remove("side-open");
        return;
      }
      if (target.closest("#s-12-ai-empty .side-new")) {
        intercept(event);
        state.currentConversationID = null;
        root("12-ai-empty")?.classList.remove("side-open");
        renderChatMessages(null);
        route("05-ai-chat");
        return;
      }
      const conversation = target.closest("[data-real-conversation-id]");
      if (conversation) {
        intercept(event);
        openConversation(conversation.dataset.realConversationId);
        return;
      }
      if (target.closest("#s-12-ai-empty .composer-tool")) {
        intercept(event);
        showToast("直接输入标题或 Tag，Memo 会在收藏中定位来源");
        root("12-ai-empty")?.querySelector(".composer-row input")?.focus();
        return;
      }
      if (
        target.closest("#s-12-ai-empty .digest") &&
        !target.closest("[data-real-citation-id]")
      ) {
        intercept(event);
        await ask("根据我的全部收藏，总结当前最重要的三条知识主线。");
        return;
      }

      const suggestion = target.closest("#s-12-ai-empty .chip-q");
      if (suggestion) {
        intercept(event);
        await ask(suggestion.textContent.trim());
        return;
      }

      if (target.closest("#s-12-ai-empty .composer-send")) {
        intercept(event);
        const input = root("12-ai-empty")?.querySelector(".composer input");
        const question = input?.value || "";
        if (input) input.value = "";
        await ask(question);
        return;
      }

      if (target.closest("#s-05-ai-chat .send-btn")) {
        intercept(event);
        const input = root("05-ai-chat")?.querySelector(".ai-input input");
        const question = input?.value || "";
        if (input) input.value = "";
        await ask(question, state.currentItemID);
        return;
      }

      const citation = target.closest("[data-real-citation-id]");
      if (citation) {
        intercept(event);
        openItem(citation.dataset.realCitationId);
        return;
      }

      const unsupportedActions = root("10-unsupported")?.querySelectorAll(
        ".alert-actions .btn",
      );
      if (unsupportedActions?.[0]?.contains(target)) {
        intercept(event);
        if (state.currentItemID) {
          const result = await native("deleteItem", {
            itemID: state.currentItemID,
          });
          if (result.deleted) {
            state.items = state.items.filter(
              (item) => item.id !== state.currentItemID,
            );
            state.currentItemID = null;
          }
        }
        renderHome();
        goToLibrary();
        return;
      }
      if (unsupportedActions?.[1]?.contains(target)) {
        intercept(event);
        goToLibrary();
      }
    },
    true,
  );

  window.MemoRuntime = {
    async nativeEvent(event) {
      if (!event || !event.name) return;
      if (event.name === "libraryReset") {
        state.items = [];
        state.conversations = [];
        state.preferences.hasCompletedOnboarding = true;
        renderHome();
        route("02-home-empty");
        return;
      }
      if (event.name === "loggedOut") {
        state.auth = { isAuthenticated: false, user: null };
        state.items = [];
        state.conversations = [];
        renderHome();
        renderSearch();
        renderAssistantHome();
        route("13-auth-login");
        return;
      }
      if (event.payload?.id) replaceItem(event.payload);
      if (event.name === "itemDeleted") {
        state.items = state.items.filter(
          (item) => item.id !== event.payload.itemID,
        );
      }
      renderHome();
      if (
        event.name === "processingUpdated" &&
        event.payload.id === state.currentItemID
      ) {
        renderProcessing(event.payload);
      } else if (
        event.name === "processingCompleted" &&
        event.payload.id === state.currentItemID
      ) {
        showToast("内容解析完成");
        openItem(event.payload.id);
      } else if (
        event.name === "processingFailed" &&
        event.payload.id === state.currentItemID
      ) {
        openItem(event.payload.id);
      }
    },
  };

  async function bootstrap() {
    try {
      prepareMVPExperience();
      const snapshot = await native("bootstrap");
      hydrateSnapshot(snapshot);
      installInputHandlers();

      if (!state.preferences.hasCompletedOnboarding) {
        route("09-onboarding");
        return;
      }

      if (!state.auth.isAuthenticated) {
        route("13-auth-login");
        return;
      }

      const requested = location.hash.replace("#", "") || "01-home";
      if (requested === "01-home") {
        if (!state.preferences.hasCompletedOnboarding) route("09-onboarding");
        else goToLibrary();
      } else if (requested === "08-search") {
        renderSearch();
      } else if (requested === "03-add") {
        prepareAddSheet();
      } else if (requested === "11-edit-tags" && state.items[0]) {
        state.currentItemID = state.items[0].id;
        renderTagEditor(state.items[0]);
      }
    } catch (error) {
      showToast(`初始化失败：${error.message || error}`);
    }
  }

  bootstrap();
})();
