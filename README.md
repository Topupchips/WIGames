# WI Games Arcade

Pixel-art 3D party games on your monitor, played with up to 4 phones. Two games so far: Badminton and Racing.

## Run it
    npm install
    npm start

Open http://localhost:3000 on the laptop and put it on the monitor (press F for fullscreen).
Phones on the same Wi-Fi scan the QR code, or open the address shown under it and type the room code.
In the lobby press 1 for Badminton or 2 for Racing (or tap a game). The first phone to join can also pick the game.

## Badminton
- 2 to 4 phones: phones 1 and 3 play on the left, phones 2 and 4 on the right. One phone plays the CPU.
- Slide your thumb on the pad to move. Tap Lob, Drop or Smash when the shuttle is inside your dashed ring.
- Motion controls: tap USE MOTION on your phone, then swing it like a racket. Swing down for a smash, swing up for a lob, a quick flick for a drop. Slide your thumb to move, or switch to MOVE: TILT and tilt the phone left and right (RECENTER sets your neutral position).
- Rally scoring, first to 11 and win by 2 (cap 15). Hitting the net or landing out loses the point.

## Racing
- 1 to 4 phones, 4 laps. Empty slots are filled with CPU cars, so one phone races three CPUs.
- Cars accelerate on their own. Hold your phone upright like a steering wheel and tap TILT TO STEER, then turn it left or right. It works in portrait or landscape: your pose during the countdown is the straight-ahead position (RECENTER resets it).
- Without motion, use the LEFT and RIGHT buttons. BRAKE slows you for corners. Hold BOOST on the straights (the meter refills while you do not boost).
- Grass and sand slow you down, walls cost speed, and cars further behind get a small catch-up boost. Points go by finishing place against everyone, CPUs included: 5, 3, 2, 1.

Enter starts the highlighted game, Esc returns to the lobby, F is fullscreen, M mutes.

## Motion controls need https
Phone browsers only give motion sensors to secure (https) pages, so plain `http://192.168...` will not work for swinging.
- Same Wi-Fi: run `npm run start:https` instead of `npm start`. Phones show a certificate warning once (self-signed): tap Advanced, then continue.
- Or use a tunnel (no warning): `npm start`, then `cloudflared tunnel --url http://localhost:3000`, and open the https address it prints on the monitor.
- Or deploy it (see below), which gives you https automatically.
The touch buttons (Lob, Drop, Smash, and LEFT/RIGHT for racing) always work as a fallback.

## Notes
- If phones cannot connect, allow Node through the laptop firewall, and make sure the Wi-Fi does not isolate clients.
- Set PUBLIC_URL=https://your-host to override the address encoded in the QR code (for hosting online).

## Playing online with friends in other places
1. Host it on the internet (any one of these):
   - Quick, from your laptop: `npm start`, then in another terminal `cloudflared tunnel --url http://localhost:3000` (or `ngrok http 3000`). Open the https address it prints.
   - Always on: push this folder to GitHub and deploy it on Render (render.yaml included), Fly.io or Railway (Dockerfile included).
2. Open that https address on your laptop. The QR code now points to it, so phones anywhere can join with the code.
3. Friends who cannot see your monitor open the "watch" link shown in the lobby (`/watch?room=CODE`) on a laptop or tablet to see the big screen. Or share your screen on a call.
