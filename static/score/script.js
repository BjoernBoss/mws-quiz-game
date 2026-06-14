/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024-2026 Bjoern Boss Henrichsen */
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
	_game.sock = new SyncSocket(`ws/${_game.sessionId}`);
	_game.sock.onfailed = (m) => alert(m);
	_game.sock.onupdate = (s) => _game.applyState(s);
	_game.sock.onestablished = null;

	/* fetch the initial state */
	_game.sock.fetch();
}
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
			_game.htmlCorrect.innerText = `Correct: ${_game.state.question.options[0]}`;
		}
		else
			_game.htmlCorrect.classList.add('hidden');
	}

	UpdateScoreboard(_game.state, _game.htmlScoreContent);
}
