# \[MWS\] Module to Create and Play a Quiz Game Together
![TypeScript](https://img.shields.io/badge/language-TypeScript-blue?style=flat-square)
[![License](https://img.shields.io/badge/license-BSD--3--Clause-brightgreen?style=flat-square)](LICENSE.txt)

A multiplayer quiz-game module for [`@bjoernboss/mws`](https://github.com/BjoernBoss/mws).

Players create a session, join it by name, and compete through rounds of multiple-choice trivia. Each round consists of a category phase where players set their confidence and activate effects, followed by an answer phase where the question is revealed. Between rounds, players can use special effects to interfere with each other's scores, adding a strategic layer on top of the trivia.

Game sessions live entirely in memory and are automatically cleaned up after inactivity. All active sessions are managed by the `QuizGame` module.

## Installation

	$ npm install @bjoernboss/mws-quiz-game

Requires Node.js 22 or later.

## Setup

The `QuizGame` module takes an optional configuration object with a questions source and a `Params` object. Mount it under a path using `dispatch`:

```typescript
import { Server, dispatch, addLogger, createConsoleLogger } from "@bjoernboss/mws";
import { QuizGame } from "@bjoernboss/mws-quiz-game";

addLogger(createConsoleLogger());

const server = new Server();
const quiz = new QuizGame({
    questions: './data/questions.json',
    params: { create: true }
});

server.listen(dispatch({ '/quiz': quiz }), { port: 8080 });
```

Navigate to `http://localhost:8080/quiz/` to create a new session.

## Questions

Questions can be provided as a file path to a JSON file or as an array of `Question` objects passed directly to the constructor. If omitted, the module loads a built-in set of 241 trivia questions sourced from [Open Trivia Database](https://opentdb.com/).

Each question requires a text, category, one correct answer, and at least one incorrect answer:

```json
[
    {
        "text": "What is the largest planet in the Solar System?",
        "category": "Science & Nature",
        "correct": "Jupiter",
        "incorrect": ["Saturn", "Earth", "Mars"]
    }
]
```

Answer options are shuffled on the client side each round.

## Parameters

The `Params` object controls module behavior and access. All fields are optional:

| Field | Default | Description |
|---|---|---|
| `create` | `false` | Allow creating new game sessions |
| `idByName` | `false` | Identify players by name instead of a client-generated UUID |
| `lifetime` | `86400000` (24h) | Cookie lifetime in milliseconds |

Parameters can also be set per-request through `params` when dispatching to the module. Request parameters override the corresponding default, allowing parent modules to implement authentication or per-route access policies.

## Endpoints

The `Endpoints` export provides the path constants used by the module. All paths are relative to the module's mount point.

| Path | Method | Description |
|---|---|---|
| `/` | GET | Lobby page: create a session and access the player client and scoreboard (requires `create` param) |
| `/new` | GET | Creates a new session and responds with the session id as JSON (requires `create` param) |
| `/client` | GET | Player interface for joining and playing the game (query param: `id`) |
| `/score` | GET | Spectator scoreboard showing live game state (query param: `id`) |
| `/static/*` | GET | Static assets (CSS, JS) served with immutable cache headers |
| `/ws` | WebSocket | Join a game session (query param: `id`) |

## Game Flow

A game progresses through rounds, each consisting of two phases. At least two players must be connected to start.

### Phases

| Phase | Description |
|---|---|
| `start` | Lobby. All players ready up to begin the first round. |
| `category` | The question's category is shown. Players set their confidence (-1 to 3) and activate effects. The question text is hidden unless the player used the "Expose" effect. All players ready up to proceed. |
| `answer` | The full question and answer options are revealed. Players pick an answer. All players ready up to resolve. |
| `resolved` | Results are shown: correct answer, point deltas, and applied effects. All players ready up to advance to the next round. |
| `done` | All questions exhausted. Final scores are displayed. |

### Scoring

Each correct answer earns points equal to the player's chosen confidence level; each wrong answer loses that amount. Scores cannot drop below zero.

## Effects

Effects are the strategic core of the game. During the `category` phase, players can activate one or more effects before seeing the question. Each effect has a cooldown measured in rounds.

### Self-Targeting Effects

| Effect | Cooldown | Description |
|---|---|---|
| Expose | 2 | Reveals the question text during the category phase |
| Protect | 4 | Blocks all effects targeting this player for the round |
| Double or Nothing | 15 | If correct, score doubles; if wrong, score drops to zero |

### Opponent-Targeting Effects

These prompt the player to select an opponent:

| Effect | Cooldown | Description |
|---|---|---|
| Wrong | 5 | Forces the opponent to fail regardless of their answer |
| No Points | 3 | Prevents the opponent from earning or losing any points |
| No Confidence | 4 | Overrides the opponent's confidence to -1 |
| Absolute Confidence | 6 | Overrides the opponent's confidence to 3 |
| Steal Points | 5 | Steals all points the opponent earns or loses this round |
| Swap | 8 | Swaps total scores with the opponent (only triggers if the opponent answers correctly) |

### Effect Resolution Order

Effects are resolved in a fixed order after answers are submitted: protection is applied first (blocking all incoming effects), then fail, zero, min/max, double-or-nothing, steal, and finally swap. When multiple players apply the same effect to the same target, one is chosen randomly. Mutual steals and mutual swaps cancel each other out.

## Frontend

The module ships with a complete browser frontend across its three pages.

### Lobby

- One-click session creation, resulting in shareable links to the player client and the spectator scoreboard, each with a copy-to-clipboard button.
- Displays the inactivity timeout after which the session will be deleted, and that sessions can be rejoined by name.

### Client

- Players log in by name - pre-filled from the cookie - and keep a persistent identity through a client-generated UUID cookie (or the name itself with `idByName`), so a session can be rejoined after closing the page.
- A persistent header shows name, score, round, and confidence; in the resolved phase, the effective payout and the point delta are added.
- The question text is masked as `???` during the category phase, unless the player has activated the Expose effect.
- Confidence is set through a color-coded slider (-1 to 3); effects are activated through buttons showing their description and a live cooldown status, and opponent-targeting effects open a selection screen listing all other players sorted by score.
- Answer options are shuffled individually per player; in the resolved phase the correct option is highlighted green and wrong choices red.
- The ready button shows the live ready count and requires at least two players; once ready, the interface locks until the phase advances.
- An in-game scoreboard view can be toggled at any time and includes a confirmed "Remove Me!" option to leave the game.
- Player updates are stamped: after a reconnect the client re-fetches the state and re-uploads any local state that is newer than the server's, so brief connection losses do not lose input. Failed connections are retried with backoff before returning to the login screen with an error.
- The layout adapts to small screens, and hover effects are limited to mouse devices.

### Scoreboard

- Read-only spectator view showing the round, phase, category, and live player standings sorted by score, updated on every state change.
- In the resolved phase it reveals the correct answer and per-player results: the chosen answer, point delta, effective confidence, and all applied effects.

## WebSocket Protocol

The game is built on trust. Each WebSocket connection publishes updates of its player state, which are then pushed to all other clients. The server validates the structure of incoming updates but does not verify game logic (e.g. whether a player's answer is actually correct).

### Client Commands

| Command | Fields | Description |
|---|---|---|
| `state` | `{ cmd: 'state' }` | Request the full current game state |
| `update` | `{ cmd: 'update', id: string, value: PlayerState \| null }` | Update the player's state, or remove the player if `value` is `null` |

### Server Messages

| Field | Description |
|---|---|
| `{ cmd: 'state', state: GameState }` | Full game state including phase, question, round, and all player states |
| `{ cmd: 'malformed' }` | The client sent an invalid or unrecognized message |
| `{ cmd: 'outdated' }` | The update's stamp is older than the server's current stamp for this player |
| `{ cmd: 'inconsistent' }` | The player id does not match the player name (when `idByName` is enabled) |
| `{ cmd: 'unknown-session' }` | The requested session does not exist (connection is closed) |

### Player Identity

By default, players are identified by a client-generated UUID stored in the `quiz-game-player-id` cookie. This means a player can change their display name between sessions while keeping their identity, and two clients with the same name are treated as separate players.

When `idByName` is enabled, players are identified by name instead. Logging in with the same name from multiple clients will result in both controlling the same player.

## Session Lifecycle

Sessions are created via the `/new` endpoint and live entirely in memory. A session is automatically deleted after 20 minutes of inactivity. New WebSocket connections and valid player updates reset the inactivity timer. All open WebSocket connections are closed when a session is deleted.

## Cookies

The client page uses two cookies (both with a configurable lifetime, default 24 hours):

| Cookie | Description |
|---|---|
| `quiz-game-last-name` | Last used player name, pre-filled on the next visit |
| `quiz-game-player-id` | Client-generated UUID used as the player identity (when `idByName` is `false`) |
