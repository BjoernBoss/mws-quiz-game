/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024-2025 Bjoern Boss Henrichsen */
import * as libCommon from "core/common.js";
import * as libClient from "core/client.js";
import * as libLog from "core/log.js";
import * as libLocation from "core/location.js";
import * as libFs from "fs";
import * as libCrypto from "crypto";
import * as libWs from "ws";

const sessionTimeoutMinutes = 20;

interface Question {
	text: string;
	options: string[4];
	correct: number;
	category: string;
};
interface GameEffects<T> {
	expose?: T;
	double?: T;
	protect?: T;
	fail?: T;
	swap?: T;
	zero?: T;
	min?: T;
	max?: T;
	steal?: T;
};
interface PlayerState {
	ready: boolean;
	confidence: number;
	payout: number;
	choice: number;
	correct: boolean;
	delta: number;
	score: number;
	effects: GameEffects<string>;
	applied: GameEffects<string>;
};
enum GamePhase {
	start = 'start',
	category = 'category',
	answer = 'answer',
	resolved = 'resolved',
	done = 'done'
};

class GameState {
	private players: Record<string, PlayerState>;
	private phase: GamePhase;
	private question: Question | null;
	private round: number;
	private remaining: Question[];
	private total: number;

	constructor(questions: Question[]) {
		this.phase = GamePhase.start;
		this.question = null;
		this.players = {};
		this.round = 0;
		this.remaining = questions.slice();
		this.total = this.remaining.length;
	}
	private resetPlayerReady(): void {
		for (const name in this.players)
			this.players[name].ready = false;
	}
	private resetPlayersForPhase(): void {
		/* reset the player states for the next phase */
		for (const name in this.players) {
			let player = this.players[name];
			player.ready = false;
			player.confidence = 1;
			player.choice = -1;
			player.correct = false;
			player.effects = {};
			player.applied = {};
		}
	}
	private applyEffects(): void {
		const appliedTo: Record<string, GameEffects<string[]>> = {};

		/* collect the list of players who applied each effect to each other */
		for (const name in this.players) {
			const player = this.players[name];
			for (const effect of ['fail', 'swap', 'zero', 'min', 'max', 'steal']) {
				const victim = ((player.effects as any)[effect] as (string | undefined));
				if (victim == null)
					continue;

				/* check if the victim exists and add it the the inverse-map */
				if (!(victim in appliedTo))
					appliedTo[victim] = {};
				const applied = appliedTo[victim];

				/* add the player as source for the given effect */
				if (!(effect in applied))
					(applied as any)[effect] = [];
				((applied as any)[effect] as string[]).push(name);
			}
		}

		/* iterate over all players again and reset them, apply the protections, exposures, fail,
		*	zero, min, max, and clear swaps for players who failed to answer correctly */
		for (const name in this.players) {
			const player = this.players[name];

			/* reset the player for the effect application */
			player.applied = {};
			player.payout = player.confidence;
			player.delta = 0;
			player.ready = false;

			/* apply the exposure-effect */
			if (player.effects.expose != null)
				player.applied.expose = 'True';

			/* apply the protect-effect */
			if (player.effects.protect != null) {
				player.applied.protect = 'True';
				delete appliedTo[name];
				continue;
			}

			/* check if any effects are applied */
			const applied = appliedTo[name];
			if (applied == null)
				continue;

			/* apply the failed effect */
			if (applied.fail != null) {
				player.applied.fail = applied.fail.join(", ");
				player.correct = false;
			}

			/* clear the swap effects */
			if (!player.correct)
				delete applied.swap;

			/* apply the zero effect */
			if (applied.zero != null) {
				player.applied.zero = applied.zero.join(", ");
				player.payout = 0;
				continue;
			}

			/* apply the min/max effects (most frequently used is applied and otherwise randomly chosen) */
			if (applied.min == null && applied.max == null)
				continue;
			if (applied.min != null && applied.max != null) {
				if (applied.min.length > applied.max.length || (applied.min.length == applied.max.length && Math.random() <= 0.5))
					delete applied.max;
				else
					delete applied.min;
			}

			/* apply the chosen effect */
			if (applied.min != null)
				player.applied.min = applied.min.join(", ");
			if (applied.max != null)
				player.applied.max = applied.max.join(", ");
			player.payout = (player.applied.max != null ? 3 : -1);
		}

		/* compute the points each player will earn and apply double-or-nothing */
		for (const name in this.players) {
			const player = this.players[name];

			/* apply the double-or-nothing effect */
			if (player.effects.double != null) {
				player.applied.double = 'True';
				player.delta = (player.correct ? player.score : -player.score);
			}
			else
				player.delta = (player.correct ? player.payout : -player.payout);
		}

		/* apply the steal randomly (ensure no steal-chains are possible) */
		const stealFrom = Object.keys(appliedTo);
		while (stealFrom.length > 0) {
			/* pick the next entry to process and remove the index from the open list */
			const index = Math.floor(Math.random() * stealFrom.length);
			const name = stealFrom[index];
			stealFrom.splice(index, 1);

			/* check if the key can be removed, as no steals are registered for it */
			if (appliedTo[name].steal == null)
				continue;
			const thieves = appliedTo[name].steal;
			delete appliedTo[name].steal;

			/* select the thief and apply him */
			const thief = thieves[Math.floor(Math.random() * thieves.length)];
			this.players[name].applied.steal = thief;

			/* check if the thief and player stole from each other */
			if ((thief in appliedTo) && appliedTo[thief].steal != null && appliedTo[thief].steal.includes(name))
				this.players[thief].applied.steal = name;

			/* steal the points */
			else {
				this.players[thief].delta += this.players[name].delta;
				this.players[name].delta = 0;
			}

			/* remove the thief to prevent double-steal */
			if (thief in appliedTo)
				delete appliedTo[thief].steal;
		}

		/* compute the overall new points */
		for (const name in this.players)
			this.players[name].score = Math.max(0, this.players[name].score + this.players[name].delta);

		/* apply the swaps randomly (ensure no swap-chains are possible) */
		const swapWith = Object.keys(appliedTo);
		while (swapWith.length > 0) {
			/* pick the next entry to process and remove the index from the open list */
			const index = Math.floor(Math.random() * swapWith.length);
			const name = swapWith[index];
			swapWith.splice(index, 1);

			/* check if the key can be removed, as no swaps are registered for it */
			if (appliedTo[name].swap == null)
				continue;
			const swaps = appliedTo[name].swap;
			delete appliedTo[name].swap;

			/* select the other player and apply him */
			const other = swaps[Math.floor(Math.random() * swaps.length)];
			this.players[name].applied.swap = other;

			/* check if the thief and player swapped each other */
			if ((other in appliedTo) && appliedTo[other].swap != null && appliedTo[other].swap.includes(name))
				this.players[other].applied.swap = name;

			/* swap the points */
			else {
				const namePoints = this.players[name].score;
				const otherPoints = this.players[other].score;

				this.players[name].score = otherPoints;
				this.players[name].delta += (otherPoints - namePoints);


				this.players[other].score = namePoints;
				this.players[other].delta += (namePoints - otherPoints);
			}

			/* remove the other person to prevent double-swaps */
			if (other in appliedTo)
				delete appliedTo[other].swap;
		}
	}
	public advanceStage(): void {
		/* check if all players are valid */
		for (const name in this.players) {
			if (!this.players[name].ready)
				return;
		}
		if (Object.keys(this.players).length < 2)
			return;

		/* check if the next stage needs to be picked */
		if (this.phase == GamePhase.start || this.phase == GamePhase.resolved) {
			if (this.remaining.length == 0) {
				this.phase = GamePhase.done;
				this.question = null;
				this.resetPlayersForPhase();
				return;
			}

			/* advance the round and select the next question */
			if (this.phase == GamePhase.start)
				this.round = 0;
			else
				this.round += 1;
			let index = Math.floor(Math.random() * this.remaining.length);
			this.question = this.remaining[index];
			this.remaining.splice(index, 1);
			this.phase = GamePhase.category;
			this.resetPlayersForPhase();
			return;
		}

		/* check if the answer-round can be started */
		if (this.phase == GamePhase.category) {
			this.phase = GamePhase.answer;
			this.resetPlayerReady();
			return;
		}

		/* apply all effects (will mark the players as not ready) and advance the stage */
		this.applyEffects();
		this.phase = GamePhase.resolved;
	}
	public makeState() {
		return {
			cmd: 'state',
			state: {
				phase: this.phase,
				question: this.question,
				totalQuestions: this.total,
				players: this.players,
				round: this.round,
			}
		};
	}
	public updatePlayer(name: string, state: PlayerState | null): void {
		if (state == null)
			delete this.players[name];
		else
			this.players[name] = state;
		this.advanceStage();
	}
};
class Session {
	public timeout: NodeJS.Timeout | null;
	public dead: number;
	public ws: Set<libWs.WebSocket>;
	public state: GameState;

