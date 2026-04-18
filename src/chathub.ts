import * as signalR from "@microsoft/signalr";
import { loadSession } from "./api";

const BASE_URL = "http://localhost:5000/api";
const HUB_URL  = "http://localhost:5000/hubs/chat";

const SALT = new Uint8Array([83,97,98,97,107,105,117,109,83,97,108,116]);

let _cryptoKey: CryptoKey | null = null;

export async function initCryptoKey(passphrase: string) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]
    );
    _cryptoKey = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: SALT, iterations: 100_000, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

export async function encryptMessage(plaintext: string): Promise<{ ciphertext: string; iv: string; authTag: string }> {
    if (!_cryptoKey) throw new Error("Crypto key not initialized");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, tagLength: 128 },
        _cryptoKey,
        new TextEncoder().encode(plaintext)
    );
    const full = new Uint8Array(encrypted);
    const ciphertextBytes = full.slice(0, full.length - 16);
    const authTagBytes    = full.slice(full.length - 16);
    return {
        ciphertext: btoa(String.fromCharCode(...ciphertextBytes)),
        iv:         btoa(String.fromCharCode(...iv)),
        authTag:    btoa(String.fromCharCode(...authTagBytes)),
    };
}

export async function decryptMessage(ciphertext: string, iv: string, authTag: string): Promise<string> {
    if (!_cryptoKey) throw new Error("Crypto key not initialized");
    const ct  = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    const ivB = Uint8Array.from(atob(iv),         c => c.charCodeAt(0));
    const tag = Uint8Array.from(atob(authTag),    c => c.charCodeAt(0));
    const combined = new Uint8Array(ct.length + tag.length);
    combined.set(ct);
    combined.set(tag, ct.length);
    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivB, tagLength: 128 },
        _cryptoKey,
        combined
    );
    return new TextDecoder().decode(decrypted);
}

export interface EncryptedMessageDto {
    id: number;
    senderId: number;
    senderUsername: string;
    senderDisplayName: string;
    senderAvatarUrl?: string | null;
    recipientId: number;
    ciphertext: string;
    iv: string;
    authTag: string;
    createdAt: string;
}

export interface ConversationDto {
    partnerId: number;
    partnerUsername: string;
    partnerDisplayName: string;
    partnerAvatarUrl?: string | null;
    latestMessageId: number;
    latestCiphertext: string;
    latestIv: string;
    latestAuthTag: string;
    latestSenderId: number;
    latestCreatedAt: string;
}

export interface UserDto {
    id: number;
    username: string;
    displayName: string;
    avatarUrl?: string | null;
}

export type PresenceHandler   = (userId: number, online: boolean) => void;
export type TypingHandler     = (userId: number, isTyping: boolean) => void;

const presenceHandlers: PresenceHandler[] = [];
const typingHandlers: TypingHandler[] = [];

export function onPresenceChange(fn: PresenceHandler) { presenceHandlers.push(fn); }
export function onTypingChange(fn: TypingHandler)     { typingHandlers.push(fn); }

function authHeader(): Record<string, string> {
    const s = loadSession();
    return s ? { Authorization: `Bearer ${s.token}` } : {};
}

async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, { headers: authHeader() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function apiGetConversations(): Promise<ConversationDto[]> {
    return get("/chat/conversations");
}

export async function apiGetHistory(otherUserId: number, before?: number, limit = 50): Promise<EncryptedMessageDto[]> {
    const p = new URLSearchParams({ limit: String(limit) });
    if (before !== undefined) p.set("before", String(before));
    return get(`/chat/history/${otherUserId}?${p}`);
}

export async function apiSearchUsers(q: string): Promise<UserDto[]> {
    return get(`/chat/users?q=${encodeURIComponent(q)}`);
}

export async function apiCheckOnline(userId: number): Promise<{ online: boolean }> {
    return get(`/chat/online/${userId}`);
}

export async function apiDeleteChatMessage(messageId: number): Promise<void> {
    const session = loadSession();
    const res = await fetch(`${BASE_URL}/chat/messages/${messageId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session?.token}` },
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Ошибка" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
    }
}

export async function apiUploadChatFile(file: File): Promise<{
    url: string; fileName: string; fileSize: number; mimeType: string;
}> {
    const session = loadSession();
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE_URL}/chat/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.token}` },
        body: form,
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Ошибка загрузки" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return res.json();
}

let connection: signalR.HubConnection | null = null;
const messageHandlers: ((msg: EncryptedMessageDto) => void)[] = [];

export function onChatMessage(handler: (msg: EncryptedMessageDto) => void) {
    messageHandlers.push(handler);
}

export async function connectChat() {
    const session = loadSession();
    connection = new signalR.HubConnectionBuilder()
        .withUrl(HUB_URL, { accessTokenFactory: () => session?.token ?? "" })
        .withAutomaticReconnect()
        .configureLogging(signalR.LogLevel.Warning)
        .build();

    connection.on("ReceiveMessage", (msg: EncryptedMessageDto) => {
        messageHandlers.forEach(fn => fn(msg));
    });

    connection.on("UserOnline", (userId: number) => {
        presenceHandlers.forEach(fn => fn(userId, true));
    });

    connection.on("UserOffline", (userId: number) => {
        presenceHandlers.forEach(fn => fn(userId, false));
    });

    connection.on("UserTyping", (userId: number, isTyping: boolean) => {
        typingHandlers.forEach(fn => fn(userId, isTyping));
    });

    await connection.start();
    console.log("[ChatHub] connected");
}

export async function sendEncryptedMessage(recipientId: number, plaintext: string) {
    if (!connection) throw new Error("Not connected");
    const { ciphertext, iv, authTag } = await encryptMessage(plaintext);
    await connection.invoke("SendMessage", recipientId, ciphertext, iv, authTag);
}

export async function sendTyping(recipientId: number, isTyping: boolean) {
    if (!connection) return;
    try { await connection.invoke("SetTyping", recipientId, isTyping); } catch {}
}

export function encodeFileMessage(meta: {
    url: string; fileName: string; fileSize: number; mimeType: string;
}): string {
    return `__FILE__${JSON.stringify(meta)}`;
}

export function decodeFileMessage(text: string): {
    url: string; fileName: string; fileSize: number; mimeType: string;
} | null {
    if (!text.startsWith("__FILE__")) return null;
    try { return JSON.parse(text.slice(8)); } catch { return null; }
}