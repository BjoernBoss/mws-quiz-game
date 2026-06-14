/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024-2026 Bjoern Boss Henrichsen */
import * as mws from "@bjoernboss/mws";
import * as libFs from "fs";
import * as libCrypto from "crypto";

const SESSION_TIMEOUT_MINUTES = 20;
const VALID_NAME_REGEX = /^[a-zA-Z0-9-_]( ?[a-zA-Z0-9-_])*$/
const NAME_COOKIE_NAME = 'quiz-game-last-name';
const NAME_COOKIE_LIFETIME_MS = 24 * 60 * 60 * 1000;

interface QuestionState {
	text: string;
	category: string;
	options: string[];
}
interface GameEffects<T> {
	expose: T;
	double: T;
	protect: T;
	fail: T;
	swap: T;
	zero: T;
	min: T;
	max: T;
	steal: T;
}
interface PlayerState {
	ready: boolean;
	confidence: number;
	payout: number;
	choice: number;
	correct: boolean;
	delta: number;
	score: number;
	applied: string[];
	effects: GameEffects<string | null>;
	last: GameEffects<number>;
}
enum GamePhase {
	start = 'start',
	category = 'category',
	answer = 'answer',
	resolved = 'resolved',
	done = 'done'
}

class GameState {
	private players: Record<string, PlayerState>;
	private phase: GamePhase;
	private question: QuestionState | null;
	private round: number;
	private remaining: QuestionState[];
	private total: number;

