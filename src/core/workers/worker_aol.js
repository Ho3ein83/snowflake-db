const SnowflakeAol = require("../SnowflakeAol");
const { parentPort, workerData } = require("worker_threads");
const { database_path, permission, maxBackupSize, backupInterval, megaBinary, snapshotSizeTrigger } = workerData;

// Check database path
if(!database_path)
    throw new Error("Database path given to backup worker is not valid or doesn't exist!");

// Manage backup files
const aol = new SnowflakeAol({
    databasePath: database_path,
    permission: permission,
    maxFileSize: maxBackupSize,
    backupInterval: backupInterval,
    megaBinaryMode: megaBinary,
    snapshotSizeTrigger: snapshotSizeTrigger,
    triggerSnapshotCallback: () => {
        parentPort.postMessage({ requestName: "persistent" });
    }
});

// Initialize the class as worker
aol.worker();

// Check if backup file is created and permissions are granted
if(!aol.currentFilename)
    throw new Error(aol.lastError || "An error has occurred inside AOL (backup) worker!");

function send(nonce, response, success, requestId){
    parentPort.postMessage({ nonce, response, success, requestId });
}

function send_success(response, nonce, requestId){
    send(nonce, response, true, requestId);
}

function send_error(response, nonce, requestId){
    send(nonce, response, false, requestId);
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
    let { action, nonce, requestId } = data;
    if(!nonce)
        nonce = generateNonce();
    if(action === "set"){
        let { key, value } = data;
        if(value instanceof Uint8Array)
            value = Buffer.from(value);
        if(!key){
            send_error(null, nonce, requestId);
            return;
        }
        aol.add(key, value);
        send_success(null, nonce, requestId);
    }
    else if(action === "remove"){
        const { key } = data;
        if(!key){
            send_error(null, nonce, requestId);
            return;
        }
        aol.remove(key);
        send_success(null, nonce, requestId);
    }
    else if(action === "rotate"){
        const { onlyIfEmpty } = data;
        if(onlyIfEmpty){
            if(aol.fileSize <= 0){
                send_success(null, nonce, requestId);
                return;
            }
        }
        aol.rotateAndRemake();
        send_success(null, nonce, requestId);
    }
    else if(action === "ping"){
        send_success(true, nonce, requestId);
    }
    else{
        send_error(null, nonce, requestId);
    }
});