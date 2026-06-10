# Wordle Duel

A real-time 1v1 Wordle game. You pick a word for your opponent, they pick one for you. First to solve wins.

## Features
- Real-time multiplayer via Socket.io WebSockets
- Classic 6-guess Wordle rules with color-coded feedback
- NYT-inspired dark theme
- Live opponent progress sidebar
- In-game chat
- Rematch system
- Mobile-friendly

---

## Deploy on TrueNAS Scale

### Option A — Docker Compose via shell (easiest)

SSH into your TrueNAS box:

```bash
# Copy project to TrueNAS from your local machine
scp -r wordle-duel/ admin@truenas.local:/mnt/your-pool/appdata/

# SSH in and build + start
ssh admin@truenas.local
cd /mnt/your-pool/appdata/wordle-duel
docker compose up -d --build
```

### Option B — Custom App in TrueNAS UI

1. Go to Apps > Discover Apps > Custom App
2. Under "Image Configuration", set image to `wordle-duel` (after building locally and pushing to a registry, or use the shell approach)
3. Set container port `3000` mapped to a host port of your choice
4. Set restart policy to "Unless Stopped"
5. Save and deploy

### Option C — Build and push to a local registry

```bash
docker build -t your-nas-ip:5000/wordle-duel:latest .
docker push your-nas-ip:5000/wordle-duel:latest
```

---

## Accessing over the internet

1. Port-forward TCP port `3000` on your router to your TrueNAS IP
2. Share `http://your-public-ip:3000` with your friend
3. Or use a free DDNS like DuckDNS: `http://yourname.duckdns.org:3000`

For HTTPS + a clean domain, use a reverse proxy — see the Nginx snippet below.

---

## How to play

1. Player A opens the app, clicks **Create Room**, gets a 6-character room code
2. Player B opens the same URL, clicks **Join Room**, enters the code
3. Both players secretly choose a 5-letter word for the other to guess
4. Once both lock in, the game starts simultaneously
5. Wordle rules: green = right spot, yellow = wrong spot, gray = not in word
6. 6 guesses max — first to solve wins. Chat and trash talk along the way.

---

## Project structure

```
wordle-duel/
├── Dockerfile
├── docker-compose.yml
├── README.md
├── public/
│   └── index.html        (single-file frontend)
└── server/
    ├── index.js          (Node.js + Socket.io backend)
    └── package.json
```

## Word validation

The server validates all guesses and chosen words against a 479k-word English dictionary (`words_alpha.txt` from the [dwyl/english-words](https://github.com/dwyl/english-words) project, public domain).

The word list is **downloaded automatically during the Docker build** — no manual step needed. Only words 2–10 letters long are loaded into memory (~100k words).

For local dev without Docker:
```bash
node server/download-words.js   # downloads words.txt once
node server/index.js            # then run the server
```



| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | Port the server listens on |

---

## Nginx reverse proxy config

Required for WebSocket (Socket.io) to work through a proxy:

```nginx
server {
    listen 80;
    server_name wordle.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```
# wordle-duel
