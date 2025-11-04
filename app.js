/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024-2025 Bjoern Boss Henrichsen */
import * as libLog from "../../server/log.js";
import * as libFs from "fs";
import * as libCrypto from "crypto";
import * as libLocation from "../../server/location.js";

const fileApp = libLocation.makeAppPath(import.meta.url);
const fileStatic = libLocation.makeAppPath(import.meta.url, 'static');

let JsonQuestions = JSON.parse(libFs.readFileSync(fileApp('categorized-questions.json'), 'utf8'));
let Sessions = {};

class GameState {
	constructor() {
		this.phase = 'start'; //start,category,answer,resolved,done
		this.question = null;
		this.remaining = [];
		this.players = {};
		this.round = null;

		for (let i = 0; i < JsonQuestions.length; ++i)
			this.remaining.push(i);
	}
	resetPlayerReady() {
		for (const key in this.players)
			this.players[key].ready = false;
	}
	resetPlayersForPhase() {
		/* reset the player states for the next phase */
		for (const key in this.players) {
			let player = this.players[key];
			player.ready = false;
			player.confidence = 1;
			player.choice = -1;
			player.correct = false;
			for (const eff in player.effects)
				player.effects[eff] = null;
			for (const eff in player.applied)
				player.applied[eff] = null;
		}
	}
	applyEffects() {
		/* initialize the actual confidences to be used and the effects to be applied to each */
		let confidence = {};
		let effects = {};
		for (const key in this.players) {
			let player = this.players[key];
			confidence[key] = player.confidence;

			for (const eff in player.effects) {
				let victim = player.effects[eff];

				/* check if no vicitm has been selected, or the effect will be handled separately */
				if (victim == null || eff in ['espose', 'protect', 'double'])
					continue;

				/* check if a victim exists and add it to the effects list */
				if (!(victim in effects))
					effects[victim] = {};

				/* add the attacker to the list of attackers of the effect */
				if (!(eff in effects[victim]))
					effects[victim][eff] = [];
				effects[victim][eff].push(key);
			}
		}

		/* iterate over all players again and apply the protections, exposures */
		for (const key in this.players) {
			let player = this.players[key];

			/* apply the exposure-effect */
			if (player.effects.expose != null)
				player.applied.expose = 'True';

			/* apply the protect-effect */
			if (player.effects.protect != null) {
				player.applied.protect = 'True';
				delete effects[key];
			}
		}

		/* apply the failed effects, and zero, and min/max, and clear
		*	any swaps for players who failed to answer correctly */
		for (const key in effects) {
			let applied = effects[key];
			let player = this.players[key];

			/* apply the failed effect */
			if ('fail' in applied) {
				player.applied.fail = applied.fail;
				player.correct = false;
			}

			/* clear the swap effects */
			if (!player.correct)
				delete applied.swap;

			/* apply the zero effect */
			if ('zero' in applied) {
				player.applied.zero = applied.zero;
				confidence[key] = 0;
				continue;
			}

			/* apply the min/max effects (most frequently used is applied is used) */
			let has = [];
			if ('min' in applied)
				has.push(['min', applied.min]);
			if ('max' in applied)
				has.push(['max', applied.max]);
			has.sort((a, b) => b[1].length - a[1].length);

			/* check if the result is trivial */
			if (has.length == 0)
				continue;
			let index = 0;

			/* pick the most frequent effect or randomly between all */
			if (has.length > 1 && has[0][1].length == has[1][1].length) {
				let count = 1;
				while (count < has.length && has[count][1].length == has[0][1].length)
					++count;
				index = Math.floor(Math.random() * count);
			}

			/* apply the chosen effect */
			player.applied[has[index][0]] = has[index][1];
			confidence[key] = (has[index][0] == 'min' ? -1 : 3);
		}

		/* compute the points each player will earn and apply double-or-nothing */
		let points = {};
		for (const key in this.players) {
			let player = this.players[key];

			/* apply the double-or-nothing effect */
			if (player.effects.double != null) {
				player.applied.double = 'True';
				points[key] = (player.correct ? player.score : -player.score);
			}
			else
				points[key] = (player.correct ? confidence[key] : -confidence[key]);
		}

		/* apply the steal randomly (ensure no steal-chains are possible) */
		let stealKeys = Object.keys(effects);
		while (stealKeys.length > 0) {
			/* pick the next entry to process and remove the index from the open list */
			let index = Math.floor(Math.random() * stealKeys.length);
			let key = stealKeys[index];
			stealKeys.splice(index, 1);

			/* check if the key can be removed, as no steals are registered for it */
			if (!('steal' in effects[key]))
				continue;
			let steals = effects[key].steal;
			delete effects[key].steal;

			/* select the thief and apply him */
			let thief = steals[Math.floor(Math.random() * steals.length)];
			this.players[key].applied.steal = thief;

			/* check if the thief and player stolea from each other */
			if ((thief in effects) && ('steal' in effects[thief]) && effects[thief].steal.includes(key))
				this.players[thief].applied.steal = key;

			/* steal the points */
			else {
				points[thief] += points[key];
				points[key] = 0;
			}

			/* remove the thief to prevent double-steal */
			if (thief in effects)
				delete effects[thief].steal;
		}

		/* compute the overall new points */
		for (const key in this.players)
			points[key] = Math.max(0, this.players[key].score + points[key]);

		/* apply the swaps randomly (ensure no swap-chains are possible) */
		let swapKeys = Object.keys(effects);
		while (swapKeys.length > 0) {
			/* pick the next entry to process and remove the index from the open list */
			let index = Math.floor(Math.random() * swapKeys.length);
			let key = swapKeys[index];
			swapKeys.splice(index, 1);

			/* check if the key can be removed, as no swaps are registered for it */
			if (!('swap' in effects[key]))
				continue;
			let swaps = effects[key].swap;
			delete effects[key].swap;

			/* select the thief and apply him */
			let thief = swaps[Math.floor(Math.random() * swaps.length)];
			this.players[key].applied.swap = thief;

			/* check if the thief and player swapped each other */
			if ((thief in effects) && ('swap' in effects[thief]) && effects[thief].swap.includes(key))
				this.players[thief].applied.swap = key;

			/* swap the points */
			else {
				let temp = points[key];
				points[key] = points[thief];
				points[thief] = temp;

			}

			/* remove the thief to prevent double-swaps */
			if (thief in effects)
				delete effects[thief].swap;
		}

		/* write the points out and update the delta */
		for (const key in this.players) {
			let player = this.players[key];

			player.delta = (points[key] - player.score);
			player.score = points[key];
			player.ready = false;
		}
	}
	advanceStage() {
		/* check if all players are valid */
		for (const key in this.players) {
			if (!this.players[key].ready)
				return;
		}
		if (this.players.length < 2)
			return;

		/* check if the next stage needs to be picked */
		if (this.phase == 'start' || this.phase == 'resolved') {
			if (this.remaining.length == 0) {
				this.phase = 'done';
				this.question = null;
				this.resetPlayersForPhase();
				return;
			}

			/* advance the round and select the next question */
			if (this.phase == 'start')
				this.round = 0;
			else
				this.round += 1;
			let index = Math.floor(Math.random() * this.remaining.length);
			this.question = JsonQuestions[this.remaining[index]];
			this.remaining.splice(index, 1);
			this.phase = 'category';
			this.resetPlayersForPhase();
			return;
		}

		/* check if the answer-round can be started */
		if (this.phase == 'category') {
			this.phase = 'answer';
			this.resetPlayerReady();
			return;
		}

		/* apply all effects (will mark the players as not ready) and advance the stage */
		this.applyEffects();
		this.phase = 'resolved';
	}
	makeState() {
		return {
			cmd: 'state',
			state: {
				phase: this.phase,
				question: this.question,
				totalQuestions: JsonQuestions.length,
				players: this.players,
				round: this.round,
			}
		};
	}
	updatePlayer(name, state) {
		if (state == undefined || state == null)
			delete this.players[name];
		else
			this.players[name] = state;
		this.advanceStage();
	}
};
class Session {
	constructor() {
		this.state = new GameState();
		this.ws = [];
		this.dead = 0;
		this.nextId = 0;
		this.timeout = null;
	}