	constructor(questions: QuestionState[]) {
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
			player.effects = { expose: null, protect: null, fail: null, zero: null, min: null, max: null, double: null, steal: null, swap: null };
			player.applied = [];
		}
	}
	private applyEffects(): void {
		const appliedTo: Record<string, GameEffects<string[] | null>> = {};

		/* collect the list of players who applied each effect to each other */
		const targetEffects: (keyof GameEffects<unknown>)[] = ['fail', 'swap', 'zero', 'min', 'max', 'steal'];
		for (const name in this.players) {
			const player = this.players[name];
			for (const effect of targetEffects) {
				const victim = player.effects[effect];
				if (victim == null)
					continue;

				/* check if the victim exists and add it the the inverse-map */
				if (!(victim in appliedTo))
					appliedTo[victim] = { expose: null, protect: null, fail: null, zero: null, min: null, max: null, double: null, steal: null, swap: null };
				const applied = appliedTo[victim];

				/* add the player as source for the given effect */
				if (applied[effect] == null)
					applied[effect] = [];
				applied[effect]!.push(name);
			}
		}

		/* iterate over all players again and reset them, apply the protections, exposures, fail,
		*	zero, min, max, and clear swaps for players who failed to answer correctly */
		for (const name in this.players) {
			const player = this.players[name];

			/* reset the player for the effect application */
			player.applied = [];
			player.payout = player.confidence;
			player.delta = 0;
			player.ready = false;

			/* apply the exposure-effect */
			if (player.effects.expose != null)
				player.applied.push('Exposed Question');

			/* apply the protect-effect */
			if (player.effects.protect != null) {
				player.applied.push('Protected');
				delete appliedTo[name];
				continue;
			}

			/* check if any effects are applied */
			const applied = appliedTo[name];
			if (applied == null)
				continue;

			/* apply the failed effect */
			if (applied.fail != null) {
				player.applied.push(`Failed by: ${applied.fail.join(', ')}`);
				player.correct = false;
			}

			/* clear the swap effects */
			if (!player.correct)
				applied.swap = null;

			/* apply the zero effect */
			if (applied.zero != null) {
				player.applied.push(`Zeroed by: ${applied.zero.join(', ')}`);
				player.payout = 0;
				continue;
			}

			/* apply the min/max effects (most frequently used is applied and otherwise randomly chosen) */
			if (applied.min == null && applied.max == null)
				continue;
			if (applied.min != null && applied.max != null) {
				if (applied.min.length > applied.max.length || (applied.min.length == applied.max.length && Math.random() <= 0.5))
					applied.max = null;
				else
					applied.min = null;
			}

			/* apply the chosen effect */
			if (applied.min != null)
				player.applied.push(`Confidence -1 by: ${applied.min.join(', ')}`);
			if (applied.max != null)
				player.applied.push(`Confidence 3 by: ${applied.max.join(', ')}`);
			player.payout = (applied.max != null ? 3 : -1);
		}

		/* compute the points each player will earn and apply double-or-nothing */
		for (const name in this.players) {
			const player = this.players[name];

			/* apply the double-or-nothing effect */
			if (player.effects.double != null) {
				player.applied.push('Double or Nothing');
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
			appliedTo[name].steal = null;

			/* select the thief and apply him */
			const thief = thieves[Math.floor(Math.random() * thieves.length)];
			this.players[name].applied.push(`Points stolen by: ${thief}`);

			/* check if the thief and player stole from each other */
			if ((thief in appliedTo) && appliedTo[thief].steal != null && appliedTo[thief].steal.includes(name))
				this.players[thief].applied.push(`Points stolen back by: ${name}`);

			/* steal the points */
			else {
				this.players[thief].delta += this.players[name].delta;
				this.players[name].delta = 0;
			}

			/* remove the thief to prevent double-steal */
			if (thief in appliedTo)
				appliedTo[thief].steal = null;
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
			appliedTo[name].swap = null;

			/* select the other player and apply him */
			const other = swaps[Math.floor(Math.random() * swaps.length)];
			this.players[name].applied.push(`Points swapped with: ${other}`);

			/* check if the thief and player swapped each other */
			if ((other in appliedTo) && appliedTo[other].swap != null && appliedTo[other].swap.includes(name))
				this.players[other].applied.push(`Points swapped back with: ${name}`);

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
				appliedTo[other].swap = null;
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
				round: this.round
			}
		};
	}
	public updatePlayer(name: string, state: any): boolean {
		if (!name.match(VALID_NAME_REGEX))
			return false;

		if (state === null)
			delete this.players[name];
		else {
			if (typeof state.ready != 'boolean' || typeof state.correct != 'boolean')
				return false;
			if (typeof state.confidence != 'number' || typeof state.payout != 'number' || typeof state.choice != 'number')
				return false;
			if (typeof state.delta != 'number' || typeof state.score != 'number')
				return false;
			if (typeof state.effects != 'object' || typeof state.applied != 'object')
				return false;
			for (const name of ['expose', 'double', 'protect', 'fail', 'swap', 'zero', 'min', 'max', 'steal']) {
				if (typeof state.effects[name] != 'string' && state.effects[name] != null)
					return false;
				if (typeof state.last[name] != 'number')
					return false;
			}
			if (!Array.isArray(state.applied))
				return false;
			const applied = [];
			for (const entry of state.applied) {
				if (typeof entry != 'string')
					return false;
				applied.push(entry);
			}

			this.players[name] = {
				ready: state.ready,
				correct: state.correct,
				confidence: state.confidence,
				payout: state.payout,
				choice: state.choice,
				delta: state.delta,
				score: state.score,
				applied,
				effects: {
					expose: state.effects.expose,
					double: state.effects.double,
					protect: state.effects.protect,
					fail: state.effects.fail,
					swap: state.effects.swap,
					zero: state.effects.zero,
					min: state.effects.min,
					max: state.effects.max,
					steal: state.effects.steal
				},
				last: {
					expose: state.last.expose,
					double: state.last.double,
					protect: state.last.protect,
					fail: state.last.fail,
					swap: state.last.swap,
					zero: state.last.zero,
					min: state.last.min,
					max: state.last.max,
					steal: state.last.steal
				}
			};
		}
		this.advanceStage();
		return true;
	}
}
class Session {
	private timeout: NodeJS.Timeout | null;
	private state: GameState;
	private dropSelf: (() => void) | null;
	private ws: Set<mws.ClientSocket>;

	constructor(questions: QuestionState[], dropSelf: () => void) {
		this.state = new GameState(questions);
		this.ws = new Set<mws.ClientSocket>();
		this.timeout = null;
		this.dropSelf = dropSelf;

		/* start the session timout */
		this.selfAlive();
	}
	private selfAlive(): void {
		if (this.timeout != null)
			clearTimeout(this.timeout);
		this.timeout = (this.dropSelf == null ? null : setTimeout(() => this.drop(), SESSION_TIMEOUT_MINUTES * 60 * 1000));
	}
	private syncStateChange(): void {
		this.selfAlive();
		const msg = JSON.stringify(this.state.makeState());
		this.ws.forEach(ws => ws.send(msg));
	}

