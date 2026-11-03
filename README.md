# Couch Arcade

Party games on your monitor, played with up to 4 phones.

## Run it
    npm install
    npm start

Open http://localhost:3000 on the laptop and put it on the monitor (press F for fullscreen).
Phones on the same Wi-Fi scan the QR code, or open the address shown under it and type the room code.

## Controls on the big screen
- 1 to 4: start a game (the first phone that joined can also pick from their phone)
- Enter: back to lobby from the results, Esc: abort a game
- F: fullscreen, M: mute

## Games
Tap Frenzy, Quick Draw, Trivia Blitz, Memory Pads. Points carry across games (5/3/2/1 by rank).

## Adding a game
Add an object to games.js (id, name, tag, min, create) and a renderer in public/host.js and public/play.js.

## Notes
- If phones cannot connect, allow Node through the laptop firewall, and make sure the Wi-Fi does not isolate clients (some guest networks do).
- Set PUBLIC_URL=https://your-host to override the address encoded in the QR code (for hosting online).

## Playing online with friends in other places
1. Host it on the internet (any one of these):
   - Quick, from your laptop: `npm start`, then in another terminal `cloudflared tunnel --url http://localhost:3000` (or `ngrok http 3000`). Open the https address it prints.
   - Always on: push this folder to GitHub and deploy it on Render (render.yaml included), Fly.io or Railway (Dockerfile included).
2. Open that https address on your laptop. The QR code now points to it, so phones anywhere can join with the code.
3. Friends who cannot see your monitor open the "watch" link shown in the lobby (`/watch?room=CODE`) on a laptop or tablet to see the big screen. Or share your screen on a call.
