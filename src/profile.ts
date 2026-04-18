import { apiGetProfile, apiUpdateDisplayName, apiUploadAvatar, loadSession, saveSession } from "./api";

const modal         = document.getElementById("profile-modal")!;
const closeBtn      = document.getElementById("profile-close")!;
const avatarPreview = document.getElementById("profile-avatar-preview") as HTMLImageElement;
const avatarInput   = document.getElementById("profile-avatar-input") as HTMLInputElement;
const avatarChange  = document.getElementById("profile-avatar-change")!;
const displayNameInput = document.getElementById("profile-displayname") as HTMLInputElement;
const saveBtn       = document.getElementById("profile-save")!;
const profileError  = document.getElementById("profile-error")!;
const profileSuccess= document.getElementById("profile-success")!;

const cropModal     = document.getElementById("crop-modal")!;
const cropCanvas    = document.getElementById("crop-canvas") as HTMLCanvasElement;
const cropConfirm   = document.getElementById("crop-confirm")!;
const cropCancel    = document.getElementById("crop-cancel")!;
const rotateBtn     = document.getElementById("crop-rotate")!;

export function openProfileModal() {
    modal.classList.remove("hidden");
    loadProfileIntoForm();
}

function closeProfileModal() {
    modal.classList.add("hidden");
}

closeBtn.addEventListener("click", closeProfileModal);
modal.addEventListener("click", e => { if (e.target === modal) closeProfileModal(); });

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
    const placeholder = document.getElementById("profile-avatar-placeholder")!;
    if (url) {
        avatarPreview.src = url;
        avatarPreview.classList.remove("hidden");
        placeholder.classList.add("hidden");
    } else {
        avatarPreview.src = "";
        avatarPreview.classList.add("hidden");
        placeholder.classList.remove("hidden");
    }
}

avatarChange.addEventListener("click", () => avatarInput.click());
avatarPreview.addEventListener("click", () => avatarInput.click());
avatarInput.addEventListener("change", () => {
    const file = avatarInput.files?.[0];
    if (!file) return;
    avatarInput.value = "";
    openCropper(file);
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
    document.querySelectorAll<HTMLElement>(".my-avatar").forEach(el => applyAvatar(el, url));
}

export function applyAvatar(el: HTMLElement, url: string | null) {
    if (url) {
        el.style.backgroundImage = `url('${url}')`;
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
    } else {
        el.style.backgroundImage = "";
    }
}

export function applyOtherAvatar(el: HTMLElement, url: string | null | undefined) {
    if (url) {
        el.style.backgroundImage = `url('${url}')`;
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
    }
}

const ctx = cropCanvas.getContext("2d")!;
const SIZE = 320;
cropCanvas.width  = SIZE;
cropCanvas.height = SIZE;

let cropImg    = new Image();
let cropRotation = 0;
let isDragging   = false;
let dragStart    = { x: 0, y: 0 };
let imgOffset    = { x: 0, y: 0 };
let imgScale     = 1;
let pinchDist    = 0;

function openCropper(file: File) {
    const url = URL.createObjectURL(file);
    cropImg = new Image();
    cropImg.onload = () => {
        cropRotation = 0;
        fitImage();
        drawCrop();
        cropModal.classList.remove("hidden");
    };
    cropImg.src = url;
}

function fitImage() {
    const rotated = cropRotation % 180 !== 0;
    const iw = rotated ? cropImg.naturalHeight : cropImg.naturalWidth;
    const ih = rotated ? cropImg.naturalWidth  : cropImg.naturalHeight;
    imgScale = Math.max(SIZE / iw, SIZE / ih);
    imgOffset = {
        x: (SIZE - iw * imgScale) / 2,
        y: (SIZE - ih * imgScale) / 2,
    };
}

function drawCrop() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.translate(SIZE / 2, SIZE / 2);
    ctx.rotate((cropRotation * Math.PI) / 180);

    const rotated = cropRotation % 180 !== 0;
    const iw = rotated ? cropImg.naturalHeight : cropImg.naturalWidth;
    const ih = rotated ? cropImg.naturalWidth  : cropImg.naturalHeight;
    const ox = imgOffset.x - (SIZE - iw * imgScale) / 2;
    const oy = imgOffset.y - (SIZE - ih * imgScale) / 2;

    ctx.drawImage(
        cropImg,
        -(SIZE / 2) - ox / imgScale,
        -(SIZE / 2) - oy / imgScale,
        cropImg.naturalWidth,
        cropImg.naturalHeight,
        -(cropImg.naturalWidth * imgScale) / 2,
        -(cropImg.naturalHeight * imgScale) / 2,
        cropImg.naturalWidth * imgScale,
        cropImg.naturalHeight * imgScale,
    );
    ctx.restore();

    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.rect(0, 0, SIZE, SIZE);
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2, true);
    ctx.fill("evenodd");

    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    ctx.stroke();
}

