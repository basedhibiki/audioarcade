
/* Minimal wrapper around existing control panel logic.
   In production, you can drop your Part1-4 code and wire to channelId (slug) */

window.initAudioArcadeWidget = function initAudioArcadeWidget({ channelSlug, signalingUrl }) {
  const container = document.getElementById('aa-widget');
  if (!container) return;

  // Basic UI
  container.innerHTML = `
    <div style="position:fixed;bottom:10px;right:10px;background:#111;color:#eee;padding:12px;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.3);font-family:Inter,system-ui">
      <div id="status-box" style="margin-bottom:8px;font-weight:600">Status: Connecting…</div>
      <div id="message-box" style="margin-bottom:8px;min-height:18px;font-size:12px;opacity:.85"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="start-btn" disabled>Start Audio</button>
        <button id="mute-btn" disabled>Mute</button>
        <button id="listen-btn" disabled>Listen</button>
        <button id="request-btn">Request Control</button>
        <button id="release-btn" disabled>Release</button>
      </div>
    </div>
  `;

  const Vars = window.AudioArcadeVars = {
    SIGNALING_SERVER: signalingUrl || 'http://localhost:8787',
    channelId: channelSlug,
    socket: null,
    localStream: null,
    peerConnections: {},
    listenPeerConnection: null,
    hasAudioControl: false,
    isListening: false,
    isMuted: false,
    currentControlUser: null,
    config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
    debugLog: (...a) => console.log('[AA]', ...a),
    showMessage: (m) => { const mb = document.getElementById('message-box'); if (mb) mb.textContent = m; }
  };

  const statusBox = document.getElementById('status-box');

  // Socket.IO
  const s = document.createElement('script');
  s.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
  s.onload = () => {
    const ioClient = window.io;
    const socket = ioClient(Vars.SIGNALING_SERVER, { transports:['websocket'] });
    Vars.socket = socket;

    socket.on('connect', () => {
      statusBox.textContent = 'Status: Connected'; statusBox.style.color = 'lime';
      socket.emit('join-channel', { channelId: Vars.channelId, token: null });
    });

    socket.on('broadcaster-status', (d) => {
      Vars.currentControlUser = d.broadcaster;
      Vars.hasAudioControl = d.broadcaster === socket.id;
      updateUI();
    });

    socket.on('control:granted', ({ userId }) => {
      if (userId === socket.id) { Vars.hasAudioControl = true; Vars.showMessage('You now have control'); }
      updateUI();
    });

    socket.on('control:cleared', () => { Vars.hasAudioControl = false; Vars.currentControlUser = null; updateUI(); });

    // Relay WebRTC offers/answers/candidates (MVP listener-only flow to keep short)
    socket.on('signal', async ({ fromUserId, data }) => {
      if (Vars.isListening && Vars.listenPeerConnection) {
        if (data.answer) await Vars.listenPeerConnection.setRemoteDescription(data.answer);
        if (data.candidate) await Vars.listenPeerConnection.addIceCandidate(data.candidate);
      }
    });

    // Buttons
    document.getElementById('request-btn').onclick = () => socket.emit('request-control', { channelId: Vars.channelId });
    document.getElementById('release-btn').onclick = () => socket.emit('release-control', { channelId: Vars.channelId });

    document.getElementById('listen-btn').onclick = () => {
      if (Vars.isListening) stopListening(); else startListening();
    };

    document.getElementById('mute-btn').onclick = () => {
      if (!Vars.localStream) return;
      Vars.isMuted = !Vars.isMuted;
      Vars.localStream.getAudioTracks().forEach(t => t.enabled = !Vars.isMuted);
      document.getElementById('mute-btn').textContent = Vars.isMuted ? 'Unmute' : 'Mute';
    };

    document.getElementById('start-btn').onclick = async () => {
      if (!Vars.hasAudioControl) return Vars.showMessage('Request control first');
      try {
        // Desktop mic for MVP (you can paste your Part 3 capture logic here)
        Vars.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        // In your full code you would create offers to each listener; omitted for brevity
        Vars.showMessage('Broadcasting (MVP stub)');
      } catch (e) { Vars.showMessage('Mic error: ' + e.message); }
    };

    function updateUI() {
      const startBtn = document.getElementById('start-btn');
      const muteBtn = document.getElementById('mute-btn');
      const listenBtn = document.getElementById('listen-btn');
      const requestBtn = document.getElementById('request-btn');
      const releaseBtn = document.getElementById('release-btn');

      if (Vars.hasAudioControl) {
        statusBox.textContent = 'Status: Broadcasting'; statusBox.style.color = 'lime';
        startBtn.disabled = false; releaseBtn.disabled = false; requestBtn.disabled = true; listenBtn.disabled = true;
        muteBtn.disabled = !Vars.localStream;
      } else if (Vars.currentControlUser) {
        statusBox.textContent = 'Status: Someone is broadcasting'; statusBox.style.color = 'deepskyblue';
        startBtn.disabled = true; releaseBtn.disabled = true; requestBtn.disabled = false; listenBtn.disabled = false; muteBtn.disabled = true;
      } else {
        statusBox.textContent = 'Status: No one is broadcasting'; statusBox.style.color = 'gray';
        startBtn.disabled = true; releaseBtn.disabled = true; requestBtn.disabled = false; listenBtn.disabled = true; muteBtn.disabled = true;
      }
    }

    async function startListening() {
      if (!Vars.currentControlUser) return Vars.showMessage('No broadcaster');
      Vars.isListening = True = true;
      document.getElementById('listen-btn').textContent = 'Stop Listening';
      Vars.listenPeerConnection = new RTCPeerConnection(Vars.config);
      Vars.listenPeerConnection.ontrack = (e) => {
        let el = document.querySelector('.aa-audio'); if (!el) { el = document.createElement('audio'); el.className='aa-audio'; el.autoplay = true; el.controls = true; document.body.appendChild(el); }
        el.srcObject = e.streams[0];
      };
      Vars.listenPeerConnection.onicecandidate = (ev) => {
        if (ev.candidate) Vars.socket.emit('signal', { channelId: Vars.channelId, toUserId: Vars.currentControlUser, data: { candidate: ev.candidate }});
      };
      Vars.listenPeerConnection.addTransceiver('audio', { direction: 'recvonly' });
      const offer = await Vars.listenPeerConnection.createOffer();
      await Vars.listenPeerConnection.setLocalDescription(offer);
      Vars.socket.emit('signal', { channelId: Vars.channelId, toUserId: Vars.currentControlUser, data: { offer } });
    }

    function stopListening() {
      Vars.isListening = false;
      document.getElementById('listen-btn').textContent = 'Listen';
      if (Vars.listenPeerConnection) { Vars.listenPeerConnection.close(); Vars.listenPeerConnection = null; }
      const el = document.querySelector('.aa-audio'); if (el) el.remove();
    }

  };
  document.body.appendChild(s);
};
