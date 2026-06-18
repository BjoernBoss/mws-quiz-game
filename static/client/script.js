/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024-2026 Bjoern Boss Henrichsen */
let _game = {};

const GAME_NAME_REGEX = /^[a-zA-Z0-9-_]( ?[a-zA-Z0-9-_])*$/

window.onload = function () {
	const pathSockets = (__LOAD_PARAMS__?.sockets ?? '/bad_path');

	/* setup the overall state */
	_game.state = {};
	_game.sessionId = new URLSearchParams(location.search).get('id') ?? 'bad_id';
	_game.id = '';
	_game.playerId = '';
	_game.idByName = (__LOAD_PARAMS__?.idByName ?? false);
	_game.loggedIn = null;
	_game.tryLogIn = false;
	_game.self = null;
	_game.selectDescription = '';
	_game.selectCallback = null;
	_game.viewScore = false;
	_game.totalPlayerCount = 0;
	_game.effects = {
		expose: {
			timeout: 2,
			description: 'Exposed',
		},
		protect: {
			timeout: 4,
			description: 'Protected',
		},
		fail: {
			timeout: 5,
			select: 'Select opponent to fail',
			description: 'Failed by',
		},
		zero: {
			timeout: 3,
			select: 'Select opponent to not get any points',
			description: 'No Points because of',
		},
		min: {
			timeout: 4,
			select: 'Select opponent to set the confidence to -1 to',
			description: 'Minimum confidence because of',
		},
		max: {
			timeout: 6,
			select: 'Select opponent to set the confidence to 3 to',
			description: 'Maximum confidence because of',
		},
		double: {
			timeout: 15,
			description: 'Double or Nothing',
		},
		steal: {
			timeout: 5,
			select: 'Select opponent to steal the points from',
			description: 'Stolen by',
		},
		swap: {
			timeout: 8,
			select: 'Select opponent to swap points with',
			description: 'Swapped Points with',
		},
	};
	_game.empty = {
		score: 0,
		stamp: 0,
		ready: false,
		payout: 0,
		confidence: 1,
		choice: -1,
		correct: false,
		delta: 0,
		effects: {},
		last: {},
		applied: [],
	};
	_game.fromScramble = [];
	_game.lastScramble = '';

	/* setup the effect parameter */
	for (const effName in _game.effects) {
		_game.effects[effName].html = document.getElementById(effName);
		_game.empty.effects[effName] = null;
		_game.empty.last[effName] = -100;
	}

	/* login-screen html components */
	_game.htmlLogin = document.getElementById('login');
	_game.htmlName = document.getElementById('name');
	_game.htmlWarning = document.getElementById('warning');
	_game.htmlWarningText = document.getElementById('warning-text');

	/* caption/footer components */
	_game.htmlMain = document.getElementById('main');
	_game.htmlSelfName = document.getElementById('self-name');
	_game.htmlText = document.getElementById('text');
	_game.htmlCategory = document.getElementById('category');
	_game.htmlQuestion = document.getElementById('question');
	_game.htmlScore = document.getElementById('score');
	_game.htmlRound = document.getElementById('round');
	_game.htmlReady = document.getElementById('ready');
	_game.htmlConfidence = document.getElementById('confidence');
	_game.htmlActual = document.getElementById('actual');
	_game.htmlDelta = document.getElementById('delta');

	/* splash-screen components */
	_game.htmlSplashScreen = document.getElementById('splash-screen');
	_game.htmlSplashMessage = document.getElementById('splash-message');

	/* gameplay components */
	_game.htmlGameScreen = document.getElementById('game-screen');
	_game.htmlGameLock = document.getElementById('game-lock');
	_game.htmlGameContent = document.getElementById('game-content');

	/* select components */
	_game.htmlSelectScreen = document.getElementById('select-screen');
	_game.htmlSelectText = document.getElementById('select-text');
	_game.htmlSelectContent = document.getElementById('select-content');

	/* setup components */
	_game.htmlSetupScreen = document.getElementById('setup-screen');
	_game.htmlSetupLock = document.getElementById('setup-lock');
	_game.htmlConfidenceSelect = document.getElementById('confidence-select');
	_game.htmlConfidenceValue = document.getElementById('confidence-value');
	_game.htmlConfidenceSlider = document.getElementById('confidence-slider');

	/* score components */
	_game.htmlScoreScreen = document.getElementById('score-screen');
	_game.htmlScoreContent = document.getElementById('score-content');
	_game.htmlToggleBoard = document.getElementById('toggle-board');

	/* setup the web-socket */
	_game.sock = new SyncSocket(`${pathSockets}?id=${_game.sessionId}`);
	_game.sock.onfailed = (m) => _game.failed(m);
	_game.sock.onupdate = (s) => _game.applyState(s);
	_game.sock.onestablished = function () {
		if (_game.tryLogIn) {
			_game.tryLogIn = false;
			_game.login();
		}
		else if (_game.loggedIn != null) {
			_game.loggedIn.applied = false;
			_game.sock.fetch();
		}
	};

	/* load the player id or check if a new id needs to be created and write the cookie back */
	_game.playerId = (_game.getCookie(__LOAD_PARAMS__?.cookie?.playerId) ?? _game.makePlayerId());
	_game.setCookie(__LOAD_PARAMS__?.cookie?.playerId, _game.playerId);

	/* initialize the last name from the cookies */
	const lastName = _game.getCookie(__LOAD_PARAMS__?.cookie?.name ?? '');
	if (lastName != null)
		_game.htmlName.value = lastName;

	/* add the login-enter key listener and default focus it */
	_game.htmlName.onkeydown = function (e) {
		if (e.key == 'Enter')
			_game.login();
	};
	_game.htmlName.focus();
}

