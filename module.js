// Snowflake core
const SnowflakeYaml = require("./src/core/SnowflakeYaml");
const SnowflakeServer = require("./src/core/SnowflakeServer");
const SnowflakeCoreHelper = require("./src/core/SnowflakeCoreHelper");
const SnowflakeLogger = require("./src/core/SnowflakeLogger");
const SnowflakeCypher = require("./src/core/SnowflakeCypher");
const Snowflake = require("./src/core/Snowflake");
const snowflakeEvents = require("./src/core/SnowflakeEvents");

// Filesystem and path
const fs = require("fs");
const path = require("path");

Snowflake.path = __dirname;
Snowflake.corePath = path.join(Snowflake.path, "src/core");

function startSnowflake(configsYamlPath, appConfigPath = null){

    // Prevent from running twice
    if(Snowflake.core !== null){
        console.log("\x1b[31mℹ Database is already running, cannot run another database in the same process.\x1b[0m");
        return;
    }

    // Check if configuration file exist
    let configFileExists = fs.existsSync(configsYamlPath);

    // Configuration file is necessary for database
    // If no config path or an invalid one was given, it'll stop the app from getting started
    if(!configsYamlPath || typeof configsYamlPath !== "string"){

        console.log("\x1b[31m🗴 Invalid configuration path.\n" +
            "Enter the path when calling 'startSnowflake'. " +
            "If the file didn't exist, it'll create a new file (with default configuration) for you and you can edit later.\x1b[0m");

        process.exit(1);

    }

    // The absolute path of the configuration file
    // If you change this during runtime, configuration won't change until you restart with the new config path
    Snowflake.configPath = Snowflake.resolvePath(configsYamlPath);

    // Create a new config file with default configuration for user to edit it
    if(!configFileExists){

        // Read default config file
        const yamlConfigContent = fs.readFileSync(path.join(Snowflake.path, "configs.default.yaml")).toString();

        const directory = path.dirname(Snowflake.configPath);

        // Create recursive directories if they don't exist
        if(!fs.existsSync(directory))
            fs.mkdirSync(directory, { recursive: true });

        // Create the new config file
        fs.writeFileSync(Snowflake.configPath, yamlConfigContent.trim());

        // [SnowflakeEventEmit]: config_created
        snowflakeEvents.emit("config_created");

        console.log(`\x1b[35m✓ Configuration file has been created in ${Snowflake.configPath}\x1b[0m`);

    }

    // Configuration core for making your app customizable
    const yaml = SnowflakeYaml.fromFile(Snowflake.configPath);
    if(configFileExists)
        console.log(`\x1b[35m✓ Configuration file has been loaded from ${Snowflake.configPath}`);

    // [SnowflakeEventEmit]: config_loaded @ SnowflakeYaml
    snowflakeEvents.emit("config_loaded", yaml);

    // Config object
    Snowflake.yaml = yaml;

    // Mark configuration file as unchanged (recently loaded without any changes afterward)
    Snowflake.yaml.changed = false;

    // App config path
    Snowflake.appConfigPath = appConfigPath;

    // Default app config path
    Snowflake.defaultAppConfigPath = path.join(Snowflake.path, "app.json");

    // Use default app config file
    if(appConfigPath === null)
        Snowflake.appConfigPath = Snowflake.defaultAppConfigPath;

    // App configuration is not necessary for database to be working, however it's recommended to use your own configuration
    if(appConfigPath !== null && typeof appConfigPath !== "string"){

        console.error("\x1b[31m🗴 Invalid app configuration path.\n" +
            "Enter the path when calling 'startSnowflake'. " +
            "If the file didn't exist, it'll create a new file (with default app configuration) for you and you can edit later.\x1b[0m");

        process.exit(1);

    }

    // Create the default app configuration for user to edit it
    else if(!fs.existsSync(Snowflake.appConfigPath)){

        // Load default app configuration
        try {

            // Parse default config
            Snowflake.config = JSON.parse(fs.readFileSync(Snowflake.defaultAppConfigPath).toString());

            // [SnowflakeEventEmit]: app_config_loaded @ object
            snowflakeEvents.emit("app_config_loaded", Snowflake.config);

            const directory = path.dirname(Snowflake.appConfigPath);

            // Create recursive directories if they don't exist
            if(!fs.existsSync(directory))
                fs.mkdirSync(directory, { recursive: true });

            // Create the new app config file
            fs.writeFileSync(Snowflake.appConfigPath, JSON.stringify(Snowflake.config, null, 2));

            // [SnowflakeEventEmit]: app_config_created
            snowflakeEvents.emit("app_config_created");

            console.log(`\x1b[35m✓ App configuration file has been created in ${Snowflake.configPath}\x1b[0m`);

        } catch (e){

            console.log(`\x1b[31mCouldn't create/parse app configuration: ${e}\x1b[0m`);

            process.exit(1);

        }

    }

    // Load current app configuration
    else {

        try {

            // Parse user provided app config
            Snowflake.config = JSON.parse(fs.readFileSync(Snowflake.appConfigPath).toString());

            // [SnowflakeEventEmit]: app_config_loaded @ object
            snowflakeEvents.emit("app_config_loaded", Snowflake.config);

            console.log(`\x1b[35m✓ App configuration file has been loaded from ${Snowflake.appConfigPath}\x1b[0m`);

        } catch (e){

            console.log(`\x1b[31mCouldn't parse app configuration: ${e}\x1b[0m`);

            process.exit(1);

        }

    }

    // [SnowflakeEventEmit]: before_start
    snowflakeEvents.emit("before_start");

    Snowflake.isDevelopment = false;
    if(typeof Snowflake.config.is_development !== "undefined")
        Snowflake.isDevelopment = Boolean(Snowflake.config.is_development);

    // Logger core for logging
    const logger = new SnowflakeLogger(yaml.get("logs"), yaml.get("dir.logs"));
    Snowflake.logger = logger;

    // Call entry points to initialize events on startup
    // Soft-restarting the app causes to remove all events, but with entry points you can add them again
    snowflakeEvents.callEntryPoints();

    // Start the benchmark
    logger.timeStart("application");
    logger.timeStart("encryption");

    // Initialize encryption core
    const cypher = new SnowflakeCypher(Snowflake.resolvePath(Snowflake.yaml.get("meids.encryption_cypher")));

    // Enable encryption
    if(Snowflake.yaml.isTrue("meids.encrypt"))
        cypher.init();

    logger.benchmark("Encryption core initialized", "encryption");

    // Encryption core
    Snowflake.cypher = cypher;

    logger.timeStart("app_validation");

    // Validate app configs
    let is_app_valid = true;
    const validate = {
        "signature": v => v.length !== 8 ? "app.json: Property 'signature' must be exactly 8 characters long." : true,
        "access_keys": v => {
            if(!Object.entries(v).length)
                logger.warning("app.json: Property 'access_keys' is empty, you won't be able to connect until you add an access key.");
            return true;
        },
        "encryption_salt": v => {
            if(Snowflake.yaml.isTrue("meids.encrypt")){
                if(v.length !== 32)
                    return "app.json: Property 'encryption_salt' must be exactly 32 characters.";
            }
            return true;
        }
    };

    let errors = [];
    for(let [i, callback] of Object.entries(validate)){
        let isValid = true, errorMessage = `app.json: Property '${i}' is missing or invalid.`;
        if(typeof Snowflake.config[i] === "undefined" || !Snowflake.config[i]){
            isValid = false;
        }
        else{
            const v = callback(Snowflake.config[i]);
            if(v !== true) {
                if(typeof v === "string" && v.length)
                    errorMessage = v;
                isValid = false;
            }
        }
        if(!isValid) {
            errors.push(errorMessage);
            logger.warning(errorMessage);
            is_app_valid = false;
        }
    }

    logger.benchmark("Application was validated", "app_validation");

    // Stop the app if config file is invalid
    if(!is_app_valid)
        logger.assert("app.json: Failed to start the application.\n" + errors.join("\n"));

    // Main core for handling database and file systems
    const core = SnowflakeCoreHelper;
    Snowflake.core = core;

    // Server core for making HTTP webserver and websockets
    const server = SnowflakeServer;
    Snowflake.server = server;

    // Start the server (Websocket and HTTP server)
    logger.benchmarkCode(() => {
        server.start();
    }, "Server initialized");

    // Start main core (database and app initialization)
    logger.benchmarkCode(() => {
        core.start();
    }, "Database loaded");

    // Display ready message
    logger.benchmark("✓ Program started", "application");

    // [SnowflakeEventEmit]: start
    snowflakeEvents.emit("start");

}