	sync() {
		this.dead = 0;
		let msg = JSON.stringify(this.state.makeState());
		for (let i = 0; i < this.ws.length; ++i)
			this.ws[i].send(msg);
	}

	handle(msg) {
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

function SetupSession() {
	let id = libCrypto.randomUUID();
	libLog.Log(`Session created: ${id}`);
	let session = (Sessions[id] = new Session());

	/* setup the session-timeout checker (20 minutes)
	*	(only considered alive when the state changes) */
	session.timeout = setInterval(function () {
		if (session.dead++ < 21)
			return;
		for (let i = 0; i < session.ws.length; ++i)
			session.ws[i].close();
		delete Sessions[id];
		clearInterval(session.timeout);
		libLog.Log(`Session deleted: ${id}`);
	}, 1000 * 60);
	return id;
}
function AcceptWebSocket(ws, id) {
	/* check if the session exists */
	if (!(id in Sessions)) {
		libLog.Log(`WebSocket connection for unknown session: ${id}`);
		ws.send(JSON.stringify({ cmd: 'unknown-session' }));
		ws.close();
		return;
	}
	let session = Sessions[id];

	/* register the listener */
	session.ws.push(ws);

	/* setup the socket */
	let uniqueId = ++session.nextId;
	ws.log = function (msg) { libLog.Log(`WS[${id}|${uniqueId}]: ${msg}`); };
	ws.err = function (msg) { libLog.Error(`WS[${id}|${uniqueId}]: ${msg}`); };
	ws.log(`websocket connected`);

	/* register the callbacks */
	ws.on('message', function (msg) {
		try {
			let parsed = JSON.parse(msg);

			/* handle the message accordingly */
			let response = session.handle(parsed);
			if (response != null) {
				ws.log(`received: ${parsed.cmd} -> ${response.cmd}`);
				ws.send(JSON.stringify(response));
			}
			else
				ws.log(`received: ${parsed.cmd}`);
		} catch (err) {
			ws.err(`exception while message: [${err}]`);
			ws.close();
		}
	});
	ws.on('close', function () {
		session.ws = session.ws.filter((s) => (s != ws));
		ws.log(`websocket disconnected`);
		ws.close();
	});
}

export class Application {
	constructor() {
		this.path = '/quiz-game';
	}
	request(msg) {
		libLog.Log(`Game handler for [${msg.relative}]`);
		if (msg.ensureMethod(['GET']) == null)
			return;

		/* check if its a root-request and forward it accordingly */
		if (msg.relative == '/') {
			msg.tryRespondFile(fileStatic('base/startup.html'));
			return;
		}

		/* check if a new session has been requested and create it */
		if (msg.relative == '/new') {
			let id = SetupSession();
			msg.respondRedirect(`${this.path}/session` + `?id=${id}`);
			return;
		}

		/* check if a session-dependent page has been requested */
		if (msg.relative == '/session') {
			msg.tryRespondFile(fileStatic('base/session.html'));
			return
		}
		if (msg.relative == '/client') {
			msg.tryRespondFile(fileStatic('client/main.html'));
			return;
		}
		if (msg.relative == '/score') {
			msg.tryRespondFile(fileStatic('score/main.html'));
			return;
		}

		/* respond to the request by trying to server the file */
		msg.tryRespondFile(fileStatic(msg.relative));
	}
	upgrade(msg) {
		libLog.Log(`Game handler for [${msg.relative}]`);

		/* check if the websocket has been requested */
		if (!msg.relative.startsWith('/ws/')) {
			msg.respondNotFound();
			return;
		}

		/* extract the id and try to accept the socket */
		let id = msg.relative.substring(4);
		if (msg.tryAcceptWebSocket((ws) => AcceptWebSocket(ws, id)))
			return;
		libLog.Warning(`Invalid request for web-socket point for session: [${id}]`);
		msg.respondNotFound();
	}
};
