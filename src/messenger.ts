import {
    apiGetConversations,
    apiGetHistory,
    apiSearchUsers,
    apiCheckOnline,
    apiUploadChatFile,
    apiDeleteChatMessage,
    connectChat,
    decryptMessage,
    decodeFileMessage,
    encodeFileMessage,
    initCryptoKey,
    onChatMessage,
    onPresenceChange,
    onTypingChange,
    sendEncryptedMessage,
    sendTyping,
    type ConversationDto,
    type EncryptedMessageDto,
} from "./chathub";
import { loadSession } from "./api";
import { startCall } from "./calls";
import { openUserPage } from "./userpage";

let currentPartnerId: number | null = null;
let currentPartnerAvatarUrl: string | null = null;
let chatConnected = false;
let messagesOldestId: number | undefined;
let messagesHasMore = true;
let messagesLoading = false;
let unreadCount = 0;
let typingTimer: ReturnType<typeof setTimeout> | null = null;
let isTypingSent = false;

const convListEl        = document.getElementById("conv-list")!;
const chatPaneEl        = document.getElementById("chat-pane")!;
const chatEmptyEl       = document.getElementById("chat-empty")!;
const chatMessagesEl    = document.getElementById("chat-messages")!;
const chatInputEl       = document.getElementById("chat-input") as HTMLInputElement;
const chatSendBtn       = document.getElementById("chat-send")!;
const chatPartnerEl     = document.getElementById("chat-partner-name")!;
const chatPartnerAvatar = document.getElementById("chat-partner-avatar")!;
const chatStatusEl      = document.getElementById("chat-partner-status")!;
const chatTypingEl      = document.getElementById("chat-typing-indicator")!;
const newChatBtn        = document.getElementById("new-chat-btn")!;
const newChatModal      = document.getElementById("new-chat-modal")!;
const newChatClose      = document.getElementById("new-chat-close")!;
const newChatSearchEl   = document.getElementById("new-chat-search") as HTMLInputElement;
const newChatResultsEl  = document.getElementById("new-chat-results")!;
const messengerNavBtn   = document.querySelector<HTMLElement>('.nav-item[data-tab="messenger"]')!;
const messengerEl       = document.getElementById("messenger")!;
const chatBackBtn       = document.getElementById("chat-back-btn")!;
const chatAttachBtn     = document.getElementById("chat-attach-btn")!;
const chatFileInput     = document.getElementById("chat-file-input") as HTMLInputElement;

function isMobile(): boolean { return window.innerWidth <= 640; }
function openMobileChat()  { messengerEl.classList.add("mobile-chat-open"); }
function closeMobileChat() { messengerEl.classList.remove("mobile-chat-open"); }
function esc(t: string)    { return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function myId(): number | undefined { return loadSession()?.userId; }

function applyBg(el: HTMLElement, url: string | null | undefined) {
    if (url) {
        el.style.backgroundImage = `url('${url}')`;
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
        el.classList.add("has-avatar");
    } else {
        el.style.backgroundImage = "";
        el.classList.remove("has-avatar");
    }
}

function isMessengerVisible(): boolean {
    return !document.getElementById("tab-messenger")?.classList.contains("hidden");
}

function addUnread(n = 1) {
    if (isMessengerVisible()) return;
    unreadCount += n;
    renderBadge();
}

function clearUnread() {
    unreadCount = 0;
    renderBadge();
}

function renderBadge() {
    let badge = messengerNavBtn.querySelector<HTMLElement>(".nav-badge");
    if (unreadCount > 0) {
        if (!badge) {
            badge = document.createElement("span");
            badge.className = "nav-badge";
            messengerNavBtn.appendChild(badge);
        }
        badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    } else {
        badge?.remove();
    }
}

messengerNavBtn.addEventListener("click", clearUnread, { capture: true });

function setPartnerStatus(online: boolean) {
    chatStatusEl.textContent = online ? "в сети" : "не в сети";
    chatStatusEl.className = "chat-partner-status " + (online ? "status-online" : "status-offline");
}

async function refreshPartnerStatus() {
    if (currentPartnerId === null) return;
    try {
        const { online } = await apiCheckOnline(currentPartnerId);
        setPartnerStatus(online);
    } catch {}
}

onPresenceChange((userId, online) => {
    if (userId === currentPartnerId) setPartnerStatus(online);
    const item = convListEl.querySelector<HTMLElement>(`.conv-item[data-pid="${userId}"]`);
    if (item) {
        item.querySelector(".presence-dot")?.remove();
        if (online) {
            const dot = document.createElement("span");
            dot.className = "presence-dot";
            item.querySelector(".conv-avatar")?.appendChild(dot);
        }
    }
});

onTypingChange((userId, isTyping) => {
    if (userId !== currentPartnerId) return;
    chatTypingEl.classList.toggle("hidden", !isTyping);
});

function handleTypingInput() {
    if (!currentPartnerId) return;
    if (!isTypingSent) {
        sendTyping(currentPartnerId, true);
        isTypingSent = true;
    }
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        if (currentPartnerId) sendTyping(currentPartnerId, false);
        isTypingSent = false;
    }, 2000);
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