_game.makePlayerId = function () {
	if (crypto?.randomUUID != null)
		return crypto.randomUUID();
	const gen = (nibbles) => {
		let out = '';
		for (let i = 0; i < nibbles; ++i)
			out += '0123456789abcdef'[Math.floor(Math.random() * 16)];
		return out;
	};

	/* build the uuid manually (no crypto available in insecure context; version: 8, variant 0b10) */
	const version = '8', variant = '89ab'[Math.floor(Math.random() * 4)];
	return `${gen(8)}-${gen(4)}-${version}${gen(3)}-${variant}${gen(3)}-${gen(12)}`;
}
_game.getCookie = function (name) {
	if (name == '')
		return;
	const value = document.cookie.split('; ').find((v) => v.startsWith(`${name}=`))?.split('=');
	if (value == null)
		return null;
	return value[1];
}
_game.setCookie = function (name, value) {
	const lifetime = (__LOAD_PARAMS__?.cookie?.lifetime ?? 0);
	if (name != '' && lifetime > 0)
		document.cookie = `${name}=${value}; expires=${new Date(Date.now() + lifetime).toUTCString()};`;
}

_game.selfChanged = function (update) {
	if (update)
		_game.applyState(null);
	++_game.self.stamp;
	console.log('Uploading dirty state');
	_game.sock.sync(_game.id, _game.self);
}
_game.applyState = function (state) {
	if (state != null)
		_game.state = state;
	if (_game.loggedIn == null)
		return;
	if (state != null)
		console.log('Applying received state');

	/* fetch the total playercount */
	_game.totalPlayerCount = 0;
	for (const _ in _game.state.players)
		++_game.totalPlayerCount;

	/* check if this is the initial connection after a login/re-connect */
	if (!_game.loggedIn.applied) {
		_game.loggedIn.applied = true;
		let dirty = false;

		/* check if no state exists yet */
		if (_game.self == null) {
			if (_game.id in _game.state.players)
				_game.self = _game.state.players[_game.id];
			else
				_game.self = { ..._game.empty }, dirty = true;
		}

		/* check if the remote state does not exist yet or is outdated */
		else if (!(_game.id in _game.state.players) || _game.self.stamp > _game.state.players[_game.id].stamp)
			dirty = true;
		else
			_game.self = _game.state.players[_game.id];

		/* apply the login name */
		if (_game.self.name != _game.loggedIn.name)
			_game.self.name = _game.loggedIn.name, dirty = true;

		/* check if the state needs to be uploaded again */
		if (dirty)
			_game.selfChanged(false);
	}

	/* check if the player has been removed */
	else if (!(_game.id in _game.state.players)) {
		_game.failed('Player has been reset');
		return;
	}

	/* check if the remote state is newer */
	else if (_game.self.stamp <= _game.state.players[_game.id].stamp)
		_game.self = _game.state.players[_game.id];

	/* construct the header and footer */
	_game.applyHeaderAndFooter();

	/* check if the scoreboard is currently being viewed */
	if (_game.viewScore) {
		_game.applyScore();
		return;
	}
	_game.htmlToggleBoard.innerText = 'Board';
	_game.htmlReady.classList.remove('hidden');

	/* check if a player is to be selected for an operation */
	if (_game.self.ready || _game.state.phase != 'category')
		_game.selectDescription = '';
	else if (_game.selectDescription.length > 0) {
		_game.applySelection();
		return;
	}

	/* check if the splash-screen needs to be shown */
	if (_game.state.question == null)
		_game.applySplashScreen();

	/* check if the question-screen needs to be constructed (will ensure for scrambling) */
	else if (_game.state.phase == 'answer' || _game.state.phase == 'resolved')
		_game.applyQuestion();

	/* setup the category/effect setup screen */
	else
		_game.applySetup();
}
_game.setupScramble = function () {
	if (_game.lastScramble == _game.state.question.text)
		return;
	_game.lastScramble = _game.state.question.text;

	/* setup the initial raw mapping */
	const indices = [];
	for (let i = 0; i < _game.state.question.options.length; ++i)
		indices.push(i);
	_game.fromScramble = Array.from(Array(_game.state.question.options.length).keys());

	/* fetch the indices in random order */
	let next = 0;
	while (indices.length > 0) {
		let index = Math.floor(Math.random() * indices.length);
		_game.fromScramble[indices[index]] = next;

		indices.splice(index, 1);
		++next;
	}
}
_game.canEffect = function (effName, full) {
	if (full && (_game.self == null || _game.self.ready || _game.state.phase != 'category'))
		return false;
	if ((_game.state.round - _game.self.last[effName]) <= _game.effects[effName].timeout)
		return false;
	if (_game.self.effects[effName] != null)
		return false;
	return true;
}
_game.doEffect = function (effName, value) {
	_game.self.last[effName] = _game.state.round;
	_game.self.effects[effName] = value;
	_game.selfChanged(true);
}

