import {
    apiGetConversations,
    apiGetHistory,
    apiSearchUsers,
    connectChat,
    decryptMessage,
    initCryptoKey,
    onChatMessage,
    sendEncryptedMessage,
    type EncryptedMessageDto
} from "./chathub";
import { loadSession } from "./api";

let currentPartnerId: number | null = null;
let chatConnected = false;
let messagesOldestId: number | undefined;
let messagesHasMore = true;
let messagesLoading = false;

const convListEl   = document.getElementById("conv-list")!;
const chatPaneEl   = document.getElementById("chat-pane")!;
const chatMessagesEl = document.getElementById("chat-messages")!;
const chatInputEl  = document.getElementById("chat-input") as HTMLInputElement;
const chatSendBtn  = document.getElementById("chat-send")!;
const chatPartnerEl = document.getElementById("chat-partner-name")!;
const newChatBtn   = document.getElementById("new-chat-btn")!;
const newChatModal = document.getElementById("new-chat-modal")!;
const newChatClose = document.getElementById("new-chat-close")!;
const newChatSearchEl = document.getElementById("new-chat-search") as HTMLInputElement;
const newChatResultsEl = document.getElementById("new-chat-results")!;

function esc(t: string) {
    return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

async function refreshConversations() {
    const convs = await apiGetConversations();
    convListEl.innerHTML = "";
    if (convs.length === 0) {
        convListEl.innerHTML = `<div class="conv-empty">Нет диалогов</div>`;
        return;
    }
    for (const c of convs) {
        let preview = "…";
        try {
            preview = await decryptMessage(c.latestCiphertext, c.latestIv, c.latestAuthTag);
        } catch { /* key mismatch */ }
        const isMine = c.latestSenderId === loadSession()?.userId;
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
    chatMessagesEl.innerHTML = "";
    chatPaneEl.classList.remove("hidden");
    chatPartnerEl.textContent = partnerName;

    // Mark active conversation
    document.querySelectorAll(".conv-item").forEach(el => {
        el.classList.toggle("active", el.getAttribute("data-pid") === String(partnerId));
    });

    await loadOlderMessages();
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

async function loadOlderMessages() {
    if (messagesLoading || !messagesHasMore || currentPartnerId === null) return;
    messagesLoading = true;
    const msgs = await apiGetHistory(currentPartnerId, messagesOldestId, 50);
    if (msgs.length < 50) messagesHasMore = false;
    if (msgs.length > 0) {
        // msgs are newest-first, reverse to render oldest-first
        const ordered = [...msgs].reverse();
        for (const m of ordered) {
            await prependMessage(m);
        }
        messagesOldestId = msgs[msgs.length - 1]!.id;
    }
    messagesLoading = false;
}

async function renderMessage(msg: EncryptedMessageDto, prepend = false) {
    const session = loadSession();
    const isOwn = msg.senderId === session?.userId;
    let text = "[зашифровано]";
    try {
        text = await decryptMessage(msg.ciphertext, msg.iv, msg.authTag);
    } catch { /* cannot decrypt */ }

    const el = document.createElement("div");
    el.className = "msg " + (isOwn ? "msg-own" : "msg-other");
    el.dataset["id"] = String(msg.id);

    const time = new Date(msg.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    el.innerHTML = `
        <div class="msg-bubble">
            <div class="msg-text">${esc(text)}</div>
            <div class="msg-time">${time}</div>
        </div>`;

    if (prepend) chatMessagesEl.prepend(el);
    else chatMessagesEl.append(el);
}

async function prependMessage(msg: EncryptedMessageDto) {
    await renderMessage(msg, true);
}

async function handleIncoming(msg: EncryptedMessageDto) {
    // Refresh sidebar
    await refreshConversations();

    if (msg.senderId !== currentPartnerId && msg.recipientId !== currentPartnerId) return;
    // Only render if this conversation is open
    const myId = loadSession()?.userId;
    const isThisConv =
        (msg.senderId === myId && msg.recipientId === currentPartnerId) ||
        (msg.senderId === currentPartnerId && msg.recipientId === myId);
    if (!isThisConv) return;

    const wasAtBottom = chatMessagesEl.scrollTop + chatMessagesEl.clientHeight >= chatMessagesEl.scrollHeight - 30;
    await renderMessage(msg, false);
    if (wasAtBottom) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
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
        alert((e as Error).message);
    } finally {
        chatSendBtn.removeAttribute("disabled");
    }
}

let searchTimeout: ReturnType<typeof setTimeout> | null = null;

function openNewChatModal() {
    newChatModal.classList.remove("hidden");
    newChatSearchEl.value = "";
    newChatResultsEl.innerHTML = "";
    newChatSearchEl.focus();
}

function closeNewChatModal() {
    newChatModal.classList.add("hidden");
}

async function searchAndRender(q: string) {
    const users = await apiSearchUsers(q);
    newChatResultsEl.innerHTML = "";
    for (const u of users) {
        const el = document.createElement("div");
        el.className = "user-result";
        el.innerHTML = `<div class="conv-avatar small"></div><span class="conv-name">${esc(u.displayName)}</span><span class="conv-uname">@${esc(u.username)}</span>`;
        el.addEventListener("click", () => {
            closeNewChatModal();
            openConversation(u.id, u.displayName);
        });
        newChatResultsEl.append(el);
    }
    if (users.length === 0) newChatResultsEl.innerHTML = `<div class="conv-empty">Нет результатов</div>`;
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
    chatInputEl.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }});
    newChatBtn.addEventListener("click", openNewChatModal);
    newChatClose.addEventListener("click", closeNewChatModal);
    newChatModal.addEventListener("click", e => { if (e.target === newChatModal) closeNewChatModal(); });
    newChatSearchEl.addEventListener("input", () => {
        if (searchTimeout) clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => searchAndRender(newChatSearchEl.value.trim()), 300);
    });
}