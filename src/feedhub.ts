import * as signalR from "@microsoft/signalr";
import type { PostDto } from "./api";
import { loadSession } from "./api";

const HUB_URL = "http://localhost:5000/hubs/feed";

let connection: signalR.HubConnection | null = null;

export type FeedEventMap = {
    newPost: (post: PostDto) => void;
    deletePost: (id: number) => void;
};

type Listeners = { [K in keyof FeedEventMap]: FeedEventMap[K][] };

const listeners: Listeners = { newPost: [], deletePost: [] };

export function onFeedEvent<K extends keyof FeedEventMap>(
    event: K,
    handler: FeedEventMap[K]
) {
    (listeners[event] as FeedEventMap[K][]).push(handler);
}

export async function connectFeed() {
    const session = loadSession();

    connection = new signalR.HubConnectionBuilder()
        .withUrl(HUB_URL, {
            accessTokenFactory: () => session?.token ?? "",
        })
        .withAutomaticReconnect()
        .configureLogging(signalR.LogLevel.Warning)
        .build();

    connection.on("NewPost", (post: PostDto) => {
        listeners.newPost.forEach((fn) => fn(post));
    });

    connection.on("DeletePost", (id: number) => {
        listeners.deletePost.forEach((fn) => fn(id));
    });

    await connection.start();
    console.log("[SignalR] connected");
}

export async function disconnectFeed() {
    await connection?.stop();
    connection = null;
}