	public async drop(): Promise<void> {
		if (this.timeout != null)
			clearTimeout(this.timeout);
		this.timeout = null;

		/* delete the session */
		if (this.dropSelf == null)
			return;
		this.dropSelf();
		this.dropSelf = null;

		/* close all connections (safe to iterate, even if it is nested removed from the set) */
		const promises: Promise<void>[] = [];
		this.ws.forEach((ws) => promises.push(ws.close()));
		await Promise.all(promises);
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
				if (!this.state.updatePlayer(msg.name, msg.value))
					return { cmd: 'malformed' };
				this.syncStateChange();
				return null;
			default:
				return { cmd: 'malformed' };
		}
	}
	public addPlayer(ws: mws.ClientSocket): void {
		this.selfAlive();
		this.ws.add(ws);
	}
	public dropPlayer(ws: mws.ClientSocket): void {
		this.ws.delete(ws);
	}
}
interface BurntAccess {
	create: boolean;
}

/**
 *	Interface to define custom questions.
 *	Must at least have one incorrect answer, and have a caption text and category.
 */
export interface Question {
	text: string;
	category: string;
	correct: string;
	incorrect: string[];
}

/**
 *	Access mask is created by merging the handler-params as access mask with the default access mask.
 *	The properties decide whether or not a given client has access to the corresponding abilities (otherwise results in 403).
 */
export interface Access {
	/** connection is allowed to create a session (default: false) */
	create?: boolean;
}

/**
 *	Endpoints used by the module.
 *	This mapping can be used to translate components of the module to different paths in the URL space.
 */
export const Endpoints = {
	/** directory containting static assets (sparsely used) */
	static: '/static',

	/** endpoint to create a new session (requires Access.create) */
	welcome: '/',

	/** endpoint to create a new page (automatically redirects to session page; requires Access.create) */
	create: '/new',

	/** directory for web-sockets (fully owned, auto-responds with 404) */
	sockets: '/ws',

	/** endpoint for created sessions (session identified by query paramter 'id') */
	session: '/session',

	/** endpoint for player clients (session identified by query paramter 'id') */
	client: '/client',

	/** endpoint for scoreboard clients (session identified by query paramter 'id') */
	score: '/score'
}

/**
 *	Game sessions only live in memory of the module.
 */
export class QuizGame extends mws.ModuleHandler {
	private fileStatic: (path: string) => string;
	private fileAssets: (path: string) => string;
	private questionList: QuestionState[];
	private sessions: Map<string, Session>;
	private defaultAccess: BurntAccess;

	/**
	 *	[questions] either describe a path to a json file of questions, or alist of questsions.
	 *	If no questions are provided, loads the default questions.
	 *	[access] describes the default access mask.
	 */
	constructor(options?: { questions?: string | Question[], access?: Access }) {
		super('quiz-game');

		this.fileStatic = mws.createPathSelf(import.meta.url, '../static');
		this.fileAssets = mws.createPathSelf(import.meta.url, '../assets');
		this.sessions = new Map<string, Session>();

		/* load the actual questions */
		this.questionList = this.loadQuestions(options?.questions ?? this.fileAssets('/default.json'));
		this.defaultAccess = {
			create: options?.access?.create ?? false
		};
	}

