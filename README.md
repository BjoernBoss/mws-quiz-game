# \[MWS\] Module to Play a Quiz Game Together
![TypeScript](https://img.shields.io/badge/language-TypeScript-blue?style=flat-square)
[![License](https://img.shields.io/badge/license-BSD--3--Clause-brightgreen?style=flat-square)](LICENSE.txt)

This repository is designed to be used with the [`MWS-Base`](https://github.com/BjoernBoss/mws-base.git).

It provides an interactive way play a quiz-game, consisting of about 190 questions, together.
It allows this by making use of `WebSockets`.
The quiz-game allows players to use fun special effects on other players, such as taking away their points, or teasing them in other ways.

All active sessions are managed by the created `QuizGame` object. Sharing this object across multiple listened ports will therefore ensure each port shares a common player base.

## Using the Module
To use this module, setup the `mws-base`. Then simply clone this repository into the modules directory:

	$ git clone https://github.com/BjoernBoss/mws-quiz-game.git modules/quiz-game

Afterwards, transpile the entire server application, and construct this module in the `setup.js Run` method as:

```JavaScript
const m = await import("./quiz-game/quiz-game.js");
server.listenHttp(93, new m.QuizGame(), null);
```
