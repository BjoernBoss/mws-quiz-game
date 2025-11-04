/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024-2025 Bjoern Boss Henrichsen */
class SyncSocket {
	constructor(path) {
		this._ws = null;

		/* connection failed to be established or invalid session and reconnection will not be tried */
		this.onfailed = null;

		/* sync state has been received */
		this.onupdate = null;

		/* executed once the connection has been established */
		this.onestablished = null;

		/* queued state to be sent to the remote */
		this._queued = null;

		/* current state has been requested from the remote */
		this._fetch = false;

		/* delay before trying to restart the connection again */
		this._delay = 256;

		/* has the connection already existed */
		this._wasConnected = false;

		/*
		*	connecting: currently trying to establish connection
		*	ready: connection ready and able to receive response
		*	failed: failed and not retrying
		*/
		this._state = 'connecting';

		/* construct the url for the web-socket */
		let protocol = (location.protocol == 'https:' ? 'wss' : 'ws');
		this._url = `${protocol}://${location.host}${path}`;

		/* try to establish the first connection */
		this._establish();
	}

	/* check if the socket is connected */
	connected() {
		return (this._state == 'ready');
	}

	/* check if the socket is being connected */
	connecting() {
		return (this._state != 'failed');
	}

	/* sync the state of [name] with the value of [state] */
	sync(name, state) {
		this._queued = {
			cmd: 'update',
			name: name,
			value: state,
		};
		if (this._state == 'ready')
			this._sendState();
	}

	/* fetch the current state from the remote */
	fetch() {
		this._fetch = true;
		if (this._state == 'ready')
			this._sendfetch();
	}

	/* retry to establish a connection */
	retry() {
		if (this._state == 'failed')
			this._establish();
	}

	_sendfetch() {
		this._fetch = false;
		console.log(`Fetching state from [${this._url}]...`);
		this._ws.send(JSON.stringify({ cmd: 'state' }));
	}
	_sendState() {
		console.log(`Uploading state to [${this._url}]...`);
		this._ws.send(JSON.stringify(this._queued));
		this._queued = null;
	}
	_establish() {
		console.log(`Trying to connect to [${this._url}]...`);
		this._state = 'connecting';

		/* try to create the socket */
		try {
			this._ws = new WebSocket(this._url);
		} catch (e) {
			console.error(`Error while creating socket to [${this._url}]: ${e}`);
			this._failed(false);
		}

		/* register all callbacks to the socket */
		let that = this;
		this._ws.onmessage = (m) => this._received(m);
		this._ws.onclose = function () {
			console.error(`Connection to remote lost [${that._url}]`);
			that._failed(true);
		};
		this._ws.onopen = function () {
			console.log(`Connection established to [${that._url}]`);
			that._state = 'ready';
			that._wasConnected = true;
			that._delay = 256;

			/* check if the state needs to be synced or fetched
			*	(sync before fetching to ensure the newest state is fetched) */
			if (that._queued != null)
				that._sendState();
			if (that._fetch)
				that._sendfetch();

			/* notify the client about the established connection */
			if (that.onestablished != null)
				that.onestablished();
		};
		this._ws.onerror = () => this._failed(false);
	}
	_kill() {
		let ws = this._ws;
		this._ws = null;
		if (ws == null)
			return;

		/* unbind all callbacks */
		ws.onmessage = null;
		ws.onclose = null;
		ws.onerror = null;
		if (ws.readyState == WebSocket.OPEN)
			try { ws.close(); } catch (_) { }
		else {
			ws.onopen = function () {
				try { ws.close(); } catch (_) { }
			};
		}
	}
	_failed(fast) {
		this._kill();

		/* check if another attempt can be made */
		if (fast) {
			this._establish();
			return;
		}
		if (this._delay <= 1024) {
			this._state = 'connecting';
			setTimeout(() => this._establish(), this._delay);
			this._delay *= 2;
			return;
		}

		/* mark the socket as failed */
		console.error(`Not trying a new connection to [${this._url}]`);
		if (this._wasConnected)
			this._fatal('Connection to server lost!');
		else
			this._fatal('Unable to establish a connection to the server!');
	}
	_fatal(msg) {
		this._kill();
		this._state = 'failed';
		this._wasConnected = false;
		if (this.onfailed != null)
			this.onfailed(msg);
	}
	_received(m) {
		try {
			/* parse the message and handle it accordingly */
			let msg = JSON.parse(m.data);
			switch (msg.cmd) {
				case 'unknown-session':
					this._fatal('Unknown session!');
					break;
				case 'state':
					/* propagate the state to the client */
					if (this.onupdate != null)
						this.onupdate(msg.state);
					break;
				default:
					console.error(`Unknown command for [${this._url}]: ${msg.cmd}`);
					this._fatal('An unknown error occurred!');
					break;
			}
		} catch (e) {
			console.error(`Error while handling message for [${this._url}]: ${e}`);
			this._failed(true);
		}
	}
};