	private checkQuestionEntry(entry: any): boolean {
		if (typeof entry.text != 'string' || entry.text == '')
			return false;
		if (typeof entry.category != 'string' || entry.category == '')
			return false;
		if (typeof entry.correct != 'string' || entry.correct == '')
			return false;
		if (!Array.isArray(entry.incorrect) || entry.incorrect.length == 0)
			return false;
		for (const opt of entry.incorrect) {
			if (typeof opt != 'string' || opt == '')
				return false;
		}
		return true;
	}
	private loadFile(path: string): any[] {
		try {
			this.info(`Loading questions from [${path}]`);
			const data = JSON.parse(libFs.readFileSync(path, 'utf-8'));

			if (Array.isArray(data))
				return data;
			this.warning(`Malformed question format of [${path}]`);
		}
		catch (err: any) {
			this.error(`Failed to load questions [${path}]: ${err.message}`);
		}
		return [];
	}
	private loadQuestions(questions: string | Question[]): QuestionState[] {
		const list = (typeof questions == 'string' ? this.loadFile(questions) : questions);
		const out: QuestionState[] = [];

		/* parse the question data */
		for (const entry of list) {
			if (!this.checkQuestionEntry(entry)) {
				this.warning(`Malformed question: ${entry.text}`);
				continue;
			}

			out.push({
				text: entry.text,
				category: entry.category,
				options: [entry.correct, ...entry.incorrect]
			});
		}

		this.info(`Successfully loaded [${out.length}] questions`);
		return out;
	}
	private setupSession(): string {
		let id = libCrypto.randomUUID();

		const session = new Session(this.questionList, () => {
			this.sessions.delete(id);
			this.info(`Session deleted: ${id}`);
		});

		this.info(`Session created: ${id}`);
		this.sessions.set(id, session);
		return id;
	}
	private async acceptWebSocket(client: mws.ClientSocket, id: string): Promise<void> {
		/* check if the session exists */
		if (!this.sessions.has(id)) {
			this.error(`WebSocket connection for unknown session: ${id}`);
			client.send(JSON.stringify({ cmd: 'unknown-session' }));
			client.close();
			return;
		}
		let session = this.sessions.get(id)!;

		/* register the listener and advance the initial stage */
		session.addPlayer(client);
		client.log(`Websocket connected`);
		let connectionName = '', nameLogTag = client.tagLog('');

		/* register the callbacks */
		client.on('data', (msg) => {
			try {
				let parsed = JSON.parse(msg.toString('utf-8'));

				/* check if a name can be assigned to the game */
				if (typeof parsed.name == 'string' && parsed.name != connectionName)
					nameLogTag(connectionName = parsed.name);

				/* handle the message accordingly */
				let response = session.handle(parsed);
				if (response != null) {
					client.trace(`Received: ${parsed.cmd} -> ${response.cmd}`);
					client.send(JSON.stringify(response));
				}
				else
					client.trace(`Received: ${parsed.cmd}`);
			} catch (err: any) {
				client.error(`Exception while message: [${err}]`);
				client.close();
			}
		});
		client.on('close', () => {
			session.dropPlayer(client);
			client.log(`Websocket disconnected`);
		});
	}
	private staticPath(client: mws.ClientRequest, path: string): string {
		return client.makePath(this.cache.immutable(this.name, mws.joinSanitized(Endpoints.static, path)));
	}
	private async fetchBody(client: mws.ClientRequest, path: string): Promise<string | null> {
		const fullPath = this.fileAssets(path);

		/* look for the file (will never be an immutable path) */
		try {
			const data: Buffer | null = await this.cache.read(fullPath);
			if (data == null) {
				client.respondInternalError(`Failed to find content [${fullPath}]`);
				return null;
			}
			return data.toString('utf-8');
		}
		catch (err: any) {
			client.respondInternalError(`Failed to read content [${fullPath}]: ${err.message}`);
			return null;
		}
	}
	private async buildStartupPage(client: mws.ClientRequest, access: BurntAccess): Promise<void> {
		/* check if the client is allowed to query */
		if (!access.create)
			return client.respondForbidden('Not allowed to create sessions');

		/* read the body */
		const body: string | null = await this.fetchBody(client, '/startup.html');
		if (body == null)
			return;

		const loadConfig: string = JSON.stringify({
			manifest: {
				create: client.makePath(Endpoints.create)
			}
		});

		const b = mws.build;
		const page = new b.HtmlPage({
			language: 'en',
			head: [
				b.Meta('viewport', 'width=device-width, initial-scale=1'),
				b.Title('Start Session!'),
				b.LoadStyle(this.staticPath(client, '/common/buttons.css')),
				b.LoadStyle(this.staticPath(client, '/base/style.css')),
				b.AddScript(`__LOAD_CONFIG__=${loadConfig}`)
			],
			body: b.Embed(body, true)
		});
		await client.respondHtml(page, { status: mws.Status.Ok });
	}
	private async buildSessionPage(client: mws.ClientRequest): Promise<void> {
		const body: string | null = await this.fetchBody(client, '/session.html');
		if (body == null)
			return;

		const loadConfig: string = JSON.stringify({
			manifest: {
				client: client.makePath(Endpoints.client),
				score: client.makePath(Endpoints.score),
				timeout: SESSION_TIMEOUT_MINUTES
			},
			valid: this.sessions.has(client.url.searchParams.get('id') ?? '')
		});

		const b = mws.build;
		const page = new b.HtmlPage({
			language: 'en',
			head: [
				b.Meta('viewport', 'width=device-width, initial-scale=1'),
				b.Title('New Session Created!'),
				b.LoadStyle(this.staticPath(client, '/common/buttons.css')),
				b.LoadStyle(this.staticPath(client, '/base/style.css')),
				b.AddScript(`__LOAD_CONFIG__=${loadConfig}`)
			],
			body: b.Embed(body, true)
		});
		await client.respondHtml(page, { status: mws.Status.Ok });
	}
	private async buildClientPage(client: mws.ClientRequest): Promise<void> {
		const body: string | null = await this.fetchBody(client, '/client.html');
		if (body == null)
			return;

		const loadConfig: string = JSON.stringify({
			manifest: {
				sockets: client.makePath(Endpoints.sockets),
				cookie: {
					name: NAME_COOKIE_NAME,
					lifetime: NAME_COOKIE_LIFETIME_MS
				}
			}
		});

		const b = mws.build;
		const page = new b.HtmlPage({
			language: 'en',
			head: [
				b.Meta('viewport', 'width=device-width, initial-scale=1'),
				b.Title('Normal Player!'),
				b.LoadStyle(this.staticPath(client, '/common/buttons.css')),
				b.LoadScript(this.staticPath(client, '/common/helper.js')),
				b.LoadScript(this.staticPath(client, '/common/sync-socket.js')),
				b.LoadScript(this.staticPath(client, '/client/script.js')),
				b.LoadStyle(this.staticPath(client, '/client/style.css')),
				b.AddScript(`__LOAD_CONFIG__=${loadConfig}`)
			],
			body: b.Embed(body, true)
		});
		await client.respondHtml(page, { status: mws.Status.Ok });
	}
	private async buildScorePage(client: mws.ClientRequest): Promise<void> {
		const body: string | null = await this.fetchBody(client, '/score.html');
		if (body == null)
			return;

		const loadConfig: string = JSON.stringify({
			manifest: {
				sockets: client.makePath(Endpoints.sockets)
			}
		});

		const b = mws.build;
		const page = new b.HtmlPage({
			language: 'en',
			head: [
				b.Meta('viewport', 'width=device-width, initial-scale=1'),
				b.Title('Scoreboard!'),
				b.LoadStyle(this.staticPath(client, '/score/style.css')),
				b.LoadScript(this.staticPath(client, '/common/helper.js')),
				b.LoadScript(this.staticPath(client, '/common/sync-socket.js')),
				b.LoadScript(this.staticPath(client, '/score/script.js')),
				b.AddScript(`__LOAD_CONFIG__=${loadConfig}`)
			],
			body: b.Embed(body, true)
		});
		await client.respondHtml(page, { status: mws.Status.Ok });
	}

