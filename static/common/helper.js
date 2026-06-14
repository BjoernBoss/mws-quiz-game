/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2026 Bjoern Boss Henrichsen */
function UpdateScoreboard(state, htmlScore) {
	/* collect the list of all players and sort them by their score */
	let list = [];
	for (const key in state.players)
		list.push([key, state.players[key].score]);
	list.sort((a, b) => ((a[1] < b[1] || (a[1] == b[1] && a[0] > b[0])) ? 1 : -1));

	/* add the list of players */
	for (let i = 0; i < list.length; ++i) {
		/* check if the element already exists or needs to be created */
		if (i >= htmlScore.children.length) {
			let node = document.createElement('div');
			htmlScore.appendChild(node);
			node.classList.add('score');
		}
		let node = htmlScore.children[i];
		let player = state.players[list[i][0]];
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
		let pointDelta = '';
		if (state.phase == 'resolved')
			pointDelta = ` (Delta: ${player.delta < 0 ? '' : '+'}${player.delta})`;
		makeNext().innerText = `Name: ${list[i][0]}${player.ready ? ' (Ready)' : ''}`;
		makeNext().innerText = `Score: ${player.score}${pointDelta}`;

		/* add the result */
		if (state.phase == 'resolved') {
			let next = makeNext();
			if (player.choice == -1)
				next.innerText = `Result: None`;
			else
				next.innerText = `Result: ${state.question.options[player.choice]}`;
		}

		/* add the confidence */
		if (state.phase == 'resolved') {
			let text = `Confidence: ${player.payout}`;
			if (player.confidence != player.payout)
				text += ` (Wanted: ${player.confidence})`;
			makeNext().innerText = text;
		}

		/* add the applied effects */
		if (player.applied.length > 0)
			makeNext().innerText = '---- Applied Effects ----';
		for (const line of player.applied)
			makeNext().innerText = line;

		/* remove any remaining children */
		while (node.children.length > count)
			node.lastChild.remove();
	}

	/* remove the remaining children */
	while (htmlScore.children.length > list.length)
		htmlScore.lastChild.remove();
}
