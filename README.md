# \[MWS\] Module to Play a Quiz Game Together
![TypeScript](https://img.shields.io/badge/language-TypeScript-blue?style=flat-square)
[![License](https://img.shields.io/badge/license-BSD--3--Clause-brightgreen?style=flat-square)](LICENSE.txt)

This repository is designed to be used with the [`MWS-Base`](https://github.com/BjoernBoss/mws-base.git).

It provides an interactive way to play a quiz-game together, consisting of about 190 questions.
The quiz-game allows players to use fun special effects on other players, such as taking away their points, or teasing them in other ways.

All active sessions are managed by the created `QuizGame` object. Sharing this object across multiple listened ports will therefore ensure each port shares a common player base.

The game differentiates players by name. Logging in with the same name will result in two players controlling the same user.

## Setup
Clone into the modules directory of an existing MWS-Base installation:

    $ git clone https://github.com/BjoernBoss/mws-quiz-game.git modules/quiz-game

Register the module in `modules/setup.js`:

```JavaScript
import * as libInterface from "core/interface.js";

export async function Run(server) {
    try {
        const quizGame = await import("quiz-game/quiz-game.js");
        const dispatch = new libInterface.DispatchModule({
            '/quiz-game': new quizGame.QuizGame(),
        });
        server.listenHttp(8080, dispatch, (host) => host == 'localhost');
    } catch (e) {
        throw new Error(`Failed to load module: ${e.message}`);
    }
}
```

Then just build and run the server as usual.

## HTTP Endpoints
| Method | Path | Description |
|---|---|---|
| GET | `/` | Create a new game session |
| GET | `/session?id={id}` | Page providing the player and scoreboard pages |
| GET | `/client?id={id}` | Play as one client in the game |
| GET | `/score?id={id}` | View the score and other information for the game |
| GET | `/**/*.css`, `/**/*.js` | Static assets |
| WebSocket | `/ws/{id}` | Join a game session |

## Cookies

The client code sets the cookie `quiz-game-last-name` to the last used player name, to retrieve and reuse it on the next refresh.

## WebSocket Protocol
The game is built on trust, every WebSocket connection just publishes updates of its player state, which are then pushed to all other clients, where necessary.