	protected override async handleRequest(client: mws.ClientRequest, params?: mws.Params): Promise<void> {
		const access: BurntAccess = {
			create: (typeof params?.create == 'boolean' ? params : this.defaultAccess).create
		};
		client.trace(`Game handler for [${client.path}] (C: ${access.create})`);

		/* all endpoints only support 'getting' */
		if (client.requireMethod('GET') == null)
			return;

		/* check if a new session has been requested and create it */
		if (client.path == Endpoints.create) {
			if (!access.create)
				return client.respondForbidden('Not allowed to create sessions');
			const id = this.setupSession();
			return client.respondSeeOther(client.makePath(`${Endpoints.session}?id=${id}`));
		}

		/* check if the websocket has been requested */
		if (client.isInsideOf(Endpoints.sockets)) {
			let id = mws.childPath(Endpoints.sockets, client.path).substring(1);

			/* extract the id and try to accept the socket (web-socket protocol handles unknown ids) */
			const ws = await client.acceptWebSocket();
			if (ws != null)
				await this.acceptWebSocket(ws, id);
			return;
		}

		/* check if its one of the html endpoints and build them dynamically */
		if (client.path == Endpoints.welcome)
			return this.buildStartupPage(client, access);
		if (client.path == Endpoints.session)
			return this.buildSessionPage(client);
		if (client.path == Endpoints.client)
			return this.buildClientPage(client);
		if (client.path == Endpoints.score)
			return this.buildScorePage(client);

		/* check if its just static content to be served */
		if (client.isInsideOf(Endpoints.static))
			await client.tryRespondFile(this.fileStatic(mws.childPath(Endpoints.static, client.path)));
	}
	protected override async handleStop(): Promise<void> {
		const list: Promise<void>[] = [];

		/* drop all sections (safe to iterate, even when they remove themselves) */
		for (const [_, session] of this.sessions)
			list.push(session.drop());
		await Promise.all(list);
	}
}
