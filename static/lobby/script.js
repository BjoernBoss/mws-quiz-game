/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2026 Bjoern Boss Henrichsen */
const DURATION_SHOW_CHECK_MS = 750;
const DURATION_ANIMATION_RECOVER_MS = 500;

window.onload = function () {
	const pathCreate = (__LOAD_PARAMS__?.create ?? '/bad_path');
	const pathClient = (__LOAD_PARAMS__?.client ?? '/bad_path');
	const pathScore = (__LOAD_PARAMS__?.score ?? '/bad_path');
	const timeout = (__LOAD_PARAMS__?.timeout ?? 'bad_timeout');

	document.getElementById('timeout').innerText = `Session will be deleted after ${timeout} Minutes of inactivity!`;

	if (navigator?.clipboard != null) {
		for (const kind of ['player', 'score']) {
			const element = document.getElementById(`${kind}-copy`);
			let timer = null;

			element.classList.add('show');
			element.onclick = () => {
				navigator.clipboard.writeText(document.getElementById(kind).href)
					.then(() => {
						const child = element.children[0];
						if (timer != null)
							clearTimeout(timer);
						child.classList.remove('blank');
						child.style.setProperty('--duration', `${DURATION_ANIMATION_RECOVER_MS}ms`);

						/* perform a small transition animation of the icon */
						child.innerText = '\u{2705}';
						timer = setTimeout(() => {
							child.classList.add('blank');
							timer = setTimeout(() => {
								child.innerText = '\u{1F4CB}';
								child.classList.remove('blank');
							}, DURATION_ANIMATION_RECOVER_MS);
						}, DURATION_SHOW_CHECK_MS);
					})
					.catch(() => {
						document.getElementById('error').classList.add('show');
						document.getElementById('error-text').innerText = `Clipboard error`;
					});
			}
		}
	}

	document.getElementById('create-button').onclick = () => fetch(pathCreate).then((resp) => {
		if (resp.status != 200)
			throw new Error(`Server responded with ${resp.status}`);
		if (resp.headers.has('content-type') && !resp.headers.get('content-type').startsWith('application/json'))
			throw new Error(`Server did not respond with json`);
		return resp.json();
	}).then((resp) => {
		if (typeof resp != 'object' || typeof resp.id != 'string')
			throw new Error(`Server responded with unsupported session data`);

		document.getElementById('error').classList.remove('show');
		document.getElementById('caption').innerText = 'New Session Created!';
		document.getElementById('create').classList.remove('show');
		document.getElementById('select').classList.add('show');
		document.getElementById('details').classList.add('show');

		document.getElementById('player').href = `${pathClient}?id=${encodeURIComponent(resp.id)}`;
		document.getElementById('score').href = `${pathScore}?id=${encodeURIComponent(resp.id)}`;
	}).catch((err) => {
		document.getElementById('error').classList.add('show');
		document.getElementById('error-text').innerText = `Error: ${err.message}`;
	});
}