let ctxMenu: HTMLElement | null = null;

function closeCtxMenu() {
    ctxMenu?.remove();
    ctxMenu = null;
}

function showCtxMenu(x: number, y: number, items: { label: string; icon: string; danger?: boolean; action: () => void }[]) {
    closeCtxMenu();

    const menu = document.createElement("div");
    menu.className = "ctx-menu";
    menu.innerHTML = items.map((item, i) =>
        `<button class="ctx-menu-item${item.danger ? " ctx-danger" : ""}" data-i="${i}">
            <span class="ctx-icon">${item.icon}</span>${item.label}
        </button>`
    ).join("");

    menu.querySelectorAll<HTMLButtonElement>(".ctx-menu-item").forEach(btn => {
        btn.addEventListener("click", () => {
            const i = parseInt(btn.dataset["i"]!);
            items[i]!.action();
            closeCtxMenu();
        });
    });

    document.body.appendChild(menu);
    ctxMenu = menu;

    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x, top = y;
    if (left + 180 > vw) left = vw - 188;
    if (top + rect.height + 8 > vh) top = y - rect.height;
    menu.style.left = `${left}px`;
    menu.style.top  = `${top}px`;
    menu.classList.add("ctx-menu-visible");
}

document.addEventListener("click",      () => closeCtxMenu(), { capture: true });
document.addEventListener("contextmenu",() => closeCtxMenu(), { capture: false });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeCtxMenu(); });
document.addEventListener("scroll",    () => closeCtxMenu(), { capture: true });

function fileIcon(mimeType: string): string {
    if (mimeType.startsWith("image/")) return "🖼️";
    if (mimeType.startsWith("video/")) return "🎬";
    if (mimeType.startsWith("audio/")) return "🎵";
    if (mimeType.includes("pdf"))      return "📄";
    if (mimeType.includes("zip") || mimeType.includes("rar") || mimeType.includes("7z")) return "🗜️";
    if (mimeType.includes("word") || mimeType.includes("document")) return "📝";
    return "📎";
}

function buildFileContent(meta: { url: string; fileName: string; fileSize: number; mimeType: string }): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "msg-file";

    if (meta.mimeType.startsWith("audio/")) {
        wrap.innerHTML = `
            <div class="msg-file-name"><span class="msg-file-icon">🎵</span>${esc(meta.fileName)}</div>
            <audio class="msg-audio-player" controls preload="metadata">
                <source src="${meta.url}" type="${esc(meta.mimeType)}"/>
            </audio>
            <div class="msg-file-size">${formatFileSize(meta.fileSize)}</div>`;
        return wrap;
    }

    if (meta.mimeType.startsWith("video/")) {
        wrap.innerHTML = `
            <div class="msg-file-name"><span class="msg-file-icon">🎬</span>${esc(meta.fileName)}</div>
            <video class="msg-video-player" controls preload="metadata">
                <source src="${meta.url}" type="${esc(meta.mimeType)}"/>
            </video>
            <div class="msg-file-size">${formatFileSize(meta.fileSize)}</div>`;
        return wrap;
    }

    if (meta.mimeType.startsWith("image/")) {
        wrap.innerHTML = `
            <img class="msg-image-preview" src="${meta.url}" alt="${esc(meta.fileName)}" loading="lazy"/>
            <div class="msg-file-bottom">
                <span class="msg-file-icon">🖼️</span>
                <span class="msg-file-name-small">${esc(meta.fileName)}</span>
                <a class="msg-file-download" href="${meta.url}" download="${esc(meta.fileName)}" target="_blank">↓</a>
            </div>`;
        return wrap;
    }

    wrap.innerHTML = `
        <div class="msg-file-generic">
            <span class="msg-file-icon-big">${fileIcon(meta.mimeType)}</span>
            <div class="msg-file-info">
                <span class="msg-file-name">${esc(meta.fileName)}</span>
                <span class="msg-file-size">${formatFileSize(meta.fileSize)}</span>
            </div>
            <a class="msg-file-download" href="${meta.url}" download="${esc(meta.fileName)}" target="_blank" title="Скачать">↓</a>
        </div>`;
    return wrap;
}