	constructor(questions: Question[]) {
		this.state = new GameState(questions);
		this.ws = new Set<libWs.WebSocket>();
		this.dead = 0;
		this.timeout = null;
	}

	public sync(): void {
		this.dead = 0;
		const msg = JSON.stringify(this.state.makeState());
		this.ws.forEach(ws => ws.send(msg));
	}

	public handle(msg: any): { cmd: string } | null {
		if (typeof (msg.cmd) != 'string' || msg.cmd == '')
			return { cmd: 'malformed' };

		/* handle the command */
		switch (msg.cmd) {
			case 'state':
				return this.state.makeState();
			case 'update':
				if (typeof (msg.name) != 'string')
					return { cmd: 'malformed' };
				this.state.updatePlayer(msg.name, msg.value);
				this.sync();
				return null;
			default:
				return { cmd: 'malformed' };
		}
	}
};

export class QuizGame implements libCommon.ModuleInterface {
	private fileStatic: (path: string) => string;
	private jsonQuestions: Question[];
	private sessions: Map<string, Session>;

	public name: string = 'quiz-game';
	constructor() {
		this.fileStatic = libLocation.MakeSelfPath(import.meta.url, '/static');
		const questionPath = libLocation.MakeSelfPath(import.meta.url)('./categorized-questions.json');
		this.jsonQuestions = JSON.parse(libFs.readFileSync(questionPath, 'utf8'));
		this.sessions = new Map<string, Session>()
	}

