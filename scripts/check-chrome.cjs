const { spawn } = require('child_process');
let WebSocket = globalThis.WebSocket;
if (!WebSocket) {
  try { WebSocket = require('next/dist/compiled/ws'); } catch (e) {}
}

async function main() {
  const chromePath = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
  const chrome = spawn(chromePath, [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--remote-debugging-port=9222',
    'http://localhost:3000/login?redirect=%2Fadmin'
  ]);

  await new Promise(r => setTimeout(r, 2500));

  try {
    const listRes = await fetch('http://127.0.0.1:9222/json');
    const tabs = await listRes.json();
    const pageTab = tabs.find(t => t.type === 'page');
    if (!pageTab) {
      console.log('No page tab found, all tabs:', tabs);
      return;
    }

    const ws = new WebSocket(pageTab.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
      ws.send(JSON.stringify({ id: 2, method: 'Log.enable' }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        console.error('EXCEPTION:', d.text, d.exception ? d.exception.description : '');
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        console.log('CONSOLE [' + msg.params.type + ']:', msg.params.args.map(a => a.value || a.description).join(' '));
      }
    });

    await new Promise(r => setTimeout(r, 4000));
  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    chrome.kill();
    process.exit(0);
  }
}

main();
