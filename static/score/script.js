/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024-2025 Bjoern Boss Henrichsen */
let _game = {};

window.onload = function () {
	/* caption/body components */
	_game.htmlCategory = document.getElementById('category');
	_game.htmlQuestion = document.getElementById('question');
	_game.htmlCorrect = document.getElementById('correct');
	_game.htmlRound = document.getElementById('round');
	_game.htmlScoreContent = document.getElementById('score-content');
	_game.htmlPhase = document.getElementById('phase');
	_game.effects = {
		expose: 'Exposed',
		protect: 'Protected',
		min: 'Minimum confidence because of',
		max: 'Maximum confidence because of',
		zero: 'No Points because of',
		steal: 'Stolen by',
		fail: 'Failed by',
		swap: 'Swapped Points with',
		double: 'Double or Nothing',
	};

	/* setup the overall state */
	_game.state = {};
	_game.sessionId = new URLSearchParams(location.search).get('id') ?? 'no-session-id';

	/* setup the web-socket */
	_game.sock = new SyncSocket(`/quiz-game/ws/${_game.sessionId}`);
	_game.sock.onfailed = (m) => alert(m);
	_game.sock.onupdate = (s) => _game.applyState(s);
	_game.sock.onestablished = null;

	/* fetch the initial state */
	_game.sock.fetch();
};
_game.applyState = function (state) {
	_game.state = state;
	console.log('Applying received state');

	/* update the current score and category */
	if (_game.state.round == null)
		_game.htmlRound.innerText = `Round: None / ${_game.state.totalQuestions}`;
	else
		_game.htmlRound.innerText = `Round: ${_game.state.round + 1} / ${_game.state.totalQuestions}`;
	_game.htmlPhase.innerText = `Phase: ${_game.state.phase}`;
	if (_game.state.question == null) {
		_game.htmlCategory.classList.add('hidden');
		_game.htmlQuestion.classList.add('hidden');
		_game.htmlCorrect.classList.add('hidden');
	}
	else {
		_game.htmlCategory.classList.remove('hidden');
		_game.htmlCategory.innerText = `Category: ${_game.state.question.category}`;

		if (_game.state.phase != 'category') {
			_game.htmlQuestion.classList.remove('hidden');
			_game.htmlQuestion.innerText = `Question: ${_game.state.question.text}`;
		}
		else
			_game.htmlQuestion.classList.add('hidden');

		if (_game.state.phase == 'resolved') {
			_game.htmlCorrect.classList.remove('hidden');
			_game.htmlCorrect.innerText = `Correct: ${_game.state.question.options[_game.state.question.correct]}`;
		}
		else
			_game.htmlCorrect.classList.add('hidden');
	}

	/* collect the list of all players and sort them by their score */
	let list = [];
	for (const key in _game.state.players)
		list.push([key, _game.state.players[key].score]);
	list.sort((a, b) => ((a[1] < b[1] || (a[1] == b[1] && a[0] > b[0])) ? 1 : -1));

	/* add the list of players */
	for (let i = 0; i < list.length; ++i) {
		/* check if the element already exists or needs to be created */
		if (i >= _game.htmlScoreContent.children.length) {
			let node = document.createElement('div');
			_game.htmlScoreContent.appendChild(node);
			node.classList.add('score');
		}
		let node = _game.htmlScoreContent.children[i];
		let player = _game.state.players[list[i][0]];
		let count = 0;
		let makeNext = function () {
			if (count >= node.children.length) {
				let temp = document.createElement('p');
				node.appendChild(temp);
				temp.classList.add(count == 0 ? 'name' : 'detail');
			}
			return node.children[count++];
		};

		/* add the name and score and ready-flag (first has always name-style) */
		makeNext().innerText = `Name: ${list[i][0]}`;
		makeNext().innerText = `Score: ${player.score} (Previously: ${player.score - player.delta})`;
		makeNext().innerText = `Ready: ${player.ready ? 'True' : 'False'}`;

		/* add the result */
		if (_game.state.phase == 'resolved') {
			let next = makeNext();
			if (player.choice == -1)
				next.innerText = `Result: None`;
			else
				next.innerText = `Result: ${_game.state.question.options[player.choice]} (${player.correct ? 'Correct' : 'Incorrect'})`;
		}

		/* add the confidence */
		if (_game.state.phase == 'resolved')
			makeNext().innerText = `Confidence: ${player.confidence}`;

		/* add the delta */
		if (_game.state.phase == 'resolved')
			makeNext().innerText = `Points: ${player.delta < 0 ? '' : '+'}${player.delta}`;

		/* add the effects flags */
		for (const key in player.effects) {
			if (player.applied[key] != null)
				makeNext().innerText = `${_game.effects[key]}: ${player.applied[key]}`;
		}

		/* remove any remaining children */
		while (node.children.length > count)
			node.lastChild.remove();
	}

	/* remove the remaining children */
	while (_game.htmlScoreContent.children.length > list.length)
		_game.htmlScoreContent.lastChild.remove();
};
