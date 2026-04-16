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

let oldestPostId: number | undefined;
let isLoading = false;
let hasMore = true;
const PAGE_SIZE = 20;

const authScreen = document.getElementById("auth-screen")!;
const feedEl = document.getElementById("feed")!;
const createPostEl = document.getElementById("create-post")!;
const postInput = document.getElementById("post-input") as HTMLInputElement;
const postSubmit = document.getElementById("post-submit")!;

const loginBtn = document.getElementById("login-btn")!;
const regBtn = document.getElementById("reg-btn")!;
const loginError = document.getElementById("login-error")!;
const regError = document.getElementById("reg-error")!;
const authTabs = document.querySelectorAll<HTMLButtonElement>(".auth-tab");

authTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
        authTabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        document
            .querySelectorAll<HTMLElement>(".auth-form")
            .forEach((f) => f.classList.remove("active"));
        document.getElementById(`${tab.dataset["tab"]}-form`)!.classList.add("active");
    });
});

loginBtn.addEventListener("click", async () => {
    const username = (document.getElementById("login-username") as HTMLInputElement).value;
    const password = (document.getElementById("login-password") as HTMLInputElement).value;
    loginError.textContent = "";
    try {
        const session = await apiLogin(username, password);
        saveSession(session);
        await boot();
    } catch (e: unknown) {
        loginError.textContent = (e as Error).message;
    }
});

regBtn.addEventListener("click", async () => {
    const username = (document.getElementById("reg-username") as HTMLInputElement).value;
    const displayName = (document.getElementById("reg-displayname") as HTMLInputElement).value;
    const password = (document.getElementById("reg-password") as HTMLInputElement).value;
    regError.textContent = "";
    try {
        const session = await apiRegister(username, displayName, password);
        saveSession(session);
        await boot();
    } catch (e: unknown) {
        regError.textContent = (e as Error).message;
    }
});

postSubmit.addEventListener("click", async () => {
    const content = postInput.value.trim();
    if (!content) return;
    postSubmit.setAttribute("disabled", "true");
    try {
        await apiCreatePost(content);
        postInput.value = "";
        // Пост придёт через SignalR и сам вставится в ленту
    } catch (e: unknown) {
        alert((e as Error).message);
    } finally {
        postSubmit.removeAttribute("disabled");
    }
});

function renderPost(post: PostDto, prepend = false): HTMLElement {
    const session = loadSession();
    const isOwn = session?.userId === post.userId;

    const el = document.createElement("div");
    el.className = "post";
    el.dataset["id"] = String(post.id);

    const date = new Date(post.createdAt).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });

    el.innerHTML = `
    <div class="post-header">
      <div class="avatar"></div>
      <div class="post-meta">
        <span class="post-author">${esc(post.displayName)}</span>
        <span class="post-username">@${esc(post.username)}</span>
        <span class="post-date">${date}</span>
      </div>
      ${isOwn ? `<button class="btn icon post-delete" data-id="${post.id}" title="Удалить">✕</button>` : ""}
    </div>
    <div class="post-content">${esc(post.content)}</div>
  `;

    el.querySelector(".post-delete")?.addEventListener("click", async () => {
        if (!confirm("Удалить пост?")) return;
        await apiDeletePost(post.id);
    });

    if (prepend) feedEl.prepend(el);
    else feedEl.append(el);

    return el;
}

function esc(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function loadMore() {
    if (isLoading || !hasMore) return;
    isLoading = true;

    const posts = await apiFetchPosts(oldestPostId, PAGE_SIZE);

    if (posts.length < PAGE_SIZE) hasMore = false;
    if (posts.length > 0) {
        posts.forEach((p) => renderPost(p));
        oldestPostId = posts[posts.length - 1]!.id;
    }

    isLoading = false;
}

window.addEventListener("scroll", () => {
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 300) {
        loadMore();
    }
});

function wireSignalR() {
    onFeedEvent("newPost", (post) => {
        renderPost(post, true);
    });

    onFeedEvent("deletePost", (id) => {
        document.querySelector<HTMLElement>(`.post[data-id="${id}"]`)?.remove();
    });
}


async function boot() {
    authScreen.classList.add("hidden");
    feedEl.classList.remove("hidden");
    createPostEl.classList.remove("hidden");

    feedEl.innerHTML = "";
    oldestPostId = undefined;
    hasMore = true;

    await connectFeed();
    wireSignalR();
    await loadMore();
}

const existingSession = loadSession();
if (existingSession) {
    boot();
}