rotateBtn.addEventListener("click", () => {
    cropRotation = (cropRotation + 90) % 360;
    fitImage();
    drawCrop();
});

cropCancel.addEventListener("click", () => cropModal.classList.add("hidden"));
cropModal.addEventListener("click", e => { if (e.target === cropModal) cropModal.classList.add("hidden"); });

cropConfirm.addEventListener("click", async () => {
    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = finalCanvas.height = 400;
    const fc = finalCanvas.getContext("2d")!;

    fc.save();
    fc.translate(200, 200);
    fc.rotate((cropRotation * Math.PI) / 180);

    const rotated = cropRotation % 180 !== 0;
    const iw = rotated ? cropImg.naturalHeight : cropImg.naturalWidth;
    const ih = rotated ? cropImg.naturalWidth  : cropImg.naturalHeight;
    const scale = (imgScale / SIZE) * 400;
    const ox = imgOffset.x - (SIZE - iw * imgScale) / 2;
    const oy = imgOffset.y - (SIZE - ih * imgScale) / 2;

    fc.drawImage(
        cropImg,
        -(200) - (ox / imgScale) * (400 / SIZE),
        -(200) - (oy / imgScale) * (400 / SIZE),
        cropImg.naturalWidth * scale,
        cropImg.naturalHeight * scale,
    );
    fc.restore();

    cropModal.classList.add("hidden");
    profileError.textContent = "";
    avatarChange.textContent = "Загружаю…";

    finalCanvas.toBlob(async blob => {
        if (!blob) return;
        const file = new File([blob], "avatar.jpg", { type: "image/jpeg" });
        try {
            const { avatarUrl } = await apiUploadAvatar(file);
            const session = loadSession();
            if (session) saveSession({ ...session, avatarUrl });
            setAvatarPreview(avatarUrl);
            updateAllAvatars(avatarUrl);
            profileSuccess.textContent = "Аватарка обновлена!";
        } catch (e) {
            profileError.textContent = (e as Error).message;
        } finally {
            avatarChange.textContent = "Сменить фото";
        }
    }, "image/jpeg", 0.92);
});

cropCanvas.addEventListener("mousedown", e => {
    isDragging = true;
    dragStart = { x: e.clientX - imgOffset.x, y: e.clientY - imgOffset.y };
});
window.addEventListener("mousemove", e => {
    if (!isDragging) return;
    imgOffset = { x: e.clientX - dragStart.x, y: e.clientY - dragStart.y };
    drawCrop();
});
window.addEventListener("mouseup", () => { isDragging = false; });

cropCanvas.addEventListener("wheel", e => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const cx = SIZE / 2, cy = SIZE / 2;
    imgOffset.x = cx + (imgOffset.x - cx) * delta;
    imgOffset.y = cy + (imgOffset.y - cy) * delta;
    imgScale *= delta;
    drawCrop();
}, { passive: false });

cropCanvas.addEventListener("touchstart", e => {
    e.preventDefault();
    if (e.touches.length === 1) {
        isDragging = true;
        const r = cropCanvas.getBoundingClientRect();
        dragStart = {
            x: e.touches[0]!.clientX - r.left - imgOffset.x,
            y: e.touches[0]!.clientY - r.top  - imgOffset.y,
        };
    } else if (e.touches.length === 2) {
        isDragging = false;
        pinchDist = Math.hypot(
            e.touches[0]!.clientX - e.touches[1]!.clientX,
            e.touches[0]!.clientY - e.touches[1]!.clientY,
        );
    }
}, { passive: false });

cropCanvas.addEventListener("touchmove", e => {
    e.preventDefault();
    const r = cropCanvas.getBoundingClientRect();
    if (e.touches.length === 1 && isDragging) {
        imgOffset = {
            x: e.touches[0]!.clientX - r.left - dragStart.x,
            y: e.touches[0]!.clientY - r.top  - dragStart.y,
        };
        drawCrop();
    } else if (e.touches.length === 2) {
        const dist = Math.hypot(
            e.touches[0]!.clientX - e.touches[1]!.clientX,
            e.touches[0]!.clientY - e.touches[1]!.clientY,
        );
        const delta = dist / pinchDist;
        pinchDist = dist;
        const cx = SIZE / 2, cy = SIZE / 2;
        imgOffset.x = cx + (imgOffset.x - cx) * delta;
        imgOffset.y = cy + (imgOffset.y - cy) * delta;
        imgScale *= delta;
        drawCrop();
    }
}, { passive: false });

cropCanvas.addEventListener("touchend", () => { isDragging = false; });