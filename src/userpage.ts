import { loadSession, type PostDto } from "./api";
import { startCall } from "./calls";

const BASE_URL = "http://localhost:5000/api";

export interface PublicProfile {
    id: number;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    online: boolean;
    postCount: number;
}

async function fetchPublicProfile(userId: number): Promise<PublicProfile> {
    const session = loadSession();
    const headers: Record<string, string> = {};
    if (session) headers["Authorization"] = `Bearer ${session.token}`;
    const res = await fetch(`${BASE_URL}/users/${userId}`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function fetchUserPosts(userId: number): Promise<PostDto[]> {
    const session = loadSession();
    const headers: Record<string, string> = {};
    if (session) headers["Authorization"] = `Bearer ${session.token}`;
    const res = await fetch(`${BASE_URL}/users/${userId}/posts`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function esc(t: string) {
    return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleString("ru-RU", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
}

function renderPostCard(post: PostDto): string {
    const imageHtml = post.imageUrl
        ? `<div class="up-post-image-wrap"><img src="${post.imageUrl}" class="up-post-image" loading="lazy"/></div>`
        : "";
    return `
    <div class="up-post">
        <div class="up-post-content">${post.content ? esc(post.content) : ""}</div>
        ${imageHtml}
        <div class="up-post-footer">
            <span class="up-post-stat">♥ ${post.likesCount}</span>
            <span class="up-post-stat">💬 ${post.commentsCount}</span>
            <span class="up-post-date">${formatDate(post.createdAt)}</span>
        </div>
    </div>`;
}

export async function openUserPage(userId: number) {
    const session = loadSession();
    //if (session?.userId === userId) return;

    let modal = document.getElementById("user-page-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "user-page-modal";
        modal.className = "modal-overlay";
        document.body.appendChild(modal);
        modal.addEventListener("click", e => { if (e.target === modal) closeUserPage(); });
    }

    modal.innerHTML = `
    <div class="modal-card user-page-card">
        <button class="user-page-close" id="user-page-close" title="Закрыть">
            <i class="fa-solid fa-xmark"></i>
        </button>
        <div class="user-page-loading">
            <div class="up-spinner"></div>
        </div>
    </div>`;

    modal.classList.remove("hidden");
    document.getElementById("user-page-close")!.addEventListener("click", closeUserPage);

    try {
        const [profile, posts] = await Promise.all([
            fetchPublicProfile(userId),
            fetchUserPosts(userId),
        ]);

        const isOnline = profile.online;
        const isLoggedIn = !!session;

        const card = modal.querySelector<HTMLElement>(".user-page-card")!;
        card.innerHTML = `
        <button class="user-page-close" id="user-page-close" title="Закрыть">
            <i class="fa-solid fa-xmark"></i>
        </button>

        <div class="user-page-hero">
            <div class="user-page-avatar" ${profile.avatarUrl ? `style="background-image:url('${profile.avatarUrl}');background-size:cover;background-position:center"` : ""}></div>
            <div class="user-page-presence ${isOnline ? "up-online" : "up-offline"}">
                ${isOnline ? "в сети" : "не в сети"}
            </div>
        </div>

        <div class="user-page-info">
            <h2 class="user-page-name">${esc(profile.displayName)}</h2>
            <span class="user-page-username">@${esc(profile.username)}</span>
            <span class="user-page-postcount">${profile.postCount} ${pluralPosts(profile.postCount)}</span>
        </div>

        ${isLoggedIn ? `
        <div class="user-page-actions">
            <button class="btn user-page-call-btn" id="up-call-btn" title="Аудиозвонок">
                <i class="fa-solid fa-phone"></i> Позвонить
            </button>
        </div>` : ""}

        <div class="user-page-posts">
            <h3 class="up-posts-title">Публикации</h3>
            <div class="up-posts-list" id="up-posts-list">
                ${posts.length === 0
            ? `<p class="up-no-posts">Нет публикаций</p>`
            : posts.map(renderPostCard).join("")}
            </div>
        </div>`;

        document.getElementById("user-page-close")!.addEventListener("click", closeUserPage);
        document.getElementById("up-call-btn")?.addEventListener("click", () => {
            closeUserPage();
            startCall(profile.id, profile.displayName);
        });

    } catch (e) {
        const card = modal.querySelector<HTMLElement>(".user-page-card")!;
        card.innerHTML = `
            <button class="user-page-close" id="user-page-close"><i class="fa-solid fa-xmark"></i></button>
            <div class="user-page-error"><i class="fa-solid fa-circle-exclamation"></i><p>Не удалось загрузить профиль</p></div>`;
        document.getElementById("user-page-close")!.addEventListener("click", closeUserPage);
    }
}

function closeUserPage() {
    document.getElementById("user-page-modal")?.classList.add("hidden");
}

function pluralPosts(n: number): string {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "публикация";
    if ([2,3,4].includes(mod10) && ![12,13,14].includes(mod100)) return "публикации";
    return "публикаций";
}

document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeUserPage();
});