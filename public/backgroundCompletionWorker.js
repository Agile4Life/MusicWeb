// A separate wake-up source for end-of-track recovery in hidden tabs.
// The page owns playback decisions; the worker only requests a state check.
let heartbeat = null

self.onmessage = ({ data }) => {
  if (data === 'start' && heartbeat === null) {
    heartbeat = setInterval(() => self.postMessage('tick'), 1500)
  } else if (data === 'stop' && heartbeat !== null) {
    clearInterval(heartbeat)
    heartbeat = null
  }
}
