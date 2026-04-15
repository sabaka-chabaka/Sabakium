import './style.css'

const users: string[] = [
    "",
    "John Doe",
    "Jane Doe",
    "Bob Smith"
]

type Post = {
    userId: number;
    id: number;
    time: string;
    text: string;
    hasMedia?: boolean;
    liked?: boolean;
};

const posts: Post[] = [
    {
        userId: 1,
        id: 1,
        time: "1 hour ago",
        text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum."
    },
    {
        userId: 2,
        id: 2,
        time: "2 hours ago",
        text: "Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt."
    },
    {
        userId: 3,
        id: 3,
        time: "3 hours ago",
        text: "Bonjour"
    }
];

const feed = document.getElementById("feed") as HTMLDivElement;

const tabs = document.querySelectorAll(".auth-tab");
const forms = document.querySelectorAll(".auth-form");

tabs.forEach(tab => {
    tab.addEventListener("click", () => {
        const target = tab.getAttribute("data-tab");

        // tabs
        tabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");

        // forms
        forms.forEach(f => {
            f.classList.remove("active");
        });

        const form = document.getElementById(`${target}-form`);
        form?.classList.add("active");
    });
});

function createPost(post: Post): HTMLElement {
    const el = document.createElement("div");
    el.className = "post";

    el.innerHTML = `
        <div class="post-header">
            <div class="avatar"></div>
            <div>
                <div class="name">${users[post.userId] ?? "Unknown"}</div>
                <div class="time">${post.time}</div>
            </div>
        </div>

        <div class="text">${post.text}</div>

        ${post.hasMedia ? `<div class="media"></div>` : ""}

        <div class="actions">
            <button class="btn like-btn">
                <i class="${post.liked ? "fa-solid" : "fa-regular"} fa-heart"></i>
            </button>
            <button class="btn"><i class="fa-regular fa-comment"></i></button>
            <button class="btn"><i class="fa-solid fa-share"></i></button>
        </div>
    `;

    const likeBtn = el.querySelector(".like-btn") as HTMLButtonElement;
    const icon = likeBtn.querySelector("i") as HTMLElement;

    likeBtn.addEventListener("click", () => {
        post.liked = !post.liked;

        icon.classList.toggle("fa-solid", post.liked);
        icon.classList.toggle("fa-regular", !post.liked);

        icon.style.color = post.liked ? "#e74c3c" : "#cfcfcf";
    });

    return el;
}

function renderFeed(list: Post[]) {
    feed.innerHTML = "";
    list.forEach(post => {
        feed.appendChild(createPost(post));
    });
}

renderFeed(posts);