/* applying-state functions */
_game.applyHeaderAndFooter = function () {
	/* update the current score and category */
	_game.htmlSelfName.innerText = `Name: ${_game.self.name}`;
	_game.htmlScore.innerText = `Score: ${_game.self.score}`;
	if (_game.state.round == null)
		_game.htmlRound.innerText = `Round: None / ${_game.state.totalQuestions}`;
	else
		_game.htmlRound.innerText = `Round: ${_game.state.round + 1} / ${_game.state.totalQuestions}`;

	_game.htmlConfidence.innerText = `Confidence: ${_game.self.confidence}`;

	if (_game.state.phase == 'resolved' && _game.self.payout != _game.self.confidence) {
		_game.htmlActual.innerText = ` (Actual: ${_game.self.payout})`;
		_game.htmlActual.classList.remove('hidden');
	}
	else
		_game.htmlActual.classList.add('hidden');

	if (_game.state.question == null)
		_game.htmlQuestion.classList.add('hidden');
	else {
		_game.htmlQuestion.classList.remove('hidden');

		_game.htmlCategory.innerText = _game.state.question.category;

		if (_game.state.phase != 'category' || _game.self.effects.expose != null)
			_game.htmlText.innerText = _game.state.question.text;
		else
			_game.htmlText.innerText = '???';
	}

	/* update the points-delta */
	if (_game.state.phase == 'resolved') {
		_game.htmlDelta.classList.remove('hidden');
		_game.htmlDelta.innerText = `(Points: ${(_game.self.delta < 0 ? '' : '+')}${_game.self.delta})`;
	}
	else
		_game.htmlDelta.classList.add('hidden');

	/* update the ready-state of the ready-button */
	if (_game.self.ready || _game.state.phase == 'done' || _game.totalPlayerCount < 2)
		_game.htmlReady.classList.add('disabled');
	else
		_game.htmlReady.classList.remove('disabled');

	/* count the number of ready players */
	let readyCount = 0;
	for (const id in _game.state.players) {
		if (_game.state.players[id].ready)
			++readyCount;
	}
	_game.htmlReady.children[0].children[0].innerText = `Ready (${readyCount} / ${_game.totalPlayerCount})`;
}
_game.applyScore = function () {
	_game.screen('score');
	_game.htmlToggleBoard.innerText = 'Return to Game';
	_game.htmlReady.classList.add('hidden');

	UpdateScoreboard(_game.state, _game.htmlScoreContent);
}
_game.applySelection = function () {
	_game.screen('select');
	_game.htmlSelectText.innerText = _game.selectDescription;

	/* collect the list of all players and sort them by their score */
	let list = [];
	for (const id in _game.state.players) {
		if (id != _game.id)
			list.push([id, _game.state.players[id].score]);
	}
	list.sort((a, b) => ((a[1] < b[1] || (a[1] == b[1] && a[0] > b[0])) ? 1 : -1));

	/* add the list of players */
	for (let i = 0; i < list.length; ++i) {
		/* check if the element already exists or needs to be created ([0/1] is text/cancel) */
		if (2 + i >= _game.htmlSelectContent.children.length) {
			let node = document.createElement('div');
			_game.htmlSelectContent.appendChild(node);
			node.classList.add('button');
			let inner = document.createElement('div');
			node.appendChild(inner);
			inner.classList.add('clickable');
			inner.appendChild(document.createElement('p'));
			let sub = document.createElement('p');
			inner.appendChild(sub);
			sub.classList.add('sub');
		}
		let node = _game.htmlSelectContent.children[i + 2];

		/* add the name and score and callback */
		const player = _game.state.players[list[i][0]];
		node.children[0].children[0].innerText = player.name;
		node.children[0].children[1].innerText = `Score: ${player.score}`;
		node.children[0].onclick = () => _game.pick(list[i][0]);
	}

	/* remove the remaining children */
	while (_game.htmlSelectContent.children.length > 2 + list.length)
		_game.htmlSelectContent.lastChild.remove();
}
_game.applySplashScreen = function () {
	_game.screen('splash');
	if (_game.state.phase == 'start')
		_game.htmlSplashMessage.innerText = 'Ready up to start playing!';
	else
		_game.htmlSplashMessage.innerText = 'Game Over!';
}
_game.applyQuestion = function () {
	_game.screen('game');

	/* setup the scrambling of the answers */
	_game.setupScramble();

	/* update the ready-visibility */
	if (_game.self.ready)
		_game.htmlGameLock.classList.remove('hidden');
	else
		_game.htmlGameLock.classList.add('hidden');

	/* add the options based on the selection and result */
	for (let i = 0; i < _game.state.question.options.length; ++i) {
		/* check if the element already exists or needs to be created ([0] is lock-overlay) */
		if (1 + i >= _game.htmlGameContent.children.length) {
			let node = document.createElement('div');
			_game.htmlGameContent.appendChild(node);
			node.classList.add('button');
			let inner = document.createElement('div');
			node.appendChild(inner);
			inner.classList.add('clickable');
			inner.onclick = () => _game.choose(i);
			inner.appendChild(document.createElement('p'));
		}
		let node = _game.htmlGameContent.children[i + 1];
		let question = _game.state.question;

		/* setup the selection-theme (even if the choice was correct, ensure not failed by another player) */
		if (_game.self.choice != _game.fromScramble[i])
			node.classList.remove('selected', 'selected-correct', 'selected-wrong');
		else if (_game.state.phase == 'answer')
			node.classList.add('selected');
		else if (_game.fromScramble[i] == 0 && _game.self.correct)
			node.classList.add('selected-correct');
		else
			node.classList.add('selected-wrong');

		/* setup the disabled-index */
		if (_game.state.phase == 'resolved')
			node.classList.add('disabled');
		else
			node.classList.remove('disabled');

		/* setup the result colors */
		if (_game.state.phase == 'answer') {
			node.classList.remove('invalid');
			node.classList.remove('correct');
		}
		else if (_game.fromScramble[i] == 0) {
			node.classList.remove('invalid');
			node.classList.add('correct');
		}
		else {
			node.classList.remove('correct');
			node.classList.add('invalid');
		}

		/* add the actual text content */
		node.children[0].children[0].innerText = question.options[_game.fromScramble[i]];
	}

	/* remove the remaining children */
	while (_game.htmlGameContent.children.length > 1 + _game.state.question.options.length)
		_game.htmlGameContent.lastChild.remove();
}
_game.applySetup = function () {
	_game.screen('setup');

	/* update the setup ready-screen */
	if (_game.self.ready)
		_game.htmlSetupLock.classList.remove('hidden');
	else
		_game.htmlSetupLock.classList.add('hidden');

	/* update the confidence slider */
	_game.htmlConfidenceValue.innerText = `Confidence: ${_game.self.confidence}`;
	for (let i = 0; i < 5; ++i)
		_game.htmlConfidenceSelect.classList.remove(`value${i}`);
	_game.htmlConfidenceSelect.classList.add(`value${_game.self.confidence + 1}`);
	_game.htmlConfidenceSlider.value = _game.self.confidence;

	/* update the effect buttons */
	for (const effName in _game.effects)
		_game.applyEffect(effName);
}
_game.applyEffect = function (effName) {
	const can = _game.canEffect(effName, false);
	const effect = _game.effects[effName];

	if (can)
		effect.html.classList.remove('disabled');
	else
		effect.html.classList.add('disabled');

	if (_game.self.effects[effName] != null && ('select' in effect))
		effect.html.children[0].children[2].innerText = `Selected: ${_game.state.players[_game.self.effects[effName]].name}`;
	else if (can)
		effect.html.children[0].children[2].innerText = `Timed Out for ${effect.timeout} Rounds`;
	else
		effect.html.children[0].children[2].innerText = `Available in ${_game.self.last[effName] + effect.timeout - _game.state.round + 1} Rounds`;
}

