import * as signalR from "@microsoft/signalr";
import { loadSession } from "./api";

const HUB_URL  = "http://localhost:5000/hubs/call";

const ICE_SERVERS: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
];

let connection: signalR.HubConnection | null = null;
let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;

let currentCallPartnerId: number | null = null;
let currentCallPartnerName = "";
let callRole: "caller" | "callee" | null = null;

const pendingIce: RTCIceCandidateInit[] = [];

let uiEl: HTMLElement | null = null;

function getUI() {
    if (!uiEl) uiEl = document.getElementById("call-ui")!;
    return uiEl;
}

function setCallStatus(text: string) {
    const el = getUI().querySelector<HTMLElement>(".call-status");
    if (el) el.textContent = text;
}

function setCallPartnerName(name: string) {
    const el = getUI().querySelector<HTMLElement>(".call-partner-name");
    if (el) el.textContent = name;
}

function showCallUI(state: "incoming" | "outgoing" | "active") {
    const ui = getUI();
    ui.dataset["state"] = state;
    ui.classList.remove("hidden");
    setCallPartnerName(currentCallPartnerName);

    ui.querySelector(".call-actions-incoming")!.classList.toggle("hidden", state !== "incoming");
    ui.querySelector(".call-actions-active")!.classList.toggle("hidden", state === "incoming");
    ui.querySelector(".call-actions-outgoing")!.classList.toggle("hidden", state !== "outgoing");

    if (state === "incoming") setCallStatus("Входящий звонок…");
    if (state === "outgoing") setCallStatus("Вызов…");
    if (state === "active")   setCallStatus("Соединение…");
}

function hideCallUI() {
    getUI().classList.add("hidden");
    getUI().dataset["state"] = "";
}

function createPeerConnection() {
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = e => {
        if (e.candidate && currentCallPartnerId && connection) {
            connection.invoke("SendIceCandidate", currentCallPartnerId, JSON.stringify(e.candidate))
                .catch(console.error);
        }
    };

    pc.ontrack = e => {
        let audio = document.getElementById("call-remote-audio") as HTMLAudioElement;
        if (!audio) {
            audio = document.createElement("audio");
            audio.id = "call-remote-audio";
            audio.autoplay = true;
            document.body.appendChild(audio);
        }
        audio.srcObject = e.streams[0] ?? null;
    };

    pc.onconnectionstatechange = () => {
        if (!pc) return;
        if (pc.connectionState === "connected") setCallStatus("В звонке");
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") endCall(false);
    };

    return pc;
}

async function getLocalAudio(): Promise<MediaStream> {
    if (localStream) return localStream;
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    return localStream;
}

function addLocalTracks(stream: MediaStream) {
    stream.getTracks().forEach(track => pc!.addTrack(track, stream));
}

async function flushPendingIce() {
    for (const c of pendingIce) {
        try { await pc!.addIceCandidate(new RTCIceCandidate(c)); } catch {}
    }
    pendingIce.length = 0;
}

export async function startCall(partnerId: number, partnerName: string) {
    if (currentCallPartnerId !== null) { alert("Вы уже в звонке"); return; }
    if (!connection) { alert("Нет соединения с сервером"); return; }

    currentCallPartnerId = partnerId;
    currentCallPartnerName = partnerName;
    callRole = "caller";

    showCallUI("outgoing");

    try {
        const stream = await getLocalAudio();
        createPeerConnection();
        addLocalTracks(stream);

        const offer = await pc!.createOffer();
        await pc!.setLocalDescription(offer);
        await connection.invoke("SendCallOffer", partnerId, JSON.stringify(offer));
    } catch (e) {
        console.error("[Call] startCall error", e);
        await endCall(true);
        alert("Не удалось получить доступ к микрофону");
    }
}

export async function acceptCall() {
    if (!pc || callRole !== "callee") return;
    showCallUI("active");
    try {
        const stream = await getLocalAudio();
        addLocalTracks(stream);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await connection!.invoke("SendCallAnswer", currentCallPartnerId!, JSON.stringify(answer));
        await flushPendingIce();
    } catch (e) {
        console.error("[Call] acceptCall error", e);
        await endCall(true);
        alert("Не удалось получить доступ к микрофону");
    }
}

export async function endCall(notify = true) {
    if (notify && currentCallPartnerId && connection) {
        connection.invoke("SendCallEnd", currentCallPartnerId).catch(() => {});
    }
    pc?.close();
    pc = null;
    localStream?.getTracks().forEach(t => t.stop());
    localStream = null;
    const audio = document.getElementById("call-remote-audio") as HTMLAudioElement | null;
    if (audio) { audio.srcObject = null; audio.remove(); }
    pendingIce.length = 0;
    currentCallPartnerId = null;
    currentCallPartnerName = "";
    callRole = null;
    hideCallUI();
}

function toggleMute() {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    const btn = getUI().querySelector<HTMLElement>(".call-mute-btn");
    if (btn) {
        btn.classList.toggle("muted", !track.enabled);
        btn.title = track.enabled ? "Выключить микрофон" : "Включить микрофон";
        btn.innerHTML = track.enabled
            ? `<i class="fa-solid fa-microphone"></i>`
            : `<i class="fa-solid fa-microphone-slash"></i>`;
    }
}

async function onCallOffer(fromId: number, fromName: string, offerJson: string) {
    if (currentCallPartnerId !== null) {
        connection?.invoke("SendCallEnd", fromId).catch(() => {});
        return;
    }

    currentCallPartnerId = fromId;
    currentCallPartnerName = fromName;
    callRole = "callee";

    createPeerConnection();

    const offer = JSON.parse(offerJson) as RTCSessionDescriptionInit;
    await pc!.setRemoteDescription(new RTCSessionDescription(offer));

    showCallUI("incoming");
}

async function onCallAnswer(answerJson: string) {
    if (!pc) return;
    const answer = JSON.parse(answerJson) as RTCSessionDescriptionInit;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    await flushPendingIce();
    showCallUI("active");
}

async function onIceCandidate(candidateJson: string) {
    const candidate = JSON.parse(candidateJson) as RTCIceCandidateInit;
    if (pc && pc.remoteDescription) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    } else {
        pendingIce.push(candidate);
    }
}

function onCallEnd() {
    endCall(false);
    setCallStatus("Звонок завершён");
    setTimeout(hideCallUI, 1500);
}

export async function connectCallHub() {
    const session = loadSession();
    connection = new signalR.HubConnectionBuilder()
        .withUrl(HUB_URL, { accessTokenFactory: () => session?.token ?? "" })
        .withAutomaticReconnect()
        .configureLogging(signalR.LogLevel.Warning)
        .build();

    connection.on("CallOffer",    onCallOffer);
    connection.on("CallAnswer",   onCallAnswer);
    connection.on("IceCandidate", onIceCandidate);
    connection.on("CallEnd",      onCallEnd);

    await connection.start();
    console.log("[CallHub] connected");
}

export function wireCallUI() {
    const ui = getUI();

    ui.querySelector(".call-accept-btn")?.addEventListener("click", acceptCall);
    ui.querySelector(".call-decline-btn")?.addEventListener("click", () => endCall(true));
    ui.querySelector(".call-hangup-btn")?.addEventListener("click", () => endCall(true));
    ui.querySelector(".call-hangup-outgoing-btn")?.addEventListener("click", () => endCall(true));
    ui.querySelector(".call-mute-btn")?.addEventListener("click", toggleMute);
}