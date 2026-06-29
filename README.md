# Astro Siege

Astro Siege is a retro arcade game in plain JavaScript and HTML canvas, with a Spring
Boot leaderboard backend. H2 in dev, Postgres plus Flyway in prod, with server-timed
sessions so scores can be validated. It has two modes, Classic and Remix, each with
its own leaderboard.

## Play (Classic)

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

## Play (Remix)

A mouse-aimed gallery shooter. Aim with the mouse and hold the left button to auto-fire
from the two bottom turrets. One shot clears every enemy under the crosshair. `ESC`
pauses. The run ends the instant any enemy reaches the bottom line.

- Enemies arrive as several Classic-style fleets at once. Each grid steps sideways,
  drops and reverses at the walls, and speeds up as it is thinned. Each has its own
  random speed and spawn point, and they overlap.
- Rows top to bottom are purple, blue, green, yellow, orange, red, growing larger
  toward the bottom. The first two waves are the full six rows; after that each wave is
  a random contiguous slice of 1 to 6 rows, weighted toward more rows, with a full wave
  guaranteed at least every four spawns. The spawn gap shrinks over the run.
- After the intro waves the screen stays busy: the live-enemy floor starts at 25 and
  rises by 5 every five waves.
- Forts line the bottom. An enemy that hits a fort dies and gouges a chunk out of it.
  Turret fire and the bomb/boomerang never damage the forts.
- The boss is a standalone rainbow Brute (1x1, 1x2, or 2x2) that splits into four red
  orbs when shot.
- Each kill has a 2% chance to drop a bomb and a 2% chance to drop a boomerang. Drops
  flash rainbow, trail pixels, bounce off two walls, then despawn. Shoot a bomb for a
  slowly expanding kill-circle (~50px radius over ~3s). Shoot a boomerang to fire three
  big boomerangs that bounce once and destroy every enemy they cross.
- A bonus UFO (the classic saucer) flashes red and white, darts to a random spot,
  hovers one to four seconds, then leaves.

Scoring by row: purple 60, blue 50, green 40, yellow 30, orange 20, red 10. Boss 15
(drops four 10-point orbs). The UFO pays by how fast you kill it: 2500 under a second,
2000 under two, 1500 under three, 1000 after that.

Pick the mode under "Mode" on the main menu before pressing Start. Classic and Remix
keep separate leaderboards.

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
(`src/main/resources/db/migration/`, currently `V1__create_score.sql`,
`V2__add_mode_to_score.sql`, and `V3__drop_redundant_score_index.sql`). Set
`SPRING_PROFILES_ACTIVE=prod` and `DATABASE_URL`,
`DATABASE_USERNAME`, `DATABASE_PASSWORD`. `render.yaml` and the `Dockerfile` are set up
for a Render web service.

## Anti-cheat

The client opens a server-timed session at load (`POST /api/game/start`). On submit, the server checks the run against that session:

- the session must exist and be unused (one submission per run)
- the claimed duration cannot exceed the real elapsed time
- the claimed points cannot exceed what the firing model allows for that duration.
  Classic uses `ScoreModel` (mirrored from the one-shot cannon cadence); Remix uses
  `RemixScoreModel` (mirrored from the hold-to-fire turret cadence). The controller
  picks the model from the submitted `mode`.

Names go through the PurgoMalum profanity filter (fail-open), and submissions are
rate limited per client.

## API

- `POST /api/game/start` -> `{ sessionId }`
- `POST /api/scores` body `{ name, points, wave, durationSeconds, sessionId, mode }`
  (`mode` is `classic` or `remix`; anything else is treated as `classic`)
- `GET  /api/scores/top?limit=10&mode=classic` (`mode` defaults to `classic`)
- `GET  /api/health`

## Audio

The in-game sound effects are synthesised at runtime with the Web Audio API. Each
effect is built from oscillators and filtered noise shaped by gain envelopes, so they
are original and nothing is fetched or licensed:

- a pitch-swept blip on fire, a noise zap on a hit, a noise burst on player death
- a four-note descending march, one note per fleet step, so it speeds up on its own
  as the fleet thins
- an LFO-warbled tone loops while the saucer crosses, a falling sweep when it is shot

The synth lives in `game.js`. The HUD has mute buttons and volume sliders for music
and SFX, and the setting is remembered between sessions.

Music: `menu-theme.mp3` loops on the main menu and game-over screen. In Classic it
pauses during play so the march beat carries the tension. Remix has its own
background music: three tracks (`REMIX_TRACKS` in `game.js`) played in a fresh random
order each run, then looped, and gated by the same music volume/mute.

Credit: the menu track is "Retro Arcade Game Music" by mondamusic, from Pixabay
(Pixabay Content License: free for commercial use, no attribution required). The three
Remix tracks (`bransboynd-retro-game-402454`, `dopestuff-neon-gaming-128925`,
`music_unlimited-stranger-things-124008`) are Pixabay tracks; keep their license
certificates and check whether each is Content ID-registered before publishing videos.

## Sprites

No image assets. Every sprite is a hardcoded pixel bitmap in `game.js`, baked once
to an offscreen canvas and drawn scaled. To use real PNGs later, swap `bakeSprite`
for image loads and keep `drawSprite` as is.

## License

The source code is released under the MIT License (see `LICENSE`).

The menu music (`menu-theme.mp3`) and the three Remix tracks
(`bransboynd-retro-game-402454.mp3`, `dopestuff-neon-gaming-128925.mp3`,
`music_unlimited-stranger-things-124008.mp3`) are Pixabay tracks used under the Pixabay
Content License (free for commercial use, no attribution required) and are not covered
by the MIT License above. The menu click sound
(`audio/card_select.mp3`) is reused from the Ranger Survivor project and is likewise
not covered by the MIT License; confirm its original source and license before any
commercial use. The sprites and the synthesised sound effects are original and covered
by the MIT License with the code.

## Disclaimer

Astro Siege is an original, fan-made arcade game inspired by the classic
fixed-shooter genre. It is not affiliated with, endorsed by, or associated with
Taito Corporation or Square Enix. This project does not use the name, code, audio,
or artwork of any existing commercial game.