function stopSnowflake(){

    return new Promise((resolve, reject) => {

        // [SnowflakeEventEmit]: before_stop
        snowflakeEvents.emit("before_stop");

        // Stop HTTP server and websocket
        Snowflake.server.stop().then(() => {

            // Stop database workers
            Snowflake.core.stopWorkers();

            // Terminate other cores with their data
            Snowflake.core = null;
            Snowflake.yaml = null;
            Snowflake.cypher = null;

            // [SnowflakeEventEmit]: stop
            snowflakeEvents.emit("stop");

            // Clear all events and filters
            snowflakeEvents.clearEvents().clearFilters();

            // Call exit points to clean up (to prevent memory leaks and multiple initialization of your module)
            snowflakeEvents.callExitPoints();

            resolve();

        }).catch(e => reject(e));

    });

}

function restartSnowflake(){

    // [SnowflakeEventEmit]: before_restart
    snowflakeEvents.emit("before_restart");

    const configPath = Snowflake.configPath;
    const appConfigPath = Snowflake.appConfigPath;
    const divider = "---------------------------------";

    console.log(divider);
    console.log("[RESTART] Stopping application...");

    stopSnowflake().then(() => {

        console.log("[RESTART] Starting application...");
        console.log(divider);

        startSnowflake(configPath, appConfigPath);

        // [SnowflakeEventEmit]: restart
        snowflakeEvents.emit("restart");

    }).catch(e => {

        Snowflake.logger.log(`%red%[RESTART] ${e}%clear%`);
        console.log(divider);

    });

}

// A new entry point to add events on startup
snowflakeEvents.addEntryPoint(() => {

    // [SnowflakeEventListener]: request_restart
    snowflakeEvents.on("request_restart", restartSnowflake);

});

module.exports = {
    Snowflake,
    startSnowflake,
    stopSnowflake,
    restartSnowflake,
    snowflakeEvents
};