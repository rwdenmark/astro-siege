# Astro Siege

Astro Siege is a retro fixed-shooter arcade game in plain JavaScript and HTML canvas, with a Spring
Boot leaderboard backend. H2 in dev, Postgres plus Flyway in prod, with server-timed
sessions so scores can be validated.

## Play

Move with `A` / `D` or the left/right arrow keys. Fire with `Space`. One shot on
screen at a time. `ESC` pauses and resumes. Clear the fleet before
it marches into you.

Scoring by row:

- Top row (small orb): 30 points
- Middle two rows (mid orb): 20 points
- Bottom two rows (large orb): 10 points
- Mystery saucer: 50, 100, 150, or 300

Lives start at 3. A life is lost to an enemy bomb. The game ends when lives run
out or the fleet reaches the cannon line. Clearing a wave starts the next one,
lower and faster.

## Run it

Local dev uses an in-memory H2 database, so there is nothing to install beyond a
JDK 17:

```
./mvnw spring-boot:run
```

Then open http://localhost:8080. The game is served from
`src/main/resources/static`, so it ships with the backend. The leaderboard talks
to the same origin; if the backend is down the game still plays and the board
shows an offline note.

H2 console (dev only): http://localhost:8080/h2-console, JDBC URL
`jdbc:h2:mem:astrosiege`, user `sa`, no password.

## Production

The `prod` profile points at Postgres and lets Flyway own the schema
(`src/main/resources/db/migration/V1__create_score.sql`). Set `SPRING_PROFILES_ACTIVE=prod`
and `DATABASE_URL`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`. `render.yaml` and the
`Dockerfile` are set up for a Render web service.

## Anti-cheat

The client opens a server-timed session at load (`POST /api/game/start`). On submit, the server checks the run against that session:

- the session must exist and be unused (one submission per run)
- the claimed duration cannot exceed the real elapsed time
- the claimed points cannot exceed what the firing model allows for that duration
  (`ScoreModel`, mirrored from the client firing cadence)

Names go through the PurgoMalum profanity filter (fail-open), and submissions are
rate limited per client.

## API

- `POST /api/game/start` -> `{ sessionId }`
- `POST /api/scores` body `{ name, points, wave, durationSeconds, sessionId }`
- `GET  /api/scores/top?limit=10`
- `GET  /api/health`

## Audio

All sound effects are synthesised at runtime with the Web Audio API - there are no
SFX files. Each effect is built from oscillators and filtered noise shaped by gain
envelopes, so they are original and nothing is fetched or licensed:

- a pitch-swept blip on fire, a noise zap on a hit, a noise burst on player death
- a four-note descending march, one note per fleet step, so it speeds up on its own
  as the fleet thins
- an LFO-warbled tone loops while the saucer crosses, a falling sweep when it is shot

The synth lives in `game.js`. The HUD has mute buttons and volume sliders for music
and SFX, and the setting is remembered between sessions.

Music: `menu-theme.mp3` loops on the main menu and game-over screen, and pauses
during play so the march beat carries the tension. Swap the track via `MUSIC_SRC` in
`game.js`. It is the only audio file in the project.

Credit: the menu track is "Retro Arcade Game Music" by mondamusic, from Pixabay
(Pixabay Content License: free for commercial use, no attribution required).

## Sprites

No image assets. Every sprite is a hardcoded pixel bitmap in `game.js`, baked once
to an offscreen canvas and drawn scaled. To use real PNGs later, swap `bakeSprite`
for image loads and keep `drawSprite` as is.

## License

The source code is released under the MIT License - see `LICENSE`.

The menu music (`menu-theme.mp3`) is "Retro Arcade Game Music" by mondamusic, used
under the Pixabay Content License (free for commercial use, no attribution required)
and is not covered by the MIT License above. All other assets - the sprites and the
sound effects - are original and covered by the MIT License with the code.

## Disclaimer

Astro Siege is an original, fan-made arcade game inspired by the classic
fixed-shooter genre. It is not affiliated with, endorsed by, or associated with
Taito Corporation or Square Enix. This project does not use the name, code, audio,
or artwork of any existing commercial game.
