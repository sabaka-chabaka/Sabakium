import "./style.css"

export interface AuthResponse {
    token: string;
    userId: number;
    username: string;
    displayName: string;
}

export interface PostDto {
    id: number;
    content: string;
    createdAt: string;
    userId: number;
    username: string;
    displayName: string;
}

export interface ApiError {
    error: string;
}

const BASE_URL = "http://localhost:5000/api";

const SESSION_KEY = "sabakium_session";

export function saveSession(data: AuthResponse) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

export function loadSession(): AuthResponse | null {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as AuthResponse) : null;
}

export function clearSession() {
    localStorage.removeItem(SESSION_KEY);
}

async function request<T>(
    path: string,
    options: RequestInit = {},
    withAuth = false
): Promise<T> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string>),
    };

    if (withAuth) {
        const session = loadSession();
        if (session) headers["Authorization"] = `Bearer ${session.token}`;
    }

    const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

    if (!res.ok) {
        const body: ApiError = await res.json().catch(() => ({ error: "Ошибка сети" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
    }

    return res.json() as Promise<T>;
}

export async function apiRegister(
    username: string,
    displayName: string,
    password: string
): Promise<AuthResponse> {
    return request<AuthResponse>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ username, displayName, password }),
    });
}

export async function apiLogin(
    username: string,
    password: string
): Promise<AuthResponse> {
    return request<AuthResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
    });
}

export async function apiFetchPosts(before?: number, limit = 20): Promise<PostDto[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before !== undefined) params.set("before", String(before));
    return request<PostDto[]>(`/posts?${params}`);
}

export async function apiCreatePost(content: string): Promise<PostDto> {
    return request<PostDto>("/posts", {
        method: "POST",
        body: JSON.stringify({ content }),
    }, true);
}

export async function apiDeletePost(id: number): Promise<void> {
    await request<void>(`/posts/${id}`, { method: "DELETE" }, true);
}