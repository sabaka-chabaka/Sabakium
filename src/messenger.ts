import {
    apiGetConversations,
    apiGetHistory,
    apiSearchUsers,
    connectChat,
    decryptMessage,
    initCryptoKey,
    onChatMessage,
    sendEncryptedMessage,
    type ConversationDto,
    type EncryptedMessageDto,
} from "./chathub";
import { loadSession } from "./api";

let currentPartnerId: number | null = null;
let chatConnected = false;
let messagesOldestId: number | undefined;
let messagesHasMore = true;
let messagesLoading = false;
let unreadCount = 0;

const convListEl       = document.getElementById("conv-list")!;
const chatPaneEl       = document.getElementById("chat-pane")!;
const chatEmptyEl      = document.getElementById("chat-empty")!;
const chatMessagesEl   = document.getElementById("chat-messages")!;
const chatInputEl      = document.getElementById("chat-input") as HTMLInputElement;
const chatSendBtn      = document.getElementById("chat-send")!;
const chatPartnerEl    = document.getElementById("chat-partner-name")!;
const newChatBtn       = document.getElementById("new-chat-btn")!;
const newChatModal     = document.getElementById("new-chat-modal")!;
const newChatClose     = document.getElementById("new-chat-close")!;
const newChatSearchEl  = document.getElementById("new-chat-search") as HTMLInputElement;
const newChatResultsEl = document.getElementById("new-chat-results")!;
const messengerNavBtn  = document.querySelector<HTMLElement>('.nav-item[data-tab="messenger"]')!;

function esc(t: string) {
    return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function myId(): number | undefined {
    return loadSession()?.userId;
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
        try { preview = await decryptMessage(c.latestCiphertext, c.latestIv, c.latestAuthTag); } catch {}
        const isMine = c.latestSenderId === myId();
        const el = document.createElement("div");
        el.className = "conv-item" + (c.partnerId === currentPartnerId ? " active" : "");
        el.dataset["pid"] = String(c.partnerId);
        el.innerHTML = `
            <div class="conv-avatar"></div>
            <div class="conv-info">
                <span class="conv-name">${esc(c.partnerDisplayName)}</span>
                <span class="conv-preview">${isMine ? "Вы: " : ""}${esc(preview.substring(0, 40))}${preview.length > 40 ? "…" : ""}</span>
            </div>`;
        el.addEventListener("click", () => openConversation(c.partnerId, c.partnerDisplayName));
        convListEl.append(el);
    }
}

async function openConversation(partnerId: number, partnerName: string) {
    currentPartnerId = partnerId;
    messagesOldestId = undefined;
    messagesHasMore = true;
    messagesLoading = false;
    chatMessagesEl.innerHTML = "";

    chatPaneEl.classList.remove("hidden");
    chatEmptyEl.classList.add("hidden");
    chatPartnerEl.textContent = partnerName;

    document.querySelectorAll(".conv-item").forEach(el =>
        el.classList.toggle("active", el.getAttribute("data-pid") === String(partnerId))
    );

    await loadOlderMessages();
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    chatInputEl.focus();
}

async function loadOlderMessages() {
    if (messagesLoading || !messagesHasMore || currentPartnerId === null) return;
    messagesLoading = true;

    const savedPartner = currentPartnerId;
    const prevScrollHeight = chatMessagesEl.scrollHeight;

    let msgs: EncryptedMessageDto[] = [];
    try {
        msgs = await apiGetHistory(currentPartnerId, messagesOldestId, 50);
        console.log(`[Chat] history for ${currentPartnerId}:`, msgs);
    } catch (e) {
        console.error("[Chat] apiGetHistory failed:", e);
    }

    if (currentPartnerId !== savedPartner) { messagesLoading = false; return; }

    if (msgs.length < 50) messagesHasMore = false;

    if (msgs.length > 0) {
        messagesOldestId = msgs[msgs.length - 1]!.id;

        const els = await Promise.all([...msgs].reverse().map(m => buildMessageEl(m)));
        const frag = document.createDocumentFragment();
        els.forEach(el => frag.appendChild(el));
        chatMessagesEl.insertBefore(frag, chatMessagesEl.firstChild);

        // Keep scroll position when prepending older messages
        if (messagesOldestId !== undefined && prevScrollHeight > 0) {
            chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight - prevScrollHeight;
        }
    }

    messagesLoading = false;
}

async function buildMessageEl(msg: EncryptedMessageDto): Promise<HTMLElement> {
    const isOwn = msg.senderId === myId();
    let text = "[зашифровано]";
    try { text = await decryptMessage(msg.ciphertext, msg.iv, msg.authTag); } catch {}

    const el = document.createElement("div");
    el.className = "msg " + (isOwn ? "msg-own" : "msg-other");
    el.dataset["id"] = String(msg.id);

    const time = new Date(msg.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    el.innerHTML = `
        <div class="msg-bubble">
            <div class="msg-text">${esc(text)}</div>
            <div class="msg-time">${time}</div>
        </div>`;
    return el;
}

async function handleIncoming(msg: EncryptedMessageDto) {
    const me = myId();
    const openConvId = currentPartnerId;

    const belongsToOpenConv = openConvId !== null && (
        (msg.senderId === me      && msg.recipientId === openConvId) ||
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
    try {
        await sendEncryptedMessage(currentPartnerId, text);
    } catch (e) {
        chatInputEl.value = text; // restore on error
        alert((e as Error).message);
    } finally {
        chatSendBtn.removeAttribute("disabled");
        chatInputEl.focus();
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

function closeNewChatModal() {
    newChatModal.classList.add("hidden");
}

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
        el.innerHTML = `
            <div class="conv-avatar small"></div>
            <span class="conv-name">${esc(u.displayName)}</span>
            <span class="conv-uname">@${esc(u.username)}</span>`;
        el.addEventListener("click", () => {
            closeNewChatModal();
            openConversation(u.id, u.displayName);
        });
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

    await refreshConversations();

    chatMessagesEl.addEventListener("scroll", () => {
        if (chatMessagesEl.scrollTop < 60) loadOlderMessages();
    });

    chatSendBtn.addEventListener("click", sendMessage);
    chatInputEl.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    newChatBtn.addEventListener("click", openNewChatModal);
    newChatClose.addEventListener("click", closeNewChatModal);
    newChatModal.addEventListener("click", e => { if (e.target === newChatModal) closeNewChatModal(); });
    newChatSearchEl.addEventListener("input", () => {
        if (searchTimeout) clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => searchAndRender(newChatSearchEl.value.trim()), 300);
    });
}