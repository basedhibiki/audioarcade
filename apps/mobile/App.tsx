import React from 'react'
import { SafeAreaView } from 'react-native'
import ChannelScreen from './src/ChannelScreen'

// simple: hardcode a room while testing
export default function App() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ChannelScreen roomName="demo" />
    </SafeAreaView>
  )
}