	private setupSession() {
		let id = libCrypto.randomUUID();
		libLog.Log(`Session created: ${id}`);
		let session = new Session(this.jsonQuestions);
		this.sessions.set(id, session);

		/* setup the session-timeout checker (only considered alive when the state changes) */
		let that = this;
		session.timeout = setInterval(function () {
			if (session.dead++ < sessionTimeoutMinutes + 1)
				return;

			/* close all connections */
			session.ws.forEach((ws) => ws.close());

			/* delete the session */
			that.sessions.delete(id);
			if (session.timeout != null)
				clearInterval(session.timeout);
			libLog.Log(`Session deleted: ${id}`);
		}, 60 * 1000);
		return id;
	}
	private acceptWebSocket(client: libClient.HttpUpgrade, ws: libWs.WebSocket, id: string): void {
		/* check if the session exists */
		if (!this.sessions.has(id)) {
			libLog.Log(`WebSocket connection for unknown session: ${id}`);
			ws.send(JSON.stringify({ cmd: 'unknown-session' }));
			ws.close();
			return;
		}
		let session = this.sessions.get(id)!;

		/* register the listener and advance the initial stage */
		session.ws.add(ws);
		client.log(`Websocket connected`);

		/* register the callbacks */
		ws.on('message', function (msg) {
			try {
				let parsed = JSON.parse(msg.toString('utf-8'));

				/* handle the message accordingly */
				let response = session.handle(parsed);
				if (response != null) {
					client.log(`Received: ${parsed.cmd} -> ${response.cmd}`);
					ws.send(JSON.stringify(response));
				}
				else
					client.log(`Received: ${parsed.cmd}`);
			} catch (err) {
				client.log(`Exception while message: [${err}]`);
				ws.close();
			}
		});
		ws.on('close', function () {
			session.ws.delete(ws);
			client.log(`Websocket disconnected`);
		});
	}

	public request(client: libClient.HttpRequest): void {
		client.log(`Game handler for [${client.path}]`);
		if (client.ensureMethod(['GET']) == null)
			return;

		/* check if its a root-request and forward it accordingly */
		if (client.path == '/') {
			client.tryRespondFile(this.fileStatic('base/startup.html'));
			return;
		}

		/* check if a new session has been requested and create it */
		if (client.path == '/new') {
			let id = this.setupSession();
			client.respondRedirect(`${client.basepath}/session?id=${id}`);
			return;
		}

		/* check if a session-dependent page has been requested */
		if (client.path == '/session') {
			client.tryRespondFile(this.fileStatic('base/session.html'));
			return
		}
		if (client.path == '/client') {
			client.tryRespondFile(this.fileStatic('client/main.html'));
			return;
		}
		if (client.path == '/score') {
			client.tryRespondFile(this.fileStatic('score/main.html'));
			return;
		}

		/* respond to the request by trying to server the file */
		client.tryRespondFile(this.fileStatic(client.path));
	}
	public upgrade(client: libClient.HttpUpgrade): void {
		client.log(`Game handler for [${client.path}]`);

		/* check if the websocket has been requested */
		if (!client.path.startsWith('/ws/')) {
			client.respondNotFound();
			return;
		}

		/* extract the id and try to accept the socket */
		let id = client.path.substring(4);
		if (client.tryAcceptWebSocket((ws) => this.acceptWebSocket(client, ws, id)))
			return;
		client.log(`Invalid request for web-socket point for session: [${id}]`);
		client.respondNotFound();
	}
};