async function refreshConversations() {
    let convs: ConversationDto[] = [];
    try { convs = await apiGetConversations(); } catch { return; }

    convListEl.innerHTML = "";
    if (convs.length === 0) {
        convListEl.innerHTML = `<div class="conv-empty">Нет диалогов</div>`;
        return;
    }
    for (const c of convs) {
        let preview = "…";
        try {
            const plain = await decryptMessage(c.latestCiphertext, c.latestIv, c.latestAuthTag);
            const fileMeta = decodeFileMessage(plain);
            preview = fileMeta ? `📎 ${fileMeta.fileName}` : plain;
        } catch {}
        const isMine = c.latestSenderId === myId();
        const el = document.createElement("div");
        el.className = "conv-item" + (c.partnerId === currentPartnerId ? " active" : "");
        el.dataset["pid"] = String(c.partnerId);

        const avatarDiv = document.createElement("div");
        avatarDiv.className = "conv-avatar";
        applyBg(avatarDiv, c.partnerAvatarUrl);

        const infoDiv = document.createElement("div");
        infoDiv.className = "conv-info";
        infoDiv.innerHTML = `
            <span class="conv-name">${esc(c.partnerDisplayName)}</span>
            <span class="conv-preview">${isMine ? "Вы: " : ""}${esc(preview.substring(0, 40))}${preview.length > 40 ? "…" : ""}</span>`;

        el.appendChild(avatarDiv);
        el.appendChild(infoDiv);
        el.addEventListener("click", () => openConversation(c.partnerId, c.partnerDisplayName, c.partnerAvatarUrl ?? null));
        convListEl.append(el);
    }
}

async function openConversation(partnerId: number, partnerName: string, partnerAvatar: string | null = null) {
    currentPartnerId = partnerId;
    currentPartnerAvatarUrl = partnerAvatar;
    messagesOldestId = undefined;
    messagesHasMore = true;
    messagesLoading = false;
    chatMessagesEl.innerHTML = "";
    chatTypingEl.classList.add("hidden");

    if (isMobile()) openMobileChat();
    else { chatPaneEl.classList.remove("hidden"); chatEmptyEl.classList.add("hidden"); }

    chatPartnerEl.textContent = partnerName;
    applyBg(chatPartnerAvatar as HTMLElement, partnerAvatar);
    chatStatusEl.textContent = "…";
    chatStatusEl.className = "chat-partner-status";

    const callBtn = document.getElementById("chat-call-btn");
    if (callBtn) {
        callBtn.onclick = () => startCall(partnerId, partnerName);
    }

    chatPartnerAvatar.onclick = () => openUserPage(partnerId);

    document.querySelectorAll(".conv-item").forEach(el =>
        el.classList.toggle("active", el.getAttribute("data-pid") === String(partnerId))
    );

    await loadOlderMessages();
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    chatInputEl.focus();
    await refreshPartnerStatus();
}

async function loadOlderMessages() {
    if (messagesLoading || !messagesHasMore || currentPartnerId === null) return;
    messagesLoading = true;

    const savedPartner = currentPartnerId;
    const prevScrollHeight = chatMessagesEl.scrollHeight;

    let msgs: EncryptedMessageDto[] = [];
    try { msgs = await apiGetHistory(currentPartnerId, messagesOldestId, 50); }
    catch (e) { console.error("[Chat] apiGetHistory failed:", e); }

    if (currentPartnerId !== savedPartner) { messagesLoading = false; return; }

    if (msgs.length < 50) messagesHasMore = false;

    if (msgs.length > 0) {
        messagesOldestId = msgs[msgs.length - 1]!.id;
        const els = await Promise.all([...msgs].reverse().map(m => buildMessageEl(m)));
        const frag = document.createDocumentFragment();
        els.forEach(el => frag.appendChild(el));
        chatMessagesEl.insertBefore(frag, chatMessagesEl.firstChild);
        if (prevScrollHeight > 0) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight - prevScrollHeight;
    }

    messagesLoading = false;
}

