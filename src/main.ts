import {
    apiCreatePost,
    apiDeletePost,
    apiFetchPosts,
    apiLikePost,
    apiLogin,
    apiRegister,
    loadSession,
    saveSession,
    apiFetchComments,
    apiCreateComment,
    apiDeleteComment,
    type PostDto,
    type CommentDto,
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
const postInput  = document.getElementById("post-input") as HTMLTextAreaElement;
const postSubmit = document.getElementById("post-submit")!;
const loginBtn   = document.getElementById("login-btn")!;
const regBtn     = document.getElementById("reg-btn")!;
const loginError = document.getElementById("login-error")!;
const regError   = document.getElementById("reg-error")!;
const authTabs   = document.querySelectorAll<HTMLButtonElement>(".auth-tab");

let selectedImage: File | null = null;

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

const attachImageBtn = document.getElementById("attach-image-btn")!;
const imageFileInput = document.getElementById("image-file-input") as HTMLInputElement;
const imagePreviewEl = document.getElementById("image-preview")!;

attachImageBtn.addEventListener("click", () => imageFileInput.click());

imageFileInput.addEventListener("change", () => {
    const file = imageFileInput.files?.[0];
    if (!file) return;
    selectedImage = file;
    const url = URL.createObjectURL(file);
    imagePreviewEl.innerHTML = `
        <div class="image-preview-wrap">
            <img src="${url}" class="post-image-preview" alt="preview"/>
            <button class="image-preview-remove" id="remove-image-btn" title="Убрать">✕</button>
        </div>`;
    document.getElementById("remove-image-btn")!.addEventListener("click", () => {
        selectedImage = null;
        imageFileInput.value = "";
        imagePreviewEl.innerHTML = "";
    });
});

postSubmit.addEventListener("click", async () => {
    const content = postInput.value.trim();
    if (!content && !selectedImage) return;
    postSubmit.setAttribute("disabled", "true");
    try {
        await apiCreatePost(content, selectedImage);
        postInput.value = "";
        selectedImage = null;
        imageFileInput.value = "";
        imagePreviewEl.innerHTML = "";
    }
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

function renderComment(comment: CommentDto, container: HTMLElement, postId: number): void {
    const session = loadSession();
    const isOwn = session?.userId === comment.userId;
    const date = new Date(comment.createdAt).toLocaleString("ru-RU", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });

    const el = document.createElement("div");
    el.className = "comment";
    el.dataset["id"] = String(comment.id);
    el.innerHTML = `
        <div class="comment-header">
            ${makeAvatarHtml(comment.avatarUrl, "comment-avatar")}
            <div class="comment-meta">
                <span class="comment-author">${esc(comment.displayName)}</span>
                <span class="comment-username">@${esc(comment.username)}</span>
                <span class="comment-date">${date}</span>
            </div>
            ${isOwn ? `<button class="comment-delete" data-comment-id="${comment.id}" title="Удалить">✕</button>` : ""}
        </div>
        <div class="comment-content">${esc(comment.content)}</div>`;

    el.querySelector(".comment-delete")?.addEventListener("click", async () => {
        if (!confirm("Удалить комментарий?")) return;
        try {
            await apiDeleteComment(postId, comment.id);
            el.remove();
            // decrement counter
            const postEl = document.querySelector<HTMLElement>(`.post[data-id="${postId}"]`);
            const counter = postEl?.querySelector<HTMLElement>(".comments-count");
            if (counter) counter.textContent = String(Math.max(0, parseInt(counter.textContent ?? "0") - 1));
        } catch (e: unknown) { alert((e as Error).message); }
    });

    container.appendChild(el);
}

function openComments(postEl: HTMLElement, post: PostDto): void {
    const existing = postEl.querySelector<HTMLElement>(".comments-section");
    if (existing) { existing.remove(); return; }

    const session = loadSession();
    const isLoggedIn = !!session;

    const section = document.createElement("div");
    section.className = "comments-section";
    section.innerHTML = `
        <div class="comments-list"></div>
        ${isLoggedIn ? `
        <div class="comment-composer">
            ${makeAvatarHtml(session?.avatarUrl, "comment-composer-avatar")}
            <input class="comment-input" placeholder="Написать комментарий…" maxlength="1000"/>
            <button class="btn submit comment-submit">Отправить</button>
        </div>` : `<p class="comments-login-hint">Войдите, чтобы оставить комментарий</p>`}`;

    postEl.appendChild(section);

    const listEl = section.querySelector<HTMLElement>(".comments-list")!;
    const loadingEl = document.createElement("div");
    loadingEl.className = "comments-loading";
    loadingEl.textContent = "Загрузка…";
    listEl.appendChild(loadingEl);

    apiFetchComments(post.id).then(comments => {
        loadingEl.remove();
        if (comments.length === 0) {
            listEl.innerHTML = `<p class="comments-empty">Пока нет комментариев</p>`;
        } else {
            comments.forEach(c => renderComment(c, listEl, post.id));
        }
    }).catch(() => { loadingEl.textContent = "Ошибка загрузки"; });

    if (!isLoggedIn) return;

    const input = section.querySelector<HTMLInputElement>(".comment-input")!;
    const submitBtn = section.querySelector<HTMLButtonElement>(".comment-submit")!;

    const doSubmit = async () => {
        const text = input.value.trim();
        if (!text) return;
        submitBtn.disabled = true;
        try {
            const comment = await apiCreateComment(post.id, text);
            listEl.querySelector(".comments-empty")?.remove();
            renderComment(comment, listEl, post.id);
            input.value = "";
            const counter = postEl.querySelector<HTMLElement>(".comments-count");
            if (counter) counter.textContent = String(parseInt(counter.textContent ?? "0") + 1);
            listEl.scrollTop = listEl.scrollHeight;
        } catch (e: unknown) { alert((e as Error).message); }
        finally { submitBtn.disabled = false; }
    };

    submitBtn.addEventListener("click", doSubmit);
    input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSubmit(); } });
}

