import { useState, useCallback } from "react";
import { SafeAreaView, View, Text, TextInput, Button, Platform } from "react-native";
import { LiveKitRoom } from "@livekit/react-native";

const TOKEN_URL = process.env.EXPO_PUBLIC_TOKEN_URL!;
const SERVER_URL = process.env.EXPO_PUBLIC_LIVEKIT_URL!;

export default function App() {
  const [roomName, setRoomName] = useState("demo");
  const [identity] = useState(() => "mob_" + Math.random().toString(36).slice(2));
  const [connect, setConnect] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const fetchToken = useCallback(async () => {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ room: roomName, identity, role: "participant" })
    });
    const { token } = await res.json();
    setToken(token);
    setConnect(true);
  }, [roomName, identity]);

  if (connect && token) {
    return (
      <LiveKitRoom
        serverUrl={SERVER_URL}
        token={token}
        connect
        audio={true}
        onDisconnected={() => { setConnect(false); setToken(null); }}
      >
        {/* Room renders headlessly for audio-only alpha; you can add UI later */}
      </LiveKitRoom>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, padding: 16, justifyContent: "center" }}>
      <View style={{ gap: 12 }}>
        <Text style={{ fontSize: 20, fontWeight: "600", textAlign: "center" }}>
          Audio Arcade (Alpha)
        </Text>
        <Text>LiveKit URL (set via env): {SERVER_URL ? "OK" : "MISSING"}</Text>
        <Text>Token URL (set via env): {TOKEN_URL ? "OK" : "MISSING"}</Text>

        <Text>Room</Text>
        <TextInput
          value={roomName}
          onChangeText={setRoomName}
          placeholder="demo"
          style={{ borderWidth: 1, padding: 10, borderRadius: 8 }}
          autoCapitalize="none"
        />
        <Button title="Join Room" onPress={fetchToken} />
        <Text style={{ opacity: 0.6, marginTop: 8 }}>
          Identity: {identity} • Platform: {Platform.OS}
        </Text>
      </View>
    </SafeAreaView>
  );
}