/* called from/for html */
_game.screen = function (name) {
	_game.htmlLogin.classList.add('hidden');
	_game.htmlMain.classList.add('hidden');
	_game.htmlSplashScreen.classList.add('hidden');
	_game.htmlSetupScreen.classList.add('hidden');
	_game.htmlGameScreen.classList.add('hidden');
	_game.htmlSelectScreen.classList.add('hidden');
	_game.htmlScoreScreen.classList.add('hidden');

	if (name == 'login')
		_game.htmlLogin.classList.remove('hidden');
	else {
		_game.htmlMain.classList.remove('hidden');
		if (name == 'splash')
			_game.htmlSplashScreen.classList.remove('hidden');
		else if (name == 'setup')
			_game.htmlSetupScreen.classList.remove('hidden');
		else if (name == 'game')
			_game.htmlGameScreen.classList.remove('hidden');
		else if (name == 'select')
			_game.htmlSelectScreen.classList.remove('hidden');
		else if (name == 'score')
			_game.htmlScoreScreen.classList.remove('hidden');
	}
}
_game.failed = function (msg) {
	_game.screen('login');
	_game.htmlWarning.classList.remove('hidden');
	_game.htmlWarningText.innerText = msg;
	_game.selectDescription = '';
	_game.viewScore = false;
	_game.loggedIn = null;
	_game.self = null;
}
_game.login = function () {
	const name = _game.htmlName.value.trim();

	/* validate the name */
	if (!name.match(GAME_NAME_REGEX)) {
		_game.failed('Please Enter a Valid Name');
		return;
	}

	/* check if the server connection exists */
	if (!_game.sock.connected()) {
		if (_game.sock.connecting())
			_game.failed('Connecting to server...');
		else {
			_game.failed('Retrying to connect to server...');
			_game.sock.retry();
		}
		_game.tryLogIn = true;
		return;
	}
	_game.tryLogIn = false;

	/* write the last name as a cookie out */
	_game.setCookie(__LOAD_PARAMS__?.cookie?.name ?? '', name);

	/* select the playerid according to the config */
	_game.id = (_game.idByName ? name : _game.playerId);

	/* mark the player as logged in and fetch the cleanest data */
	_game.loggedIn = { name, applied: false };
	_game.sock.fetch();
}
_game.ready = function () {
	if (_game.self == null || _game.self.ready || _game.state.phase == 'done' || _game.totalPlayerCount < 2)
		return;

	_game.self.ready = true;
	_game.selfChanged(true);
}
_game.toggleScore = function () {
	if (_game.self == null)
		return;
	_game.viewScore = !_game.viewScore;
	_game.applyState(null);
}
_game.slide = function (v) {
	if (_game.self == null || _game.self.ready || _game.state.phase != 'category')
		return;

	_game.self.confidence = Number(v);
	_game.selfChanged(true);
}
_game.choose = function (v) {
	if (_game.self == null || _game.self.ready || _game.state.phase != 'answer')
		return;

	_game.self.choice = _game.fromScramble[v];
	_game.self.correct = (_game.self.choice == 0);
	_game.selfChanged(true);
}
_game.activate = function (effName) {
	if (!_game.canEffect(effName, true))
		return;
	if (!('select' in _game.effects[effName])) {
		_game.doEffect(effName, _game.loggedIn.name);
		return;
	}

	_game.selectDescription = _game.effects[effName].select;
	_game.selectCallback = function (id) {
		if (id != null && _game.canEffect(effName, true))
			_game.doEffect(effName, id);
	};
	_game.applyState(null);
}
_game.pick = function (id) {
	if (_game.self == null)
		return;

	/* select-callback will automatically apply state */
	_game.selectDescription = '';
	_game.selectCallback(id);
	_game.applyState(null);
}
_game.remove = function () {
	if (_game.self == null)
		return;

	if (!_game.sock.connected())
		_game.failed('Network issue while removing player');
	else {
		delete _game.state.players[_game.id];
		_game.sock.sync(_game.id, null);
		_game.failed('Player has been removed');
	}
}
