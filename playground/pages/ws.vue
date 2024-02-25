<script setup lang="ts">

const logs = ref<string[]>([])

const log = (...args: any[]) => {
  console.log("[ws]", ...args);
  logs.value.push(args.join(" "));
};

let ws: WebSocket | undefined

const connect = async () => {
  const isSecure = location.protocol === "https:";
  const url = (isSecure ? "wss://" : "ws://") + location.host + "/_ws";

  if (ws) {
    log("Closing...");
    ws.close();
  }

  log("Connecting to", url, "...");
  ws = new WebSocket(url);

  ws.addEventListener("close", () => {
    log("Connection closed");
  });

  ws.addEventListener("error", (event) => {
    log("Error:", event);
  });

  ws.addEventListener("message", (event) => {
    log("Message from server:", event.data);
  });

  log("Waiting for connection...");
  await new Promise((resolve) => ws!.addEventListener("open", resolve));
};

const clearLogs = () => {
  logs.value = []
};

const sendPing = () => {
  log("Sending ping...");
  ws?.send("ping");
};

const message = ref<string>("ping")
const sendMessage = () => {
  ws?.send(message.value);
};

onMounted(async () => {
  await connect();
  sendPing();
})
</script>

<template>
  <div class="ms-m-5" data-theme="dark">
    <h3>Nuxt WebSocket Test Page</h3>

    <div class="ms-btn-group">
      <button @click="sendPing">Send Ping</button>
      <button @click="connect">Reconnect</button>
      <button @click="clearLogs">Clear</button>
    </div>

    <div class="ms-form-group ms-mt-2">
      <div class="row">
        <div class="col-sm-6">
          <input id="message" v-model="message" type="email" class="ms-secondary ms-small" placeholder="Message..."
            @keydown.enter="sendMessage" />
        </div>
        <div class="col-sm-1">
          <button class="ms-btn ms-secondary ms-small" @click="sendMessage">
            Send
          </button>
        </div>
      </div>
      <br />
    </div>
    <pre id="logs">
      <div
v-for="log in logs"
:key="log"
>{{ log }}</div>
    </pre>
  </div>
</template>

<style>
@import url('https://cdn.jsdelivr.net/npm/minstyle.io@2.0.2/dist/css/minstyle.io.min.css');
</style>
