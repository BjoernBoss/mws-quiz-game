/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024-2026 Bjoern Boss Henrichsen */
let _game = {};

window.onload = function () {
	const pathSockets = (__LOAD_PARAMS__?.sockets ?? '/bad_path');

	/* caption/body components */
	_game.htmlQuestion = document.getElementById('question');
	_game.htmlCategory = document.getElementById('category');
	_game.htmlText = document.getElementById('text');
	_game.htmlSolution = document.getElementById('solution');
	_game.htmlRound = document.getElementById('round');
	_game.htmlScoreContent = document.getElementById('score-content');
	_game.htmlPhase = document.getElementById('phase');

	/* setup the overall state */
	_game.state = {};
	_game.sessionId = new URLSearchParams(location.search).get('id') ?? 'bad_id';

	/* setup the web-socket */
	_game.sock = new SyncSocket(`${pathSockets}?id=${_game.sessionId}`);
	_game.sock.onfailed = (m) => alert(m);
	_game.sock.onupdate = (s) => _game.applyState(s);
	_game.sock.onestablished = () => _game.sock.fetch();
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

	if (_game.state.question == null)
		_game.htmlQuestion.classList.add('hidden');
	else {
		_game.htmlQuestion.classList.remove('hidden');
		_game.htmlCategory.innerText = _game.state.question.category;

		if (_game.state.phase != 'category')
			_game.htmlText.innerText = _game.state.question.text;
		else
			_game.htmlText.innerText = '???';

		if (_game.state.phase == 'resolved')
			_game.htmlSolution.innerText = _game.state.question.options[0];
		else
			_game.htmlSolution.innerText = '???';
	}

	UpdateScoreboard(_game.state, _game.htmlScoreContent);
}
