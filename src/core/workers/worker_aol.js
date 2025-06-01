const SnowflakeAol = require("../SnowflakeAol");
const { parentPort, workerData } = require('worker_threads');
const { database_path, permission } = workerData;

// Check database path
if(!database_path)
    throw new Error("Database path given to backup worker is not valid or doesn't exist!");

// Manage backup files
const aol = new SnowflakeAol(database_path, permission);

// Initialize the class as worker
aol.worker();

// Check if backup file is created and permissions are granted
if(!aol.file_descriptor)
    throw new Error(aol.last_error || "An error has occurred inside AOL (backup) worker!");

function send(nonce, response, success){
    parentPort.postMessage({ nonce, response, success });
}

function send_success(response, nonce){
    send(nonce, response, true);
}

function send_error(response, nonce){
    send(nonce, response, false);
}

function blockForSeconds(seconds) {
    const start = Date.now();
    while (Date.now() - start < seconds * 1000) {
        // Busy-wait loop, blocking the event loop
    }
}

let counter = 0;
function generateNonce() {
    return (Date.now().toString(36) + (counter++).toString(36));
}

parentPort.on("message", data => {
    let { action, nonce } = data;
    if(!nonce)
        nonce = generateNonce();
    if(action === "set"){
        const { key, value } = data;
        if(!key){
            send_error(null, nonce);
            return;
        }
        aol.add(key, value);
        send_success(null, nonce);
    }
    else{
        send_error(null, nonce);
    }
});