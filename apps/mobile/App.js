import React, { useEffect, useState } from 'react';
import { Text, View, Button } from 'react-native';
import io from 'socket.io-client';

export default function App() {
  const [status, setStatus] = useState('Connecting…');
  const [hasControl, setHasControl] = useState(false);
  const [broadcaster, setBroadcaster] = useState(null);
  useEffect(() => {
    const socket = io(process.env.EXPO_PUBLIC_SIGNAL_URL || 'http://localhost:8787', { transports:['websocket'] });
    socket.on('connect', () => {
      setStatus('Connected'); socket.emit('join-channel', { channelId: 'demo', token: null });
    });
    socket.on('broadcaster-status', (d) => { setBroadcaster(d.broadcaster); setHasControl(d.broadcaster === socket.id); });
    socket.on('control:granted', ({ userId }) => { if (userId === socket.id) setHasControl(true); });
    return () => socket.disconnect();
  }, []);

  return (
    <View style={{flex:1, alignItems:'center', justifyContent:'center', gap:12}}>
      <Text>{status}</Text>
      <Text>{hasControl ? 'You have control' : (broadcaster ? 'Someone is broadcasting' : 'No one broadcasting')}</Text>
      {/* Wire request/release buttons similarly to the web */}
      <Button title="Request Control" onPress={()=>{}} />
    </View>
  );
}
