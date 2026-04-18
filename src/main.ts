import {
    apiCreatePost,
    apiDeletePost,
    apiFetchPosts,
    apiLogin,
    apiRegister,
    loadSession,
    saveSession,
    type PostDto,
} from "./api";
import { connectFeed, onFeedEvent } from "./feedhub";
import { initMessenger } from "./messenger";
import { applyAvatar, openProfileModal } from "./profile";

let oldestPostId: number | undefined;
let isLoading = false;
let hasMore = true;
const PAGE_SIZE = 20;

const authScreen = document.getElementById("auth-screen")!;
const appShell   = document.getElementById("app-shell")!;
const feedEl     = document.getElementById("feed")!;
const postInput  = document.getElementById("post-input") as HTMLInputElement;
const postSubmit = document.getElementById("post-submit")!;
const loginBtn   = document.getElementById("login-btn")!;
const regBtn     = document.getElementById("reg-btn")!;
const loginError = document.getElementById("login-error")!;
const regError   = document.getElementById("reg-error")!;
const authTabs   = document.querySelectorAll<HTMLButtonElement>(".auth-tab");

authTabs.forEach(tab => {
    tab.addEventListener("click", () => {
        authTabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        document.querySelectorAll<HTMLElement>(".auth-form").forEach(f => f.classList.remove("active"));
        document.getElementById(`${tab.dataset["tab"]}-form`)!.classList.add("active");
    });
});

loginBtn.addEventListener("click", async () => {
    const username = (document.getElementById("login-username") as HTMLInputElement).value;
    const password = (document.getElementById("login-password") as HTMLInputElement).value;
    loginError.textContent = "";
    try { const s = await apiLogin(username, password); saveSession(s); await boot(); }
    catch (e: unknown) { loginError.textContent = (e as Error).message; }
});

regBtn.addEventListener("click", async () => {
    const username    = (document.getElementById("reg-username") as HTMLInputElement).value;
    const displayName = (document.getElementById("reg-displayname") as HTMLInputElement).value;
    const password    = (document.getElementById("reg-password") as HTMLInputElement).value;
    regError.textContent = "";
    try { const s = await apiRegister(username, displayName, password); saveSession(s); await boot(); }
    catch (e: unknown) { regError.textContent = (e as Error).message; }
});

const navItems = document.querySelectorAll<HTMLElement>(".nav-item");
const tabEls: Record<string, HTMLElement> = {
    feed:      document.getElementById("tab-feed")!,
    messenger: document.getElementById("tab-messenger")!,
};

function switchTab(name: string) {
    navItems.forEach(n => n.classList.toggle("active", n.dataset["tab"] === name));
    Object.entries(tabEls).forEach(([k, el]) => el.classList.toggle("hidden", k !== name));
}

navItems.forEach(item => item.addEventListener("click", () => switchTab(item.dataset["tab"]!)));

document.getElementById("sidebar-profile-btn")!.addEventListener("click", openProfileModal);

postSubmit.addEventListener("click", async () => {
    const content = postInput.value.trim();
    if (!content) return;
    postSubmit.setAttribute("disabled", "true");
    try { await apiCreatePost(content); postInput.value = ""; }
    catch (e: unknown) { alert((e as Error).message); }
    finally { postSubmit.removeAttribute("disabled"); }
});

function esc(t: string) { return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

function makeAvatarHtml(url: string | null | undefined, cls = ""): string {
    if (url) {
        return `<div class="avatar ${cls}" style="background-image:url('${url}');background-size:cover;background-position:center;"></div>`;
    }
    return `<div class="avatar ${cls}"></div>`;
}

function renderPost(post: PostDto, prepend = false): HTMLElement {
    const session = loadSession();
    const isOwn = session?.userId === post.userId;
    const el = document.createElement("div");
    el.className = "post";
    el.dataset["id"] = String(post.id);
    const date = new Date(post.createdAt).toLocaleString("ru-RU", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
    el.innerHTML = `
    <div class="post-header">
      ${makeAvatarHtml((post as any).avatarUrl, isOwn ? "my-avatar" : "")}
      <div class="post-meta">
        <span class="post-author">${esc(post.displayName)}</span>
        <span class="post-username">@${esc(post.username)}</span>
        <span class="post-date">${date}</span>
      </div>
      ${isOwn ? `<button class="btn icon post-delete" data-id="${post.id}" title="Удалить">✕</button>` : ""}
    </div>
    <div class="post-content">${esc(post.content)}</div>`;

    if (isOwn) {
        const avatarEl = el.querySelector<HTMLElement>(".my-avatar");
        if (avatarEl) applyAvatar(avatarEl, session?.avatarUrl ?? null);
    }

    el.querySelector(".post-delete")?.addEventListener("click", async () => {
        if (!confirm("Удалить пост?")) return;
        await apiDeletePost(post.id);
    });
    if (prepend) feedEl.prepend(el);
    else feedEl.append(el);
    return el;
}

async function loadMore() {
    if (isLoading || !hasMore) return;
    isLoading = true;
    const posts = await apiFetchPosts(oldestPostId, PAGE_SIZE);
    if (posts.length < PAGE_SIZE) hasMore = false;
    if (posts.length > 0) { posts.forEach(p => renderPost(p)); oldestPostId = posts[posts.length-1]!.id; }
    isLoading = false;
}

const tabFeedEl = document.getElementById("tab-feed")!;
tabFeedEl.addEventListener("scroll", () => {
    if (tabFeedEl.scrollTop + tabFeedEl.clientHeight >= tabFeedEl.scrollHeight - 300) loadMore();
});

function wireSignalR() {
    onFeedEvent("newPost", post => renderPost(post, true));
    onFeedEvent("deletePost", id => { document.querySelector<HTMLElement>(`.post[data-id="${id}"]`)?.remove(); });
}

async function boot() {
    authScreen.classList.add("hidden");
    appShell.classList.remove("hidden");

    const session = loadSession()!;

    const sidebarName = document.getElementById("sidebar-user-name")!;
    sidebarName.textContent = session.displayName;

    const myAvatarUrl = session.avatarUrl ?? null;
    document.querySelectorAll<HTMLElement>(".my-avatar").forEach(el => applyAvatar(el, myAvatarUrl));

    feedEl.innerHTML = "";
    oldestPostId = undefined;
    hasMore = true;

    await connectFeed();
    wireSignalR();
    await loadMore();

    switchTab("feed");
    await initMessenger();
}

const existingSession = loadSession();
if (existingSession) boot();