function renderMessageText(text: string): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = urlRegex.exec(text)) !== null) {
        if (match.index > lastIndex)
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        const a = document.createElement("a");
        a.href = match[0]; a.textContent = match[0];
        a.target = "_blank"; a.rel = "noopener noreferrer";
        fragment.appendChild(a);
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length)
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    return fragment;
}

async function buildMessageEl(msg: EncryptedMessageDto): Promise<HTMLElement> {
    const me = myId();
    const isOwn = msg.senderId === me;
    let text = "[зашифровано]";
    try { text = await decryptMessage(msg.ciphertext, msg.iv, msg.authTag); } catch {}

    const session = loadSession();
    const avatarUrl = isOwn
        ? (session?.avatarUrl ?? null)
        : (msg.senderAvatarUrl ?? currentPartnerAvatarUrl ?? null);

    const el = document.createElement("div");
    el.className = "msg " + (isOwn ? "msg-own" : "msg-other");
    el.dataset["id"] = String(msg.id);

    const time = new Date(msg.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

    const avatarEl = document.createElement("div");
    avatarEl.className = "msg-avatar";
    applyBg(avatarEl, avatarUrl);

    const bubbleEl = document.createElement("div");
    bubbleEl.className = "msg-bubble";

    const fileMeta = decodeFileMessage(text);
    if (fileMeta) {
        bubbleEl.appendChild(buildFileContent(fileMeta));
    } else {
        const textEl = document.createElement("div");
        textEl.className = "msg-text";
        textEl.appendChild(renderMessageText(text));
        bubbleEl.appendChild(textEl);
    }

    const timeEl = document.createElement("div");
    timeEl.className = "msg-time";
    timeEl.textContent = time;
    bubbleEl.appendChild(timeEl);

    if (isOwn) { el.appendChild(bubbleEl); el.appendChild(avatarEl); }
    else       { el.appendChild(avatarEl); el.appendChild(bubbleEl); }

    bubbleEl.addEventListener("contextmenu", e => {
        e.preventDefault();
        e.stopPropagation();

        const items = [];

        if (isOwn) {
            items.push({
                label: "Удалить сообщение",
                icon: "🗑",
                danger: true,
                action: async () => {
                    try {
                        await apiDeleteChatMessage(msg.id);
                        el.classList.add("msg-deleting");
                        el.addEventListener("animationend", () => el.remove(), { once: true });
                    } catch (err) {
                        alert((err as Error).message);
                    }
                },
            });
        }

        if (items.length > 0) showCtxMenu(e.clientX, e.clientY, items);
    });

    return el;
}

async function handleIncoming(msg: EncryptedMessageDto) {
    const me = myId();
    const openConvId = currentPartnerId;
    const belongsToOpenConv = openConvId !== null && (
        (msg.senderId === me         && msg.recipientId === openConvId) ||
        (msg.senderId === openConvId && msg.recipientId === me)
    );

    if (belongsToOpenConv && !chatPaneEl.classList.contains("hidden")) {
        const wasAtBottom = chatMessagesEl.scrollTop + chatMessagesEl.clientHeight >= chatMessagesEl.scrollHeight - 40;
        const el = await buildMessageEl(msg);
        chatMessagesEl.appendChild(el);
        if (wasAtBottom) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    } else if (msg.senderId !== me) {
        addUnread(1);
    }

    await refreshConversations();
}

async function sendMessage() {
    if (!currentPartnerId) return;
    const text = chatInputEl.value.trim();
    if (!text) return;
    chatSendBtn.setAttribute("disabled", "true");
    chatInputEl.value = "";
    if (typingTimer) { clearTimeout(typingTimer); typingTimer = null; }
    if (isTypingSent) { sendTyping(currentPartnerId, false); isTypingSent = false; }
    try { await sendEncryptedMessage(currentPartnerId, text); }
    catch (e) { chatInputEl.value = text; alert((e as Error).message); }
    finally { chatSendBtn.removeAttribute("disabled"); chatInputEl.focus(); }
}

async function sendFile(file: File) {
    if (!currentPartnerId) return;
    const MAX = 50 * 1024 * 1024;
    if (file.size > MAX) { alert("Файл слишком большой (макс. 50 МБ)"); return; }

    const progressEl = document.createElement("div");
    progressEl.className = "msg msg-own";
    progressEl.innerHTML = `<div class="msg-bubble"><div class="msg-upload-progress">
        <span class="msg-file-icon">📎</span>
        <span>Загрузка ${esc(file.name)}…</span>
    </div></div>`;
    chatMessagesEl.appendChild(progressEl);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

    try {
        const meta = await apiUploadChatFile(file);
        progressEl.remove();
        const payload = encodeFileMessage(meta);
        await sendEncryptedMessage(currentPartnerId, payload);
    } catch (e) {
        progressEl.remove();
        alert((e as Error).message);
    }
}

let searchTimeout: ReturnType<typeof setTimeout> | null = null;

function openNewChatModal() {
    newChatModal.classList.remove("hidden");
    newChatSearchEl.value = "";
    newChatResultsEl.innerHTML = "";
    newChatSearchEl.focus();
    searchAndRender("");
}

function closeNewChatModal() { newChatModal.classList.add("hidden"); }

async function searchAndRender(q: string) {
    const users = await apiSearchUsers(q);
    newChatResultsEl.innerHTML = "";
    if (users.length === 0) {
        newChatResultsEl.innerHTML = `<div class="conv-empty">Нет результатов</div>`;
        return;
    }
    for (const u of users) {
        const el = document.createElement("div");
        el.className = "user-result";
        const avatarEl = document.createElement("div");
        avatarEl.className = "conv-avatar small";
        applyBg(avatarEl, u.avatarUrl);
        const nameEl  = document.createElement("span");
        nameEl.className = "conv-name";
        nameEl.textContent = u.displayName;
        const unameEl = document.createElement("span");
        unameEl.className = "conv-uname";
        unameEl.textContent = `@${u.username}`;
        el.appendChild(avatarEl);
        el.appendChild(nameEl);
        el.appendChild(unameEl);
        el.addEventListener("click", () => { closeNewChatModal(); openConversation(u.id, u.displayName, u.avatarUrl ?? null); });
        newChatResultsEl.append(el);
    }
}

export async function initMessenger() {
    const session = loadSession();
    if (!session) return;

    await initCryptoKey(session.token.substring(0, 32));

    if (!chatConnected) {
        await connectChat();
        onChatMessage(handleIncoming);
        chatConnected = true;
    }

    const chatInputAvatar = document.getElementById("chat-input-avatar");
    if (chatInputAvatar) applyBg(chatInputAvatar, session.avatarUrl ?? null);

    await refreshConversations();

    chatMessagesEl.addEventListener("scroll", () => {
        if (chatMessagesEl.scrollTop < 60) loadOlderMessages();
    });

    chatBackBtn.addEventListener("click", closeMobileChat);

    window.addEventListener("resize", () => {
        if (!isMobile()) {
            messengerEl.classList.remove("mobile-chat-open");
            if (currentPartnerId !== null) {
                chatPaneEl.classList.remove("hidden");
                chatEmptyEl.classList.add("hidden");
            }
        }
    });

    chatSendBtn.addEventListener("click", sendMessage);
    chatInputEl.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    chatInputEl.addEventListener("input", handleTypingInput);

    chatAttachBtn.addEventListener("click", () => chatFileInput.click());
    chatFileInput.addEventListener("change", () => {
        const file = chatFileInput.files?.[0];
        if (!file) return;
        chatFileInput.value = "";
        sendFile(file);
    });

    newChatBtn.addEventListener("click", openNewChatModal);
    newChatClose.addEventListener("click", closeNewChatModal);
    newChatModal.addEventListener("click", e => { if (e.target === newChatModal) closeNewChatModal(); });
    newChatSearchEl.addEventListener("input", () => {
        if (searchTimeout) clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => searchAndRender(newChatSearchEl.value.trim()), 300);
    });
}