function renderPost(post: PostDto, prepend = false): HTMLElement {
    const session = loadSession();
    const isOwn = session?.userId === post.userId;
    const isLoggedIn = !!session;
    const el = document.createElement("div");
    el.className = "post";
    el.dataset["id"] = String(post.id);
    const date = new Date(post.createdAt).toLocaleString("ru-RU", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });

    const imageHtml = post.imageUrl
        ? `<div class="post-image-container"><img src="${post.imageUrl}" class="post-image" alt="Изображение поста" loading="lazy"/></div>`
        : "";

    const likeClass = post.likedByMe ? "liked" : "";
    const likeBtn = isLoggedIn
        ? `<button class="btn like-btn ${likeClass}" data-id="${post.id}" title="Лайк">
               <span class="like-icon">♥</span>
               <span class="like-count">${post.likesCount}</span>
           </button>`
        : `<span class="like-display"><span class="like-icon">♥</span><span class="like-count">${post.likesCount}</span></span>`;

    const commentBtn = `<button class="btn comments-btn" data-id="${post.id}" title="Комментарии">
        <i class="fa-regular fa-comment"></i>
        <span class="comments-count">${post.commentsCount}</span>
    </button>`;

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
    ${post.content ? `<div class="post-content">${esc(post.content)}</div>` : ""}
    ${imageHtml}
    <div class="post-actions">
      ${likeBtn}
      ${commentBtn}
    </div>`;

    if (isOwn) {
        const avatarEl = el.querySelector<HTMLElement>(".my-avatar");
        if (avatarEl) applyAvatar(avatarEl, session?.avatarUrl ?? null);
    }

    el.querySelector(".post-delete")?.addEventListener("click", async () => {
        if (!confirm("Удалить пост?")) return;
        await apiDeletePost(post.id);
    });

    el.querySelector(".like-btn")?.addEventListener("click", async (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.disabled = true;
        try {
            const res = await apiLikePost(post.id);
            btn.classList.toggle("liked", res.liked);
            btn.querySelector(".like-count")!.textContent = String(res.likesCount);
            post.likedByMe = res.liked;
            post.likesCount = res.likesCount;
        } finally { btn.disabled = false; }
    });

    el.querySelector(".comments-btn")?.addEventListener("click", () => openComments(el, post));

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
    onFeedEvent("updateLikes", (data: { postId: number; likesCount: number }) => {
        const postEl = document.querySelector<HTMLElement>(`.post[data-id="${data.postId}"]`);
        if (!postEl) return;
        const countEl = postEl.querySelector(".like-count");
        if (countEl) countEl.textContent = String(data.likesCount);
    });
    onFeedEvent("newComment", (data: { postId: number; comment: CommentDto }) => {
        const postEl = document.querySelector<HTMLElement>(`.post[data-id="${data.postId}"]`);
        if (!postEl) return;
        // update counter
        const counter = postEl.querySelector<HTMLElement>(".comments-count");
        if (counter) counter.textContent = String(parseInt(counter.textContent ?? "0") + 1);
        const listEl = postEl.querySelector<HTMLElement>(".comments-list");
        if (!listEl) return;
        const session = loadSession();
        if (session?.userId === data.comment.userId) return;
        listEl.querySelector(".comments-empty")?.remove();
        renderComment(data.comment, listEl, data.postId);
    });
}

async function boot() {
    authScreen.classList.add("hidden");
    appShell.classList.remove("hidden");

    const session = loadSession()!;
    document.getElementById("sidebar-user-name")!.textContent = session.displayName;

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