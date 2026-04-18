import {apiGetProfile, apiUpdateDisplayName, apiUploadAvatar, loadSession, saveSession} from "./api.ts";

const modal    = document.getElementById("profile-modal")!;
const closeBtn = document.getElementById("profile-close")!;

export function openProfileModal() {
    modal.classList.remove("hidden");
    loadProfileIntoForm();
}

function closeProfileModal() {
    modal.classList.add("hidden");
}

closeBtn.addEventListener("click", closeProfileModal);
modal.addEventListener("click", e => { if (e.target === modal) closeProfileModal(); });

const avatarPreview   = document.getElementById("profile-avatar-preview") as HTMLImageElement;
const avatarInput     = document.getElementById("profile-avatar-input") as HTMLInputElement;
const avatarChange    = document.getElementById("profile-avatar-change")!;
const displayNameInput= document.getElementById("profile-displayname") as HTMLInputElement;
const saveBtn         = document.getElementById("profile-save")!;
const profileError    = document.getElementById("profile-error")!;
const profileSuccess  = document.getElementById("profile-success")!;

async function loadProfileIntoForm() {
    profileError.textContent = "";
    profileSuccess.textContent = "";
    try {
        const p = await apiGetProfile();
        displayNameInput.value = p.displayName;
        setAvatarPreview(p.avatarUrl);
    } catch (e) {
        profileError.textContent = (e as Error).message;
    }
}

function setAvatarPreview(url: string | null) {
    if (url) {
        avatarPreview.src = url;
        avatarPreview.classList.remove("hidden");
        avatarPreview.nextElementSibling?.classList.add("hidden"); // hide placeholder
    } else {
        avatarPreview.src = "";
        avatarPreview.classList.add("hidden");
        avatarPreview.nextElementSibling?.classList.remove("hidden");
    }
}

avatarChange.addEventListener("click", () => avatarInput.click());
avatarPreview.addEventListener("click", () => avatarInput.click());

avatarInput.addEventListener("change", async () => {
    const file = avatarInput.files?.[0];
    if (!file) return;

    const localUrl = URL.createObjectURL(file);
    avatarPreview.src = localUrl;
    avatarPreview.classList.remove("hidden");
    (avatarPreview.nextElementSibling as HTMLElement)?.classList.add("hidden");

    profileError.textContent = "";
    avatarChange.textContent = "Загружаю…";
    try {
        const { avatarUrl } = await apiUploadAvatar(file);
        const session = loadSession();
        if (session) saveSession({ ...session, avatarUrl });
        updateAllAvatars(avatarUrl);
        profileSuccess.textContent = "Аватарка обновлена!";
    } catch (e) {
        profileError.textContent = (e as Error).message;
    } finally {
        avatarChange.textContent = "Сменить фото";
        avatarInput.value = "";
    }
});

saveBtn.addEventListener("click", async () => {
    const name = displayNameInput.value.trim();
    if (!name) return;
    profileError.textContent = "";
    profileSuccess.textContent = "";
    saveBtn.setAttribute("disabled", "true");
    try {
        const { displayName } = await apiUpdateDisplayName(name);
        const session = loadSession();
        if (session) saveSession({ ...session, displayName });
        profileSuccess.textContent = "Сохранено!";
        const sidebarName = document.getElementById("sidebar-user-name");
        if (sidebarName) sidebarName.textContent = displayName;
    } catch (e) {
        profileError.textContent = (e as Error).message;
    } finally {
        saveBtn.removeAttribute("disabled");
    }
});

export function updateAllAvatars(url: string | null) {
    document.querySelectorAll<HTMLElement>(".my-avatar").forEach(el => {
        applyAvatar(el, url);
    });
}

export function applyAvatar(el: HTMLElement, url: string | null) {
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

export function applyOtherAvatar(el: HTMLElement, url: string | null | undefined) {
    if (url) {
        el.style.backgroundImage = `url('${url}')`;
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
        el.classList.add("has-avatar");
    }
}